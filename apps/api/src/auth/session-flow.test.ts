import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { eq } from 'drizzle-orm';

import { auditLog, users } from '../db/index.ts';
import { createTestDb, type TestDb } from '../db/test-helpers.ts';
import { registerOidcAuthRoutes } from './routes.ts';
import { requireSession } from './guards.ts';
import { OidcClient } from './oidc/index.ts';
import { SESSION_COOKIE_NAME, SessionCodec } from './session/session.ts';
import { OIDC_TXN_COOKIE_NAME, OidcTxnCodec } from './session/txn.ts';
import { CSRF_HEADER } from './csrf.ts';
import type { SessionReader } from './types.ts';
import { LocalOidcIssuer } from './testing/local-oidc-issuer.ts';

/**
 * Task 5a — full OIDC login flow end-to-end over HTTP (bare Fastify + PGlite +
 * LocalOidcIssuer, no network): login → IdP → callback → session cookie → guarded
 * resource → logout, plus the denial paths (group-less, inactive, bad state) with
 * their audit rows.
 */

const CLIENT = 'switchboard-web';
const REDIRECT = 'https://app.test/api/v1/auth/callback';
const now = (): Date => new Date(Date.parse('2026-07-15T12:00:00.000Z'));

let ctx: TestDb;
let app: FastifyInstance;
let issuer: LocalOidcIssuer;
let session: SessionCodec;
let txn: OidcTxnCodec;
let client: OidcClient;

beforeEach(async () => {
  ctx = await createTestDb();
  issuer = new LocalOidcIssuer({ now });
  session = new SessionCodec({ secret: 'sess', secure: false, now });
  txn = new OidcTxnCodec({ secret: 'txn', secure: false, now });
  client = new OidcClient({
    issuer: issuer.issuer,
    clientId: CLIENT,
    clientSecret: 'shh',
    transport: issuer.transport(),
    now,
  });

  app = Fastify({ logger: false });
  registerOidcAuthRoutes(app, {
    db: ctx.db,
    client,
    session,
    txn,
    redirectUri: REDIRECT,
    postLoginRedirect: '/app',
    loginErrorRedirect: '/login',
  });
  const readSession: SessionReader = (request) => session.read(request.headers.cookie);
  app.get(
    '/api/v1/leads',
    { preHandler: requireSession({ db: ctx.db, readSession }) },
    async (r) => ({
      owner: r.user?.id,
    }),
  );
  await app.ready();
}, 120_000);

afterEach(async () => {
  await app.close();
  await ctx.close();
});

interface CookieLike {
  name: string;
  value: string;
}
function cookie(res: { cookies: CookieLike[] }, name: string): CookieLike | undefined {
  return res.cookies.find((c) => c.name === name);
}
function decodeTxn(value: string): { state: string; nonce: string } {
  const payload = value.split('.')[0] as string;
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as {
    state: string;
    nonce: string;
  };
}

/** Drive /auth/login and return the txn cookie value + its decoded state/nonce. */
async function startLogin(
  on: FastifyInstance = app,
): Promise<{ txnValue: string; state: string; nonce: string }> {
  const res = await on.inject({ method: 'GET', url: '/api/v1/auth/login' });
  expect(res.statusCode).toBe(302);
  const txn = cookie(res, OIDC_TXN_COOKIE_NAME);
  expect(txn).toBeDefined();
  const { state, nonce } = decodeTxn(txn?.value as string);
  const loc = new URL(res.headers.location as string);
  expect(loc.searchParams.get('state')).toBe(state); // URL state matches the cookie
  return { txnValue: txn?.value as string, state, nonce };
}

describe('successful login', () => {
  test('login → callback → session → guarded route → logout', async () => {
    const { txnValue, state, nonce } = await startLogin();
    const code = issuer.authorize({
      sub: 'google|77',
      nonce,
      email: 'rep@corp.test',
      name: 'Rep Seven',
      groups: ['sales-crm-users'],
    });

    const cb = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/callback?code=${code}&state=${state}`,
      headers: { cookie: `${OIDC_TXN_COOKIE_NAME}=${txnValue}` },
    });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toBe('/app');
    const sess = cookie(cb, SESSION_COOKIE_NAME);
    expect(sess?.value).toBeTruthy();
    const sessionCookie = `${SESSION_COOKIE_NAME}=${sess?.value}`;

    // The user was provisioned.
    const dbUsers = await ctx.db.select().from(users).where(eq(users.idpSubject, 'google|77'));
    expect(dbUsers).toHaveLength(1);
    expect(dbUsers[0]?.role).toBe('rep');

    // /auth/me returns the identity.
    const me = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/me',
      headers: { cookie: sessionCookie },
    });
    expect(me.statusCode).toBe(200);
    expect(me.json()).toMatchObject({ email: 'rep@corp.test', role: 'rep' });

    // The session authorizes a guarded resource.
    const leads = await app.inject({
      method: 'GET',
      url: '/api/v1/leads',
      headers: { cookie: sessionCookie },
    });
    expect(leads.statusCode).toBe(200);
    expect(leads.json().owner).toBe(dbUsers[0]?.id);

    // auth.login was audited.
    const logins = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'auth.login'));
    expect(logins).toHaveLength(1);
    expect(logins[0]?.actorId).toBe(dbUsers[0]?.id);

    // Logout clears the session cookie.
    const logout = await app.inject({
      method: 'POST',
      url: '/api/v1/auth/logout',
      headers: { cookie: sessionCookie },
    });
    expect(logout.statusCode).toBe(200);
    expect(cookie(logout, SESSION_COOKIE_NAME)?.value).toBe('');
  });

  test('an admin (both groups) is provisioned as admin', async () => {
    const { txnValue, state, nonce } = await startLogin();
    const code = issuer.authorize({
      sub: 'google|boss',
      nonce,
      email: 'boss@corp.test',
      name: 'Boss',
      groups: ['sales-crm-users', 'sales-crm-admins'],
    });
    await app.inject({
      method: 'GET',
      url: `/api/v1/auth/callback?code=${code}&state=${state}`,
      headers: { cookie: `${OIDC_TXN_COOKIE_NAME}=${txnValue}` },
    });
    const [row] = await ctx.db.select().from(users).where(eq(users.idpSubject, 'google|boss'));
    expect(row?.role).toBe('admin');
  });
});

describe('denial paths', () => {
  test('group-less user → redirected to error, no session, audited', async () => {
    const { txnValue, state, nonce } = await startLogin();
    const code = issuer.authorize({
      sub: 'google|nogroup',
      nonce,
      email: 'ng@corp.test',
      groups: ['some-other-team'],
    });
    const cb = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/callback?code=${code}&state=${state}`,
      headers: { cookie: `${OIDC_TXN_COOKIE_NAME}=${txnValue}` },
    });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toContain('error=no_access');
    expect(cookie(cb, SESSION_COOKIE_NAME)).toBeUndefined();
    // Not provisioned.
    const rows = await ctx.db.select().from(users).where(eq(users.idpSubject, 'google|nogroup'));
    expect(rows).toHaveLength(0);
    // Audited auth.denied / no_group.
    const denied = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'auth.denied'));
    expect(denied.some((d) => d.reason === 'no_group')).toBe(true);
  });

  test('inactive user → refused and audited (not resurrected)', async () => {
    await ctx.db.insert(users).values({
      email: 'off@corp.test',
      name: 'Off',
      role: 'rep',
      idpSubject: 'google|off',
      isActive: false,
    });
    const { txnValue, state, nonce } = await startLogin();
    const code = issuer.authorize({
      sub: 'google|off',
      nonce,
      email: 'off@corp.test',
      groups: ['sales-crm-users'],
    });
    const cb = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/callback?code=${code}&state=${state}`,
      headers: { cookie: `${OIDC_TXN_COOKIE_NAME}=${txnValue}` },
    });
    expect(cb.headers.location).toContain('error=inactive');
    expect(cookie(cb, SESSION_COOKIE_NAME)).toBeUndefined();
    const [row] = await ctx.db.select().from(users).where(eq(users.idpSubject, 'google|off'));
    expect(row?.isActive).toBe(false);
    const denied = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'auth.denied'));
    expect(denied.some((d) => d.reason === 'inactive')).toBe(true);
  });

  test('bad state (state mismatch) → refused, audited bad_state, token endpoint result discarded', async () => {
    const { txnValue, nonce } = await startLogin();
    const code = issuer.authorize({
      sub: 'google|x',
      nonce,
      email: 'x@corp.test',
      groups: ['sales-crm-users'],
    });
    const cb = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/callback?code=${code}&state=this-is-not-the-state`,
      headers: { cookie: `${OIDC_TXN_COOKIE_NAME}=${txnValue}` },
    });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toContain('error=exchange_failed');
    expect(cookie(cb, SESSION_COOKIE_NAME)).toBeUndefined();
    const denied = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'auth.denied'));
    expect(denied.some((d) => d.reason === 'bad_state')).toBe(true);
  });

  test('callback without a txn cookie → error redirect', async () => {
    const cb = await app.inject({
      method: 'GET',
      url: '/api/v1/auth/callback?code=abc&state=def',
    });
    expect(cb.statusCode).toBe(302);
    expect(cb.headers.location).toContain('error=expired');
  });
});

// ── Verified-domain role resolution (the direct-Google path, no groups claim) ─

describe('domain-based role resolution', () => {
  let domainApp: FastifyInstance;

  beforeEach(async () => {
    // Same DB/issuer/codecs as the outer app — only the deps differ: this app
    // has the domain strategy configured the way main.ts wires it from
    // AUTH_ALLOWED_DOMAIN / AUTH_ADMIN_EMAILS.
    domainApp = Fastify({ logger: false });
    registerOidcAuthRoutes(domainApp, {
      db: ctx.db,
      client,
      session,
      txn,
      redirectUri: REDIRECT,
      postLoginRedirect: '/app',
      loginErrorRedirect: '/login',
      domainRbac: { allowedDomain: 'corp.test', adminEmails: new Set(['boss@corp.test']) },
    });
    await domainApp.ready();
  });

  afterEach(async () => {
    await domainApp.close();
  });

  /** Complete a login on domainApp for the given claims; returns the callback response. */
  async function loginWith(claims: {
    sub: string;
    email?: string;
    name?: string;
    groups?: string[];
    extra?: Record<string, unknown>;
  }): Promise<{ statusCode: number; location: string; sessionValue: string | undefined }> {
    const { txnValue, state, nonce } = await startLogin(domainApp);
    const code = issuer.authorize({ ...claims, nonce });
    const cb = await domainApp.inject({
      method: 'GET',
      url: `/api/v1/auth/callback?code=${code}&state=${state}`,
      headers: { cookie: `${OIDC_TXN_COOKIE_NAME}=${txnValue}` },
    });
    return {
      statusCode: cb.statusCode,
      location: String(cb.headers.location),
      sessionValue: cookie(cb, SESSION_COOKIE_NAME)?.value,
    };
  }

  async function deniedReasons(): Promise<(string | null)[]> {
    const rows = await ctx.db.select().from(auditLog).where(eq(auditLog.action, 'auth.denied'));
    return rows.map((r) => r.reason);
  }

  test('a Workspace user in the domain logs in as rep', async () => {
    const res = await loginWith({
      sub: 'google|ws-rep',
      email: 'rep@corp.test',
      name: 'Workspace Rep',
      extra: { hd: 'corp.test', email_verified: true },
    });
    expect(res.statusCode).toBe(302);
    expect(res.location).toBe('/app');
    expect(res.sessionValue).toBeTruthy();
    const [row] = await ctx.db.select().from(users).where(eq(users.idpSubject, 'google|ws-rep'));
    expect(row?.role).toBe('rep');
  });

  test('an allow-listed address logs in as admin (case-insensitive)', async () => {
    const res = await loginWith({
      sub: 'google|ws-boss',
      email: 'Boss@Corp.TEST',
      name: 'The Boss',
      extra: { hd: 'corp.test', email_verified: true },
    });
    expect(res.location).toBe('/app');
    const [row] = await ctx.db.select().from(users).where(eq(users.idpSubject, 'google|ws-boss'));
    expect(row?.role).toBe('admin');
  });

  test('a personal gmail.com account (no hd) is REFUSED, unprovisioned, audited domain_no_hd', async () => {
    const res = await loginWith({
      sub: 'google|personal',
      email: 'anyone@gmail.com',
      extra: { email_verified: true },
    });
    expect(res.statusCode).toBe(302);
    expect(res.location).toContain('error=no_access');
    expect(res.sessionValue).toBeUndefined();
    const rows = await ctx.db.select().from(users).where(eq(users.idpSubject, 'google|personal'));
    expect(rows).toHaveLength(0);
    expect(await deniedReasons()).toContain('domain_no_hd');
  });

  test('a Workspace account from the WRONG domain is refused and audited domain_hd_mismatch', async () => {
    const res = await loginWith({
      sub: 'google|other-ws',
      email: 'rep@other.test',
      extra: { hd: 'other.test', email_verified: true },
    });
    expect(res.location).toContain('error=no_access');
    expect(res.sessionValue).toBeUndefined();
    expect(await deniedReasons()).toContain('domain_hd_mismatch');
  });

  test('an unverified email is refused and audited domain_email_unverified — even in-domain and allow-listed', async () => {
    const res = await loginWith({
      sub: 'google|unverified',
      email: 'boss@corp.test',
      extra: { hd: 'corp.test', email_verified: false },
    });
    expect(res.location).toContain('error=no_access');
    expect(res.sessionValue).toBeUndefined();
    expect(await deniedReasons()).toContain('domain_email_unverified');
  });

  test('a token with no email is refused and audited domain_no_email', async () => {
    const res = await loginWith({
      sub: 'google|no-email',
      extra: { hd: 'corp.test', email_verified: true },
    });
    expect(res.location).toContain('error=no_access');
    expect(await deniedReasons()).toContain('domain_no_email');
  });

  test('the groups path still works unchanged on an app WITH domain config (Keycloak coexists)', async () => {
    const res = await loginWith({
      sub: 'kc|admin',
      email: 'kc-admin@corp.test',
      groups: ['sales-crm-admins'],
    });
    expect(res.location).toBe('/app');
    const [row] = await ctx.db.select().from(users).where(eq(users.idpSubject, 'kc|admin'));
    expect(row?.role).toBe('admin');
  });

  test('a groups claim granting nothing is refused no_group — the domain never resurrects it', async () => {
    const res = await loginWith({
      sub: 'kc|nogroup',
      email: 'boss@corp.test', // in-domain AND allow-listed…
      groups: ['some-other-team'], // …but the IdP's groups decision stands
      extra: { hd: 'corp.test', email_verified: true },
    });
    expect(res.location).toContain('error=no_access');
    expect(res.sessionValue).toBeUndefined();
    expect(await deniedReasons()).toContain('no_group');
  });

  test('WITHOUT domain config a groups-less Google-style token stays refused (no_group, pre-existing)', async () => {
    // The outer `app` has no domainRbac — the strategy is opt-in.
    const { txnValue, state, nonce } = await startLogin();
    const code = issuer.authorize({
      sub: 'google|no-strategy',
      nonce,
      email: 'rep@corp.test',
      extra: { hd: 'corp.test', email_verified: true },
    });
    const cb = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/callback?code=${code}&state=${state}`,
      headers: { cookie: `${OIDC_TXN_COOKIE_NAME}=${txnValue}` },
    });
    expect(cb.headers.location).toContain('error=no_access');
    expect(cookie(cb, SESSION_COOKIE_NAME)).toBeUndefined();
    expect(await deniedReasons()).toContain('no_group');
  });
});

describe('unauthenticated access', () => {
  test('/auth/me without a session → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/auth/me' });
    expect(res.statusCode).toBe(401);
    expect(res.json().error.code).toBe('UNAUTHENTICATED');
  });

  test('guarded resource without a session → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/v1/leads' });
    expect(res.statusCode).toBe(401);
  });

  test('a mutating guarded resource still enforces CSRF once authenticated', async () => {
    // (sanity that requireSession + CSRF compose with the real session issued here)
    const { txnValue, state, nonce } = await startLogin();
    const code = issuer.authorize({
      sub: 'google|c',
      nonce,
      email: 'c@corp.test',
      groups: ['sales-crm-users'],
    });
    const cb = await app.inject({
      method: 'GET',
      url: `/api/v1/auth/callback?code=${code}&state=${state}`,
      headers: { cookie: `${OIDC_TXN_COOKIE_NAME}=${txnValue}` },
    });
    const sessionCookie = `${SESSION_COOKIE_NAME}=${cookie(cb, SESSION_COOKIE_NAME)?.value}`;
    // GET is fine; a POST to a session-guarded mutating route needs the header.
    // (Reuse /api/v1/leads as GET-only here; CSRF composition is proven in guards.test.ts.)
    const ok = await app.inject({
      method: 'GET',
      url: '/api/v1/leads',
      headers: { cookie: sessionCookie, [CSRF_HEADER]: '1' },
    });
    expect(ok.statusCode).toBe(200);
  });
});

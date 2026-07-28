import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, test } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

import {
  assertRealModeConfig,
  buildCommsRouteDeps,
  buildGmailPushVerifier,
  buildRegistries,
  registerProductionRoutes,
  requireHumanActor,
} from './main.ts';
import { loadConfig } from './config.ts';
import { registerRoutes } from './routes/index.ts';
import type { Db } from './db/index.ts';
import type { QueueDriver } from './queue/index.ts';
import { TokenCipher } from './services/sync/token-cipher.ts';
import { requireAdmin } from './auth/guards.ts';
import { createActivityWebhookEmitter } from './services/webhooks/index.ts';
import type { AuthenticatedUser } from './auth/types.ts';
import { GmailEmailProvider } from './providers/email/gmail-email-provider.ts';
import { MockEmailProvider } from './providers/mock/mock-email-provider.ts';
import { MockTelephonyProvider } from './providers/telephony/index.ts';
import { TwilioTelephonyProvider } from './providers/telephony/twilio-telephony-provider.ts';
import { MockASRProvider, DeepgramASRProvider } from './providers/asr/index.ts';
import { MockAIProvider, HaikuAIProvider } from './providers/ai/index.ts';

/*
 * Composition-root guarantees that do NOT need infra. The wiring itself (real
 * pg pool + BullMQ + the global session gate) is proven against real Postgres
 * and Redis by deploy/VERIFY.md, because asserting it here would need both
 * services — see that script for the end-to-end evidence.
 *
 * What is pinned here is the fail-closed posture: the single worst outcome for
 * this product is booting real mode with no IdP, which would serve the whole
 * API with no way to authenticate anyone.
 */

const REAL = { MOCK_MODE: '0', SESSION_SECRET: 'x'.repeat(40) } as const;

describe('assertRealModeConfig — fail closed without an IdP', () => {
  test('MOCK_MODE=1 needs no OIDC config (the zero-account path, guide §4.6)', () => {
    const env = { MOCK_MODE: '1' } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env), env)).not.toThrow();
  });

  test('MOCK_MODE=0 with no OIDC config refuses to boot', () => {
    const env = { ...REAL } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env), env)).toThrow(/OIDC_ISSUER/);
  });

  // failure path: a half-configured IdP is still a refusal, and the message
  // names exactly what is missing rather than the whole list.
  test('MOCK_MODE=0 with a partial IdP config names only the missing keys', () => {
    const env = {
      ...REAL,
      OIDC_ISSUER: 'https://accounts.example.com',
      OIDC_CLIENT_ID: 'switchboard',
    } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env), env)).toThrow(/OIDC_CLIENT_SECRET/);
    expect(() => assertRealModeConfig(loadConfig(env), env)).not.toThrow(/OIDC_ISSUER,/);
  });

  test('blank strings count as unset (an empty .env line is not configuration)', () => {
    const env = {
      ...REAL,
      OIDC_ISSUER: '  ',
      OIDC_CLIENT_ID: '',
      OIDC_CLIENT_SECRET: '',
    } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env), env)).toThrow(/OIDC_ISSUER/);
  });

  test('a fully configured IdP passes the gate', () => {
    const env = {
      ...REAL,
      OIDC_ISSUER: 'https://accounts.example.com',
      OIDC_CLIENT_ID: 'switchboard',
      OIDC_CLIENT_SECRET: 'shh',
    } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env), env)).not.toThrow();
  });
});

// ── Role resolution must be able to admit someone (the Google-issuer trap:
// Google's ID tokens carry no `groups` claim, so groups-only RBAC against
// accounts.google.com refuses EVERY login at runtime) ─────────────────────────

const GOOGLE_IDP = {
  ...REAL,
  OIDC_ISSUER: 'https://accounts.google.com',
  OIDC_CLIENT_ID: 'switchboard.apps.googleusercontent.com',
  OIDC_CLIENT_SECRET: 'shh',
} as const;

describe('assertRealModeConfig — a boot whose SSO can never admit anyone is refused', () => {
  test('Google issuer without AUTH_ALLOWED_DOMAIN refuses to boot', () => {
    const env = { ...GOOGLE_IDP } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env), env)).toThrow(/AUTH_ALLOWED_DOMAIN/);
  });

  test('issuer normalisation: trailing slash / case still refuse', () => {
    const slash = { ...GOOGLE_IDP, OIDC_ISSUER: 'https://accounts.google.com/' };
    expect(() => assertRealModeConfig(loadConfig(slash), slash)).toThrow(/AUTH_ALLOWED_DOMAIN/);
    const cased = { ...GOOGLE_IDP, OIDC_ISSUER: 'https://Accounts.Google.com' };
    expect(() => assertRealModeConfig(loadConfig(cased), cased)).toThrow(/AUTH_ALLOWED_DOMAIN/);
  });

  test('Google issuer + AUTH_ALLOWED_DOMAIN boots (with or without admins)', () => {
    const env = { ...GOOGLE_IDP, AUTH_ALLOWED_DOMAIN: 'corp.com' } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env), env)).not.toThrow();
    const withAdmins = {
      ...env,
      AUTH_ADMIN_EMAILS: 'boss@corp.com, second@corp.com',
    } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(withAdmins), withAdmins)).not.toThrow();
  });

  test('a non-Google issuer still boots without domain config (the Keycloak path, unchanged)', () => {
    const env = {
      ...REAL,
      OIDC_ISSUER: 'http://localhost:8081/realms/switchboard',
      OIDC_CLIENT_ID: 'switchboard',
      OIDC_CLIENT_SECRET: 'shh',
    } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env), env)).not.toThrow();
  });

  // failure path: the allow-list is meaningless without its domain — half a
  // family is a boot refusal, same posture as partial Twilio below.
  test('AUTH_ADMIN_EMAILS without AUTH_ALLOWED_DOMAIN refuses to boot', () => {
    const env = {
      ...REAL,
      OIDC_ISSUER: 'https://accounts.example.com',
      OIDC_CLIENT_ID: 'switchboard',
      OIDC_CLIENT_SECRET: 'shh',
      AUTH_ADMIN_EMAILS: 'boss@corp.com',
    } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env), env)).toThrow(
      /AUTH_ADMIN_EMAILS is set but AUTH_ALLOWED_DOMAIN/,
    );
  });

  // failure path: an allow-listed address the domain gate would always refuse
  // is a dead admin grant (typo'd domain or entry) — refuse it loudly at boot.
  test('an admin email outside the allowed domain refuses to boot, naming the entry', () => {
    const env = {
      ...GOOGLE_IDP,
      AUTH_ALLOWED_DOMAIN: 'corp.com',
      AUTH_ADMIN_EMAILS: 'boss@corp.com, boss@personal-gmail.com',
    } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env), env)).toThrow(/boss@personal-gmail\.com/);
  });

  test('MOCK_MODE=1 ignores the whole family (dev-login path, zero config)', () => {
    const env = { MOCK_MODE: '1', AUTH_ADMIN_EMAILS: 'boss@corp.com' } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env), env)).not.toThrow();
  });
});

// Real mode + Gmail configured ⇒ /wh/gmail will mount ⇒ the push token is
// mandatory (CONTRACTS §C7 "signature-verified"; an untokened verifier accepts
// any parseable envelope from the open internet).
const REAL_WITH_IDP = {
  ...REAL,
  OIDC_ISSUER: 'https://accounts.example.com',
  OIDC_CLIENT_ID: 'switchboard',
  OIDC_CLIENT_SECRET: 'shh',
} as const;

describe('assertRealModeConfig — /wh/gmail cannot boot open', () => {
  test('real mode + GOOGLE_CLIENT_ID without GMAIL_PUSH_TOKEN refuses to boot', () => {
    const env = { ...REAL_WITH_IDP, GOOGLE_CLIENT_ID: 'gcid' } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env), env)).toThrow(/GMAIL_PUSH_TOKEN/);
  });

  test('a blank GMAIL_PUSH_TOKEN (empty env line) is unset, still refused', () => {
    const env = {
      ...REAL_WITH_IDP,
      GOOGLE_CLIENT_ID: 'gcid',
      GMAIL_PUSH_TOKEN: '',
    } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env), env)).toThrow(/GMAIL_PUSH_TOKEN/);
  });

  test('real mode + GOOGLE_CLIENT_ID + GMAIL_PUSH_TOKEN boots', () => {
    const env = {
      ...REAL_WITH_IDP,
      GOOGLE_CLIENT_ID: 'gcid',
      GMAIL_PUSH_TOKEN: 'push-token-value',
    } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env), env)).not.toThrow();
  });

  test('real mode WITHOUT Gmail needs no push token (route never mounts)', () => {
    const env = { ...REAL_WITH_IDP } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env), env)).not.toThrow();
  });
});

// ── Telephony: absent ⇒ paused, partial ⇒ refused (the D-061 posture) ────────

/** The full Twilio credential set (assertRealModeConfig requires all four). */
const TWILIO_FULL = {
  TWILIO_ACCOUNT_SID: 'ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
  TWILIO_AUTH_TOKEN: 'twilio-auth-token',
  TWILIO_PHONE_NUMBER: '+15550001111',
  PUBLIC_WEBHOOK_URL: 'https://crm.example.com',
} as const;

describe('assertRealModeConfig — telephony pauses when absent, refuses when partial', () => {
  test('real mode with NO Twilio vars boots (feature paused, not the boot)', () => {
    const env = { ...REAL_WITH_IDP } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env), env)).not.toThrow();
  });

  test('real mode with the full Twilio set boots', () => {
    const env = { ...REAL_WITH_IDP, ...TWILIO_FULL } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env), env)).not.toThrow();
  });

  // failure path: intent signalled (one var set) with the rest missing must be
  // a boot refusal naming exactly the missing keys — never a silent pause and
  // never routes that fail per-request.
  test('a lone TWILIO_ACCOUNT_SID refuses to boot, naming the missing keys', () => {
    const env = {
      ...REAL_WITH_IDP,
      TWILIO_ACCOUNT_SID: TWILIO_FULL.TWILIO_ACCOUNT_SID,
    } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env), env)).toThrow(
      /TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER, PUBLIC_WEBHOOK_URL/,
    );
  });

  test('telephony without PUBLIC_WEBHOOK_URL refuses (Twilio signs the full public URL)', () => {
    const env = {
      ...REAL_WITH_IDP,
      TWILIO_ACCOUNT_SID: TWILIO_FULL.TWILIO_ACCOUNT_SID,
      TWILIO_AUTH_TOKEN: TWILIO_FULL.TWILIO_AUTH_TOKEN,
      TWILIO_PHONE_NUMBER: TWILIO_FULL.TWILIO_PHONE_NUMBER,
    } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env), env)).toThrow(/PUBLIC_WEBHOOK_URL/);
  });

  test('a blank Twilio env line is unset: all-blank pauses, one-real-rest-blank refuses', () => {
    const allBlank = {
      ...REAL_WITH_IDP,
      TWILIO_ACCOUNT_SID: '',
      TWILIO_AUTH_TOKEN: '',
      TWILIO_PHONE_NUMBER: '',
    } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(allBlank), allBlank)).not.toThrow();

    const oneReal = { ...allBlank, TWILIO_ACCOUNT_SID: 'ACx' } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(oneReal), oneReal)).toThrow(/TWILIO_AUTH_TOKEN/);
  });

  // The REST API-key pair is indivisible: sid without secret Basic-auths with
  // an empty password — constructs fine, 401s per-request. Refused instead.
  test('TWILIO_API_KEY_SID without TWILIO_API_KEY_SECRET refuses to boot (and vice versa)', () => {
    const sidOnly = {
      ...REAL_WITH_IDP,
      ...TWILIO_FULL,
      TWILIO_API_KEY_SID: 'SKxxx',
    } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(sidOnly), sidOnly)).toThrow(
      /TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET/,
    );
    const secretOnly = {
      ...REAL_WITH_IDP,
      ...TWILIO_FULL,
      TWILIO_API_KEY_SECRET: 'shh',
    } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(secretOnly), secretOnly)).toThrow(
      /TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET/,
    );
    const both = {
      ...REAL_WITH_IDP,
      ...TWILIO_FULL,
      TWILIO_API_KEY_SID: 'SKxxx',
      TWILIO_API_KEY_SECRET: 'shh',
    } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(both), both)).not.toThrow();
  });

  test('a lone DEEPGRAM_API_KEY or ANTHROPIC_API_KEY never fails the boot (single-var families)', () => {
    const env = { ...REAL_WITH_IDP, DEEPGRAM_API_KEY: 'dg' } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env), env)).not.toThrow();
    const env2 = { ...REAL_WITH_IDP, ANTHROPIC_API_KEY: 'sk-ant' } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env2), env2)).not.toThrow();
  });

  test('MOCK_MODE=1 ignores partial Twilio config entirely', () => {
    const env = { MOCK_MODE: '1', TWILIO_ACCOUNT_SID: 'ACx' } as NodeJS.ProcessEnv;
    expect(() => assertRealModeConfig(loadConfig(env), env)).not.toThrow();
  });
});

// A minimal, structurally valid Pub/Sub push body (what the verifier parses).
const PUSH_BODY = JSON.stringify({
  message: {
    data: Buffer.from(
      JSON.stringify({ emailAddress: 'rep@company.test', historyId: '42' }),
      'utf8',
    ).toString('base64'),
    messageId: 'pubsub-msg-test',
  },
});

describe('buildGmailPushVerifier — the production /wh/gmail gate', () => {
  test('MOCK_MODE: structural-only (no token required)', () => {
    const v = buildGmailPushVerifier(loadConfig({ MOCK_MODE: '1' }));
    expect(v.verify({}, PUSH_BODY)).toBe(true);
    expect(v.verify({}, 'garbage')).toBe(false);
  });

  test('real mode without a token cannot even construct the verifier', () => {
    const config = loadConfig({ ...REAL } as NodeJS.ProcessEnv);
    expect(() => buildGmailPushVerifier(config)).toThrow(/GMAIL_PUSH_TOKEN/);
  });

  test('real mode: wrong/absent token rejected, correct token accepted', () => {
    const config = loadConfig({
      ...REAL,
      GMAIL_PUSH_TOKEN: 'secret-push-token',
    } as NodeJS.ProcessEnv);
    const v = buildGmailPushVerifier(config);
    expect(v.verify({}, PUSH_BODY)).toBe(false);
    expect(v.verify({ 'x-goog-channel-token': 'wrong' }, PUSH_BODY)).toBe(false);
    expect(v.verify({ 'x-goog-channel-token': 'secret-push-token' }, PUSH_BODY)).toBe(true);
    // A correct token never launders a malformed body.
    expect(v.verify({ 'x-goog-channel-token': 'secret-push-token' }, 'garbage')).toBe(false);
  });
});

describe('buildRegistries — both registries share the gmail binding', () => {
  test('MOCK_MODE: eager registry present, sender registry hands out mock providers', () => {
    const env = { MOCK_MODE: '1' } as NodeJS.ProcessEnv;
    const { registry, senderRegistry } = buildRegistries(loadConfig(env), env);
    expect(registry).not.toBeNull();
    expect(registry!.email).toBeInstanceOf(MockEmailProvider);
    expect(
      senderRegistry.providerFor({ provider: 'mock', address: 'rep@mock.test' }),
    ).toBeInstanceOf(MockEmailProvider);
  });

  // Bug regression: the sender registry was previously built WITHOUT the gmail
  // config, so in real mode every send threw 'requires gmail OAuth config'
  // despite correct Google credentials.
  test('real mode + Gmail configured: the SENDER registry can build a real provider', () => {
    const env = {
      ...REAL,
      GOOGLE_CLIENT_ID: 'gcid',
      GOOGLE_CLIENT_SECRET: 'gsecret',
      GMAIL_SENDER_ADDRESS: 'default@company.test',
    } as NodeJS.ProcessEnv;
    const { registry, senderRegistry } = buildRegistries(loadConfig(env), env);
    expect(registry!.email).toBeInstanceOf(GmailEmailProvider);
    expect(
      senderRegistry.providerFor({ provider: 'gmail', address: 'rep@company.test' }),
    ).toBeInstanceOf(GmailEmailProvider);
  });

  test('real mode without Gmail: no eager registry, sender fails per-send (feature paused, boot fine)', () => {
    const env = { ...REAL } as NodeJS.ProcessEnv;
    const { registry, senderRegistry } = buildRegistries(loadConfig(env), env);
    expect(registry).toBeNull();
    expect(() =>
      senderRegistry.providerFor({ provider: 'gmail', address: 'rep@company.test' }),
    ).toThrow(/gmail oauth config/i);
  });
});

describe('buildRegistries — telephony/ASR/AI per-family gating (real branch)', () => {
  test('MOCK_MODE: mock comms providers, and the SAME instances the registry holds', () => {
    const env = { MOCK_MODE: '1' } as NodeJS.ProcessEnv;
    const built = buildRegistries(loadConfig(env), env);
    expect(built.telephony).toBeInstanceOf(MockTelephonyProvider);
    expect(built.asr).toBeInstanceOf(MockASRProvider);
    expect(built.ai).toBeInstanceOf(MockAIProvider);
    // Identity matters: routes and workers share per-instance mock state
    // (idempotency ledgers, call counts).
    expect(built.telephony).toBe(built.registry!.telephony);
    expect(built.asr).toBe(built.registry!.asr);
    expect(built.ai).toBe(built.registry!.ai);
  });

  test('real mode + full Twilio set: the REAL adapter, independent of Gmail', () => {
    const env = { ...REAL, ...TWILIO_FULL } as NodeJS.ProcessEnv;
    const built = buildRegistries(loadConfig(env), env);
    // The decoupling headline: no Gmail ⇒ email registry null, telephony still real.
    expect(built.registry).toBeNull();
    expect(built.telephony).toBeInstanceOf(TwilioTelephonyProvider);
    expect(built.asr).toBeNull();
    expect(built.ai).toBeNull();
  });

  test('real mode with NO Twilio vars: telephony null (feature paused)', () => {
    const env = { ...REAL } as NodeJS.ProcessEnv;
    expect(buildRegistries(loadConfig(env), env).telephony).toBeNull();
  });

  // Defence in depth: even if assertRealModeConfig were skipped, a partial set
  // must yield null (paused) — NEVER a half-constructed adapter that throws
  // per-request (the D-061 email-send bug).
  test('real mode + partial Twilio set: telephony null, never half-constructed', () => {
    const env = {
      ...REAL,
      TWILIO_ACCOUNT_SID: TWILIO_FULL.TWILIO_ACCOUNT_SID,
    } as NodeJS.ProcessEnv;
    expect(buildRegistries(loadConfig(env), env).telephony).toBeNull();
  });

  test('real mode + DEEPGRAM_API_KEY: real ASR adapter; AI stays null', () => {
    const env = { ...REAL, DEEPGRAM_API_KEY: 'dg-key' } as NodeJS.ProcessEnv;
    const built = buildRegistries(loadConfig(env), env);
    expect(built.asr).toBeInstanceOf(DeepgramASRProvider);
    expect(built.ai).toBeNull();
  });

  test('real mode + ANTHROPIC_API_KEY: real AI adapter; ASR stays null', () => {
    const env = { ...REAL, ANTHROPIC_API_KEY: 'sk-ant-test' } as NodeJS.ProcessEnv;
    const built = buildRegistries(loadConfig(env), env);
    expect(built.ai).toBeInstanceOf(HaikuAIProvider);
    expect(built.asr).toBeNull();
  });

  test('a blank env line never constructs a real adapter with empty creds', () => {
    const env = {
      ...REAL,
      DEEPGRAM_API_KEY: '',
      ANTHROPIC_API_KEY: '',
    } as NodeJS.ProcessEnv;
    const built = buildRegistries(loadConfig(env), env);
    expect(built.asr).toBeNull();
    expect(built.ai).toBeNull();
  });
});

// ── Route mounting: provider present ⇔ routes mount ──────────────────────────
// registerRoutes touches `db` only at request time, so a stub Db + a stub queue
// let us prove the mount decision (buildCommsRouteDeps → registerRoutes) with
// no pg/redis — the same rationale as the buildRegistries suite above.

const stubDb = {} as unknown as Db;
const stubQueue: QueueDriver = {
  enqueue: async () => undefined,
  process: () => undefined,
  close: async () => undefined,
};

async function mountedRoutes(env: NodeJS.ProcessEnv): Promise<{
  calls: boolean;
  twilioWebhook: boolean;
  sms: boolean;
  ai: boolean;
}> {
  const config = loadConfig(env);
  const built = buildRegistries(config, env);
  const app = Fastify();
  registerRoutes(app, { db: stubDb, ...buildCommsRouteDeps(config, built, stubQueue) });
  await app.ready();
  try {
    return {
      calls: app.hasRoute({ method: 'POST', url: '/api/v1/calls/dial' }),
      twilioWebhook: app.hasRoute({ method: 'POST', url: '/wh/twilio/sms' }),
      sms: app.hasRoute({ method: 'POST', url: '/api/v1/sms/send' }),
      ai: app.hasRoute({ method: 'POST', url: '/api/v1/ai/smart-view' }),
    };
  } finally {
    await app.close();
  }
}

describe('buildCommsRouteDeps — routes mount iff the family is configured', () => {
  test('MOCK_MODE mounts calls, /wh/twilio, sms and ai', async () => {
    const routes = await mountedRoutes({ MOCK_MODE: '1' } as NodeJS.ProcessEnv);
    expect(routes).toEqual({ calls: true, twilioWebhook: true, sms: true, ai: true });
  });

  test('real mode with nothing configured mounts none of them (and does not throw)', async () => {
    const routes = await mountedRoutes({ ...REAL } as NodeJS.ProcessEnv);
    expect(routes).toEqual({ calls: false, twilioWebhook: false, sms: false, ai: false });
  });

  test('real mode + full Twilio set mounts calls + /wh/twilio + sms, not ai', async () => {
    const routes = await mountedRoutes({ ...REAL, ...TWILIO_FULL } as NodeJS.ProcessEnv);
    expect(routes).toEqual({ calls: true, twilioWebhook: true, sms: true, ai: false });
  });

  test('real mode + Deepgram + Anthropic mounts ai, not telephony', async () => {
    const routes = await mountedRoutes({
      ...REAL,
      DEEPGRAM_API_KEY: 'dg-key',
      ANTHROPIC_API_KEY: 'sk-ant-test',
    } as NodeJS.ProcessEnv);
    expect(routes).toEqual({ calls: false, twilioWebhook: false, sms: false, ai: true });
  });

  // failure path: ONE of the AI pair is a complete config for its vendor (no
  // boot failure) but must not mount a half-alive /api/v1/ai/*.
  test('real mode + only ANTHROPIC_API_KEY does NOT mount /api/v1/ai/*', async () => {
    const routes = await mountedRoutes({
      ...REAL,
      ANTHROPIC_API_KEY: 'sk-ant-test',
    } as NodeJS.ProcessEnv);
    expect(routes.ai).toBe(false);
  });

  test('real-mode telephony deps carry the configured caller-id and public origin', () => {
    const env = { ...REAL, ...TWILIO_FULL } as NodeJS.ProcessEnv;
    const config = loadConfig(env);
    const deps = buildCommsRouteDeps(config, buildRegistries(config, env), stubQueue);
    expect(deps.telephony?.callerId).toBe(TWILIO_FULL.TWILIO_PHONE_NUMBER);
    expect(deps.telephony?.publicBaseUrl).toBe(TWILIO_FULL.PUBLIC_WEBHOOK_URL);
    expect(deps.sms?.fromNumber).toBe(TWILIO_FULL.TWILIO_PHONE_NUMBER);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// The production route-mount manifest.
//
// Root cause this suite exists: `main.ts` (deployed) and `dev/boot.ts` (local
// "real API" dev) are two independent composition roots, and they DRIFTED —
// three times in one day the dev root carried behaviour the production root
// lacked (`/api/v1/sms/send` mounted from no root at all; `smart-views` + `bulk`
// mounted only by dev boot, so the deployed API 404'd both), while every
// "verified end-to-end" claim was collected against the dev root.
//
// The rule enforced here: EVERY route-registrar module under `routes/` must be
// mounted by the PRODUCTION composition root (`registerProductionRoutes`, the
// exact function `buildProductionApp` calls) — or its absence must be declared
// below, with the gating condition NAMED. Adding a new `routes/*.ts` module
// without a mount decision fails the coverage test; unwiring a declared module
// from `main.ts` fails the mount test. A mere snapshot of "what mounts today"
// would have passed through all three bugs — the manifest is instead a claim
// about what MUST mount, checked against the directory listing so it cannot
// silently go stale in either direction.
// ═════════════════════════════════════════════════════════════════════════════

interface MountProbe {
  method: 'GET' | 'POST';
  url: string;
}

interface ManifestEntry {
  /** One canonical route the module registers (pattern form, e.g. `:id`). */
  probe: MountProbe;
  /**
   * Present ⇒ the module deliberately does NOT mount under a minimal real-mode
   * config, and the string NAMES the gating condition. Gated modules must still
   * mount under the fully-configured env (MAXIMAL_REAL) — a gate is a feature
   * pause, never a licence to be unreachable in every deploy.
   */
  gate?: string;
}

/** Files under routes/ that are not route registrars (helpers/aggregator). */
const NOT_ROUTE_REGISTRARS = new Set(['index', 'http']);

const PRODUCTION_MOUNT_MANIFEST: Record<string, ManifestEntry> = {
  'admin-audit': { probe: { method: 'GET', url: '/api/v1/admin/audit-log' } },
  'admin-crud': { probe: { method: 'GET', url: '/api/v1/admin/users' } },
  'admin-export': { probe: { method: 'POST', url: '/api/v1/admin/exports' } },
  'admin-tokens': { probe: { method: 'POST', url: '/api/v1/admin/tokens' } },
  ai: {
    probe: { method: 'POST', url: '/api/v1/ai/smart-view' },
    gate: 'needs BOTH DEEPGRAM_API_KEY and ANTHROPIC_API_KEY (buildRegistries: asr+ai pair)',
  },
  bulk: { probe: { method: 'POST', url: '/api/v1/bulk' } },
  contacts: { probe: { method: 'GET', url: '/api/v1/contacts' } },
  'email-send': { probe: { method: 'POST', url: '/api/v1/emails/send' } },
  'email-sync': {
    probe: { method: 'POST', url: '/api/v1/oauth/gmail/start' },
    gate: 'needs GOOGLE_CLIENT_ID (+GMAIL_PUSH_TOKEN for /wh/gmail); unset ⇒ Gmail sync paused',
  },
  'email-threads': { probe: { method: 'GET', url: '/api/v1/emails/threads' } },
  'email-triage': { probe: { method: 'GET', url: '/api/v1/emails/triage' } },
  imports: { probe: { method: 'POST', url: '/api/v1/imports' } },
  inbox: { probe: { method: 'GET', url: '/api/v1/inbox' } },
  leads: { probe: { method: 'GET', url: '/api/v1/leads' } },
  notes: { probe: { method: 'GET', url: '/api/v1/notes' } },
  opportunities: { probe: { method: 'GET', url: '/api/v1/opportunities' } },
  reports: { probe: { method: 'GET', url: '/api/v1/reports/activity' } },
  search: { probe: { method: 'GET', url: '/api/v1/search' } },
  sequences: { probe: { method: 'GET', url: '/api/v1/sequences' } },
  'smart-views': { probe: { method: 'GET', url: '/api/v1/smart-views' } },
  sms: {
    probe: { method: 'POST', url: '/api/v1/sms/send' },
    gate: 'needs the full TWILIO_* set + PUBLIC_WEBHOOK_URL (buildRegistries: telephony)',
  },
  snippets: { probe: { method: 'GET', url: '/api/v1/snippets' } },
  tasks: { probe: { method: 'GET', url: '/api/v1/tasks' } },
  telephony: {
    probe: { method: 'POST', url: '/api/v1/calls/dial' },
    gate: 'needs the full TWILIO_* set + PUBLIC_WEBHOOK_URL (buildRegistries: telephony)',
  },
  templates: { probe: { method: 'GET', url: '/api/v1/templates' } },
  unsubscribe: { probe: { method: 'GET', url: '/api/v1/unsubscribe/:token' } },
  'webhook-subscriptions': {
    probe: { method: 'GET', url: '/api/v1/admin/webhook-subscriptions' },
  },
};

/** Every provider family fully configured ⇒ every gated module must mount too. */
const MAXIMAL_REAL = {
  ...REAL_WITH_IDP,
  GOOGLE_CLIENT_ID: 'gcid',
  GOOGLE_CLIENT_SECRET: 'gsecret',
  GMAIL_SENDER_ADDRESS: 'sender@company.test',
  GMAIL_PUSH_TOKEN: 'push-token-value',
  ...TWILIO_FULL,
  DEEPGRAM_API_KEY: 'dg-key',
  ANTHROPIC_API_KEY: 'sk-ant-test',
} as const;

// registerProductionRoutes touches the db only at request time except for
// `rawClientOf(db)` (smart-views/bulk derive their raw `$n` client at
// registration), so the stub needs a `$client.query` shape.
const stubClientDb = {
  $client: { query: async (): Promise<{ rows: never[] }> => ({ rows: [] }) },
} as unknown as Db;

const TEST_USER: AuthenticatedUser = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'rep@company.test',
  name: 'Test Rep',
  role: 'rep',
  isActive: true,
  timezone: 'UTC',
};

async function composedProductionApp(
  env: NodeJS.ProcessEnv,
  opts: { simulateUser?: boolean } = {},
): Promise<FastifyInstance> {
  const config = loadConfig(env);
  const built = buildRegistries(config, env);
  const app = Fastify();
  if (opts.simulateUser === true) {
    // Stand-in for the global session gate (which lives in buildProductionApp,
    // above this seam): decorate the request the way requireSession does.
    app.addHook('onRequest', async (request) => {
      request.user = TEST_USER;
    });
  }
  registerProductionRoutes(app, {
    config,
    built,
    db: stubClientDb,
    queue: stubQueue,
    cipher: new TokenCipher('x'.repeat(40)),
    // The real guard factory with inert deps: constructed exactly like
    // production, never invoked at registration time.
    adminGuard: requireAdmin({ db: stubClientDb, readSession: () => null }),
    activityEmitter: createActivityWebhookEmitter(stubQueue),
    orgTimezone: 'UTC',
    importStorageDir: 'imports-scratch',
  });
  await app.ready();
  return app;
}

function routeModulesOnDisk(): string[] {
  const routesDir = join(dirname(fileURLToPath(import.meta.url)), 'routes');
  return readdirSync(routesDir)
    .filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts'))
    .map((f) => f.slice(0, -'.ts'.length))
    .filter((name) => !NOT_ROUTE_REGISTRARS.has(name));
}

describe('production route-mount manifest — no route module ships unwired', () => {
  test('every routes/*.ts module has a mount decision (and no stale entries)', () => {
    const onDisk = routeModulesOnDisk();
    const declared = Object.keys(PRODUCTION_MOUNT_MANIFEST);

    const undeclared = onDisk.filter((m) => !declared.includes(m));
    expect(
      undeclared,
      `route module(s) with NO production mount decision: ${undeclared
        .map((m) => `routes/${m}.ts`)
        .join(', ')}. Wire each into main.ts (registerProductionRoutes) and add its probe ` +
        'to PRODUCTION_MOUNT_MANIFEST — or, if it is legitimately feature-gated, declare ' +
        'it here with a `gate` naming the env condition.',
    ).toEqual([]);

    const stale = declared.filter((m) => !onDisk.includes(m));
    expect(
      stale,
      `PRODUCTION_MOUNT_MANIFEST declares module(s) that no longer exist: ${stale.join(', ')}. ` +
        'Remove the stale entries.',
    ).toEqual([]);
  });

  test('fully-configured real mode mounts EVERY declared module (gated included)', async () => {
    const app = await composedProductionApp(MAXIMAL_REAL as NodeJS.ProcessEnv);
    try {
      for (const [name, entry] of Object.entries(PRODUCTION_MOUNT_MANIFEST)) {
        expect(
          app.hasRoute(entry.probe),
          `routes/${name}.ts is NOT mounted by the production composition root ` +
            `(probe ${entry.probe.method} ${entry.probe.url}) even with every provider ` +
            'family configured. Wire it in main.ts (registerProductionRoutes) — or, if its ' +
            'absence is deliberate, add a `gate` for it in PRODUCTION_MOUNT_MANIFEST ' +
            'naming the condition.',
        ).toBe(true);
      }
    } finally {
      await app.close();
    }
  });

  test('minimal real mode: ungated modules still mount; gated modules are absent as declared', async () => {
    const app = await composedProductionApp({ ...REAL_WITH_IDP } as NodeJS.ProcessEnv);
    try {
      for (const [name, entry] of Object.entries(PRODUCTION_MOUNT_MANIFEST)) {
        if (entry.gate === undefined) {
          expect(
            app.hasRoute(entry.probe),
            `routes/${name}.ts is declared ALWAYS-mounted but is absent under a minimal ` +
              'real-mode config. Either its wiring in main.ts grew an accidental provider ' +
              'dependency, or it is genuinely gated — then declare the gate here.',
          ).toBe(true);
        } else {
          expect(
            app.hasRoute(entry.probe),
            `routes/${name}.ts mounts even though its declared gate ("${entry.gate}") is ` +
              'NOT satisfied by the minimal config — the gate declaration is stale; fix ' +
              'the manifest or the wiring.',
          ).toBe(false);
        }
      }
    } finally {
      await app.close();
    }
  });
});

describe('requireHumanActor — smart-views/bulk need a session user in production', () => {
  test('GET /api/v1/smart-views with no session user is FORBIDDEN (never the sentinel actor)', async () => {
    const app = await composedProductionApp(MAXIMAL_REAL as NodeJS.ProcessEnv);
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/smart-views' });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    } finally {
      await app.close();
    }
  });

  test('POST /api/v1/bulk with no session user is FORBIDDEN (bearer tokens cannot bulk-write)', async () => {
    const app = await composedProductionApp(MAXIMAL_REAL as NodeJS.ProcessEnv);
    try {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/bulk',
        payload: { action: 'edit_status', smartViewId: '00000000-0000-4000-8000-000000000001' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
    } finally {
      await app.close();
    }
  });

  test('with a resolved session user the guard admits the request', async () => {
    const app = await composedProductionApp(MAXIMAL_REAL as NodeJS.ProcessEnv, {
      simulateUser: true,
    });
    try {
      const res = await app.inject({ method: 'GET', url: '/api/v1/smart-views' });
      // The stub db cannot serve the query (that is request-time, not what this
      // suite pins) — the assertion is that the GUARD no longer rejects.
      expect(res.statusCode).not.toBe(403);
      expect(res.statusCode).not.toBe(401);
    } finally {
      await app.close();
    }
  });

  test('requireHumanActor in isolation: rejects a userless request, passes a decorated one', async () => {
    const app = Fastify();
    app.get('/probe', { preHandler: requireHumanActor }, async () => ({ ok: true }));
    app.get(
      '/probe-with-user',
      {
        preHandler: [
          async (request): Promise<void> => {
            request.user = TEST_USER;
          },
          requireHumanActor,
        ],
      },
      async () => ({ ok: true }),
    );
    await app.ready();
    try {
      const denied = await app.inject({ method: 'GET', url: '/probe' });
      expect(denied.statusCode).toBe(403);
      expect(denied.json()).toMatchObject({ error: { code: 'FORBIDDEN' } });
      const admitted = await app.inject({ method: 'GET', url: '/probe-with-user' });
      expect(admitted.statusCode).toBe(200);
    } finally {
      await app.close();
    }
  });
});

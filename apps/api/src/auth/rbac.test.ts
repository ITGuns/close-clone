import { describe, expect, test } from 'vitest';

import {
  groupsToRole,
  resolveRole,
  SALES_CRM_ADMINS_GROUP,
  SALES_CRM_USERS_GROUP,
  type DomainRbacConfig,
} from './rbac.ts';

/** Task 5a — group → role mapping; extended with verified-domain resolution. */

describe('groupsToRole', () => {
  test('admins group → admin', () => {
    expect(groupsToRole([SALES_CRM_ADMINS_GROUP])).toBe('admin');
  });
  test('users group → rep', () => {
    expect(groupsToRole([SALES_CRM_USERS_GROUP])).toBe('rep');
  });
  test('both groups → admin (admin ⊃ rep)', () => {
    expect(groupsToRole([SALES_CRM_USERS_GROUP, SALES_CRM_ADMINS_GROUP])).toBe('admin');
  });
  test('neither group → null (login refused)', () => {
    expect(groupsToRole(['some-other-group'])).toBeNull();
    expect(groupsToRole([])).toBeNull();
  });
  test('undefined groups claim → null', () => {
    expect(groupsToRole(undefined)).toBeNull();
  });
});

// ── resolveRole: groups precedence + the verified-domain strategy ────────────

const DOMAIN: DomainRbacConfig = {
  allowedDomain: 'corp.com',
  adminEmails: new Set(['boss@corp.com']),
};

/** A fully valid domain-strategy claim set — each refusal test breaks ONE thing. */
const OK = { email: 'rep@corp.com', email_verified: true, hd: 'corp.com' } as const;

describe('resolveRole — groups claim is authoritative when present', () => {
  test('groups path unchanged: admins → admin, users → rep, both → admin', () => {
    expect(resolveRole({ groups: [SALES_CRM_ADMINS_GROUP] })).toEqual({
      ok: true,
      role: 'admin',
      strategy: 'groups',
    });
    expect(resolveRole({ groups: [SALES_CRM_USERS_GROUP] })).toEqual({
      ok: true,
      role: 'rep',
      strategy: 'groups',
    });
    expect(resolveRole({ groups: [SALES_CRM_USERS_GROUP, SALES_CRM_ADMINS_GROUP] })).toEqual({
      ok: true,
      role: 'admin',
      strategy: 'groups',
    });
  });

  test('groups claim present but gating-group-less REFUSES even when the domain would admit (no fall-through)', () => {
    // The IdP emitted groups and deliberately granted none — its access
    // decision stands; the domain strategy must not resurrect the login.
    expect(resolveRole({ groups: [], ...OK }, DOMAIN)).toEqual({ ok: false, reason: 'no_group' });
    expect(resolveRole({ groups: ['other-team'], ...OK }, DOMAIN)).toEqual({
      ok: false,
      reason: 'no_group',
    });
  });

  test('groups win over the allow-list when both strategies could apply', () => {
    // A groups-admin whose email is NOT allow-listed stays admin (groups rule),
    // and a groups-rep whose email IS allow-listed stays rep.
    expect(resolveRole({ groups: [SALES_CRM_ADMINS_GROUP], ...OK }, DOMAIN)).toEqual({
      ok: true,
      role: 'admin',
      strategy: 'groups',
    });
    expect(
      resolveRole({ groups: [SALES_CRM_USERS_GROUP], ...OK, email: 'boss@corp.com' }, DOMAIN),
    ).toEqual({ ok: true, role: 'rep', strategy: 'groups' });
  });
});

describe('resolveRole — verified-domain strategy', () => {
  test('a Workspace user in the domain → rep', () => {
    expect(resolveRole(OK, DOMAIN)).toEqual({ ok: true, role: 'rep', strategy: 'domain' });
  });

  test('an allow-listed address → admin, case-insensitively', () => {
    expect(resolveRole({ ...OK, email: 'boss@corp.com' }, DOMAIN)).toEqual({
      ok: true,
      role: 'admin',
      strategy: 'domain',
    });
    expect(resolveRole({ ...OK, email: 'Boss@Corp.COM' }, DOMAIN)).toEqual({
      ok: true,
      role: 'admin',
      strategy: 'domain',
    });
  });

  test('hd matches case-insensitively', () => {
    expect(resolveRole({ ...OK, hd: 'Corp.COM' }, DOMAIN)).toEqual({
      ok: true,
      role: 'rep',
      strategy: 'domain',
    });
  });

  test('no strategy configured + no groups claim → no_group (pre-existing refusal)', () => {
    expect(resolveRole(OK)).toEqual({ ok: false, reason: 'no_group' });
    expect(resolveRole({})).toEqual({ ok: false, reason: 'no_group' });
  });

  // ── fail-closed refusals: every missing/wrong claim REFUSES, never reps ───

  test('missing or empty email → domain_no_email', () => {
    expect(resolveRole({ email_verified: true, hd: 'corp.com' }, DOMAIN)).toEqual({
      ok: false,
      reason: 'domain_no_email',
    });
    expect(resolveRole({ ...OK, email: '' }, DOMAIN)).toEqual({
      ok: false,
      reason: 'domain_no_email',
    });
  });

  test('unverified email → domain_email_unverified (false AND absent both refuse)', () => {
    expect(resolveRole({ ...OK, email_verified: false }, DOMAIN)).toEqual({
      ok: false,
      reason: 'domain_email_unverified',
    });
    expect(resolveRole({ email: 'rep@corp.com', hd: 'corp.com' }, DOMAIN)).toEqual({
      ok: false,
      reason: 'domain_email_unverified',
    });
  });

  test('no hd claim (a personal gmail.com account) → domain_no_hd, never defaulted', () => {
    expect(resolveRole({ email: 'anyone@gmail.com', email_verified: true }, DOMAIN)).toEqual({
      ok: false,
      reason: 'domain_no_hd',
    });
    // Even an allow-list hit cannot rescue a token with no hd.
    expect(resolveRole({ email: 'boss@corp.com', email_verified: true }, DOMAIN)).toEqual({
      ok: false,
      reason: 'domain_no_hd',
    });
    expect(resolveRole({ ...OK, hd: '' }, DOMAIN)).toEqual({ ok: false, reason: 'domain_no_hd' });
  });

  test('wrong Workspace domain → domain_hd_mismatch', () => {
    expect(
      resolveRole({ email: 'rep@other.com', email_verified: true, hd: 'other.com' }, DOMAIN),
    ).toEqual({ ok: false, reason: 'domain_hd_mismatch' });
  });

  test('hd in-domain but email outside it → domain_email_mismatch (belt-and-braces)', () => {
    expect(
      resolveRole({ email: 'rep@elsewhere.com', email_verified: true, hd: 'corp.com' }, DOMAIN),
    ).toEqual({ ok: false, reason: 'domain_email_mismatch' });
  });

  test('a superstring domain never matches (corp.com ≠ notcorp.com / corp.com.evil.io)', () => {
    expect(
      resolveRole({ email: 'x@notcorp.com', email_verified: true, hd: 'notcorp.com' }, DOMAIN),
    ).toEqual({ ok: false, reason: 'domain_hd_mismatch' });
    expect(
      resolveRole(
        { email: 'x@corp.com.evil.io', email_verified: true, hd: 'corp.com.evil.io' },
        DOMAIN,
      ),
    ).toEqual({ ok: false, reason: 'domain_hd_mismatch' });
  });

  test('empty allow-list: everyone in the domain is rep, nobody is admin', () => {
    const noAdmins: DomainRbacConfig = { allowedDomain: 'corp.com', adminEmails: new Set() };
    expect(resolveRole({ ...OK, email: 'boss@corp.com' }, noAdmins)).toEqual({
      ok: true,
      role: 'rep',
      strategy: 'domain',
    });
  });
});

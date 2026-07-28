import type { Role } from './types.ts';

/**
 * Role resolution (Task 5a; extended for direct-Google SSO — see DECISIONS).
 *
 * TWO strategies, tried in a fixed precedence order by {@link resolveRole}:
 *
 *  1. **Groups** (build guide §1: no local roles — the IdP is the authority).
 *     If the verified ID token carries a `groups` claim AT ALL, it is
 *     authoritative and there is NO fall-through: an IdP that emits groups has
 *     expressed role intent, and a user it placed in neither gating group was
 *     deliberately not granted access (refusing here is what keeps a Keycloak
 *     deployment's access decisions in Keycloak).
 *  2. **Verified Workspace domain** (Google's ID tokens NEVER carry `groups`).
 *     Active only when configured ({@link DomainRbacConfig}, from
 *     `AUTH_ALLOWED_DOMAIN` / `AUTH_ADMIN_EMAILS`): the token must present a
 *     VERIFIED email (`email_verified === true` — Google explicitly warns the
 *     bare `email` claim is not proof of ownership) whose `hd` claim equals the
 *     configured Workspace domain. `hd` is only minted for Workspace-hosted
 *     accounts, so a personal gmail.com account — which can complete the OIDC
 *     flow perfectly well — has no `hd` and is refused. Within the domain the
 *     env allow-list grants `admin`; everyone else is `rep`.
 *
 * Anyone neither strategy admits is refused login entirely (there is no
 * "authenticated but role-less" state), with a distinct audited reason per
 * refusal path — never a silent default to `rep`.
 */

export const SALES_CRM_ADMINS_GROUP = 'sales-crm-admins';
export const SALES_CRM_USERS_GROUP = 'sales-crm-users';

/**
 * Map IdP group claims to a Switchboard role, or `null` if the user is in neither
 * gating group (→ login refused, audited `auth.denied`). Role is recomputed from
 * groups on every login, so removing someone from the admins group demotes them
 * on their next sign-in.
 */
export function groupsToRole(groups: readonly string[] | undefined): Role | null {
  if (groups === undefined) return null;
  if (groups.includes(SALES_CRM_ADMINS_GROUP)) return 'admin';
  if (groups.includes(SALES_CRM_USERS_GROUP)) return 'rep';
  return null;
}

/**
 * Domain-strategy configuration, built by the composition root from
 * `AUTH_ALLOWED_DOMAIN` / `AUTH_ADMIN_EMAILS` (config.ts normalises both to
 * lowercase and validates their shape at boot). Absent ⇒ groups-only, exactly
 * the pre-existing behaviour.
 */
export interface DomainRbacConfig {
  /** Workspace domain (lowercase, e.g. `corp.com`) the token's `hd` must equal. */
  allowedDomain: string;
  /** Lowercased emails granted `admin`; everyone else in the domain is `rep`. */
  adminEmails: ReadonlySet<string>;
}

/**
 * Machine reasons for a refused role resolution — each is written verbatim to
 * the `auth.denied` audit row, so keep them distinct and greppable.
 *
 * - `no_group` — groups strategy: claim present but no gating group, or claim
 *   absent with no domain strategy configured (the pre-existing reason).
 * - `domain_*` — domain strategy configured but the token fails a required
 *   check. Missing/failed claims REFUSE; they never default to `rep`.
 */
export type RoleRefusalReason =
  | 'no_group'
  | 'domain_no_email'
  | 'domain_email_unverified'
  | 'domain_no_hd'
  | 'domain_hd_mismatch'
  | 'domain_email_mismatch';

export type RoleResolution =
  | { ok: true; role: Role; strategy: 'groups' | 'domain' }
  | { ok: false; reason: RoleRefusalReason };

/** The subset of verified ID-token claims role resolution reads. */
export interface RoleClaims {
  groups?: readonly string[] | undefined;
  email?: string | undefined;
  email_verified?: boolean | undefined;
  /** Google Workspace hosted-domain claim; absent on personal accounts. */
  hd?: string | undefined;
}

/**
 * Resolve a Switchboard role from VERIFIED ID-token claims (the caller must
 * only pass claims that already survived signature + iss/aud/exp/nonce checks).
 *
 * Precedence: a present `groups` claim is authoritative and never falls through
 * (see the module doc). Only a token with NO groups claim consults the domain
 * strategy, and only when the strategy is configured. Every early return on the
 * domain path is deliberate fail-closed ordering: identity proof first
 * (email present → verified), then tenancy (`hd` present → matches), then the
 * belt-and-braces email/domain agreement, and only then the role grant.
 */
export function resolveRole(claims: RoleClaims, domain?: DomainRbacConfig): RoleResolution {
  if (claims.groups !== undefined) {
    const role = groupsToRole(claims.groups);
    if (role === null) return { ok: false, reason: 'no_group' };
    return { ok: true, role, strategy: 'groups' };
  }
  if (domain === undefined) return { ok: false, reason: 'no_group' };

  const email = claims.email;
  if (email === undefined || email === '') return { ok: false, reason: 'domain_no_email' };
  // Strict `!== true`: absent and non-boolean-true both refuse. An unverified
  // email is an ATTACKER-CHOSEN string — anyone can register any address at a
  // consumer IdP without proving ownership.
  if (claims.email_verified !== true) return { ok: false, reason: 'domain_email_unverified' };

  const hd = claims.hd;
  // No `hd` ⇒ not a Workspace-hosted account (personal gmail.com completes the
  // OIDC flow fine) — refused, never defaulted.
  if (hd === undefined || hd === '') return { ok: false, reason: 'domain_no_hd' };
  if (hd.toLowerCase() !== domain.allowedDomain) return { ok: false, reason: 'domain_hd_mismatch' };

  // Belt-and-braces: `hd` is the authority, but the email the row is keyed on
  // must agree with it, or we would provision an out-of-domain address.
  const emailLower = email.toLowerCase();
  if (!emailLower.endsWith(`@${domain.allowedDomain}`)) {
    return { ok: false, reason: 'domain_email_mismatch' };
  }

  return {
    ok: true,
    role: domain.adminEmails.has(emailLower) ? 'admin' : 'rep',
    strategy: 'domain',
  };
}

import { z } from 'zod';

/**
 * Typed, zod-validated runtime config (CONTRACTS §C9: every module works under
 * MOCK_MODE=1 with no external accounts). Parse once at boot; never read
 * `process.env` elsewhere.
 */

const boolFlag = z.enum(['0', '1']).transform((v) => v === '1');

/**
 * The dev/test fallback session secret. It is intentionally weak and is REJECTED
 * in production (see {@link loadConfig}) — it keys the session-cookie HMAC and
 * the AES OAuth-token cipher, so a default/unset value in production would allow
 * cookie forgery and token decryption.
 */
const DEV_SESSION_SECRET = 'dev-insecure-session-secret';

/**
 * The dev/test fallback List-Unsubscribe signing secret. Deliberately DISTINCT
 * from {@link DEV_SESSION_SECRET}: the two keys serve different purposes
 * (session/cipher vs. unsubscribe HMAC), and keeping them separate even in dev
 * means no code path can quietly conflate them. Rejected in production.
 */
const DEV_UNSUBSCRIBE_SECRET = 'dev-insecure-unsubscribe-secret';

/**
 * Publicly-known placeholder secrets that MUST be rejected in production even
 * though some satisfy the length floor — they ship in `.env.example`, git, and
 * docs, so treating them as valid would hand every reader a working key. Keep in
 * sync with `.env.example` and `deploy/.env.example`.
 */
const KNOWN_INSECURE_SECRETS: ReadonlySet<string> = new Set([
  DEV_SESSION_SECRET,
  DEV_UNSUBSCRIBE_SECRET,
  'change-me-to-a-64-char-random-hex-string',
  'change-me-32-chars-minimum-000000',
  // LIST_UNSUBSCRIBE_SECRET placeholders (current + historical .env.example copies).
  'change-me-to-a-different-64-char-random-hex',
  'change-me-32-chars-minimum-111111',
  'change-me-random-hex',
  // GMAIL_PUSH_TOKEN placeholder (.env.example must use exactly this string).
  'change-me-to-a-random-gmail-push-token',
]);

/** Minimum acceptable secret length (SESSION_SECRET, LIST_UNSUBSCRIBE_SECRET) in production. */
const MIN_PROD_SECRET_LEN = 32;

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  MOCK_MODE: boolFlag.default('1'),
  DATABASE_URL: z.string().min(1).default('postgres://localhost:5432/switchboard'),
  REDIS_URL: z.string().min(1).default('redis://localhost:6379'),
  SESSION_SECRET: z.string().min(1).default(DEV_SESSION_SECRET),
  LIST_UNSUBSCRIBE_SECRET: z.string().min(1).default(DEV_UNSUBSCRIBE_SECRET),
  /** Shared token authenticating /wh/gmail pushes. Optional here — real mode
   *  enforces presence when Gmail is configured (main.ts assertRealModeConfig). */
  GMAIL_PUSH_TOKEN: z.string().min(1).optional(),
  // ── Real-mode provider credentials (all optional: absent ⇒ that FEATURE is
  // paused, never the boot; PARTIAL Twilio config is refused by main.ts
  // assertRealModeConfig — see the posture note there). All ignored under
  // MOCK_MODE=1.
  TWILIO_ACCOUNT_SID: z.string().min(1).optional(),
  TWILIO_AUTH_TOKEN: z.string().min(1).optional(),
  TWILIO_API_KEY_SID: z.string().min(1).optional(),
  TWILIO_API_KEY_SECRET: z.string().min(1).optional(),
  TWILIO_PHONE_NUMBER: z.string().min(1).optional(),
  DEEPGRAM_API_KEY: z.string().min(1).optional(),
  ANTHROPIC_API_KEY: z.string().min(1).optional(),
  /** Public origin the proxy forwards to /wh/* (Twilio signs the FULL URL).
   *  Required by assertRealModeConfig whenever telephony is configured. */
  PUBLIC_WEBHOOK_URL: z.string().min(1).optional(),
});

// ── Domain-based SSO role resolution (auth/rbac.ts) — for IdPs that emit no
// `groups` claim (Google Workspace direct). Shape-validated + normalised by the
// parsers below (unconditionally: a malformed value is malformed in any mode);
// cross-field coherence (admins ⊆ domain, Google issuer requires the domain) is
// real-mode-gated in main.ts assertRealModeConfig.

/**
 * A bare DNS domain (`corp.com`): labels of letters/digits/hyphens, at least
 * one dot, no scheme/`@`/path. Anything else is refused AT BOOT — a malformed
 * AUTH_ALLOWED_DOMAIN would otherwise fail closed at runtime by bouncing every
 * login, which is safe but undebuggable.
 */
const AUTH_DOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/;

/** One `local@domain.tld` shape per entry — a non-email entry can never match a
 *  verified email, i.e. it is a dead admin grant; refuse loudly at boot. */
const AUTH_ADMIN_EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * `AUTH_ALLOWED_DOMAIN` → normalised lowercase domain, or null when unset/blank.
 * Throws on a malformed value (see {@link AUTH_DOMAIN_RE}).
 */
function parseAllowedDomain(raw: string | undefined): string | null {
  const trimmed = raw?.trim().toLowerCase() ?? '';
  if (trimmed === '') return null;
  if (!AUTH_DOMAIN_RE.test(trimmed)) {
    throw new Error(
      `AUTH_ALLOWED_DOMAIN must be a bare Workspace domain like "example.com" ` +
        `(got '${trimmed}'): no scheme, no "@", no path — it is compared against ` +
        `the Google ID token's \`hd\` claim.`,
    );
  }
  return trimmed;
}

/**
 * `AUTH_ADMIN_EMAILS` (comma-separated) → normalised lowercase, deduplicated
 * list. Whitespace around entries and stray/trailing commas are tolerated;
 * a non-email entry throws (dead grant — see {@link AUTH_ADMIN_EMAIL_RE}).
 */
function parseAdminEmails(raw: string | undefined): string[] {
  if (raw === undefined) return [];
  const emails: string[] = [];
  for (const part of raw.split(',')) {
    const entry = part.trim().toLowerCase();
    if (entry === '') continue;
    if (!AUTH_ADMIN_EMAIL_RE.test(entry)) {
      throw new Error(
        `AUTH_ADMIN_EMAILS entry '${entry}' is not an email address; expected a ` +
          `comma-separated list like "alice@corp.com, bob@corp.com".`,
      );
    }
    if (!emails.includes(entry)) emails.push(entry);
  }
  return emails;
}

/**
 * Env-file convention (D-061): a blank `VAR=` line in a compose env_file reaches
 * the process as '' — treat it exactly like unset, so `??`/default fallbacks fire
 * instead of '' silently winning.
 */
function blankAsUnset(value: string | undefined): string | undefined {
  return value === '' ? undefined : value;
}

export interface AppConfig {
  nodeEnv: 'development' | 'test' | 'production';
  port: number;
  mockMode: boolean;
  databaseUrl: string;
  redisUrl: string;
  sessionSecret: string;
  listUnsubscribeSecret: string;
  /** null ⇒ unset (or blank env line). Real mode + Gmail configured requires it. */
  gmailPushToken: string | null;
  // Real-mode provider credentials. null ⇒ unset (or blank env line) ⇒ that
  // feature stays paused in real mode. All unused under MOCK_MODE=1.
  twilioAccountSid: string | null;
  twilioAuthToken: string | null;
  twilioApiKeySid: string | null;
  twilioApiKeySecret: string | null;
  twilioPhoneNumber: string | null;
  deepgramApiKey: string | null;
  anthropicApiKey: string | null;
  /** Public origin for /wh/* callbacks + unsubscribe links. null ⇒ unset. */
  publicWebhookUrl: string | null;
  /**
   * Workspace domain for verified-domain role resolution (auth/rbac.ts),
   * lowercase. null ⇒ unset ⇒ groups-only RBAC (the Keycloak path). Real mode
   * with OIDC_ISSUER = accounts.google.com REQUIRES it (assertRealModeConfig):
   * Google emits no `groups` claim, so without it every login is refused.
   */
  authAllowedDomain: string | null;
  /**
   * Lowercased, deduplicated admin allow-list for the domain strategy. Empty ⇒
   * everyone in the domain is `rep`. Only meaningful with authAllowedDomain
   * (set without it, real mode refuses to boot — a dead grant is a misconfig).
   */
  authAdminEmails: readonly string[];
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.parse({
    NODE_ENV: env.NODE_ENV,
    PORT: env.PORT,
    MOCK_MODE: env.MOCK_MODE,
    DATABASE_URL: env.DATABASE_URL,
    REDIS_URL: env.REDIS_URL,
    SESSION_SECRET: env.SESSION_SECRET,
    // Env-file convention: `LIST_UNSUBSCRIBE_SECRET=` (blank line in a compose
    // env_file) reaches us as '' — treat it exactly like unset so it falls to
    // the dev default, which production then REJECTS below. Without this, `??`
    // -style fallbacks let '' through and the HMAC key was literally ''.
    LIST_UNSUBSCRIBE_SECRET:
      env.LIST_UNSUBSCRIBE_SECRET === '' ? undefined : env.LIST_UNSUBSCRIBE_SECRET,
    // Same blank-line convention: '' behaves like unset (→ null, and real mode
    // with Gmail configured then refuses to boot — never a '' shared token).
    GMAIL_PUSH_TOKEN: env.GMAIL_PUSH_TOKEN === '' ? undefined : env.GMAIL_PUSH_TOKEN,
    // Provider credentials: '' (a blank env line — every one of these ships
    // commented-in but empty in .env.example) is unset, so an untouched env file
    // pauses the feature instead of constructing an adapter with '' creds.
    TWILIO_ACCOUNT_SID: blankAsUnset(env.TWILIO_ACCOUNT_SID),
    TWILIO_AUTH_TOKEN: blankAsUnset(env.TWILIO_AUTH_TOKEN),
    TWILIO_API_KEY_SID: blankAsUnset(env.TWILIO_API_KEY_SID),
    TWILIO_API_KEY_SECRET: blankAsUnset(env.TWILIO_API_KEY_SECRET),
    TWILIO_PHONE_NUMBER: blankAsUnset(env.TWILIO_PHONE_NUMBER),
    DEEPGRAM_API_KEY: blankAsUnset(env.DEEPGRAM_API_KEY),
    ANTHROPIC_API_KEY: blankAsUnset(env.ANTHROPIC_API_KEY),
    PUBLIC_WEBHOOK_URL: blankAsUnset(env.PUBLIC_WEBHOOK_URL),
  });
  // Fail closed in production: an unset (→ dev default), publicly-known
  // placeholder, or too-short SESSION_SECRET would let an attacker forge session
  // cookies and decrypt stored OAuth tokens. Dev/test keep the weak default so
  // MOCK_MODE runs with no config.
  if (
    parsed.NODE_ENV === 'production' &&
    (KNOWN_INSECURE_SECRETS.has(parsed.SESSION_SECRET) ||
      parsed.SESSION_SECRET.length < MIN_PROD_SECRET_LEN)
  ) {
    throw new Error(
      'SESSION_SECRET must be set to a strong unique value in production (>=32 chars); the dev default and .env.example placeholder are insecure.',
    );
  }
  // Same fail-closed rule for the List-Unsubscribe signing key: a forgeable
  // key (empty, dev default, committed placeholder, or short) lets anyone mint
  // valid one-click unsubscribe tokens and mass-suppress arbitrary leads — a
  // compliance-rail bypass (I-SEND-5). No fallback to SESSION_SECRET: key reuse
  // across purposes is what hid this hole in the first place.
  if (
    parsed.NODE_ENV === 'production' &&
    (KNOWN_INSECURE_SECRETS.has(parsed.LIST_UNSUBSCRIBE_SECRET) ||
      parsed.LIST_UNSUBSCRIBE_SECRET.length < MIN_PROD_SECRET_LEN)
  ) {
    throw new Error(
      'LIST_UNSUBSCRIBE_SECRET must be set to a strong unique value in production (>=32 chars); it signs one-click unsubscribe tokens, and an empty/placeholder value would let anyone forge them and mass-suppress leads.',
    );
  }
  // GMAIL_PUSH_TOKEN gates /wh/gmail — an otherwise-unauthenticated internet
  // ingress. Presence is enforced by main.ts (real mode + Gmail configured);
  // WHEN set in production it must be strong, or the webhook is guessably open.
  if (
    parsed.NODE_ENV === 'production' &&
    parsed.GMAIL_PUSH_TOKEN !== undefined &&
    (KNOWN_INSECURE_SECRETS.has(parsed.GMAIL_PUSH_TOKEN) ||
      parsed.GMAIL_PUSH_TOKEN.length < MIN_PROD_SECRET_LEN)
  ) {
    throw new Error(
      'GMAIL_PUSH_TOKEN must be a strong unique value in production (>=32 chars); it authenticates /wh/gmail pushes, and a guessable/placeholder token leaves the webhook open to the internet.',
    );
  }
  return {
    nodeEnv: parsed.NODE_ENV,
    port: parsed.PORT,
    mockMode: parsed.MOCK_MODE,
    databaseUrl: parsed.DATABASE_URL,
    redisUrl: parsed.REDIS_URL,
    sessionSecret: parsed.SESSION_SECRET,
    listUnsubscribeSecret: parsed.LIST_UNSUBSCRIBE_SECRET,
    gmailPushToken: parsed.GMAIL_PUSH_TOKEN ?? null,
    twilioAccountSid: parsed.TWILIO_ACCOUNT_SID ?? null,
    twilioAuthToken: parsed.TWILIO_AUTH_TOKEN ?? null,
    twilioApiKeySid: parsed.TWILIO_API_KEY_SID ?? null,
    twilioApiKeySecret: parsed.TWILIO_API_KEY_SECRET ?? null,
    twilioPhoneNumber: parsed.TWILIO_PHONE_NUMBER ?? null,
    deepgramApiKey: parsed.DEEPGRAM_API_KEY ?? null,
    anthropicApiKey: parsed.ANTHROPIC_API_KEY ?? null,
    publicWebhookUrl: parsed.PUBLIC_WEBHOOK_URL ?? null,
    // Blank/whitespace-only ⇒ unset (the D-061 env-file convention); malformed
    // values throw here so the boot fails loud instead of bouncing every login.
    authAllowedDomain: parseAllowedDomain(env.AUTH_ALLOWED_DOMAIN),
    authAdminEmails: parseAdminEmails(env.AUTH_ADMIN_EMAILS),
  };
}

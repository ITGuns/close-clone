import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import Fastify, {
  type FastifyInstance,
  type FastifyRequest,
  type preHandlerHookHandler,
} from 'fastify';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { sql } from 'drizzle-orm';
import pg from 'pg';
import { Queue } from 'bullmq';

import { loadConfig, type AppConfig } from './config.ts';
import type { Db } from './db/index.ts';
import { orgSettings } from './db/schema.ts';
import { registerRoutes, sendError } from './routes/index.ts';
import type { ActivityWebhookEmitter } from './services/activity/index.ts';
import {
  createProviderRegistry,
  createEmailSenderRegistry,
  createRealTelephonyProvider,
  createRealASRProvider,
  createRealAIProvider,
  type ProviderRegistry,
  type EmailSenderRegistry,
} from './providers/registry.ts';
import type { TelephonyProvider, ASRProvider, AIProvider } from '@switchboard/shared/providers';
import type { TelephonyRouteDeps } from './routes/telephony.ts';
import type { SmsRouteDeps } from './routes/sms.ts';
import type { AiRouteDeps } from './routes/ai.ts';
import { createBullmqQueueDriver } from './queue/index.ts';
import type { QueueDriver } from './queue/index.ts';
import { TokenCipher } from './services/sync/token-cipher.ts';
import { SharedTokenGmailPushVerifier, type GmailPushVerifier } from './services/sync/webhook.ts';
import { ImportStorage } from './services/imports/storage.ts';
import { sweepDueIntents } from './services/sequences/sweeper.ts';
import { processIntent } from './services/sequences/dispatch.ts';
import { SEND_JOB_NAME } from './services/sequences/job-names.ts';
import { handleTelephonyJob, TWILIO_PROCESS_JOB } from './services/telephony/worker.ts';
import { processPendingTwilioWebhooks } from './services/telephony/process.ts';
import { SignatureTwilioVerifier } from './services/telephony/ingress.ts';
import { MOCK_TWILIO_AUTH_TOKEN } from './providers/telephony/twilio-signature.ts';
import {
  buildLogController,
  buildLoggerOptions,
  createErrorSinkFromConfig,
  createGracefulShutdown,
  genRequestId,
  registerHealthz,
  registerHttpObservability,
  registerSecurityHeaders,
} from './observability/index.ts';
import { requireAdmin, requireSession } from './auth/guards.ts';
import {
  TokenService,
  PostgresRateLimiter,
  createBearerAuthPreHandler,
} from './services/tokens/index.ts';
import { registerAdminTokenRoutes } from './routes/admin-tokens.ts';
import { registerWebhookSubscriptionRoutes } from './routes/webhook-subscriptions.ts';
import {
  createWebhookDeliveryProcessor,
  createActivityWebhookEmitter,
  sweepPendingWebhookDeliveries,
  type WebhookSender,
} from './services/webhooks/index.ts';
import { SessionCodec } from './auth/session/session.ts';
import { OidcTxnCodec } from './auth/session/txn.ts';
import { OidcClient } from './auth/oidc/index.ts';
import { registerOidcAuthRoutes } from './auth/routes.ts';
import type { SessionReader } from './auth/types.ts';
import { registerDevAuthRoutes } from './dev/auth.ts';
import { resolveCurrentUserId } from './dev/util.ts';

/**
 * THE PRODUCTION COMPOSITION ROOT (deploy/WIRING.md).
 *
 * `server.ts` is a test/embedded helper: no auth, stub healthz, no workers. This
 * is the entry the container actually runs — the one place that owns real
 * config, a real pg pool, real Redis, and the security posture:
 *
 *   - migrations on boot behind a Postgres advisory lock (single-writer safe
 *     across replicas), gated by MIGRATE_ON_BOOT
 *   - a GLOBAL `requireSession` preHandler over /api/v1/* with the documented
 *     exemptions (/wh/*, public unsubscribe, /healthz, dev-login in MOCK_MODE)
 *     — review finding F4
 *   - `requireAdmin` threaded into every admin surface AND the import routes
 *     (bulk write) — review finding F4
 *   - real `/healthz` probing Postgres + BullMQ queue depth
 *   - structured logging with request ids + secret redaction, an error sink,
 *     and graceful shutdown that drains then closes pg + queue
 *   - the sequence worker: queue processor + due-intent sweeper
 *
 * MOCK_MODE branches ONLY here, at the adapter line: the session reader, the
 * provider registry, and the auth issuer are chosen once and injected. Nothing
 * above this file knows which mode it is in.
 */

const MIGRATIONS_DIR = resolve(dirname(fileURLToPath(import.meta.url)), 'db/migrations');

/** Advisory-lock key for the boot migrator (any stable 64-bit constant). */
const MIGRATION_LOCK_KEY = 4_017_755_301_882_113n;

/** How often the sweeper enqueues due send-intents. */
const SWEEP_INTERVAL_MS = 15_000;

/** A CLAIMED intent older than this is expired to FAILED_TIMEOUT by the sweeper. */
const CLAIM_TIMEOUT_MS = 5 * 60_000;

export type AppRole = 'server' | 'worker';

export interface BuiltApp {
  app: FastifyInstance;
  db: Db;
  queue: QueueDriver;
  close: () => Promise<void>;
}

function readRole(env: NodeJS.ProcessEnv): AppRole {
  return env['APP_ROLE'] === 'worker' ? 'worker' : 'server';
}

/**
 * Run pending migrations under an advisory lock so concurrent replicas cannot
 * race the same DDL: the loser blocks, then finds nothing to do.
 */
export async function migrateOnBoot(db: Db): Promise<void> {
  await db.execute(sql`select pg_advisory_lock(${MIGRATION_LOCK_KEY})`);
  try {
    await migrate(db as never, { migrationsFolder: MIGRATIONS_DIR });
  } finally {
    await db.execute(sql`select pg_advisory_unlock(${MIGRATION_LOCK_KEY})`);
  }
}

/**
 * The session seam (auth/types.ts): real mode reads the OIDC session cookie;
 * MOCK_MODE reads the dev-login cookie/bearer. Both feed the SAME guards.
 */
function buildSessionReader(config: AppConfig): SessionReader {
  if (config.mockMode) {
    return (request) => {
      const userId = resolveCurrentUserId(request, config.sessionSecret);
      return userId === null ? null : { userId };
    };
  }
  // Real mode: the signed OIDC session cookie the login callback issued. Its
  // `read` returns exactly the SessionReader shape (userId + optional sliding-
  // renewal Set-Cookie the guard echoes). `secure` defaults on (TLS-terminated
  // upstream, ARCHITECTURE §8).
  const codec = new SessionCodec({ secret: config.sessionSecret });
  return (request) => codec.read(request.headers.cookie);
}

/**
 * Fail closed. A production boot without an IdP would otherwise serve the whole
 * API with no way to authenticate anyone — refuse instead.
 */
export function assertRealModeConfig(config: AppConfig, env: NodeJS.ProcessEnv): void {
  if (config.mockMode) return;
  const missing = ['OIDC_ISSUER', 'OIDC_CLIENT_ID', 'OIDC_CLIENT_SECRET'].filter(
    (key) => (env[key] ?? '').trim() === '',
  );
  if (missing.length > 0) {
    throw new Error(
      `MOCK_MODE=0 requires company IdP config: ${missing.join(', ')} unset. ` +
        'Set them (HUMAN_TODO.md → "Company IdP OIDC app") or run MOCK_MODE=1.',
    );
  }
  // /wh/gmail mounts iff Gmail is configured. When it WILL mount, the push
  // ingress must have its shared token (CONTRACTS §C7 "signature-verified") —
  // without one, any internet caller could inject webhook_inbox rows and force
  // resyncs. Fail the boot rather than ever serving that route open.
  if ((env['GOOGLE_CLIENT_ID'] ?? '') !== '' && config.gmailPushToken === null) {
    throw new Error(
      'MOCK_MODE=0 with GOOGLE_CLIENT_ID set requires GMAIL_PUSH_TOKEN: it authenticates ' +
        '/wh/gmail pushes (configure the Pub/Sub push subscription with the same token). ' +
        'Set it, or unset GOOGLE_CLIENT_ID to run without Gmail sync.',
    );
  }
  // Telephony follows the same posture as Gmail (D-061): WHOLLY absent ⇒ the
  // calls/SMS surface simply never mounts and the boot proceeds; PARTIALLY
  // present ⇒ refuse to boot naming the missing keys. Any TWILIO_* var set is
  // the operator signalling intent — booting with only some of the set would
  // either mount routes that fail per-request (the D-061 email-send bug) or
  // silently drop the feature the operator just configured.
  const twilioTouched = [
    config.twilioAccountSid,
    config.twilioAuthToken,
    config.twilioApiKeySid,
    config.twilioApiKeySecret,
    config.twilioPhoneNumber,
  ].some((v) => v !== null);
  if (twilioTouched) {
    const missingTwilio: string[] = [];
    if (config.twilioAccountSid === null) missingTwilio.push('TWILIO_ACCOUNT_SID');
    if (config.twilioAuthToken === null) missingTwilio.push('TWILIO_AUTH_TOKEN');
    // Without a default caller-id every UI dial fails per-request and every
    // sequence SMS step skips — a half-alive feature, so it is part of the set.
    if (config.twilioPhoneNumber === null) missingTwilio.push('TWILIO_PHONE_NUMBER');
    // Twilio signs the FULL public URL. With the localhost fallback every
    // inbound /wh/twilio webhook fails verification — including STOP opt-outs,
    // which MUST ingest (§4.5) — so telephony without a public origin is a
    // compliance hazard, not a degraded mode.
    if (config.publicWebhookUrl === null) missingTwilio.push('PUBLIC_WEBHOOK_URL');
    if (missingTwilio.length > 0) {
      throw new Error(
        `MOCK_MODE=0 with a partial Twilio config: ${missingTwilio.join(', ')} unset. ` +
          'Telephony mounts only fully configured — set them (HUMAN_TODO.md → Twilio), ' +
          'or unset every TWILIO_* var to run without calling/SMS.',
      );
    }
    // The REST API-key pair is optional but indivisible: apiKeySid without its
    // secret makes every Twilio REST call Basic-auth with an empty password —
    // constructs fine, 401s per-request.
    if ((config.twilioApiKeySid === null) !== (config.twilioApiKeySecret === null)) {
      throw new Error(
        'TWILIO_API_KEY_SID and TWILIO_API_KEY_SECRET must be set together ' +
          '(they are a Basic-auth username/password pair); set both or neither.',
      );
    }
  }
}

/**
 * Provider registries for the composition root. Each vendor credential gates
 * ONLY its own feature — a missing account pauses that feature, never the boot
 * (guide §1/§4.6, D-061):
 *
 *  - Gmail gates email / sequence-email: the eager registry is built only when
 *    Gmail is configured, so SSO, leads, pipeline etc. run without it.
 *  - Twilio gates telephony (calls + SMS + /wh/twilio), Deepgram gates ASR,
 *    Anthropic gates AI — each built independently of Gmail AND of each other,
 *    so a Gmail-less deploy can still dial. `null` ⇒ paused ⇒ the routes that
 *    need it are simply not mounted.
 *
 * BOTH email registries receive the same `gmail` binding. The sender registry is
 * lazy about WHEN it fails (per send, not at construction) but it still needs the
 * OAuth config to build a real provider — constructing it without `gmail` made
 * every real-mode send throw `real email provider requires gmail OAuth config`.
 *
 * Telephony construction re-checks the FULL credential set even though
 * `assertRealModeConfig` already refused a partial one — same belt-and-braces as
 * `buildGmailPushVerifier`: a half-configured adapter that boots and throws
 * per-request must be unconstructible even if a future caller skips the gate.
 */
export interface BuiltRegistries {
  registry: ProviderRegistry | null;
  senderRegistry: EmailSenderRegistry;
  telephony: TelephonyProvider | null;
  asr: ASRProvider | null;
  ai: AIProvider | null;
}

export function buildRegistries(config: AppConfig, env: NodeJS.ProcessEnv): BuiltRegistries {
  if (config.mockMode) {
    const registryConfig = { mockMode: true };
    // ONE mock registry: routes and workers must share instances (the mocks keep
    // per-instance state — idempotency ledgers, call counts).
    const registry = createProviderRegistry(registryConfig);
    return {
      registry,
      senderRegistry: createEmailSenderRegistry(registryConfig),
      telephony: registry.telephony ?? null,
      asr: registry.asr ?? null,
      ai: registry.ai ?? null,
    };
  }
  const gmailConfigured = (env['GOOGLE_CLIENT_ID'] ?? '') !== '';
  const gmail = gmailConfigured
    ? {
        clientId: env['GOOGLE_CLIENT_ID']!,
        clientSecret: env['GOOGLE_CLIENT_SECRET'] ?? '',
        address: env['GMAIL_SENDER_ADDRESS'] ?? '',
      }
    : undefined;
  const registryConfig = { mockMode: false, ...(gmail !== undefined ? { gmail } : {}) };
  return {
    registry: gmailConfigured ? createProviderRegistry(registryConfig) : null,
    senderRegistry: createEmailSenderRegistry(registryConfig),
    telephony: realTelephonyFromConfig(config),
    asr:
      config.deepgramApiKey !== null
        ? createRealASRProvider({ apiKey: config.deepgramApiKey })
        : null,
    ai:
      config.anthropicApiKey !== null
        ? createRealAIProvider({ apiKey: config.anthropicApiKey })
        : null,
  };
}

/**
 * Real Twilio adapter iff the FULL credential set is present; otherwise null
 * (feature paused). Destructured locals so TypeScript narrows each field —
 * and so a partial set can never reach the adapter constructor.
 */
function realTelephonyFromConfig(config: AppConfig): TelephonyProvider | null {
  const { twilioAccountSid, twilioAuthToken, twilioPhoneNumber, publicWebhookUrl } = config;
  if (
    twilioAccountSid === null ||
    twilioAuthToken === null ||
    twilioPhoneNumber === null ||
    publicWebhookUrl === null
  ) {
    return null;
  }
  const { twilioApiKeySid, twilioApiKeySecret } = config;
  return createRealTelephonyProvider({
    accountSid: twilioAccountSid,
    authToken: twilioAuthToken,
    publicBaseUrl: publicWebhookUrl,
    ...(twilioApiKeySid !== null && twilioApiKeySecret !== null
      ? { apiKeySid: twilioApiKeySid, apiKeySecret: twilioApiKeySecret }
      : {}),
  });
}

/**
 * Comms route deps from the built providers — extracted so the mount decision is
 * testable without pg/redis (same rationale as `buildRegistries`). A key is
 * present iff its provider exists; `registerRoutes` mounts a family iff its key
 * is present, so "provider null ⇒ routes absent" is exactly this function.
 *
 * `/api/v1/ai/*` needs BOTH asr and ai (`AiRouteDeps` requires the pair — call
 * summaries run ASR→AI). One key without the other mounts nothing; the boot
 * warns (see buildProductionApp) rather than failing, because each key alone is
 * a complete config for its own vendor.
 */
export interface CommsRouteDeps {
  telephony?: Omit<TelephonyRouteDeps, 'db'>;
  sms?: Omit<SmsRouteDeps, 'db'>;
  ai?: Omit<AiRouteDeps, 'db'>;
}

export function buildCommsRouteDeps(
  config: AppConfig,
  built: Pick<BuiltRegistries, 'telephony' | 'asr' | 'ai'>,
  queue: QueueDriver,
): CommsRouteDeps {
  const publicBaseUrl = config.publicWebhookUrl ?? `http://localhost:${config.port}`;
  return {
    // Telephony (click-to-call + dialer, /wh/twilio ingress) and two-way SMS
    // mount only when a telephony provider exists — mock always; real iff the
    // full Twilio set was configured (buildRegistries). Twilio signs the FULL
    // public URL, so publicBaseUrl must be the external origin, never the proxy
    // host (assertRealModeConfig requires PUBLIC_WEBHOOK_URL with telephony).
    ...(built.telephony !== null
      ? {
          telephony: {
            verifier: new SignatureTwilioVerifier(
              config.mockMode ? MOCK_TWILIO_AUTH_TOKEN : (config.twilioAuthToken ?? ''),
            ),
            dialProvider: built.telephony,
            now: (): Date => new Date(),
            publicBaseUrl,
            queue,
            ...(config.twilioPhoneNumber !== null ? { callerId: config.twilioPhoneNumber } : {}),
          },
          sms: {
            provider: built.telephony,
            now: (): Date => new Date(),
            ...(config.twilioPhoneNumber !== null ? { fromNumber: config.twilioPhoneNumber } : {}),
          },
        }
      : {}),
    // AI (summaries, drafting, NL→Smart View) needs the ASR+AI pair.
    ...(built.asr !== null && built.ai !== null
      ? { ai: { asr: built.asr, ai: built.ai, now: (): Date => new Date() } }
      : {}),
  };
}

/**
 * `/wh/gmail` ingress verifier (CONTRACTS §C7: signature-verified). MOCK_MODE
 * keeps the structural-only check. Real mode REQUIRES the shared push token —
 * `assertRealModeConfig` already refused to boot without it, and this re-check
 * makes an open verifier unconstructible even if a future caller skips that
 * gate. The full Google Pub/Sub OIDC-JWT verifier is a later drop-in behind the
 * same `GmailPushVerifier` seam (needs a Google project — HUMAN_TODO); until
 * then this shared secret is what stands between the internet and
 * `webhook_inbox` writes.
 */
export function buildGmailPushVerifier(config: AppConfig): GmailPushVerifier {
  if (config.mockMode) return new SharedTokenGmailPushVerifier();
  if (config.gmailPushToken === null) {
    throw new Error(
      'MOCK_MODE=0 requires GMAIL_PUSH_TOKEN to authenticate /wh/gmail pushes; ' +
        'refusing to construct an open webhook verifier.',
    );
  }
  return new SharedTokenGmailPushVerifier({ requiredToken: config.gmailPushToken });
}

/**
 * `defaultUserId` sentinel for the smart-views/bulk deps. Those routes REQUIRE a
 * fallback actor id, but in production the fallback must be unreachable: both
 * surfaces run behind {@link requireHumanActor}, which rejects any request that
 * did not resolve to a session user BEFORE the handler can consult the fallback.
 * The nil-v4 value is deliberately not a real user: if a future change ever
 * removes the guard, writes attribute to a nonexistent user and fail the FK —
 * loud — instead of silently impersonating someone (dev's `defaultUserId` is a
 * dev-only convenience that must never reach this root).
 */
export const NO_SESSION_ACTOR_SENTINEL = '00000000-0000-4000-8000-000000000000';

/**
 * Production guard for actor-attributed surfaces (smart-views, bulk): the request
 * must carry a resolved SESSION user (`request.user`, set by the global
 * `requireSession` gate). Bearer API tokens pass the global gate but are machine
 * principals with no user identity — smart views are per-user objects (`me`
 * binding, create ownership) and bulk is a bulk-WRITE surface whose every event
 * is attributed to an acting human, so tokens are refused here the same way the
 * admin/* surface is session-only (a deliberately safe limitation, not an
 * oversight). 403 (authenticated but not permitted), never 401.
 */
export const requireHumanActor: preHandlerHookHandler = async (request, reply) => {
  if (request.user === undefined) {
    return sendError(
      reply,
      'FORBIDDEN',
      'this endpoint requires a signed-in user session; API tokens carry no user identity',
    );
  }
  return undefined;
};

/**
 * Org timezone for Smart View / bulk relative-date resolution (CONTRACTS C3),
 * read from `org_settings.company_timezone` at boot. Registration-time snapshot:
 * an admin PATCH of org-settings takes effect on the next process restart (same
 * class of tradeoff as every other registration-time dep here). Falls back to
 * the schema default 'UTC' when no org_settings row exists yet.
 */
export async function loadOrgTimezone(db: Db): Promise<string> {
  const rows = await db.select({ tz: orgSettings.companyTimezone }).from(orgSettings).limit(1);
  return rows[0]?.tz ?? 'UTC';
}

/**
 * Everything `registerProductionRoutes` needs beyond the app. Extracted so the
 * FULL production route surface is composable with a stub db/queue — the
 * route-mount manifest suite in main.test.ts registers exactly this function and
 * asserts every `routes/*.ts` module is mounted or deliberately gated. This is
 * the drift-stopper for the "works in dev/boot.ts, 404s in the container" class
 * of bug (smart-views/bulk, sms/send): dev and production may wire differently,
 * but production's wiring is now itself under test.
 */
export interface ProductionRouteWiring {
  config: AppConfig;
  built: BuiltRegistries;
  db: Db;
  queue: QueueDriver;
  cipher: TokenCipher;
  adminGuard: preHandlerHookHandler;
  activityEmitter: ActivityWebhookEmitter;
  orgTimezone: string;
  importStorageDir: string;
}

/**
 * THE production route surface: every `routes/*.ts` registrar mounts here (or is
 * deliberately absent per the feature gates named in buildRegistries /
 * buildCommsRouteDeps). `buildProductionApp` calls this with real infra; the
 * manifest suite calls it with stubs. Auth-session routes (OIDC/dev-login) are
 * NOT here — they are mode-specific and live with the session gate in
 * buildProductionApp.
 */
export function registerProductionRoutes(
  app: FastifyInstance,
  wiring: ProductionRouteWiring,
): void {
  const { config, built, db, queue, cipher, adminGuard, activityEmitter } = wiring;

  // The session actor, exactly as the global requireSession gate resolved it.
  const getSessionActor = (request: FastifyRequest): { userId: string } | null =>
    request.user !== undefined ? { userId: request.user.id } : null;

  registerRoutes(app, {
    db,
    emailSend: { providerFor: built.senderRegistry.providerFor, cipher },
    sequences: { queue, now: () => new Date() },
    // Validated in loadConfig (fail-closed in production). Deliberately NOT
    // falling back to sessionSecret: reusing the session key for a different
    // HMAC purpose is key reuse, and the old `env[...] ?? sessionSecret` read
    // silently accepted '' from a blank env line as the signing key.
    unsubscribe: { secret: config.listUnsubscribeSecret },
    // Email sync routes only when a provider exists (mock, or real + Gmail
    // configured). Absent → the routes are simply not mounted; the rest of the
    // API is unaffected.
    ...(built.registry !== null
      ? {
          email: {
            db,
            provider: built.registry.email,
            cipher,
            verifier: buildGmailPushVerifier(config),
            redirectUri: `${config.publicWebhookUrl ?? ''}/api/v1/oauth/gmail/callback`,
            providerName: config.mockMode ? 'mock' : 'gmail',
          },
        }
      : {}),
    // F4: import is a bulk-write surface (multipart CSV → dry-run → commit) —
    // never leave it on its injected default. Guard + a real authenticated actor.
    imports: {
      storage: new ImportStorage(wiring.importStorageDir),
      getActor: getSessionActor,
      preHandler: adminGuard,
    },
    adminAudit: { adminGuard },
    adminExport: { adminGuard },
    adminCrud: { adminGuard },
    inbox: { queue },
    // Smart Views + bulk (the daily-work loop, CONTRACTS §C7): rep surfaces, so
    // NOT admin-gated — but both take requireHumanActor + the real session actor
    // (never dev/boot.ts's fixture defaultUserId): `me` binds to the signed-in
    // rep, creates are owned by them, and every bulk event is attributed to the
    // human who clicked. The sentinel fallback is unreachable behind the guard.
    smartViews: {
      orgTimezone: wiring.orgTimezone,
      defaultUserId: NO_SESSION_ACTOR_SENTINEL,
      getActor: getSessionActor,
      preHandler: requireHumanActor,
    },
    bulk: {
      orgTimezone: wiring.orgTimezone,
      queue,
      defaultUserId: NO_SESSION_ACTOR_SENTINEL,
      getActor: getSessionActor,
      preHandler: requireHumanActor,
    },
    // Fan domain events onto outbound webhooks: activity.recorded stages its
    // delivery rows inside the record transaction, then enqueues post-commit
    // through this queue-backed emitter.
    activityEmitter,
    // Telephony (click-to-call + SMS, /wh/twilio ingress) + AI (summaries,
    // drafting, NL→Smart View) mount only when their providers exist — mock
    // always; real iff the family's credentials are fully configured
    // (buildRegistries). The mapping lives in buildCommsRouteDeps so it is
    // testable without pg/redis.
    ...buildCommsRouteDeps(config, built, queue),
  });

  // A lone ASR or AI key is a complete config for its vendor (so it must not
  // fail the boot) but mounts nothing, because /api/v1/ai/* needs the pair —
  // say so loudly instead of leaving an env archaeology dig.
  if (!config.mockMode && (built.asr !== null) !== (built.ai !== null)) {
    app.log.warn(
      { deepgramConfigured: built.asr !== null, anthropicConfigured: built.ai !== null },
      '/api/v1/ai/* not mounted: it needs BOTH DEEPGRAM_API_KEY and ANTHROPIC_API_KEY, and only one is set',
    );
  }

  // Admin CRUD for the internal API's own credentials: issue/revoke API tokens
  // and manage outbound webhook subscriptions. Admin-guarded (session-only),
  // so a token cannot mint or escalate tokens. The acting admin is the session
  // user (created_by / audit actor).
  registerAdminTokenRoutes(app, {
    db,
    adminGuard,
    resolveActorId: (request) => request.user?.id ?? null,
  });
  registerWebhookSubscriptionRoutes(app, { db, adminGuard });
}

export interface BuildOptions {
  config?: AppConfig;
  env?: NodeJS.ProcessEnv;
}

export async function buildProductionApp(options: BuildOptions = {}): Promise<BuiltApp> {
  const env = options.env ?? process.env;
  const config = options.config ?? loadConfig(env);
  assertRealModeConfig(config, env);

  // ── Real Postgres ─────────────────────────────────────────────────────────
  const pool = new pg.Pool({ connectionString: config.databaseUrl });
  const db = drizzle(pool) as unknown as Db;
  if (env['MIGRATE_ON_BOOT'] !== '0') await migrateOnBoot(db);

  // ── Real Redis / BullMQ ───────────────────────────────────────────────────
  const redis = new URL(config.redisUrl);
  const connection = {
    host: redis.hostname,
    port: Number(redis.port || 6379),
    ...(redis.password !== '' ? { password: redis.password } : {}),
  };
  const queue = createBullmqQueueDriver({ connection });
  // A second handle purely for depth introspection (the driver hides its queue).
  const probeQueue = new Queue('sequences', { connection });

  // ── Providers ─────────────────────────────────────────────────────────────
  // Both email registries share the gmail binding — see buildRegistries for why
  // the sender registry must NOT be built without it. telephony/asr/ai are per
  // family: null ⇒ that feature's routes/workers are simply not wired.
  const built = buildRegistries(config, env);
  const cipher = new TokenCipher(config.sessionSecret);

  // buildLoggerOptions (not `logger: true`): it carries the req/res/err
  // serializers AND the redact paths, so secrets never reach stdout. The
  // observability plugin owns request logging, so pino's own is disabled via
  // the logController seam (not the deprecated top-level flag).
  const app = Fastify({
    logger: buildLoggerOptions({ level: env['LOG_LEVEL'] ?? 'info' }),
    logController: buildLogController(),
    // Propagates an inbound x-request-id when it is safe, else mints one.
    genReqId: genRequestId,
  });
  registerSecurityHeaders(app);
  registerHttpObservability(app);

  // DSN-gated: a real sink when SENTRY_DSN is set, console otherwise. The C8
  // response mapping is untouched — this only observes.
  const errorSink = createErrorSinkFromConfig({
    ...(env['SENTRY_DSN'] !== undefined ? { dsn: env['SENTRY_DSN'] } : {}),
    ...(env['APP_VERSION'] !== undefined ? { release: env['APP_VERSION'] } : {}),
  });
  app.addHook('onError', async (request, _reply, error) => {
    errorSink.captureException(error, { requestId: String(request.id), route: request.url });
  });

  // ── Real healthz: Postgres + queue depth (replaces server.ts's stub) ──────
  registerHealthz(app, {
    db,
    queueDepth: {
      depth: async () => {
        const counts = await probeQueue.getJobCounts('waiting', 'delayed', 'active');
        return (counts['waiting'] ?? 0) + (counts['delayed'] ?? 0) + (counts['active'] ?? 0);
      },
    },
  });

  // ── Auth (F4): one global gate over /api/v1/*, with the documented exemptions
  const readSession = buildSessionReader(config);
  const sessionGuard = requireSession({ db, readSession });
  const adminGuard: preHandlerHookHandler = requireAdmin({ db, readSession });

  // Internal API: other internal systems authenticate with a Bearer TOKEN
  // instead of a session cookie. The token pre-handler does hash lookup + scope
  // + Postgres fixed-window rate limit (no Redis), and decorates request.apiToken.
  // Scope is derived from the route so a read token cannot mutate (I-RAIL-API):
  // reports → read:reports, other GET → read:leads, anything mutating →
  // write:leads. A write scope is permission to ASK the engine, never to bypass
  // a compliance rail (those re-check inside the send/dial transaction).
  const tokenService = new TokenService(db);
  const rateLimiter = new PostgresRateLimiter(db);
  const bearerDeps = { db, tokens: tokenService, rateLimiter };
  const bearerRead = createBearerAuthPreHandler(bearerDeps, { scope: 'read:leads' });
  const bearerWrite = createBearerAuthPreHandler(bearerDeps, { scope: 'write:leads' });
  const bearerReports = createBearerAuthPreHandler(bearerDeps, { scope: 'read:reports' });

  const EXEMPT = (url: string): boolean =>
    url.startsWith('/wh/') ||
    url.startsWith('/healthz') ||
    url.startsWith('/api/v1/unsubscribe') ||
    // The login/callback routes issue the session — they cannot require one.
    url.startsWith('/api/v1/auth/login') ||
    url.startsWith('/api/v1/auth/callback') ||
    (config.mockMode && url.startsWith('/api/v1/auth/dev-'));

  const hasBearer = (request: { headers: Record<string, unknown> }): boolean => {
    const h = request.headers['authorization'];
    return typeof h === 'string' && h.startsWith('Bearer ');
  };

  app.addHook('preHandler', async (request, reply) => {
    if (!request.url.startsWith('/api/v1/')) return;
    if (EXEMPT(request.url)) return;
    if (hasBearer(request)) {
      // The admin/* surface stays session-only (requireAdmin needs a session
      // user); a token cannot reach it — a deliberately safe limitation.
      const guard = request.url.startsWith('/api/v1/reports')
        ? bearerReports
        : request.method === 'GET' || request.method === 'HEAD'
          ? bearerRead
          : bearerWrite;
      await guard.call(app, request, reply, () => undefined);
      return;
    }
    await sessionGuard.call(app, request, reply, () => undefined);
  });

  if (config.mockMode) {
    registerDevAuthRoutes(app, { db, sessionSecret: config.sessionSecret });
  } else {
    // Real SSO: the login → IdP → callback flow that MINTS the session cookie
    // the reader above reads. assertRealModeConfig already proved these env
    // vars are present, so the non-null assertions are safe.
    const oidcClient = new OidcClient({
      issuer: env['OIDC_ISSUER']!,
      clientId: env['OIDC_CLIENT_ID']!,
      clientSecret: env['OIDC_CLIENT_SECRET']!,
    });
    const webOrigin = env['WEB_ORIGIN'] ?? config.publicWebhookUrl ?? '';
    registerOidcAuthRoutes(app, {
      db,
      client: oidcClient,
      session: new SessionCodec({ secret: config.sessionSecret }),
      txn: new OidcTxnCodec({ secret: config.sessionSecret }),
      redirectUri: `${webOrigin}/api/v1/auth/callback`,
      postLoginRedirect: `${webOrigin}/inbox`,
      loginErrorRedirect: `${webOrigin}/login`,
    });
  }

  // One shared activity→webhook emitter for every producer (routes + the
  // sequence dispatch worker below), so a subscriber sees activity.recorded for
  // rep CRUD AND for sequence-driven outbound. (createWebhookDeliveryProcessor
  // below delivers what it stages.)
  const activityEmitter = createActivityWebhookEmitter(queue);

  // The FULL /api/v1 + /wh route surface, in the one function the route-mount
  // manifest suite (main.test.ts) pins — so a routes/*.ts module that dev/boot.ts
  // mounts but this root forgets is a failing test, not a deployed 404.
  registerProductionRoutes(app, {
    config,
    built,
    db,
    queue,
    cipher,
    adminGuard,
    activityEmitter,
    orgTimezone: await loadOrgTimezone(db),
    importStorageDir: env['IMPORT_STORAGE_DIR'] ?? '/var/lib/switchboard/imports',
  });

  // ── Sequence worker: CONSUME the queue, then keep it fed ──────────────────
  // `processIntent` re-checks every rail (reply/bounce/suppression/window/cap)
  // INSIDE the send transaction (§4.3 never-events) — this binding is what
  // turns enqueued intents into actual sends. Without it the sweeper would
  // enqueue into Redis forever and no sequence step would ever go out.
  const unsubscribeConfig = {
    baseUrl: config.publicWebhookUrl ?? `http://localhost:${config.port}`,
    mailbox: env['UNSUBSCRIBE_MAILBOX'] ?? 'unsubscribe@switchboard.internal',
    // Same validated key as the /unsub route above (mint + verify must agree);
    // see loadConfig for the production fail-closed rule.
    secret: config.listUnsubscribeSecret,
  };
  const dispatchDeps = {
    db,
    providerFor: built.senderRegistry.providerFor,
    cipher,
    queue,
    // Distinguishes this replica in send_intents.worker_id (§4.3 claim audit).
    workerId: `${env['HOSTNAME'] ?? 'api'}:${process.pid}`,
    now: () => new Date(),
    unsubscribe: unsubscribeConfig,
    emitter: activityEmitter,
    sms: {
      // No telephony provider (TWILIO_* unset) → no fromNumber either, so
      // dispatch SKIPs sms steps with `no_sms_from_number` before ever touching
      // this. It exists for the misconfigured case (a number set, credentials
      // missing): refuse loudly → the intent lands FAILED/provider_error with
      // this message, rather than a step silently disappearing.
      provider: built.telephony ?? {
        sendSms: (): Promise<never> => {
          throw new Error('telephony provider not configured (TWILIO_* unset): cannot send SMS');
        },
      },
      ...(config.twilioPhoneNumber !== null ? { fromNumber: config.twilioPhoneNumber } : {}),
    },
  };
  // Telephony ingress: an inbound Twilio webhook persists a webhook_inbox row,
  // then enqueues twilio:process; this worker turns that row into timeline
  // events (call logged, sms received, STOP opt-out). deps.provider only needs
  // sendSms (the quiet-hours opt-out confirmation). Present only when a
  // telephony provider exists (mock always; real iff TWILIO_* fully set).
  const telephonyProcessDeps =
    built.telephony !== null ? { db, provider: built.telephony, emitter: activityEmitter } : null;

  // Outbound webhook delivery (guide §5c): emitWebhookEvent (fired by domain
  // events) writes durable webhook_deliveries rows + enqueues webhook:deliver;
  // this processor POSTs each with its stored HMAC-signed envelope and owns
  // retries/backoff/dead-letter. The sender is the one network seam — the target
  // URL was validated (https + public host, SSRF guard) at subscription create;
  // delivery-time resolve-and-pin against DNS rebinding is the documented
  // remaining hardening (WIRING.md).
  const webhookSender: WebhookSender = async ({ url, headers, body }) => {
    const res = await fetch(url, { method: 'POST', headers, body });
    return { status: res.status };
  };
  const webhookDeliveryProcessor = createWebhookDeliveryProcessor({
    db,
    sender: webhookSender,
    queue,
  });

  queue.process(async (job) => {
    if (job.name === SEND_JOB_NAME) {
      const intentId = (job.data as { intentId?: string }).intentId;
      if (intentId !== undefined) await processIntent(dispatchDeps, intentId);
      return;
    }
    if (job.name === TWILIO_PROCESS_JOB && telephonyProcessDeps !== null) {
      await handleTelephonyJob(telephonyProcessDeps, job);
      return;
    }
    await webhookDeliveryProcessor(job);
  });

  // The sweeper is the safety net — BullMQ delays are an optimisation, Postgres
  // (send_intents.due_at / webhook_inbox) is the source of truth (§4.3), so a
  // lost Redis job is simply re-processed on the next sweep.
  const sweeper = setInterval(() => {
    void sweepDueIntents({ db, queue, now: () => new Date(), claimTimeoutMs: CLAIM_TIMEOUT_MS })
      .then((count) => {
        if (count > 0) app.log.info({ count }, 'swept due send-intents');
      })
      .catch((error: unknown) => {
        errorSink.captureException(error, { where: 'sequence-sweeper' });
      });
    if (telephonyProcessDeps !== null) {
      void processPendingTwilioWebhooks(telephonyProcessDeps).catch((error: unknown) => {
        errorSink.captureException(error, { where: 'telephony-sweeper' });
      });
    }
    // Outbound-webhook relay: re-enqueue any committed-but-pending delivery
    // (the outbox safety net — makes activity.recorded emission race-free even
    // if a low-latency flush lost the commit race or Redis blipped).
    void sweepPendingWebhookDeliveries(db, queue)
      .then((count) => {
        if (count > 0) app.log.info({ count }, 'swept pending webhook-deliveries');
      })
      .catch((error: unknown) => {
        errorSink.captureException(error, { where: 'webhook-delivery-sweeper' });
      });
  }, SWEEP_INTERVAL_MS);
  sweeper.unref?.();

  await app.ready();

  const shutdown = createGracefulShutdown({
    app,
    resources: [
      { name: 'sweeper', close: () => clearInterval(sweeper) },
      { name: 'queue', close: () => queue.close() },
      { name: 'queue-probe', close: () => probeQueue.close() },
      { name: 'postgres', close: () => pool.end() },
    ],
  });
  shutdown.install();

  return {
    app,
    db,
    queue,
    close: async () => {
      await app.close();
      await queue.close();
      await probeQueue.close();
      await pool.end();
    },
  };
}

/** Entry: boot the role this process was given. */
export async function main(env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = loadConfig(env);
  const role = readRole(env);
  const built = await buildProductionApp({ config, env });

  if (role === 'server') {
    const address = await built.app.listen({ port: config.port, host: '0.0.0.0' });
    built.app.log.info({ address, role, mockMode: config.mockMode }, 'switchboard api listening');
  } else {
    built.app.log.info({ role }, 'switchboard worker started');
  }
}

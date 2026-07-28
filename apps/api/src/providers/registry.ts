import type {
  EmailProvider,
  TelephonyProvider,
  ASRProvider,
  AIProvider,
} from '@switchboard/shared/providers';
import { MockEmailProvider } from './mock/mock-email-provider.ts';
import { GmailEmailProvider } from './email/gmail-email-provider.ts';
import { createMockTelephonyProvider } from './telephony/index.ts';
import {
  FetchTwilioTransport,
  createTwilioTelephonyProvider,
} from './telephony/twilio-telephony-provider.ts';
import {
  FetchDeepgramTransport,
  createDeepgramASRProvider,
  createMockASRProvider,
} from './asr/index.ts';
import {
  FetchAnthropicTransport,
  createHaikuAIProvider,
  createMockAIProvider,
} from './ai/index.ts';
import type { Clock, IdSource } from './mock/clock.ts';

/**
 * Provider composition root (ARCHITECTURE §1, CONTRACTS §C2).
 *
 * This is *the adapter line*: the one place that chooses mock vs real adapters
 * from `mockMode`. No code above this may branch on MOCK_MODE — callers depend
 * only on the `EmailProvider` interface, so every code path above is identical
 * whether the process is mocked or live.
 *
 * The real branch of `createProviderRegistry` binds the Gmail REST adapter
 * (task 2b). It needs OAuth client credentials plus a default mailbox identity,
 * supplied by the caller from parsed config (never `process.env` here — see
 * `config.ts`). Absent that config the branch fails fast with a configuration
 * error rather than degrading silently.
 *
 * The real telephony/ASR/AI adapters are NOT part of that Gmail-gated registry:
 * they are bound per family by `createRealTelephonyProvider` /
 * `createRealASRProvider` / `createRealAIProvider` below, so each vendor
 * credential gates exactly its own feature (D-061 posture: a missing credential
 * pauses the feature, never the boot).
 */

/**
 * Gmail OAuth binding for the real (non-mock) email provider. OAuth linking,
 * backfill, and history sync are mailbox-agnostic — each call is keyed by its
 * per-account OAuth tokens — so a single shared instance serves every mailbox.
 * Only `send()` needs a sender identity: `address` is the default From / the
 * Message-ID domain. Per-account send-from is task 2d's concern.
 */
export interface GmailBindingConfig {
  clientId: string;
  clientSecret: string;
  address: string;
  scopes?: string[];
}

export interface ProviderRegistry {
  email: EmailProvider;
  /** All bound under mockMode. In real mode the composition root binds the real
   *  Twilio/Deepgram/Haiku adapters PER FAMILY via `createRealTelephonyProvider`
   *  / `createRealASRProvider` / `createRealAIProvider` below — independent of
   *  this (Gmail-gated) registry, so a Gmail-less deploy can still dial. */
  telephony?: TelephonyProvider;
  asr?: ASRProvider;
  ai?: AIProvider;
}

export interface RegistryConfig {
  mockMode: boolean;
  /** Required for the real (non-mock) branch; ignored under `mockMode`. */
  gmail?: GmailBindingConfig;
}

export interface MockRegistryOverrides {
  address?: string;
  clock?: Clock;
  ids?: IdSource;
}

export function createProviderRegistry(
  config: RegistryConfig,
  mockOverrides: MockRegistryOverrides = {},
): ProviderRegistry {
  if (config.mockMode) {
    return {
      email: new MockEmailProvider(mockOverrides),
      telephony: createMockTelephonyProvider({
        ...(mockOverrides.clock !== undefined ? { clock: mockOverrides.clock } : {}),
        ...(mockOverrides.ids !== undefined ? { ids: mockOverrides.ids } : {}),
      }),
      asr: createMockASRProvider(),
      ai: createMockAIProvider(),
    };
  }
  if (config.gmail === undefined) {
    throw new Error(
      'real email provider requires gmail OAuth config (clientId/clientSecret/address); ' +
        'set MOCK_MODE=1 to use the in-memory provider',
    );
  }
  return {
    email: new GmailEmailProvider({
      clientId: config.gmail.clientId,
      clientSecret: config.gmail.clientSecret,
      address: config.gmail.address,
      ...(config.gmail.scopes !== undefined ? { scopes: config.gmail.scopes } : {}),
    }),
  };
}

// ---------------------------------------------------------------------------
// Real comms adapters (telephony / ASR / AI) — the non-email adapter line
// ---------------------------------------------------------------------------

/**
 * These factories are the ONLY place the real Twilio/Deepgram/Haiku adapters are
 * constructed. Each binds its production fetch transport explicitly (the
 * adapters take `transport` as REQUIRED config — there is no default, so a
 * caller that forgets it is a type error, not a runtime surprise).
 *
 * Every field a factory takes is required-and-complete on purpose: the D-061
 * lesson is that a half-configured adapter that constructs fine and then throws
 * per-request is the worst failure mode. The composition root (`main.ts
 * buildRegistries`) calls these only when the FULL credential set for the
 * family is present; a wholly absent family stays `null` (feature paused, boot
 * fine) and a partial one refuses the boot (assertRealModeConfig).
 *
 * NONE of these adapters has ever been exercised against a live vendor account
 * — only transport-injected unit tests (HUMAN_TODO: Twilio/Deepgram/Anthropic
 * accounts).
 */

export interface TwilioBindingConfig {
  accountSid: string;
  /** Auth token — HMAC key for webhook verification + REST Basic-auth fallback. */
  authToken: string;
  /**
   * Public origin (scheme + host, no trailing slash) Twilio calls back to.
   * `/wh/twilio/{voice,status}` URLs are derived from it; Twilio signs the FULL
   * public URL, so this must be the external origin, never the proxy host.
   */
  publicBaseUrl: string;
  /** Optional REST API-key pair — set BOTH or NEITHER (Basic-auth username+password). */
  apiKeySid?: string;
  apiKeySecret?: string;
}

export function createRealTelephonyProvider(binding: TwilioBindingConfig): TelephonyProvider {
  const base = binding.publicBaseUrl.replace(/\/+$/, '');
  return createTwilioTelephonyProvider({
    accountSid: binding.accountSid,
    authToken: binding.authToken,
    transport: new FetchTwilioTransport(),
    // Outbound dial TwiML + voice/recording/SMS status callbacks (CONTRACTS §C7
    // routes). One /status endpoint serves voice, recording and SMS callbacks.
    voiceUrl: `${base}/wh/twilio/voice`,
    statusCallbackUrl: `${base}/wh/twilio/status`,
    smsStatusCallbackUrl: `${base}/wh/twilio/status`,
    ...(binding.apiKeySid !== undefined ? { apiKeySid: binding.apiKeySid } : {}),
    ...(binding.apiKeySecret !== undefined ? { apiKeySecret: binding.apiKeySecret } : {}),
  });
}

export interface DeepgramBindingConfig {
  apiKey: string;
}

export function createRealASRProvider(binding: DeepgramBindingConfig): ASRProvider {
  return createDeepgramASRProvider({
    apiKey: binding.apiKey,
    transport: new FetchDeepgramTransport(),
  });
}

export interface AnthropicBindingConfig {
  apiKey: string;
}

export function createRealAIProvider(binding: AnthropicBindingConfig): AIProvider {
  return createHaikuAIProvider({
    apiKey: binding.apiKey,
    transport: new FetchAnthropicTransport(),
  });
}

// ---------------------------------------------------------------------------
// Per-account send-from (task 2d)
// ---------------------------------------------------------------------------

/**
 * Per-account send-from (task 2d, resolving the 2b note). OAuth linking, backfill,
 * and history sync are mailbox-agnostic — one shared provider keyed by per-account
 * tokens serves them all. SEND is different: the From header and Message-ID domain
 * MUST be the *sending rep's own* mailbox address, not one shared configured
 * identity. This factory returns an `EmailProvider` bound to a specific mailbox
 * address, one cached instance per address (so the mock's idempotency ledger — and
 * any real per-mailbox state — persists across that mailbox's sends).
 *
 * The mock/real choice stays on THIS adapter line: it branches on `mockMode`,
 * never above (ARCHITECTURE §1). The account's own tokens are supplied separately
 * by the caller (decrypted from `email_accounts.oauth_tokens`).
 */
export type EmailProviderName = 'gmail' | 'mock';

export interface AccountIdentity {
  address: string;
  provider: EmailProviderName;
}

export interface EmailSenderRegistry {
  providerFor(identity: AccountIdentity): EmailProvider;
}

export function createEmailSenderRegistry(
  config: RegistryConfig,
  mockOverrides: MockRegistryOverrides = {},
): EmailSenderRegistry {
  const cache = new Map<string, EmailProvider>();
  return {
    providerFor(identity: AccountIdentity): EmailProvider {
      const key = `${identity.provider}:${identity.address.toLowerCase()}`;
      const cached = cache.get(key);
      if (cached !== undefined) return cached;
      const created = config.mockMode
        ? new MockEmailProvider({ ...mockOverrides, address: identity.address })
        : buildGmailForAddress(config, identity.address);
      cache.set(key, created);
      return created;
    },
  };
}

function buildGmailForAddress(config: RegistryConfig, address: string): EmailProvider {
  if (config.gmail === undefined) {
    throw new Error(
      'real email provider requires gmail OAuth config (clientId/clientSecret); ' +
        'set MOCK_MODE=1 to use the in-memory provider',
    );
  }
  return new GmailEmailProvider({
    clientId: config.gmail.clientId,
    clientSecret: config.gmail.clientSecret,
    address,
    ...(config.gmail.scopes !== undefined ? { scopes: config.gmail.scopes } : {}),
  });
}

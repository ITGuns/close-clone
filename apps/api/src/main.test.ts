import { describe, expect, test } from 'vitest';

import { assertRealModeConfig, buildGmailPushVerifier, buildRegistries } from './main.ts';
import { loadConfig } from './config.ts';
import { GmailEmailProvider } from './providers/email/gmail-email-provider.ts';
import { MockEmailProvider } from './providers/mock/mock-email-provider.ts';

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
    const config = loadConfig({ ...REAL, GMAIL_PUSH_TOKEN: 'secret-push-token' } as NodeJS.ProcessEnv);
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
    expect(senderRegistry.providerFor({ provider: 'mock', address: 'rep@mock.test' })).toBeInstanceOf(
      MockEmailProvider,
    );
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

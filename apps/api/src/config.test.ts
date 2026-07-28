import { expect, test } from 'vitest';
import { loadConfig } from './config.ts';

test('loadConfig applies MOCK_MODE-first defaults with an empty env', () => {
  const config = loadConfig({});
  expect(config.mockMode).toBe(true);
  expect(config.port).toBe(3000);
  expect(config.nodeEnv).toBe('development');
});

test('loadConfig parses provided env values', () => {
  const config = loadConfig({ MOCK_MODE: '0', PORT: '8080', NODE_ENV: 'test' });
  expect(config.mockMode).toBe(false);
  expect(config.port).toBe(8080);
  expect(config.nodeEnv).toBe('test');
});

const STRONG_SECRET = 'a'.repeat(48); // >= 32 chars, not the dev default

test('loadConfig fails closed in production when SESSION_SECRET is absent (dev default)', () => {
  expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/strong unique value in production/);
});

test('loadConfig fails closed in production when SESSION_SECRET is the dev default', () => {
  expect(() =>
    loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'dev-insecure-session-secret' }),
  ).toThrow(/insecure/);
});

test('loadConfig fails closed in production when SESSION_SECRET is the public .env.example placeholder', () => {
  // The placeholder is >=32 chars so it clears the length floor — it must still be
  // rejected because it ships in git/docs (KNOWN_INSECURE_SECRETS).
  expect(() =>
    loadConfig({
      NODE_ENV: 'production',
      MOCK_MODE: '0',
      SESSION_SECRET: 'change-me-to-a-64-char-random-hex-string',
    }),
  ).toThrow(/placeholder are insecure/);
});

test('loadConfig fails closed on the deploy template SESSION_SECRET', () => {
  expect(() =>
    loadConfig({
      NODE_ENV: 'production',
      SESSION_SECRET: 'change-me-32-chars-minimum-000000',
    }),
  ).toThrow(/placeholder are insecure/);
});

test('loadConfig fails closed in production when SESSION_SECRET is shorter than 32 chars', () => {
  expect(() =>
    loadConfig({ NODE_ENV: 'production', SESSION_SECRET: 'short-but-unique-secret' }),
  ).toThrow(/>=32 chars/);
});

test('loadConfig succeeds in production with a strong unique SESSION_SECRET', () => {
  // LIST_UNSUBSCRIBE_SECRET is also production-required (validated separately below).
  const config = loadConfig({
    NODE_ENV: 'production',
    SESSION_SECRET: STRONG_SECRET,
    LIST_UNSUBSCRIBE_SECRET: 'c'.repeat(48),
  });
  expect(config.nodeEnv).toBe('production');
  expect(config.mockMode).toBe(true);
  expect(config.sessionSecret).toBe(STRONG_SECRET);
});

test('non-production keeps the dev default working (tests + dev stay green)', () => {
  expect(loadConfig({ NODE_ENV: 'test' }).sessionSecret).toBe('dev-insecure-session-secret');
  expect(loadConfig({}).sessionSecret).toBe('dev-insecure-session-secret');
});

// ── LIST_UNSUBSCRIBE_SECRET: same fail-closed treatment as SESSION_SECRET ────
// A forgeable unsubscribe key lets anyone mass-suppress leads (I-SEND-5 bypass),
// so production rejects absent/empty/placeholder/short values. All production
// cases below supply a strong SESSION_SECRET so we exercise THIS check.

const PROD_BASE = { NODE_ENV: 'production', SESSION_SECRET: STRONG_SECRET } as const;

test('loadConfig fails closed in production when LIST_UNSUBSCRIBE_SECRET is absent', () => {
  expect(() => loadConfig({ ...PROD_BASE })).toThrow(/LIST_UNSUBSCRIBE_SECRET/);
});

test('loadConfig fails closed in production when LIST_UNSUBSCRIBE_SECRET is empty (deploy env ships a blank line)', () => {
  // `??` fallbacks do NOT catch '' — this is the exact hole being locked: an
  // empty env line must behave like unset and be rejected in production.
  expect(() => loadConfig({ ...PROD_BASE, LIST_UNSUBSCRIBE_SECRET: '' })).toThrow(
    /LIST_UNSUBSCRIBE_SECRET/,
  );
});

test('loadConfig fails closed in production on committed LIST_UNSUBSCRIBE_SECRET placeholders', () => {
  for (const placeholder of [
    'change-me-random-hex', // historical .env.example value
    'change-me-to-a-different-64-char-random-hex', // current .env.example value
    'change-me-32-chars-minimum-111111', // deploy/.env.example value
    'dev-insecure-unsubscribe-secret', // dev default, explicit
  ]) {
    expect(() => loadConfig({ ...PROD_BASE, LIST_UNSUBSCRIBE_SECRET: placeholder })).toThrow(
      /LIST_UNSUBSCRIBE_SECRET/,
    );
  }
});

test('loadConfig fails closed in production when LIST_UNSUBSCRIBE_SECRET is shorter than 32 chars', () => {
  expect(() =>
    loadConfig({ ...PROD_BASE, LIST_UNSUBSCRIBE_SECRET: 'short-but-unique-value' }),
  ).toThrow(/LIST_UNSUBSCRIBE_SECRET/);
});

test('loadConfig succeeds in production with strong distinct secrets', () => {
  const unsub = 'b'.repeat(48);
  const config = loadConfig({ ...PROD_BASE, LIST_UNSUBSCRIBE_SECRET: unsub });
  expect(config.listUnsubscribeSecret).toBe(unsub);
  expect(config.sessionSecret).toBe(STRONG_SECRET);
  // No silent key reuse: the unsubscribe key never mirrors the session key.
  expect(config.listUnsubscribeSecret).not.toBe(config.sessionSecret);
});

// ── GMAIL_PUSH_TOKEN: authenticates /wh/gmail (optional; presence in real mode
// with Gmail configured is enforced by main.ts assertRealModeConfig) ─────────

test('GMAIL_PUSH_TOKEN defaults to null; a blank env line is unset', () => {
  expect(loadConfig({}).gmailPushToken).toBeNull();
  expect(loadConfig({ GMAIL_PUSH_TOKEN: '' }).gmailPushToken).toBeNull();
});

test('GMAIL_PUSH_TOKEN passes through when set', () => {
  expect(loadConfig({ GMAIL_PUSH_TOKEN: 'push-tok' }).gmailPushToken).toBe('push-tok');
});

test('production rejects a short GMAIL_PUSH_TOKEN', () => {
  expect(() =>
    loadConfig({
      ...PROD_BASE,
      LIST_UNSUBSCRIBE_SECRET: 'b'.repeat(48),
      GMAIL_PUSH_TOKEN: 'short-token',
    }),
  ).toThrow(/GMAIL_PUSH_TOKEN/);
});

test('production rejects the committed GMAIL_PUSH_TOKEN placeholder (>=32 chars but public)', () => {
  expect(() =>
    loadConfig({
      ...PROD_BASE,
      LIST_UNSUBSCRIBE_SECRET: 'b'.repeat(48),
      GMAIL_PUSH_TOKEN: 'change-me-to-a-random-gmail-push-token',
    }),
  ).toThrow(/GMAIL_PUSH_TOKEN/);
});

test('production accepts a strong GMAIL_PUSH_TOKEN; absent stays allowed (Gmail-less deploys)', () => {
  const base = { ...PROD_BASE, LIST_UNSUBSCRIBE_SECRET: 'b'.repeat(48) };
  expect(loadConfig({ ...base, GMAIL_PUSH_TOKEN: 'd'.repeat(48) }).gmailPushToken).toBe(
    'd'.repeat(48),
  );
  expect(loadConfig({ ...base }).gmailPushToken).toBeNull();
});

test('non-production keeps a weak GMAIL_PUSH_TOKEN working (dev/test)', () => {
  expect(loadConfig({ NODE_ENV: 'test', GMAIL_PUSH_TOKEN: 'tok' }).gmailPushToken).toBe('tok');
});

test('mock mode / non-production boots without LIST_UNSUBSCRIBE_SECRET (dev default, distinct from session dev default)', () => {
  const dev = loadConfig({});
  expect(dev.listUnsubscribeSecret).toBe('dev-insecure-unsubscribe-secret');
  expect(dev.listUnsubscribeSecret).not.toBe(dev.sessionSecret);
  expect(loadConfig({ NODE_ENV: 'test' }).listUnsubscribeSecret).toBe(
    'dev-insecure-unsubscribe-secret',
  );
  // Empty string in dev also falls to the default rather than becoming ''.
  expect(loadConfig({ LIST_UNSUBSCRIBE_SECRET: '' }).listUnsubscribeSecret).toBe(
    'dev-insecure-unsubscribe-secret',
  );
});

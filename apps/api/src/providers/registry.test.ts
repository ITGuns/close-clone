import { describe, expect, test } from 'vitest';
import { createProviderRegistry, createEmailSenderRegistry } from './registry.ts';
import { MockEmailProvider } from './mock/mock-email-provider.ts';
import { GmailEmailProvider } from './email/gmail-email-provider.ts';
import { ManualClock } from './mock/clock.ts';

describe('provider registry (composition root, CONTRACTS §C2)', () => {
  test('MOCK_MODE binds the in-memory MockEmailProvider', () => {
    const registry = createProviderRegistry({ mockMode: true });
    expect(registry.email).toBeInstanceOf(MockEmailProvider);
  });

  test('mock overrides (clock/address) reach the provider', () => {
    const registry = createProviderRegistry(
      { mockMode: true },
      { address: 'ceo@mock.test', clock: new ManualClock() },
    );
    expect(registry.email).toBeInstanceOf(MockEmailProvider);
    expect((registry.email as MockEmailProvider).address).toBe('ceo@mock.test');
  });

  test('non-mock mode without gmail config fails fast with a config error', () => {
    expect(() => createProviderRegistry({ mockMode: false })).toThrow(/gmail/i);
  });

  test('non-mock mode binds the real GmailEmailProvider when configured', () => {
    const registry = createProviderRegistry({
      mockMode: false,
      gmail: { clientId: 'cid', clientSecret: 'secret', address: 'rep@company.test' },
    });
    expect(registry.email).toBeInstanceOf(GmailEmailProvider);
  });
});

describe('email sender registry (per-account send-from, task 2d)', () => {
  const GMAIL = { clientId: 'cid', clientSecret: 'secret', address: 'default@company.test' };

  test('mock mode binds a MockEmailProvider per address and caches case-insensitively', () => {
    const reg = createEmailSenderRegistry({ mockMode: true });
    const a = reg.providerFor({ provider: 'mock', address: 'rep@mock.test' });
    expect(a).toBeInstanceOf(MockEmailProvider);
    expect((a as MockEmailProvider).address).toBe('rep@mock.test');
    expect(reg.providerFor({ provider: 'mock', address: 'REP@mock.test' })).toBe(a);
  });

  // Regression for the main.ts wiring bug: the sender registry was built without
  // the gmail binding, so EVERY real-mode send threw. The real branch must work
  // when the OAuth config is supplied…
  test('real mode WITH gmail config builds a GmailEmailProvider bound to the account address', () => {
    const reg = createEmailSenderRegistry({ mockMode: false, gmail: GMAIL });
    const p = reg.providerFor({ provider: 'gmail', address: 'rep@company.test' });
    expect(p).toBeInstanceOf(GmailEmailProvider);
    // Same address → cached instance; different address → distinct provider.
    expect(reg.providerFor({ provider: 'gmail', address: 'rep@company.test' })).toBe(p);
    expect(reg.providerFor({ provider: 'gmail', address: 'other@company.test' })).not.toBe(p);
  });

  // …and fail per-send with a config error when it is not (the lazy contract).
  test('real mode WITHOUT gmail config throws a config error per send, not at construction', () => {
    const reg = createEmailSenderRegistry({ mockMode: false });
    expect(() => reg.providerFor({ provider: 'gmail', address: 'rep@company.test' })).toThrow(
      /gmail oauth config/i,
    );
  });
});

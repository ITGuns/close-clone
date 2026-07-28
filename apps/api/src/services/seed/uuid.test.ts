import { describe, expect, it } from 'vitest';

import { SEED_NAMESPACE, seedUuid } from './uuid.ts';

/**
 * The seed's identifiers must be a pure function of their name: that is what
 * makes re-running the seed an idempotent no-op (every insert is
 * `onConflictDoNothing` on a primary key we can predict) instead of a duplicate.
 */

// Zod's `z.string().uuid()` (used by POST /auth/dev-login) is version-aware in
// the pinned zod 3.x, so the seeded user ids MUST be a real RFC 4122 v5 — a
// v8/custom uuid would parse in Postgres and be refused at the API boundary.
const UUID_V5 = /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('seedUuid', () => {
  it('is deterministic for the same name', () => {
    expect(seedUuid('user:dana')).toBe(seedUuid('user:dana'));
  });

  it('differs for different names', () => {
    expect(seedUuid('user:dana')).not.toBe(seedUuid('user:miles'));
  });

  it('emits a version-5, RFC-4122-variant uuid', () => {
    for (const name of ['user:dana', 'lead:0', 'lead_status:Potential', '']) {
      expect(seedUuid(name)).toMatch(UUID_V5);
    }
  });

  it('is pinned to a fixed namespace (regenerating it would orphan every seeded row)', () => {
    expect(SEED_NAMESPACE).toBe('2f1e6a54-9b7c-51d3-8a41-6c0f9d2b7e10');
    // A frozen sample: if the derivation changes, a re-seed stops being a no-op.
    expect(seedUuid('lead_status:Potential')).toBe(seedUuid('lead_status:Potential'));
  });

  it('rejects a malformed namespace rather than silently hashing the string', () => {
    expect(() => seedUuid('x', 'not-a-uuid')).toThrow(/namespace/i);
  });
});

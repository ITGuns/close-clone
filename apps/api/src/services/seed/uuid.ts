import { createHash } from 'node:crypto';

/**
 * Deterministic identifiers for seeded rows (RFC 4122 v5, name-based).
 *
 * CLAUDE.md forbids `Math.random`/`Date.now` in seed and fixture logic. That is
 * not only about reproducible content: because every seeded primary key is a
 * pure function of its name, every insert can be `onConflictDoNothing` on a key
 * we can predict, which is what makes re-running the seed a genuine no-op rather
 * than a duplicate dataset.
 *
 * Version 5 (SHA-1) is deliberate, not incidental. The pinned zod 3.x
 * `z.string().uuid()` — which `POST /api/v1/auth/dev-login` applies to `userId` —
 * is version-aware, so a v8/"custom" uuid would be a perfectly valid Postgres
 * value that the API refuses at the boundary. SHA-1 here is an identifier
 * derivation, not a security primitive.
 *
 * No enums / namespaces / parameter properties (host type-stripping constraint).
 */

/**
 * The one namespace every Switchboard seed id derives from. Changing it orphans
 * every previously seeded row (a re-seed would insert a second copy under new
 * ids instead of colliding), so it is frozen and asserted in the tests.
 */
export const SEED_NAMESPACE = '2f1e6a54-9b7c-51d3-8a41-6c0f9d2b7e10';

const UUID_SHAPE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function namespaceBytes(namespace: string): Uint8Array {
  if (!UUID_SHAPE.test(namespace)) {
    throw new Error(`seedUuid: namespace must be a uuid, got "${namespace}"`);
  }
  const hex = namespace.replace(/-/g, '');
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

function byte(bytes: Uint8Array, index: number): number {
  const value = bytes[index];
  // `noUncheckedIndexedAccess` — the digest is always >= 16 bytes, but the type
  // system does not know that and a silent 0 would be worse than a throw.
  if (value === undefined) throw new Error(`seedUuid: digest too short at byte ${index}`);
  return value;
}

/**
 * Derive a stable uuid v5 from `name` (and optionally a non-default namespace).
 * Pure: no clock, no randomness, no I/O.
 */
export function seedUuid(name: string, namespace: string = SEED_NAMESPACE): string {
  const ns = namespaceBytes(namespace);
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(ns.length + nameBytes.length);
  input.set(ns, 0);
  input.set(nameBytes, ns.length);

  const digest = createHash('sha1').update(input).digest();
  const out = new Uint8Array(16);
  for (let i = 0; i < 16; i += 1) out[i] = byte(digest, i);
  // Version 5 in the high nibble of byte 6; RFC 4122 variant in byte 8.
  out[6] = (byte(out, 6) & 0x0f) | 0x50;
  out[8] = (byte(out, 8) & 0x3f) | 0x80;

  const hex: string[] = [];
  for (let i = 0; i < 16; i += 1) hex.push(byte(out, i).toString(16).padStart(2, '0'));
  const s = hex.join('');
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
}

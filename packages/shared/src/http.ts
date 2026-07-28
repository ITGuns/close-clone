/**
 * Cross-module HTTP facts (CONTRACTS §C7). Small on purpose: only things BOTH the
 * API and the web client must agree on byte-for-byte belong here.
 *
 * `CSRF_HEADER` earned its place the hard way. The API rejects every mutating
 * request that lacks it (`apps/api/src/auth/csrf.ts`) while the web client has to
 * send it on all of them — and because `hasCsrfHeader` checks only PRESENCE, never
 * the value, a disagreement about the NAME does not fail loudly. It fails as
 * "every write returns 403 once deployed", which is exactly what shipped: the
 * client never sent the header at all, and ~4,000 green tests did not notice
 * because each layer mocked the one beneath it.
 *
 * Two copies of this string is one rename away from repeating that. One copy,
 * imported by both sides, cannot drift.
 */

/**
 * Custom header proving a mutating request came from our own first-party JS.
 * A cross-origin page cannot set a custom header without a CORS preflight, and
 * the API grants CORS to its own origin only — so presence alone is the signal.
 * The VALUE is never inspected; do not treat it as a secret or a token.
 */
export const CSRF_HEADER = 'x-switchboard-csrf';

/** Methods the CSRF gate does not apply to (RFC 9110 safe methods). */
const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

/** True for methods that require the CSRF header. Case-insensitive. */
export function isMutatingMethod(method: string): boolean {
  return !SAFE_METHODS.has(method.toUpperCase());
}

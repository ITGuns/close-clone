import type { IncomingHttpHeaders } from 'node:http';

/**
 * CSRF defense for the internal SPA (Task 5a). Two layers, no per-request CSRF
 * token needed:
 *
 *  1. The session cookie is `SameSite=Lax`, so a cross-site page cannot cause the
 *     browser to attach it to a state-changing (non-GET) request at all.
 *  2. Mutating requests must additionally carry a custom header. A browser will
 *     not let a cross-origin page set a custom request header without a CORS
 *     preflight, and the API grants CORS to its own origin only — so the header's
 *     presence proves the request came from our own first-party JS (fetch/XHR),
 *     not from a forged cross-site form or navigation.
 *
 * A classic double-submit *token* is not usable here because the session cookie is
 * httpOnly (our own JS cannot read a value to mirror). Requiring the custom header
 * on mutating methods is the correct fit and is what an internal same-origin SPA
 * needs. GET/HEAD/OPTIONS are safe methods and are never gated.
 */

/*
 * The header name and the safe-method set live in @switchboard/shared because the
 * web client must send exactly this header — and since `hasCsrfHeader` below checks
 * only presence, a disagreement about the name fails silently as "every write 403s
 * once deployed" rather than as a type error. Re-exported so this module stays the
 * one import site for CSRF concerns inside the api.
 */
import { CSRF_HEADER, isMutatingMethod } from '@switchboard/shared';

export { CSRF_HEADER, isMutatingMethod };

/**
 * True if the request carries a non-empty CSRF header. The value is not checked
 * against anything — its *presence* is the signal (only same-origin JS can set it).
 */
export function hasCsrfHeader(
  headers: IncomingHttpHeaders,
  headerName: string = CSRF_HEADER,
): boolean {
  const value = headers[headerName.toLowerCase()];
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.some((v) => v.length > 0);
  return false;
}

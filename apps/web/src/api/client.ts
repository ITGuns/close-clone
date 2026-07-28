/*
 * Thin typed fetch wrapper honoring CONTRACTS §C7:
 *   - base `/api/v1`, JSON, camelCase
 *   - `{error:{code,message,details?}}` → typed ApiError (C8 codes)
 *   - keyset pagination `?cursor=&limit=` → `{items, nextCursor?}`
 *
 * No response schema validation is done here — the server owns the contract and
 * shapes come straight from @switchboard/shared types. Errors ARE parsed.
 */
import { CSRF_HEADER, isMutatingMethod } from '@switchboard/shared';
import { ApiError, isApiErrorCode, statusToCode, type ApiErrorBody } from './errors.ts';

export const API_BASE = '/api/v1';

/**
 * Custom-header CSRF defence. The session guard answers 403 FORBIDDEN to any
 * mutating request that arrives without it, so every write from this SPA (log a
 * call, add a note, move a stage, commit an import) depends on it.
 *
 * The name and the safe-method set are imported from the contract package rather
 * than mirrored here: the server checks only that the header is PRESENT, never its
 * value, so a name that drifts between the two sides produces no type error and no
 * failing unit test — just "every write 403s once deployed". That is precisely the
 * bug this rail was added to fix, and one shared constant is what stops it
 * recurring.
 *
 * The value is NOT a secret. Its presence is the proof, because a cross-site form
 * or navigation cannot set a custom request header without a CORS preflight, and
 * the API grants CORS to its own origin only.
 */
export { CSRF_HEADER, isMutatingMethod };

/** Non-secret marker value; only its non-emptiness is load-bearing. */
export const CSRF_HEADER_VALUE = '1';

/**
 * The CSRF header for `method` (empty for safe methods). Exported because the
 * import upload builds its own `fetch` — it must not silently skip the rail.
 */
export function csrfHeaders(method: string): Record<string, string> {
  return isMutatingMethod(method) ? { [CSRF_HEADER]: CSRF_HEADER_VALUE } : {};
}

export type QueryValue = string | number | boolean | undefined | null;
export type QueryParams = Record<string, QueryValue>;

export interface RequestOptions {
  method?: string;
  /** JSON-serialized as the request body; sets Content-Type. */
  body?: unknown;
  query?: QueryParams;
  signal?: AbortSignal;
  headers?: Record<string, string>;
}

function buildUrl(path: string, query?: QueryParams): string {
  if (!query) return `${API_BASE}${path}`;
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null) {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `${API_BASE}${path}?${qs}` : `${API_BASE}${path}`;
}

async function toApiError(res: Response): Promise<ApiError> {
  let code = statusToCode(res.status);
  let message = res.statusText || `Request failed with status ${res.status}`;
  let details: unknown;
  try {
    const body: unknown = await res.json();
    const err = (body as Partial<ApiErrorBody> | null)?.error;
    if (err && typeof err === 'object') {
      if (isApiErrorCode(err.code)) code = err.code;
      if (typeof err.message === 'string' && err.message.length > 0) message = err.message;
      details = err.details;
    }
  } catch {
    /* error body was not JSON — keep the status-derived defaults */
  }
  return new ApiError(code, message, res.status, details);
}

export async function apiRequest<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? 'GET';
  // opts.headers is spread last so an explicit caller header always wins.
  const headers: Record<string, string> = {
    Accept: 'application/json',
    ...csrfHeaders(method),
    ...opts.headers,
  };
  const init: RequestInit = {
    method,
    headers,
    credentials: 'include',
  };
  if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  if (opts.signal) init.signal = opts.signal;

  const res = await fetch(buildUrl(path, opts.query), init);
  if (!res.ok) {
    throw await toApiError(res);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

// ── Keyset pagination (C7) ──────────────────────────────────────────────────

/** A single keyset page: items plus an opaque cursor for the next page. */
export interface Page<T> {
  items: T[];
  nextCursor?: string;
}

export interface PageParams {
  cursor?: string;
  limit?: number;
}

/** Turn keyset page params into query values (undefined keys are dropped). */
export function toPageQuery(params: PageParams): QueryParams {
  return { cursor: params.cursor, limit: params.limit };
}

/*
 * Server-session calls (real mode). The session cookie minted by the API's OIDC
 * callback is HttpOnly — the SPA cannot read it, so the ONLY way to know who is
 * signed in is to ask the server. These are the typed calls AuthProvider uses to
 * do that; they go through `apiRequest` so `credentials: 'include'` (the cookie)
 * and the CSRF header on the POST (CONTRACTS §C7) are never skipped.
 */
import type { User } from '@switchboard/shared';
import { apiRequest } from '../api/client.ts';

/**
 * Whether the bundle was built to talk to a real API (`VITE_API_MODE=real`).
 * Third and last place the web branches on API mode, after main.tsx (worker
 * boot) and LoginPage (which screen): here it decides who owns identity —
 * the server (real) or the local dev-login store (mock).
 */
export function isRealApiMode(): boolean {
  return import.meta.env.VITE_API_MODE === 'real';
}

/**
 * GET /api/v1/auth/me — resolve the session cookie to the signed-in user.
 * Rejects with ApiError UNAUTHENTICATED (401) when there is no live session;
 * that is the NORMAL logged-out case, not a failure to surface.
 */
export function fetchSessionUser(): Promise<User> {
  return apiRequest<User>('/auth/me');
}

/**
 * POST /api/v1/auth/logout — clear the server session cookie. Mutating, so the
 * shared client attaches the CSRF header; a bare fetch here would 403.
 */
export function endServerSession(): Promise<void> {
  return apiRequest<{ ok: boolean }>('/auth/logout', { method: 'POST' }).then(() => undefined);
}

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { JSX, ReactNode } from 'react';
import type { User } from '@switchboard/shared';
import { ApiError } from '../api/errors.ts';
import { readStoredUser, storeUser } from './auth.ts';
import { endServerSession, fetchSessionUser, isRealApiMode } from './session.ts';

/*
 * Identity has two sources, decided by build mode:
 *
 *  - MOCK (default): the dev-login fixture user, restored SYNCHRONOUSLY from
 *    localStorage so there is no auth flash on boot. Client-side only — MSW has
 *    no session endpoints and the Pages demo has no server at all.
 *  - REAL (VITE_API_MODE=real): the server is the only source of truth. The
 *    OIDC callback sets an HttpOnly cookie the SPA cannot read, so boot starts
 *    in `status: 'unknown'` and resolves via GET /auth/me. localStorage is
 *    IGNORED for identity here — a stale local blob must neither resurrect a
 *    dead session nor mask a live one.
 *
 * Guards must treat 'unknown' as "wait", never as "signed out": redirecting
 * while the /auth/me round-trip is in flight bounces a legitimately signed-in
 * user to /login — the exact real-mode bug this three-state model fixes.
 */
export type AuthStatus = 'unknown' | 'authenticated' | 'anonymous';

interface AuthContextValue {
  /** The signed-in user, or null when logged out or still resolving. */
  user: User | null;
  /** Three-state session: 'unknown' only ever occurs in real mode, during boot. */
  status: AuthStatus;
  /** Whether a user is currently signed in. False while 'unknown' — check `status` before redirecting. */
  isAuthenticated: boolean;
  /** Adopt a picked dev user (MOCK dev-login) and persist the session. */
  login: (user: User) => void;
  /** Clear the session — local state always, plus the server session in real mode. */
  logout: () => void;
}

interface AuthState {
  user: User | null;
  status: AuthStatus;
}

function initialAuthState(): AuthState {
  if (isRealApiMode()) return { user: null, status: 'unknown' };
  const user = readStoredUser();
  return { user, status: user === null ? 'anonymous' : 'authenticated' };
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [state, setState] = useState<AuthState>(initialAuthState);

  // Real mode: hydrate from the server exactly once per mount. A 401 is the
  // ordinary logged-out answer; anything else (API down, 5xx) also resolves to
  // 'anonymous' — fail-closed to the login screen rather than an eternal
  // spinner. The cookie survives such a failure, so a later boot recovers.
  useEffect(() => {
    if (!isRealApiMode()) return undefined;
    let cancelled = false;
    fetchSessionUser().then(
      (user) => {
        if (!cancelled) setState({ user, status: 'authenticated' });
      },
      (err: unknown) => {
        if (cancelled) return;
        setState({ user: null, status: 'anonymous' });
        if (!(err instanceof ApiError && err.code === 'UNAUTHENTICATED')) {
          console.error('[sb] session check failed — treating as signed out', err);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const login = useCallback((next: User) => {
    // Persistence is the mock dev-login store only; real-mode identity lives in
    // the server session, never localStorage.
    if (!isRealApiMode()) storeUser(next);
    setState({ user: next, status: 'authenticated' });
  }, []);

  const logout = useCallback(() => {
    storeUser(null);
    setState({ user: null, status: 'anonymous' });
    if (isRealApiMode()) {
      // End the SERVER session too — clearing local state alone leaves a live
      // cookie that the next boot would re-hydrate straight back. Fire-and-forget
      // (callers are sync); on failure the cookie may outlive the UI state, so
      // say so in the console rather than silently pretending.
      void endServerSession().catch((err: unknown) => {
        console.error('[sb] server logout failed — the session cookie may still be live', err);
      });
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user: state.user,
      status: state.status,
      isAuthenticated: state.status === 'authenticated',
      login,
      logout,
    }),
    [state, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
}

import type { JSX } from 'react';
import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { Spinner } from '../ui/index.ts';
import { useAuth } from './AuthProvider.tsx';

/**
 * Route guard: unauthenticated users are redirected to /login, preserving the
 * attempted location in router state so the login screen can send them back.
 * Rendered as a layout route whose children are the authenticated shell.
 *
 * While the real-mode /auth/me round-trip is in flight (`status === 'unknown'`)
 * this renders a holding frame and does NOT redirect — bouncing during that
 * window is indistinguishable from "SSO login never works" (the session cookie
 * is set, but the guard never waited to hear about it).
 */
export function RequireAuth(): JSX.Element {
  const { status } = useAuth();
  const location = useLocation();

  if (status === 'unknown') {
    return (
      <div className="sb-boot">
        <Spinner size="lg" label="Checking your session" />
      </div>
    );
  }

  if (status === 'anonymous') {
    const from = `${location.pathname}${location.search}`;
    return <Navigate to="/login" replace state={{ from }} />;
  }

  return <Outlet />;
}

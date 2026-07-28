import type { JSX } from 'react';
import { Navigate, useLocation } from 'react-router-dom';
import { Spinner } from '../ui/index.ts';
import { useAuth } from './AuthProvider.tsx';
import { DevLoginPage } from './DevLoginPage.tsx';
import { SsoLoginPage } from './SsoLoginPage.tsx';

interface LocationState {
  from?: string;
}

/**
 * The /login route. This is the second (and last) place the web decides on API
 * mode — mirroring main.tsx: decide once here, keep the two screens themselves
 * mode-agnostic. Real mode has no dev-login route on the API at all
 * (apps/api/src/main.ts mounts it only under MOCK_MODE), so the fixture picker
 * would be a dead end; it renders the OIDC hand-off instead.
 *
 * Note: `from` (set by RequireAuth) only survives in mock mode, where sign-in is
 * client-side. The OIDC round-trip returns through the API's own configured
 * post-login redirect and carries no router state — see DECISIONS/report.
 */
export function LoginPage(): JSX.Element {
  const { status, isAuthenticated } = useAuth();
  const location = useLocation();
  const from = (location.state as LocationState | null)?.from ?? '/inbox';

  // Real-mode boot: don't flash the sign-in screen at someone whose /auth/me
  // check is still in flight — wait, then either bounce them onward or render it.
  if (status === 'unknown') {
    return (
      <div className="sb-boot">
        <Spinner size="lg" label="Checking your session" />
      </div>
    );
  }

  if (isAuthenticated) {
    return <Navigate to={from} replace />;
  }

  return import.meta.env.VITE_API_MODE === 'real' ? <SsoLoginPage /> : <DevLoginPage from={from} />;
}

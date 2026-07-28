import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { JSX } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ROUTER_FUTURE } from '../app/routerFuture.ts';
import { http, HttpResponse } from 'msw';
import type { User } from '@switchboard/shared';
import { CSRF_HEADER } from '@switchboard/shared';
import { server } from '../mocks/server.ts';
import { AUTH_STORAGE_KEY, storeUser } from './auth.ts';
import { AuthProvider, useAuth } from './AuthProvider.tsx';
import { RequireAuth } from './RequireAuth.tsx';

/*
 * Real-mode identity (VITE_API_MODE=real): the SERVER is the source of truth.
 * The OIDC callback sets an HttpOnly cookie the SPA cannot read, so boot must
 * resolve GET /auth/me — these tests pin the three-state model that makes that
 * possible without re-introducing the redirect-while-in-flight bug (D-061
 * class: every mocked layer hid that the client never asked the server who was
 * signed in).
 */

const USER: User = {
  id: '00000000-0000-4000-8000-000000000001',
  email: 'ada@switchboard.test',
  name: 'Ada Okafor',
  role: 'admin',
  idpSubject: 'oidc|ada@switchboard.test',
  isActive: true,
  timezone: 'America/New_York',
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-01T00:00:00.000Z',
};

const ME = '/api/v1/auth/me';
const LOGOUT = '/api/v1/auth/logout';

function me401(counter?: { calls: number }): ReturnType<typeof http.get> {
  return http.get(ME, () => {
    if (counter) counter.calls += 1;
    return HttpResponse.json(
      { error: { code: 'UNAUTHENTICATED', message: 'no active session' } },
      { status: 401 },
    );
  });
}

function Probe(): JSX.Element {
  const { user, status, isAuthenticated, logout } = useAuth();
  return (
    <div>
      <output>{`${status}:${user ? user.name : 'null'}:${String(isAuthenticated)}`}</output>
      <button type="button" onClick={logout}>
        sign out
      </button>
    </div>
  );
}

beforeEach(() => {
  vi.stubEnv('VITE_API_MODE', 'real');
  localStorage.clear();
});
afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

describe('AuthProvider — real mode boots from the server', () => {
  test('a live server session hydrates the user with NO localStorage entry', async () => {
    server.use(http.get(ME, () => HttpResponse.json(USER)));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    // First paint is the third state — not "signed out".
    expect(screen.getByRole('status')).toHaveTextContent('unknown:null:false');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('authenticated:Ada Okafor:true'),
    );
    // Server truth is never mirrored into the mock store.
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });

  test('a stale localStorage user does NOT count as identity in real mode', async () => {
    storeUser(USER);
    const counter = { calls: 0 };
    server.use(me401(counter));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('unknown:null:false');
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('anonymous:null:false'),
    );
    expect(counter.calls).toBe(1);
  });

  // failure path: 401 is the ordinary logged-out answer — one check, no retry
  // loop, no console noise.
  test('a 401 resolves to anonymous exactly once and is not treated as an error', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const counter = { calls: 0 };
    server.use(me401(counter));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('anonymous:null:false'),
    );
    // Let any accidental re-fetch loop reveal itself before counting.
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(counter.calls).toBe(1);
    expect(errSpy).not.toHaveBeenCalled();
  });

  // failure path: an unreachable API fails CLOSED to the login screen (the
  // cookie survives, a later boot recovers) and is loudly logged.
  test('a network-level failure resolves to anonymous and logs', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    server.use(http.get(ME, () => HttpResponse.error()));
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('anonymous:null:false'),
    );
    expect(errSpy).toHaveBeenCalled();
  });
});

describe('RequireAuth — the in-flight window', () => {
  function renderGuarded(): { loginMounted: () => boolean } {
    let mounted = false;
    function LoginProbe(): JSX.Element {
      mounted = true;
      return <div>LOGIN SCREEN</div>;
    }
    render(
      <AuthProvider>
        <MemoryRouter initialEntries={['/protected']} future={ROUTER_FUTURE}>
          <Routes>
            <Route path="/login" element={<LoginProbe />} />
            <Route element={<RequireAuth />}>
              <Route path="/protected" element={<div>PROTECTED CONTENT</div>} />
            </Route>
          </Routes>
        </MemoryRouter>
      </AuthProvider>,
    );
    return { loginMounted: () => mounted };
  }

  test('does not redirect while /auth/me is in flight; renders the page on success', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    server.use(
      http.get(ME, async () => {
        await gate;
        return HttpResponse.json(USER);
      }),
    );
    const { loginMounted } = renderGuarded();

    // In flight: a holding frame — neither the protected page nor /login.
    expect(screen.getByText('Checking your session')).toBeInTheDocument();
    expect(screen.queryByText('PROTECTED CONTENT')).not.toBeInTheDocument();
    expect(screen.queryByText('LOGIN SCREEN')).not.toBeInTheDocument();

    release();
    expect(await screen.findByText('PROTECTED CONTENT')).toBeInTheDocument();
    // The login route was never mounted — no bounce-and-return.
    expect(loginMounted()).toBe(false);
  });

  // failure path: genuinely logged out → exactly one redirect to /login, no loop.
  test('a 401 redirects to /login after (not during) the check', async () => {
    const counter = { calls: 0 };
    server.use(me401(counter));
    const { loginMounted } = renderGuarded();
    expect(loginMounted()).toBe(false);
    expect(await screen.findByText('LOGIN SCREEN')).toBeInTheDocument();
    expect(screen.queryByText('PROTECTED CONTENT')).not.toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(counter.calls).toBe(1);
  });
});

describe('logout — real mode ends the SERVER session', () => {
  test('calls POST /auth/logout through the CSRF-bearing client and clears local state', async () => {
    let logoutCalls = 0;
    let csrfHeader: string | null = null;
    server.use(
      http.get(ME, () => HttpResponse.json(USER)),
      http.post(LOGOUT, ({ request }) => {
        logoutCalls += 1;
        csrfHeader = request.headers.get(CSRF_HEADER);
        return HttpResponse.json({ ok: true });
      }),
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('authenticated:Ada Okafor:true'),
    );

    await userEvent.click(screen.getByRole('button', { name: 'sign out' }));
    // Local state drops immediately…
    expect(screen.getByRole('status')).toHaveTextContent('anonymous:null:false');
    // …and the server session is actually ended, with the CSRF rail attached
    // (a bare fetch would be 403'd by the session guard once deployed).
    await waitFor(() => expect(logoutCalls).toBe(1));
    expect(csrfHeader).not.toBeNull();
    expect(csrfHeader).not.toBe('');
  });

  // failure path: a dead API must not trap the user signed-in; local state
  // still clears and the failure is reported, not swallowed silently.
  test('still clears local state when the server logout fails', async () => {
    const errSpy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    server.use(
      http.get(ME, () => HttpResponse.json(USER)),
      http.post(LOGOUT, () => HttpResponse.error()),
    );
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await waitFor(() =>
      expect(screen.getByRole('status')).toHaveTextContent('authenticated:Ada Okafor:true'),
    );
    await userEvent.click(screen.getByRole('button', { name: 'sign out' }));
    expect(screen.getByRole('status')).toHaveTextContent('anonymous:null:false');
    await waitFor(() => expect(errSpy).toHaveBeenCalled());
  });
});

describe('mock mode is untouched by the server-session model', () => {
  test('boot stays synchronous — no unknown state, no /auth/me call', () => {
    vi.stubEnv('VITE_API_MODE', '');
    storeUser(USER);
    // No MSW handler for /auth/me is registered here and unhandled requests
    // error loudly — rendering cleanly IS the proof no server call happens.
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    expect(screen.getByRole('status')).toHaveTextContent('authenticated:Ada Okafor:true');
  });

  test('logout stays local — no server call, storage cleared', async () => {
    vi.stubEnv('VITE_API_MODE', '');
    storeUser(USER);
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'sign out' }));
    expect(screen.getByRole('status')).toHaveTextContent('anonymous:null:false');
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
  });
});

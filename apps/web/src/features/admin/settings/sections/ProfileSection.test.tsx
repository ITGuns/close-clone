import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@switchboard/shared';
import { ToastProvider } from '../../../../feedback/ToastProvider.tsx';
import { AuthProvider } from '../../../../auth/AuthProvider.tsx';
import { readStoredUser, storeUser } from '../../../../auth/auth.ts';
import { db } from '../../../../mocks/fixtures.ts';
import { server } from '../../../../mocks/server.ts';
import { adminHandlers } from '../../mocks/adminHandlers.ts';
import { resetAdminStore } from '../../mocks/adminStore.ts';
import { ProfileSection } from './ProfileSection.tsx';

function fixtureUser(): User {
  const u = db.users[0];
  if (!u) throw new Error('fixture users missing');
  return u;
}

function renderProfile(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider ttl={0}>
        <AuthProvider>
          <ProfileSection />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetAdminStore();
  server.use(...adminHandlers);
  storeUser(fixtureUser());
});
afterEach(() => {
  storeUser(null);
  cleanup();
  vi.restoreAllMocks();
});

describe('identity', () => {
  test('shows the editable fields and the read-only SSO identity block', () => {
    const me = fixtureUser();
    renderProfile();

    expect(screen.getByLabelText('Display name')).toHaveValue(me.name);
    expect(screen.getByLabelText('Timezone')).toHaveValue(me.timezone);
    expect(screen.getByText(me.email)).toBeInTheDocument();
    expect(screen.getByText('Company single sign-on (SSO)')).toBeInTheDocument();
    expect(screen.getByText(me.idpSubject)).toBeInTheDocument();
    // Internal SSO: no password management surface, ever.
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(
      screen.getByText(/Password and two-factor settings live in the identity provider/),
    ).toBeInTheDocument();
  });
});

describe('saving', () => {
  test('saves name + timezone, toasts, and propagates to the auth session', async () => {
    const user = userEvent.setup();
    renderProfile();

    const nameInput = screen.getByLabelText('Display name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Ada O. Okafor');
    await user.selectOptions(screen.getByLabelText('Timezone'), 'America/Chicago');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    await screen.findByText('Profile saved');
    expect(db.users[0]?.name).toBe('Ada O. Okafor');
    expect(db.users[0]?.timezone).toBe('America/Chicago');
    // useAuth().login re-persisted the mock session blob → top bar re-renders.
    expect(readStoredUser()?.name).toBe('Ada O. Okafor');
  });

  test('an empty name disables save and shows a field error', async () => {
    const user = userEvent.setup();
    const before = db.users[0]?.name;
    renderProfile();

    await user.clear(screen.getByLabelText('Display name'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Display name is required');
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
    expect(db.users[0]?.name).toBe(before);
  });
});

describe('my data', () => {
  test('Download my data builds a JSON blob download named switchboard-my-data.json', async () => {
    const user = userEvent.setup();
    const downloads: string[] = [];
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:sb-test'),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });

    renderProfile();
    await user.click(screen.getByRole('button', { name: 'Download my data' }));

    await waitFor(() => expect(downloads).toEqual(['switchboard-my-data.json']));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
});

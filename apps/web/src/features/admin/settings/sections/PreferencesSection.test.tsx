import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '../../../../feedback/ToastProvider.tsx';
import { ThemeProvider } from '../../../../theme/ThemeProvider.tsx';
import { server } from '../../../../mocks/server.ts';
import { adminHandlers } from '../../mocks/adminHandlers.ts';
import { adminStore, resetAdminStore } from '../../mocks/adminStore.ts';
import { PreferencesSection } from './PreferencesSection.tsx';

function renderPrefs(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider ttl={0}>
        <ThemeProvider>
          <PreferencesSection />
        </ThemeProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetAdminStore();
  server.use(...adminHandlers);
});
afterEach(() => {
  cleanup();
  localStorage.removeItem('sb-theme');
  document.documentElement.removeAttribute('data-theme');
});

describe('theme', () => {
  test('offers labeled radios and picking Dark stamps data-theme + persists sb-theme', async () => {
    const user = userEvent.setup();
    renderPrefs();

    expect(screen.getByRole('radio', { name: 'Match system' })).toBeChecked();
    await user.click(screen.getByRole('radio', { name: 'Dark' }));

    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(localStorage.getItem('sb-theme')).toBe('dark');
    expect(screen.getByText('Applies to this browser on this device.')).toBeInTheDocument();
  });
});

describe('notifications', () => {
  test('reflects the stored preferences and firewalls the compliance rail in copy', async () => {
    renderPrefs();

    const desktop = await screen.findByRole('switch', { name: 'Desktop notifications' });
    expect(desktop).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('switch', { name: 'Daily email digest' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
    expect(
      screen.getByText(/compliance rail enforced by the engine — see Compliance/),
    ).toBeInTheDocument();
  });

  test('flipping a switch persists to the store immediately', async () => {
    const user = userEvent.setup();
    renderPrefs();

    await user.click(await screen.findByRole('switch', { name: 'Daily email digest' }));

    await waitFor(() => expect(adminStore.preferences.emailDigest).toBe(true));
    expect(screen.getByRole('switch', { name: 'Daily email digest' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('enabling quiet hours reveals time fields and edits persist', async () => {
    const user = userEvent.setup();
    renderPrefs();

    await user.click(await screen.findByRole('switch', { name: 'Notification quiet hours' }));
    await waitFor(() => expect(adminStore.preferences.quietHours.enabled).toBe(true));

    const from = await screen.findByLabelText('From');
    fireEvent.change(from, { target: { value: '22:00' } });
    await waitFor(() => expect(adminStore.preferences.quietHours.start).toBe('22:00'));
  });

  test('a failed load shows an ErrorState with retry', async () => {
    server.use(
      http.get('*/api/v1/users/me/preferences', () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'boom' } }, { status: 500 }),
      ),
    );
    renderPrefs();

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/Couldn’t load preferences/);
  });
});

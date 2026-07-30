import { createRef } from 'react';
import { afterEach, beforeEach, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { User } from '@switchboard/shared';
import { AuthProvider } from '../auth/AuthProvider.tsx';
import { storeUser } from '../auth/auth.ts';
import { db } from '../mocks/fixtures.ts';
import { ThemeProvider } from '../theme/ThemeProvider.tsx';
import { TopBar } from './TopBar.tsx';

function fixtureUser(): User {
  const u = db.users[0];
  if (!u) throw new Error('fixture users missing');
  return u;
}

beforeEach(() => {
  storeUser(fixtureUser());
});
afterEach(() => {
  storeUser(null);
  localStorage.removeItem('sb-theme');
  document.documentElement.removeAttribute('data-theme');
  cleanup();
});

test('the user menu links to the personal settings section', () => {
  render(
    <MemoryRouter>
      <ThemeProvider>
        <AuthProvider>
          <TopBar searchRef={createRef<HTMLInputElement>()} onOpenPalette={() => {}} />
        </AuthProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );

  expect(screen.getByRole('link', { name: 'Account settings' })).toHaveAttribute(
    'href',
    '/settings?section=profile',
  );
  // Sign out stays — the link complements it, never replaces it.
  expect(screen.getByRole('button', { name: 'Sign out' })).toBeInTheDocument();
});

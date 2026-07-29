import type { JSX } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TourProvider, useTour } from './TourProvider.tsx';
import { markTourSeen, TOUR_SUPPRESS_KEY, tourSeenKey } from './tour.ts';

vi.mock('../../auth/AuthProvider.tsx', () => ({
  useAuth: () => ({
    user: { id: 'u-test', name: 'Test Rep' },
    status: 'authenticated',
    isAuthenticated: true,
    login: vi.fn(),
    logout: vi.fn(),
  }),
}));

function Probe(): JSX.Element {
  const { openTour } = useTour();
  return (
    <button type="button" onClick={openTour}>
      replay entry
    </button>
  );
}

/** Fake shell chrome carrying the real data-tour anchors. */
function Harness(): JSX.Element {
  return (
    <TourProvider>
      <nav>
        <a href="/inbox" data-tour="nav-inbox">
          Inbox
        </a>
        <a href="/leads" data-tour="nav-leads">
          Leads
        </a>
        <a href="/pipeline" data-tour="nav-pipeline">
          Pipeline
        </a>
      </nav>
      <form data-tour="topbar-search">
        <input aria-label="Global search" />
      </form>
      <Probe />
    </TourProvider>
  );
}

beforeEach(() => {
  localStorage.removeItem(TOUR_SUPPRESS_KEY);
  localStorage.removeItem(tourSeenKey('u-test'));
});
afterEach(() => {
  cleanup();
  localStorage.removeItem(tourSeenKey('u-test'));
  localStorage.setItem(TOUR_SUPPRESS_KEY, '1');
});

describe('TourProvider — first run', () => {
  it('auto-opens the welcome step for a fresh user and burns the seen flag', async () => {
    render(<Harness />);
    expect(
      await screen.findByRole('dialog', { name: 'Welcome to Switchboard' }),
    ).toBeInTheDocument();
    expect(localStorage.getItem(tourSeenKey('u-test'))).toBe('1');
  });

  it('never auto-opens when already seen', () => {
    markTourSeen('u-test');
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('never auto-opens when suppressed', () => {
    localStorage.setItem(TOUR_SUPPRESS_KEY, '1');
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('TourProvider — walking the tour', () => {
  it('Start tour → coachmarks advance/retreat on arrows → Escape ends and restores', async () => {
    render(<Harness />);
    const welcome = await screen.findByRole('dialog', { name: 'Welcome to Switchboard' });
    await userEvent.click(screen.getByRole('button', { name: 'Start tour' }));
    expect(welcome).not.toBeInTheDocument();

    expect(await screen.findByRole('dialog', { name: 'Inbox' })).toBeInTheDocument();
    expect(screen.getByText('Step 2 of 6')).toBeInTheDocument();

    await userEvent.keyboard('{ArrowRight}');
    expect(await screen.findByRole('dialog', { name: 'Leads' })).toBeInTheDocument();
    await userEvent.keyboard('{ArrowLeft}');
    expect(await screen.findByRole('dialog', { name: 'Inbox' })).toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('walks through to the finish card and closes on Done', async () => {
    render(<Harness />);
    await screen.findByRole('dialog', { name: 'Welcome to Switchboard' });
    await userEvent.click(screen.getByRole('button', { name: 'Start tour' }));
    for (const name of ['Inbox', 'Leads', 'Pipeline', 'Search & commands']) {
      expect(await screen.findByRole('dialog', { name })).toBeInTheDocument();
      await userEvent.keyboard('{ArrowRight}');
    }
    const finish = await screen.findByRole('dialog', { name: 'That’s the board' });
    expect(finish).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('TourProvider — replay', () => {
  it('openTour() reopens the tour even when seen', async () => {
    markTourSeen('u-test');
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await userEvent.click(screen.getByRole('button', { name: 'replay entry' }));
    expect(
      await screen.findByRole('dialog', { name: 'Welcome to Switchboard' }),
    ).toBeInTheDocument();
  });
});

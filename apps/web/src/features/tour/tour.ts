import type { FloatingSide } from '../../ui/floating.ts';

/*
 * Guided-tour core: the step script and the first-run decision. Pure and
 * storage-flag based, modeled on features/welcome/useIgnition.ts — no server
 * field (spec decision D-T1), so a rep switching browsers may see the tour once
 * more. Storage failure degrades to "never auto-open", never a throw.
 */

/** Global kill switch — set by the test suites and available to demos. */
export const TOUR_SUPPRESS_KEY = 'sb-tour-suppress';

export interface TourStep {
  id: string;
  kind: 'modal' | 'anchored';
  /** CSS selector for the chrome element this step points at. */
  anchor?: string;
  side?: FloatingSide;
  title: string;
  body: string;
  /** Combo string rendered via KbdCombo — same strings the registry binds. */
  combo?: string;
}

/**
 * The script. Anchors are persistent shell chrome only (rail + topbar), so the
 * tour works on every authenticated route and on an empty workspace. Sequences
 * has no rail entry, so it is covered honestly by the palette step (D-T4).
 */
export const TOUR_STEPS: readonly TourStep[] = [
  {
    id: 'welcome',
    kind: 'modal',
    title: 'Welcome to Switchboard',
    body: 'Your queue, your leads, your pipeline — one keyboard. This tour takes 60 seconds.',
  },
  {
    id: 'inbox',
    kind: 'anchored',
    anchor: '[data-tour="nav-inbox"]',
    side: 'right',
    title: 'Inbox',
    body: 'Everything that needs a reply, in one queue. Work it top to bottom.',
    combo: 'g i',
  },
  {
    id: 'leads',
    kind: 'anchored',
    anchor: '[data-tour="nav-leads"]',
    side: 'right',
    title: 'Leads',
    body: 'Every account with its full timeline — calls, email, SMS, notes in one stream.',
    combo: 'g l',
  },
  {
    id: 'pipeline',
    kind: 'anchored',
    anchor: '[data-tour="nav-pipeline"]',
    side: 'right',
    title: 'Pipeline',
    body: 'Deals by stage. Move them as they progress.',
    combo: 'g p',
  },
  {
    id: 'search',
    kind: 'anchored',
    anchor: '[data-tour="topbar-search"]',
    side: 'bottom',
    title: 'Search & commands',
    body: 'Search leads here. The command palette runs everything else — sequences, dialer, import.',
    combo: 'mod+k',
  },
  {
    id: 'finish',
    kind: 'modal',
    title: 'That’s the board',
    body: 'Press ? for every live shortcut. Replay this tour from Support & FAQs.',
    combo: '?',
  },
];

/** localStorage key holding a user's seen flag. */
export function tourSeenKey(userId: string): string {
  return `sb-tour-v1:${userId}`;
}

export function hasSeenTour(userId: string): boolean {
  try {
    return localStorage.getItem(tourSeenKey(userId)) === '1';
  } catch {
    return true; // broken storage: never auto-open
  }
}

export function markTourSeen(userId: string): void {
  try {
    localStorage.setItem(tourSeenKey(userId), '1');
  } catch {
    /* degrade: the tour may auto-open again next boot */
  }
}

export function isTourSuppressed(): boolean {
  try {
    return localStorage.getItem(TOUR_SUPPRESS_KEY) === '1';
  } catch {
    return true;
  }
}

/** Pure first-run decision — the only gate for auto-opening the tour. */
export function decideAutoOpen(seen: boolean, suppressed: boolean): boolean {
  return !seen && !suppressed;
}

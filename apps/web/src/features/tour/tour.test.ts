import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  decideAutoOpen,
  hasSeenTour,
  isTourSuppressed,
  markTourSeen,
  TOUR_STEPS,
  TOUR_SUPPRESS_KEY,
  tourSeenKey,
} from './tour.ts';

beforeEach(() => {
  localStorage.removeItem(TOUR_SUPPRESS_KEY);
  localStorage.removeItem(tourSeenKey('u1'));
});
afterEach(() => {
  // Restore the suite-wide default (src/test/setup.ts seeds suppression).
  localStorage.setItem(TOUR_SUPPRESS_KEY, '1');
});

describe('decideAutoOpen', () => {
  it('opens only when unseen and unsuppressed', () => {
    expect(decideAutoOpen(false, false)).toBe(true);
    expect(decideAutoOpen(true, false)).toBe(false);
    expect(decideAutoOpen(false, true)).toBe(false);
    expect(decideAutoOpen(true, true)).toBe(false);
  });
});

describe('storage flags', () => {
  it('seen flag round-trips per user', () => {
    expect(hasSeenTour('u1')).toBe(false);
    markTourSeen('u1');
    expect(hasSeenTour('u1')).toBe(true);
    expect(hasSeenTour('u2')).toBe(false);
    localStorage.removeItem(tourSeenKey('u1'));
  });

  it('suppress flag reads the kill-switch key', () => {
    expect(isTourSuppressed()).toBe(false);
    localStorage.setItem(TOUR_SUPPRESS_KEY, '1');
    expect(isTourSuppressed()).toBe(true);
  });
});

describe('TOUR_STEPS', () => {
  it('is 6 steps: modal bookends, anchored middle with selector + side', () => {
    expect(TOUR_STEPS).toHaveLength(6);
    expect(new Set(TOUR_STEPS.map((s) => s.id)).size).toBe(6);
    expect(TOUR_STEPS[0]?.kind).toBe('modal');
    expect(TOUR_STEPS.at(-1)?.kind).toBe('modal');
    for (const s of TOUR_STEPS.slice(1, -1)) {
      expect(s.kind).toBe('anchored');
      expect(s.anchor).toMatch(/^\[data-tour="/);
      expect(s.side).toBeDefined();
    }
  });
});

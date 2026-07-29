# Switchboard Self-Serve Onboarding + Guided Tour — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** First-run guided tour (6 steps, keyboard-first, dismissible + replayable) over Switchboard's operator chrome, plus real "get started" CTAs on the Leads and Sequences empty states.

**Architecture:** A `TourProvider` mounted in `AppShell` auto-opens once per user (localStorage flag, `useIgnition` pattern), rendering `Modal` bookend steps and a new non-modal `Coachmark` primitive (built on an extended `ui/floating.ts`) anchored to `data-tour` attributes on the LeftRail/TopBar. No API, contract, or auth changes.

**Tech Stack:** React 19 + Vite, existing hand-rolled UI kit only (zero new dependencies), Vitest + Testing Library + MSW, Playwright (standalone `e2e/`).

**Spec:** `docs/superpowers/specs/2026-07-30-switchboard-self-serve-design.md` (decisions D-T1…D-T11 referenced below).

## Global Constraints

- Repo root: `D:/CODE/NEW/close-clone`. All paths below are repo-relative. Run pnpm commands from the repo root.
- **No new dependencies. No changes to `CONTRACTS.md`, `ARCHITECTURE.md`, `DESIGN.md`, `apps/api`, or any auth file.**
- Strict TypeScript, `exactOptionalPropertyTypes`-style discipline: optional props that receive a possibly-undefined value must be declared `?: T | undefined`.
- Motion: `transform` + `opacity` only; `var(--ease-out)`; enter ≤ 200ms; **keyboard-initiated advances are 0ms** (all coachmark steps render with `data-instant`); reduced motion collapses animation via the existing `@media (prefers-reduced-motion: reduce)` block in `apps/web/src/styles/overlays.css`.
- Copy voice: short declaratives, numbers over adjectives, no marketing froth. Use the exact strings given below (curly apostrophes, as in the codebase).
- Storage keys: `sb-tour-v1:<userId>` (seen), `sb-tour-suppress` (kill switch). All storage access wrapped in try/catch; failure degrades to "never auto-open".
- Unit tests: `pnpm --filter @switchboard/web exec vitest run <path relative to apps/web>`. Full suite: `pnpm --filter @switchboard/web test`.
- Commit after every task. Branch first (Task 1). Work in an isolated worktree if using superpowers:using-git-worktrees.

---

### Task 1: Extend `ui/floating.ts` with left/right sides

**Files:**
- Modify: `apps/web/src/ui/floating.ts`
- Test (create): `apps/web/src/ui/floating.test.ts`

**Interfaces:**
- Produces: `export type FloatingSide = 'top' | 'bottom' | 'left' | 'right'`; `export function computeFloatingPosition(anchor: HTMLElement, panel: HTMLElement, options: FloatingOptions): FloatingPosition` (the previously-internal `compute`, now exported); `FloatingOptions.side` and `FloatingPosition.side` widened to `FloatingSide`. `useFloatingPosition` signature unchanged.

- [ ] **Step 0: Branch**

```bash
git checkout -b feature/self-serve-tour
```

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/ui/floating.test.ts` (jsdom viewport is 1024×768; `VIEWPORT_MARGIN` is 8):

```ts
import { describe, expect, it } from 'vitest';
import { computeFloatingPosition } from './floating.ts';

/** Minimal element stub — compute only calls getBoundingClientRect. */
function el(rect: { top: number; left: number; width: number; height: number }): HTMLElement {
  const r = {
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  } as DOMRect;
  return { getBoundingClientRect: () => r } as unknown as HTMLElement;
}

describe('computeFloatingPosition — left/right sides', () => {
  it('places the panel to the right of the anchor, center-aligned vertically', () => {
    const anchor = el({ top: 300, left: 16, width: 48, height: 32 });
    const panel = el({ top: 0, left: 0, width: 280, height: 120 });
    const pos = computeFloatingPosition(anchor, panel, { side: 'right', align: 'center', offset: 12 });
    expect(pos.side).toBe('right');
    expect(pos.style.left).toBe(76); // 16 + 48 + 12
    expect(pos.style.top).toBe(256); // 300 + 32/2 - 120/2
  });

  it('flips right → left when the right edge has no room', () => {
    const anchor = el({ top: 300, left: 964, width: 48, height: 32 });
    const panel = el({ top: 0, left: 0, width: 280, height: 120 });
    const pos = computeFloatingPosition(anchor, panel, { side: 'right', offset: 12 });
    expect(pos.side).toBe('left');
    expect(pos.style.left).toBe(672); // 964 - 12 - 280
  });

  it('flips left → right and clamps to the viewport margin', () => {
    const anchor = el({ top: 4, left: 4, width: 10, height: 10 });
    const panel = el({ top: 0, left: 0, width: 100, height: 50 });
    const pos = computeFloatingPosition(anchor, panel, { side: 'left', offset: 8 });
    expect(pos.side).toBe('right');
    expect(pos.style.left).toBe(22); // 4 + 10 + 8
    expect(pos.style.top).toBe(8); // align start = 4, clamped to margin
  });

  it('keeps the existing bottom-placement contract unchanged', () => {
    const anchor = el({ top: 100, left: 100, width: 200, height: 40 });
    const panel = el({ top: 0, left: 0, width: 160, height: 80 });
    const pos = computeFloatingPosition(anchor, panel, {});
    expect(pos.side).toBe('bottom');
    expect(pos.style.top).toBe(144); // 100 + 40 + 4
    expect(pos.style.left).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/web exec vitest run src/ui/floating.test.ts`
Expected: FAIL — `computeFloatingPosition` is not exported.

- [ ] **Step 3: Implement**

In `apps/web/src/ui/floating.ts`, replace the `FloatingOptions`/`FloatingPosition` types and the whole internal `compute` function with:

```ts
export type FloatingSide = 'top' | 'bottom' | 'left' | 'right';

export interface FloatingOptions {
  side?: FloatingSide;
  align?: 'start' | 'center' | 'end';
  /** Gap between anchor and panel, px. */
  offset?: number;
}

export interface FloatingPosition {
  style: CSSProperties;
  anchorWidth: number;
  /** Side actually used after flipping — drives transform-origin via data-side. */
  side: FloatingSide;
}

const VIEWPORT_MARGIN = 8;

/**
 * Pure placement: exported for unit tests and for callers that need a one-shot
 * measurement. Vertical sides flip vertically, horizontal sides horizontally;
 * both axes clamp to the viewport margin afterwards.
 */
export function computeFloatingPosition(
  anchor: HTMLElement,
  panel: HTMLElement,
  { side = 'bottom', align = 'start', offset = 4 }: FloatingOptions,
): FloatingPosition {
  const a = anchor.getBoundingClientRect();
  const p = panel.getBoundingClientRect();

  let actualSide = side;
  if (side === 'bottom' && a.bottom + offset + p.height > window.innerHeight - VIEWPORT_MARGIN) {
    if (a.top - offset - p.height >= VIEWPORT_MARGIN) actualSide = 'top';
  } else if (side === 'top' && a.top - offset - p.height < VIEWPORT_MARGIN) {
    if (a.bottom + offset + p.height <= window.innerHeight - VIEWPORT_MARGIN) {
      actualSide = 'bottom';
    }
  } else if (side === 'right' && a.right + offset + p.width > window.innerWidth - VIEWPORT_MARGIN) {
    if (a.left - offset - p.width >= VIEWPORT_MARGIN) actualSide = 'left';
  } else if (side === 'left' && a.left - offset - p.width < VIEWPORT_MARGIN) {
    if (a.right + offset + p.width <= window.innerWidth - VIEWPORT_MARGIN) {
      actualSide = 'right';
    }
  }

  let top: number;
  let left: number;
  if (actualSide === 'top' || actualSide === 'bottom') {
    top = actualSide === 'bottom' ? a.bottom + offset : a.top - offset - p.height;
    left = a.left;
    if (align === 'center') left = a.left + a.width / 2 - p.width / 2;
    else if (align === 'end') left = a.right - p.width;
  } else {
    left = actualSide === 'right' ? a.right + offset : a.left - offset - p.width;
    top = a.top;
    if (align === 'center') top = a.top + a.height / 2 - p.height / 2;
    else if (align === 'end') top = a.bottom - p.height;
  }

  const maxLeft = window.innerWidth - VIEWPORT_MARGIN - p.width;
  left = Math.min(Math.max(left, VIEWPORT_MARGIN), Math.max(maxLeft, VIEWPORT_MARGIN));
  const maxTop = window.innerHeight - VIEWPORT_MARGIN - p.height;
  top = Math.min(Math.max(top, VIEWPORT_MARGIN), Math.max(maxTop, VIEWPORT_MARGIN));

  return {
    style: { position: 'fixed', top: Math.round(top), left: Math.round(left) },
    anchorWidth: Math.round(a.width),
    side: actualSide,
  };
}
```

Then inside `useFloatingPosition`'s `update`, change the call `compute(anchor, panel, { side, align, offset })` to `computeFloatingPosition(anchor, panel, { side, align, offset })`. Nothing else in the hook changes. Keep the file's header comment but update the line "two sides, three alignments" → "four sides, three alignments".

- [ ] **Step 4: Run tests to verify pass (and no regression)**

Run: `pnpm --filter @switchboard/web exec vitest run src/ui/floating.test.ts src/ui/overlays.test.tsx src/ui/primitives.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/ui/floating.ts apps/web/src/ui/floating.test.ts
git commit -m "feat(web): extend floating positioner to left/right sides, export pure compute"
```

---

### Task 2: Tour core module (steps data + first-run decision + storage)

**Files:**
- Create: `apps/web/src/features/tour/tour.ts`
- Test (create): `apps/web/src/features/tour/tour.test.ts`

**Interfaces:**
- Produces: `TOUR_SUPPRESS_KEY: string`; `interface TourStep { id: string; kind: 'modal' | 'anchored'; anchor?: string; side?: FloatingSide; title: string; body: string; combo?: string }`; `TOUR_STEPS: readonly TourStep[]` (6 entries); `tourSeenKey(userId: string): string`; `hasSeenTour(userId: string): boolean`; `markTourSeen(userId: string): void`; `isTourSuppressed(): boolean`; `decideAutoOpen(seen: boolean, suppressed: boolean): boolean`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/tour/tour.test.ts`:

```ts
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/web exec vitest run src/features/tour/tour.test.ts`
Expected: FAIL — cannot resolve `./tour.ts`.

- [ ] **Step 3: Implement**

Create `apps/web/src/features/tour/tour.ts`:

```ts
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
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @switchboard/web exec vitest run src/features/tour/tour.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/tour
git commit -m "feat(web): tour step script + first-run decision core"
```

---

### Task 3: `Coachmark` primitive + CSS

**Files:**
- Create: `apps/web/src/ui/Coachmark.tsx`
- Modify: `apps/web/src/ui/index.ts` (add export)
- Modify: `apps/web/src/styles/overlays.css` (append styles; extend reduced-motion block)
- Test (create): `apps/web/src/ui/Coachmark.test.tsx`

**Interfaces:**
- Consumes: `useFloatingPosition`, `FloatingSide` (Task 1); `Button` (`./Button.tsx`); `cx` (`../lib/cx.ts`).
- Produces: `export function Coachmark(props: CoachmarkProps): JSX.Element` with `CoachmarkProps = { anchor: HTMLElement; side?: FloatingSide; title: string; step: number; total: number; isLast: boolean; instant?: boolean; onNext: () => void; onBack?: (() => void) | undefined; onDismiss: () => void; className?: string; children: ReactNode }`. Non-modal `role="dialog"`, focuses itself, capture-phase Escape/ArrowRight/ArrowLeft/Enter, adds `.sb-tour-anchor` to the anchor while mounted.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/ui/Coachmark.test.tsx`:

```tsx
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Coachmark } from './Coachmark.tsx';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function renderMark(over: { isLast?: boolean; withBack?: boolean } = {}) {
  const anchor = document.createElement('button');
  anchor.textContent = 'anchor';
  document.body.appendChild(anchor);
  const onNext = vi.fn();
  const onBack = vi.fn();
  const onDismiss = vi.fn();
  render(
    <Coachmark
      anchor={anchor}
      side="right"
      title="Inbox"
      step={2}
      total={6}
      isLast={over.isLast ?? false}
      onBack={over.withBack === false ? undefined : onBack}
      onNext={onNext}
      onDismiss={onDismiss}
    >
      <p>Everything that needs a reply, in one queue.</p>
    </Coachmark>,
  );
  return { anchor, onNext, onBack, onDismiss };
}

describe('Coachmark', () => {
  it('is a labelled non-modal dialog that takes focus and shows its position', () => {
    renderMark();
    const dialog = screen.getByRole('dialog', { name: 'Inbox' });
    expect(dialog).toHaveFocus();
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(screen.getByText('Step 2 of 6')).toBeInTheDocument();
    expect(screen.getByText('Everything that needs a reply, in one queue.')).toBeInTheDocument();
  });

  it('rings the anchor while mounted and cleans up on unmount', () => {
    const { anchor } = renderMark();
    expect(anchor.classList.contains('sb-tour-anchor')).toBe(true);
    cleanup();
    expect(anchor.classList.contains('sb-tour-anchor')).toBe(false);
  });

  it('advances, retreats, and dismisses from the keyboard', async () => {
    const { onNext, onBack, onDismiss } = renderMark();
    await userEvent.keyboard('{ArrowRight}');
    expect(onNext).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{ArrowLeft}');
    expect(onBack).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('Enter advances from the panel but activates a focused button normally', async () => {
    const { onNext, onDismiss } = renderMark();
    await userEvent.keyboard('{Enter}'); // focus is on the panel
    expect(onNext).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: 'Skip' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1); // no double-advance
  });

  it('renders button controls: Skip / Back / Next, and Finish on the last step', async () => {
    const { onNext, onBack, onDismiss } = renderMark();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    cleanup();
    renderMark({ isLast: true, withBack: false });
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/web exec vitest run src/ui/Coachmark.test.tsx`
Expected: FAIL — cannot resolve `./Coachmark.tsx`.

- [ ] **Step 3: Implement the component**

Create `apps/web/src/ui/Coachmark.tsx`:

```tsx
import { useEffect, useId, useRef } from 'react';
import type { JSX, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/cx.ts';
import { useFloatingPosition } from './floating.ts';
import type { FloatingSide } from './floating.ts';
import { Button } from './Button.tsx';

export interface CoachmarkProps {
  /** Element this step points at (must be in the document). */
  anchor: HTMLElement;
  side?: FloatingSide;
  title: string;
  /** 1-based position and total for the "Step n of m" line. */
  step: number;
  total: number;
  isLast: boolean;
  /** Skip the entrance animation — keyboard advances must be 0ms (DESIGN §4). */
  instant?: boolean;
  onNext: () => void;
  onBack?: (() => void) | undefined;
  onDismiss: () => void;
  className?: string;
  children: ReactNode;
}

/**
 * Guided-tour step: a portalled, anchored, NON-modal dialog (no aria-modal, no
 * Tab trap — the page stays operable, spec D-T6). Focuses itself on mount, rings
 * its anchor via `.sb-tour-anchor`, and owns four keys on a capture-phase
 * document listener (the Tooltip.tsx Escape pattern): Escape dismisses without
 * closing anything beneath; ArrowRight/Enter advance; ArrowLeft goes back.
 * Every other key (g-chords, /, mod+k) passes through untouched.
 */
export function Coachmark({
  anchor,
  side = 'bottom',
  title,
  step,
  total,
  isLast,
  instant = false,
  onNext,
  onBack,
  onDismiss,
  className,
  children,
}: CoachmarkProps): JSX.Element {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(anchor);
  anchorRef.current = anchor;
  const position = useFloatingPosition(true, anchorRef, panelRef, {
    side,
    align: 'center',
    offset: 12,
  });

  // Latest-handler refs so the once-registered key listener never goes stale.
  const handlers = useRef({ onNext, onBack, onDismiss });
  handlers.current = { onNext, onBack, onDismiss };

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    anchor.classList.add('sb-tour-anchor');
    return () => anchor.classList.remove('sb-tour-anchor');
  }, [anchor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        handlers.current.onDismiss();
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'Enter') {
        // Let Enter activate a focused button normally (no double-advance).
        if (
          event.key === 'Enter' &&
          event.target instanceof HTMLElement &&
          event.target.closest('button')
        ) {
          return;
        }
        event.stopPropagation();
        event.preventDefault();
        handlers.current.onNext();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.stopPropagation();
        event.preventDefault();
        handlers.current.onBack?.();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      tabIndex={-1}
      className={cx('sb-coachmark', className)}
      data-side={position.side}
      data-instant={instant || undefined}
      style={position.style}
    >
      <p className="sb-coachmark__step">
        Step {step} of {total}
      </p>
      <h2 id={titleId} className="sb-coachmark__title">
        {title}
      </h2>
      <div id={bodyId} className="sb-coachmark__body">
        {children}
      </div>
      <div className="sb-coachmark__actions">
        <Button variant="ghost" size="sm" onClick={() => handlers.current.onDismiss()}>
          Skip
        </Button>
        {onBack ? (
          <Button size="sm" onClick={() => handlers.current.onBack?.()}>
            Back
          </Button>
        ) : null}
        <Button variant="primary" size="sm" onClick={() => handlers.current.onNext()}>
          {isLast ? 'Finish' : 'Next'}
        </Button>
      </div>
    </div>,
    document.body,
  );
}
```

In `apps/web/src/ui/index.ts`, add (alphabetically among the existing component exports):

```ts
export { Coachmark } from './Coachmark.tsx';
```

- [ ] **Step 4: Add the CSS**

Append to `apps/web/src/styles/overlays.css` (after the Tooltip block, before the reduced-motion media query):

```css
/* ── Coachmark (guided-tour step — ui/Coachmark.tsx) ───────────────────── */
.sb-coachmark {
  z-index: var(--z-toast);
  width: 300px;
  padding: var(--space-4) var(--space-5);
  background: var(--surface-2);
  border: 1px solid var(--border-1);
  border-radius: var(--radius-2);
  box-shadow: var(--shadow-2);
  color: var(--ink-0);
  font-size: var(--fs-sm);
  animation: sb-coachmark-in var(--dur) var(--ease-out);
}
.sb-coachmark:focus {
  outline: none; /* programmatic dialog focus; controls keep visible rings */
}
/* Keyboard advances are 0ms — the tour passes instant on every step (D-T7). */
.sb-coachmark[data-instant] {
  animation: none;
}
.sb-coachmark[data-side='right'] {
  transform-origin: left center;
}
.sb-coachmark[data-side='left'] {
  transform-origin: right center;
}
.sb-coachmark[data-side='top'] {
  transform-origin: center bottom;
}
.sb-coachmark[data-side='bottom'] {
  transform-origin: center top;
}
.sb-coachmark__step {
  margin: 0;
  color: var(--ink-3);
  font-size: var(--fs-micro);
  font-variant-numeric: tabular-nums;
}
.sb-coachmark__title {
  margin: var(--space-1) 0;
  font-size: var(--fs-md);
  font-weight: var(--fw-semibold);
}
.sb-coachmark__body {
  color: var(--ink-2);
}
.sb-coachmark__body p {
  margin: 0;
}
.sb-coachmark__combo {
  margin-top: var(--space-2);
}
.sb-coachmark__actions {
  display: flex;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-top: var(--space-4);
}
@keyframes sb-coachmark-in {
  from {
    opacity: 0;
    transform: translateY(4px) scale(0.98);
  }
}
/* Active tour anchor: focus-token ring, zero layout shift (D-T5). */
.sb-tour-anchor {
  border-radius: var(--radius-1);
  box-shadow:
    0 0 0 2px var(--surface-1),
    0 0 0 4px var(--focus);
}
```

Then in the existing `@media (prefers-reduced-motion: reduce)` block in the same file, add `.sb-coachmark` to the selector group that sets `animation: none;` (the one containing `.sb-tooltip, .sb-menu, .sb-combobox__panel`).

- [ ] **Step 5: Run tests to verify pass**

Run: `pnpm --filter @switchboard/web exec vitest run src/ui/Coachmark.test.tsx src/ui/overlays.test.tsx`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/ui/Coachmark.tsx apps/web/src/ui/Coachmark.test.tsx apps/web/src/ui/index.ts apps/web/src/styles/overlays.css
git commit -m "feat(web): Coachmark primitive — anchored non-modal tour step"
```

---

### Task 4: `TourProvider` — auto-open, step engine, persistence, replay

**Files:**
- Create: `apps/web/src/features/tour/TourProvider.tsx`
- Create: `apps/web/src/features/tour/index.ts`
- Test (create): `apps/web/src/features/tour/TourProvider.test.tsx`

**Interfaces:**
- Consumes: `tour.ts` (Task 2), `Coachmark` + `Modal` + `Button` from `../../ui/index.ts` (Task 3), `KbdCombo` from `../../keyboard/index.ts`, `useAuth` from `../../auth/AuthProvider.tsx`.
- Produces: `export function TourProvider({ children }: { children: ReactNode }): JSX.Element`; `export function useTour(): { openTour: () => void }` (throws outside the provider). Barrel `features/tour/index.ts` re-exports both plus `TOUR_STEPS`, `TOUR_SUPPRESS_KEY`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/tour/TourProvider.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/web exec vitest run src/features/tour/TourProvider.test.tsx`
Expected: FAIL — cannot resolve `./TourProvider.tsx`.

- [ ] **Step 3: Implement**

Create `apps/web/src/features/tour/TourProvider.tsx`:

```tsx
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { JSX, ReactNode } from 'react';
import { Button, Coachmark, Modal } from '../../ui/index.ts';
import { KbdCombo } from '../../keyboard/index.ts';
import { useAuth } from '../../auth/AuthProvider.tsx';
import type { TourStep } from './tour.ts';
import {
  decideAutoOpen,
  hasSeenTour,
  isTourSuppressed,
  markTourSeen,
  TOUR_STEPS,
} from './tour.ts';

/*
 * First-run guided tour (spec 2026-07-30-switchboard-self-serve-design.md).
 * Auto-opens once per user (localStorage flag burned at open — D-T3, the
 * useIgnition pattern), replayable on demand via useTour().openTour() (/help).
 * Steps are Modal bookends + Coachmarks anchored to persistent shell chrome.
 */

interface TourContextValue {
  /** Open the tour at step 1. Replay-safe: never rewrites the seen flag. */
  openTour: () => void;
}

const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour requires TourProvider');
  return ctx;
}

export function TourProvider({ children }: { children: ReactNode }): JSX.Element {
  const { user } = useAuth();
  const [index, setIndex] = useState<number | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const autoRan = useRef(false);

  const open = useCallback(() => {
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIndex(0);
  }, []);

  const close = useCallback(() => {
    setIndex(null);
    restoreRef.current?.focus?.();
    restoreRef.current = null;
  }, []);

  // First run: burn the flag the moment the tour auto-opens so a dismissal is
  // never nagged; replay stays available from /help (D-T3).
  useEffect(() => {
    if (autoRan.current || !user) return;
    autoRan.current = true;
    if (decideAutoOpen(hasSeenTour(user.id), isTourSuppressed())) {
      markTourSeen(user.id);
      open();
    }
  }, [user, open]);

  const value = useMemo<TourContextValue>(() => ({ openTour: open }), [open]);

  return (
    <TourContext.Provider value={value}>
      {children}
      {index !== null ? (
        <TourOverlay index={index} onIndexChange={setIndex} onClose={close} />
      ) : null}
    </TourContext.Provider>
  );
}

function StepBody({ step }: { step: TourStep }): JSX.Element {
  return (
    <>
      <p>{step.body}</p>
      {step.combo ? (
        <div className="sb-coachmark__combo">
          <KbdCombo combo={step.combo} />
        </div>
      ) : null}
    </>
  );
}

interface TourOverlayProps {
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

function TourOverlay({ index, onIndexChange, onClose }: TourOverlayProps): JSX.Element | null {
  const step = TOUR_STEPS[index];
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  if (!step) return null;
  const isLast = index === TOUR_STEPS.length - 1;

  const next = (): void => {
    if (isLast) onClose();
    else onIndexChange(index + 1);
  };
  const back = index > 0 ? (): void => onIndexChange(index - 1) : undefined;

  if (step.kind === 'modal') {
    const first = index === 0;
    return (
      <Modal
        open
        onClose={onClose}
        label={step.title}
        initialFocusRef={primaryRef}
        className="sb-tour-modal"
      >
        <p className="sb-coachmark__step">
          Step {index + 1} of {TOUR_STEPS.length}
        </p>
        <h2 className="sb-coachmark__title">{step.title}</h2>
        <div className="sb-coachmark__body">
          <StepBody step={step} />
        </div>
        <div className="sb-coachmark__actions">
          {first ? (
            <>
              <Button variant="ghost" onClick={onClose}>
                Skip
              </Button>
              <button
                ref={primaryRef}
                type="button"
                className="sb-btn sb-btn--primary"
                onClick={next}
              >
                Start tour
              </button>
            </>
          ) : (
            <>
              {back ? (
                <Button variant="ghost" onClick={back}>
                  Back
                </Button>
              ) : null}
              <button
                ref={primaryRef}
                type="button"
                className="sb-btn sb-btn--primary"
                onClick={onClose}
              >
                Done
              </button>
            </>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <AnchoredStep
      key={step.id}
      step={step}
      index={index}
      total={TOUR_STEPS.length}
      isLast={isLast}
      onNext={next}
      onBack={back}
      onDismiss={onClose}
    />
  );
}

interface AnchoredStepProps {
  step: TourStep;
  index: number;
  total: number;
  isLast: boolean;
  onNext: () => void;
  onBack?: (() => void) | undefined;
  onDismiss: () => void;
}

function AnchoredStep({
  step,
  index,
  total,
  isLast,
  onNext,
  onBack,
  onDismiss,
}: AnchoredStepProps): JSX.Element | null {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const skippedRef = useRef(false);

  // Both anchors live in persistent chrome, so this is purely defensive: a
  // missing anchor skips forward instead of stranding the tour.
  useLayoutEffect(() => {
    const el = step.anchor ? document.querySelector<HTMLElement>(step.anchor) : null;
    if (el) {
      setAnchor(el);
      return;
    }
    if (!skippedRef.current) {
      skippedRef.current = true;
      onNext();
    }
  }, [step, onNext]);

  if (!anchor) return null;
  return (
    <Coachmark
      anchor={anchor}
      side={step.side ?? 'bottom'}
      title={step.title}
      step={index + 1}
      total={total}
      isLast={isLast}
      instant
      onNext={onNext}
      onBack={onBack}
      onDismiss={onDismiss}
    >
      <StepBody step={step} />
    </Coachmark>
  );
}
```

Create `apps/web/src/features/tour/index.ts`:

```ts
export { TourProvider, useTour } from './TourProvider.tsx';
export { TOUR_STEPS, TOUR_SUPPRESS_KEY } from './tour.ts';
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @switchboard/web exec vitest run src/features/tour/TourProvider.test.tsx`
Expected: PASS (all 6 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/tour
git commit -m "feat(web): TourProvider — first-run auto-open, step engine, replay"
```

---

### Task 5: Wire into the shell (suppress-seed first, then anchors + mount)

**Files:**
- Modify: `apps/web/src/test/setup.ts` (suite-wide suppression seed — do this FIRST)
- Modify: `apps/web/src/app/LeftRail.tsx` (rail `data-tour` anchors)
- Modify: `apps/web/src/app/TopBar.tsx:44` (search-form anchor)
- Modify: `apps/web/src/app/AppShell.tsx` (mount `TourProvider`)
- Test (create): `apps/web/src/app/tourAnchors.test.tsx`

**Interfaces:**
- Consumes: `TourProvider` from `../features/tour/index.ts` (Task 4).
- Produces: DOM anchors `[data-tour="nav-inbox"]`, `[data-tour="nav-leads"]`, `[data-tour="nav-pipeline"]` (LeftRail links, derived `nav-${item.to.slice(1)}`) and `[data-tour="topbar-search"]` (TopBar search form) — the selectors `TOUR_STEPS` targets.

- [ ] **Step 1: Seed suite-wide suppression (keeps every existing jsdom test green once the tour mounts in the shell)**

In `apps/web/src/test/setup.ts`, directly after the imports, add:

```ts
/*
 * The first-run guided tour auto-opens on a fresh profile, and every jsdom test
 * is a fresh profile. Suppress it suite-wide; the tour's own tests clear this
 * key in their beforeEach to exercise the auto-open path.
 */
localStorage.setItem('sb-tour-suppress', '1');
```

- [ ] **Step 2: Write the failing anchor test**

Create `apps/web/src/app/tourAnchors.test.tsx`:

```tsx
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LeftRail } from './LeftRail.tsx';

describe('tour anchors', () => {
  it('LeftRail exposes data-tour anchors for inbox, leads, and pipeline', () => {
    const { container } = render(
      <MemoryRouter>
        <LeftRail collapsed={false} onToggleCollapse={() => {}} />
      </MemoryRouter>,
    );
    for (const id of ['nav-inbox', 'nav-leads', 'nav-pipeline']) {
      expect(container.querySelector(`[data-tour="${id}"]`)).not.toBeNull();
    }
  });

  it('keeps anchors when the rail is collapsed (tooltip-wrapped links)', () => {
    const { container } = render(
      <MemoryRouter>
        <LeftRail collapsed onToggleCollapse={() => {}} />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-tour="nav-inbox"]')).not.toBeNull();
  });
});
```

(The TopBar anchor needs Theme/Auth providers to unit-render; it is asserted end-to-end in Task 9's `onboarding.spec.ts` — the "Search & commands" coachmark cannot appear without it.)

- [ ] **Step 3: Run test to verify it fails**

Run: `pnpm --filter @switchboard/web exec vitest run src/app/tourAnchors.test.tsx`
Expected: FAIL — `container.querySelector('[data-tour="nav-inbox"]')` is null.

- [ ] **Step 4: Implement the wiring**

In `apps/web/src/app/LeftRail.tsx`, inside `RailLink`, add the attribute to the `NavLink` (after `aria-label`):

```tsx
    <NavLink
      to={item.to}
      aria-label={collapsed ? item.label : undefined}
      data-tour={`nav-${item.to.slice(1)}`}
      className={({ isActive }) => cx('sb-rail__item', isActive && 'is-active')}
    >
```

In `apps/web/src/app/TopBar.tsx`, add the attribute to the search form (line ~44):

```tsx
      <form
        className="sb-topbar__search"
        role="search"
        data-tour="topbar-search"
        onSubmit={(e) => {
```

In `apps/web/src/app/AppShell.tsx`, import and mount the provider around `ShellChrome` (innermost, so it sees every context):

```tsx
import { TourProvider } from '../features/tour/index.ts';
```

and change the provider stack to:

```tsx
              <AiProvider>
                <TourProvider>
                  <ShellChrome />
                </TourProvider>
              </AiProvider>
```

- [ ] **Step 5: Run the anchor test, the shell tests, and the a11y suite**

Run: `pnpm --filter @switchboard/web exec vitest run src/app/tourAnchors.test.tsx src/app/keyboardShell.test.tsx src/app/a11y.test.tsx`
Expected: PASS — the suppression seed from Step 1 keeps the shell suites tour-free.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/test/setup.ts apps/web/src/app/LeftRail.tsx apps/web/src/app/TopBar.tsx apps/web/src/app/AppShell.tsx apps/web/src/app/tourAnchors.test.tsx
git commit -m "feat(web): mount first-run tour in the shell with data-tour anchors"
```

---

### Task 6: Replay entry on Support & FAQs

**Files:**
- Modify: `apps/web/src/pages/HelpPage.tsx`
- Test (create): `apps/web/src/pages/HelpPage.test.tsx`

**Interfaces:**
- Consumes: `useTour` from `../features/tour/index.ts` (Task 4); `Page.actions` slot (`./Page.tsx`); `Button` from `../ui/index.ts`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/pages/HelpPage.test.tsx`:

```tsx
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { HelpPage } from './HelpPage.tsx';

const openTour = vi.fn();
vi.mock('../features/tour/index.ts', () => ({
  useTour: () => ({ openTour }),
}));

describe('HelpPage', () => {
  it('offers a guided-tour replay in the page actions', async () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Replay the guided tour' }));
    expect(openTour).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/web exec vitest run src/pages/HelpPage.test.tsx`
Expected: FAIL — no button named "Replay the guided tour".

- [ ] **Step 3: Implement**

In `apps/web/src/pages/HelpPage.tsx`:

Change the ui import to include Button:

```tsx
import { Button, Kbd } from '../ui/index.ts';
```

Add below the other imports:

```tsx
import { useTour } from '../features/tour/index.ts';
```

Change the `HelpPage` function head and `Page` opening tag to:

```tsx
export function HelpPage(): JSX.Element {
  const { openTour } = useTour();
  return (
    <Page
      title="Support & FAQs"
      subtitle="How Switchboard behaves, why it sometimes says no, and where to get help."
      actions={<Button onClick={openTour}>Replay the guided tour</Button>}
    >
```

(Everything inside the Page stays unchanged.)

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @switchboard/web exec vitest run src/pages/HelpPage.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/pages/HelpPage.tsx apps/web/src/pages/HelpPage.test.tsx
git commit -m "feat(web): replay the guided tour from Support & FAQs"
```

---

### Task 7: Leads "No leads yet" → Import leads CTA

**Files:**
- Modify: `apps/web/src/features/leads/components/LeadsSurface.tsx:252-265` (the EmptyState branch)
- Test (modify): `apps/web/src/features/leads/components/LeadsSurface.test.tsx` (append one test to the `LeadsSurface — All leads` describe)

**Interfaces:**
- Consumes: existing `EmptyState.actions` slot; `Link` from `react-router-dom` (link-styled-as-button, `className="sb-btn"` — the `SequenceDetail.tsx:85` precedent).

- [ ] **Step 1: Write the failing test**

Append to the `describe('LeadsSurface — All leads', …)` block in `apps/web/src/features/leads/components/LeadsSurface.test.tsx`:

```tsx
  test('true empty state offers the import path', async () => {
    useReferenceHandlers();
    server.use(http.get(api('/leads'), () => HttpResponse.json({ items: [] })));
    renderAt('/leads');
    await screen.findByText('No leads yet');
    const cta = screen.getByRole('link', { name: 'Import leads' });
    expect(cta).toHaveAttribute('href', '/import');
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/web exec vitest run src/features/leads/components/LeadsSurface.test.tsx`
Expected: the new test FAILS (no link named "Import leads"); every existing test still passes.

- [ ] **Step 3: Implement**

In `apps/web/src/features/leads/components/LeadsSurface.tsx`:

1. Add `Link` to the existing `react-router-dom` import.
2. Replace the EmptyState's conditional actions spread (currently lines 262-264):

```tsx
              {...(q
                ? { actions: <Button onClick={() => setQuery('')}>Clear filter</Button> }
                : {})}
```

with:

```tsx
              {...(q
                ? { actions: <Button onClick={() => setQuery('')}>Clear filter</Button> }
                : viewId
                  ? {}
                  : {
                      actions: (
                        <Link className="sb-btn" to="/import">
                          Import leads
                        </Link>
                      ),
                    })}
```

(The Smart-View empty case stays action-less — an empty view is a filter result, not a new-rep state.)

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @switchboard/web exec vitest run src/features/leads/components/LeadsSurface.test.tsx`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/leads/components/LeadsSurface.tsx apps/web/src/features/leads/components/LeadsSurface.test.tsx
git commit -m "feat(web): No-leads-yet empty state routes to the CSV import wizard"
```

---

### Task 8: Sequences empty state → sequences primer CTA

**Files:**
- Modify: `apps/web/src/features/comms/components/SequencesList.tsx:102-106`
- Test (modify): `apps/web/src/features/comms/components/sequences.test.tsx` (append one test to the `SequencesList` describe)

**Interfaces:**
- Consumes: `EmptyState.actions`; `Link` from `react-router-dom`. NOTE: the web app has **no sequence-create UI** — the CTA must not advertise one (spec §3); it routes to `/help`, whose FAQ documents sequence behavior.

- [ ] **Step 1: Write the failing test**

Append inside `describe('SequencesList', …)` in `apps/web/src/features/comms/components/sequences.test.tsx`:

```tsx
  test('empty state routes to the sequences primer on /help', async () => {
    server.use(http.get(api('/sequences'), () => HttpResponse.json([])));
    renderComms(<SequencesList />, '/sequences');
    await screen.findByText('No sequences yet');
    expect(screen.getByRole('link', { name: 'How sequences work' })).toHaveAttribute(
      'href',
      '/help',
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm --filter @switchboard/web exec vitest run src/features/comms/components/sequences.test.tsx`
Expected: the new test FAILS (no link); existing tests pass.

- [ ] **Step 3: Implement**

In `apps/web/src/features/comms/components/SequencesList.tsx`:

1. Change the router import to `import { Link, useNavigate } from 'react-router-dom';`.
2. Replace the empty-state block (lines 102-106):

```tsx
      {sequences.length === 0 ? (
        <EmptyState
          title="No sequences yet"
          description="Create a sequence to start automating outreach."
        />
      ) : (
```

with:

```tsx
      {sequences.length === 0 ? (
        <EmptyState
          title="No sequences yet"
          description="Sequences automate multi-step outreach; a reply pauses everything."
          actions={
            <Link className="sb-btn" to="/help">
              How sequences work
            </Link>
          }
        />
      ) : (
```

- [ ] **Step 4: Run test to verify pass**

Run: `pnpm --filter @switchboard/web exec vitest run src/features/comms/components/sequences.test.tsx`
Expected: PASS (all tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/features/comms/components/SequencesList.tsx apps/web/src/features/comms/components/sequences.test.tsx
git commit -m "feat(web): sequences empty state routes to the /help primer"
```

---

### Task 9: E2E — guard existing specs, add `onboarding.spec.ts`

**Files:**
- Modify: `e2e/tests/auth.setup.ts` (ship suppression inside the shared storageState)
- Modify: `e2e/tests/rep-loop.spec.ts` (fresh-profile spec: suppress before first goto)
- Create: `e2e/tests/onboarding.spec.ts`

**Interfaces:**
- Consumes: `ADMIN_USER` from `e2e/tests/support/app`; the `test.use({ storageState: { cookies: [], origins: [] } })` fresh-profile pattern already used by `rep-loop.spec.ts:13`; dialog names produced by Tasks 3-5 (`Welcome to Switchboard`, `Inbox`, `Leads`, `Pipeline`, `Search & commands`, `That’s the board`) and buttons (`Start tour`, `Skip`, `Done`, `Replay the guided tour`).

- [ ] **Step 1: Guard the existing suite**

In `e2e/tests/auth.setup.ts`, add as the first line of the setup body (before `await page.goto('/welcome')`):

```ts
  // Authed specs never meet the first-run tour: the suppress key is set before
  // any page load and is captured into the shared storageState.
  await page.addInitScript(() => window.localStorage.setItem('sb-tour-suppress', '1'));
```

In `e2e/tests/rep-loop.spec.ts`, directly under the existing `test.use({ storageState: { cookies: [], origins: [] } });` line, add:

```ts
// The rep loop predates the tour; suppress it here — onboarding.spec.ts owns it.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => window.localStorage.setItem('sb-tour-suppress', '1'));
});
```

- [ ] **Step 2: Write the new spec**

Create `e2e/tests/onboarding.spec.ts`:

```ts
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN_USER } from './support/app';

/*
 * First-run onboarding: the guided tour auto-opens exactly once after a fresh
 * dev-login, advances on the keyboard (0ms — DESIGN §4), dismisses with Escape,
 * stays dismissed across reloads, and replays on demand from Support & FAQs.
 */

// Completely fresh profile — no auth, no tour flags.
test.use({ storageState: { cookies: [], origins: [] } });

async function loginFresh(page: Page): Promise<void> {
  await page.goto('/welcome');
  await page.getByRole('link', { name: 'Open Switchboard' }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button', { name: new RegExp(ADMIN_USER.name) }).click();
  await expect(page).toHaveURL(/\/inbox$/);
}

test('first run: tour auto-opens, advances by keyboard, and stays dismissed', async ({ page }) => {
  test.setTimeout(60_000);
  await loginFresh(page);

  const welcome = page.getByRole('dialog', { name: 'Welcome to Switchboard' });
  await expect(welcome).toBeVisible();
  await welcome.getByRole('button', { name: 'Start tour' }).click();

  await expect(page.getByRole('dialog', { name: 'Inbox' })).toBeVisible();
  await expect(page.getByText('Step 2 of 6')).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog', { name: 'Leads' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('dialog', { name: 'Inbox' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Inbox' })).toBeHidden();

  // Dismissal persists: a reload never re-opens the tour.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Welcome to Switchboard' })).toBeHidden();
});

test('replay: Support & FAQs relaunches the tour to completion', async ({ page }) => {
  test.setTimeout(60_000);
  await loginFresh(page);

  // Dismiss the first-run instance.
  const welcome = page.getByRole('dialog', { name: 'Welcome to Switchboard' });
  await expect(welcome).toBeVisible();
  await welcome.getByRole('button', { name: 'Skip' }).click();
  await expect(welcome).toBeHidden();

  await page.goto('/help');
  await page.getByRole('button', { name: 'Replay the guided tour' }).click();
  await expect(page.getByRole('dialog', { name: 'Welcome to Switchboard' })).toBeVisible();
  await page.getByRole('button', { name: 'Start tour' }).click();

  // Walk all four coachmarks (the rail + topbar anchors exist on /help too).
  for (const name of ['Inbox', 'Leads', 'Pipeline', 'Search & commands']) {
    await expect(page.getByRole('dialog', { name })).toBeVisible();
    await page.keyboard.press('ArrowRight');
  }
  const finish = page.getByRole('dialog', { name: /That.s the board/ });
  await expect(finish).toBeVisible();
  await finish.getByRole('button', { name: 'Done' }).click();
  await expect(finish).toBeHidden();
});
```

- [ ] **Step 3: Run the new spec to verify it fails before the app is rebuilt / passes after**

The e2e web server builds the app itself (`playwright.config.ts` builds + previews unless a preview is already up — kill any stale preview on port 4173 first).

```bash
cd e2e
pnpm install --ignore-workspace   # first time only
pnpm exec playwright test tests/onboarding.spec.ts
```

Expected: PASS (2 tests). If it fails, debug with `pnpm exec playwright test tests/onboarding.spec.ts --headed`.

- [ ] **Step 4: Run the full e2e suite (regression gate)**

```bash
cd e2e
pnpm test
```

Expected: ALL specs green — `auth.setup`, `surfaces`, `keyboard`, `compliance`, `rep-loop`, `ai-confirm`, `theme-motion`, `onboarding`.

- [ ] **Step 5: Commit**

```bash
git add e2e/tests/auth.setup.ts e2e/tests/rep-loop.spec.ts e2e/tests/onboarding.spec.ts
git commit -m "test(e2e): first-run tour spec; suppress tour in pre-existing journeys"
```

---

### Task 10: Verification, live light/dark check, docs

**Files:**
- Modify: `DECISIONS.md` (append), `STATUS.md` (update)

- [ ] **Step 1: Full gates (run each; all must be clean)**

```bash
pnpm --filter @switchboard/web typecheck
pnpm --filter @switchboard/web lint
pnpm --filter @switchboard/web test
pnpm --filter @switchboard/web build
pnpm format:check
```

Expected: zero errors. If `format:check` flags the new files, run `pnpm exec prettier --write` on exactly those files and re-run.

- [ ] **Step 2: Live browser verification (mock mode) — light + dark + reduced motion**

```bash
pnpm --filter @switchboard/web dev
```

In a real browser at the printed localhost URL:
1. Open devtools → Application → clear localStorage for the origin. Dev-login as a fixture user → the Welcome card must appear over /inbox.
2. Walk the tour end-to-end with only the keyboard (ArrowRight/ArrowLeft/Escape). Verify: coachmark ring sits on the rail item with no layout shift, step advance is instant, `g l` still navigates mid-tour, `?` still opens the cheat sheet after the tour.
3. Toggle theme (topbar) and replay from /help → verify surface/border/ring colors in **both light and dark**.
4. Devtools → Rendering → emulate `prefers-reduced-motion: reduce` → replay: no movement, panels appear instantly.
5. Empty-state CTAs: in a Blank workspace (dev-login chooser), /leads shows "Import leads" → lands on the import wizard; /sequences shows "How sequences work" → lands on /help.
6. Console: zero errors throughout.

- [ ] **Step 3: Docs**

Append to `DECISIONS.md` (next sequential D-number):

```
D-0XX — First-run guided tour is client-flagged, not contract-backed.
The self-serve tour (features/tour) stores its per-user seen flag in
localStorage (`sb-tour-v1:<userId>`; kill switch `sb-tour-suppress`) instead of
a User schema field, so CONTRACTS.md stays untouched. Trade-off: a rep switching
browsers may see the tour once more. Full decision log D-T1…D-T11 in
docs/superpowers/specs/2026-07-30-switchboard-self-serve-design.md.
```

Update `STATUS.md`: add a line noting the self-serve onboarding + guided tour shipped (tour, empty-state CTAs, onboarding e2e spec).

- [ ] **Step 4: Final commit**

```bash
git add DECISIONS.md STATUS.md
git commit -m "docs: record self-serve tour decisions and status"
```

Then follow superpowers:finishing-a-development-branch to integrate `feature/self-serve-tour`.

---

## Self-review notes (performed at plan time)

- **Spec coverage:** first-run detection (T2/T4/T5), tour overlay + a11y + motion (T3/T4), replay (T6), empty-state path reusing the import wizard (T7/T8), e2e + guard specs (T9), DoD gates + light/dark (T10). Non-goals need no tasks.
- **Type consistency:** `FloatingSide` (T1) is consumed by `TourStep.side` (T2) and `CoachmarkProps.side` (T3); `CoachmarkProps.onBack?: (() => void) | undefined` matches `AnchoredStepProps.onBack` and `TourOverlay`'s `back` binding (T4); dialog/button accessible names in T9 match the strings rendered in T3/T4/T6 (`That’s the board` uses a curly apostrophe — the Playwright matcher uses `/That.s the board/`).
- **Known judgment already recorded:** all coachmarks render `instant` (D-T7); suppression seeding lives in `src/test/setup.ts` + `auth.setup.ts` + `rep-loop.spec.ts` so no pre-existing test meets the tour.

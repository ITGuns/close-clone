# Switchboard Landing Makeover — "Signal Bloom" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Spec:** `docs/superpowers/specs/2026-07-29-switchboard-landing-makeover-design.md` (direction **B — Signal Bloom**, chosen by the human).
**Law annex:** `DESIGN.md` at repo root ("Operator Grid") — where this plan and `DESIGN.md` conflict, stop and escalate.

**Goal:** Rebuild the `/welcome` hero as a full-bleed live status wall (fixture rows, six state lamps), add a low-alpha cyan bloom behind the headline and 56/72px display steps — all inside the locked Operator Grid color budget, with one retimed 500–800ms ignition, and delete `welcome-tokens.css` once the global tokens carry the law.

**Architecture:** All token additions land in the existing two-layer `apps/web/src/styles/tokens.css` (raw values in the four per-theme LAW blocks, semantic forwards in the ALIAS layer). The landing keeps its section skeleton (WelcomeNav → Hero → AccountsBand → FeatureActs → KeyboardStrip → TrustLine → FooterCta); only `Hero.tsx`/`HeroFrame.tsx` DOM changes (tilted frame → full-bleed wall + bloom layer). Motion stays hand-rolled CSS `@starting-style` transitions gated by the existing `data-ignite` attribute from `useIgnition.ts` (untouched); every delay derives from one new `--dur-ignition` token.

**Tech Stack:** React 19 + Vite 6 + TypeScript strict, Vitest 3 (jsdom, `css: false`), @testing-library/react, axe-core, react-router-dom 6, @fontsource (self-hosted IBM Plex Sans Condensed 600/700, Inter variable, JetBrains Mono). No additions.

## Global Constraints

Spec non-goals, copied verbatim — every task's requirements implicitly include these:

- **App-surface polish** (inbox, leads, pipeline, reports, import, admin, ai, `src/pages/` utility pages) — later slices (see Roadmap).
- **Onboarding / product tour** — later slice.
- **No foreign UI stack.** No Tailwind, shadcn, Radix, GSAP, 21st.dev, or any animation library. `apps/web/package.json` dependencies stay as-is (`lucide-react` + @fontsource + react-query/react-virtual/react-router). All motion remains hand-rolled CSS keyframes/transitions.
- **No new color hues.** Chrome stays achromatic; the six `--state-*` tokens plus the one cyan (`--focus`/`--state-live`) are the entire palette (`DESIGN.md` §2, `apps/web/src/ui/README.md` best-practice #4).
- **No raster images on the landing.** `WelcomePage.test.tsx` line 163 (`expect(container.querySelectorAll('img')).toHaveLength(0)`) plus the per-section checks (lines 104, 112) are review-blocking; keep them green.
- **No pricing page** — Switchboard is an internal, single-tenant, SSO-gated product; the landing sells the tool to its own operators, not to buyers. None may be invented.
- No changes to `apps/web/src/ui/` primitive behavior or APIs; restyle via tokens and landing-scoped CSS only.
- No new fonts or weights beyond what `apps/web/src/styles/fonts.css` already self-hosts (payload discipline: only used weights, `font-display: swap`).

Signal Bloom guards (project-specific, non-negotiable):

- Full-bleed live status-wall hero built from `fixtures.ts` rows — deterministic data, no `Math.random`/`Date.now`, live DOM only.
- The headline bloom is a **low-alpha wash derived from `--state-live`** (`#56c8ff` dark / `#0b7fc4` light) — **NO new hue**; dark theme stronger, light theme near-off.
- Display face is **IBM Plex Sans Condensed 700** at the new **56px and 72px** display steps (current top is 44px); the steps are used only by the landing hero headline.
- Hand-rolled CSS motion, **transform + opacity only**; exactly **one 500–800ms ignition**, once per session; `prefers-reduced-motion: reduce` collapses it entirely (`useIgnition.test.tsx` guards replay — keep green).
- **ZERO `<img>`** anywhere on the landing.
- Palette = achromatic chrome + the six `--state-*` tokens + the one cyan. Nothing else. No hex/px literals in component CSS — tokens only.
- All token changes go into the **LAW blocks (per-theme raw values) and ALIAS layer** of `apps/web/src/styles/tokens.css`.
- Extend `WelcomePage.test.tsx`, never weaken it.

All commands run from `D:/CODE/NEW/close-clone/apps/web` (or repo root with `pnpm --filter @switchboard/web <cmd>`). Branch off `main` before Task 1 (e.g. `git switch -c feat/landing-signal-bloom`).

---

## File Structure

| File | Responsibility in this slice |
| --- | --- |
| `apps/web/src/styles/tokens.css` | +`--fs-display-xl`/`--fs-display-2xl` (type scale), +`--dur-ignition` (motion), +`--glow-hero-alpha` in all four LAW blocks, +`--glow-hero` in the ALIAS layer |
| `apps/web/src/styles/tokens.test.ts` | **New** — law test pinning the Signal Bloom token additions (file-content assertions; Vitest runs with `css: false`, so CSS is asserted as text) |
| `apps/web/src/features/welcome/welcome-tokens.css` | **Deleted** (merge-dedup — global tokens now carry identical law values) |
| `apps/web/src/features/welcome/welcome.css` | Migrated to global law token names; status wall, bloom, display steps, retimed ignition |
| `apps/web/src/features/welcome/welcomeCss.test.ts` | **New** — guards the dedup (no legacy token names, no literal delays, bloom/ignition wired to tokens) |
| `apps/web/src/features/welcome/fixtures.ts` | +`WallRow` + `WALL_ROWS` (12 deterministic rows, all six states) |
| `apps/web/src/features/welcome/fixtures.test.ts` | **New** — wall dataset invariants |
| `apps/web/src/features/welcome/HeroFrame.tsx` | Tilted frame → full-bleed status wall (still decorative, still zero `<img>`) |
| `apps/web/src/features/welcome/Hero.tsx` | +bloom layer div |
| `apps/web/src/features/welcome/copy.ts` | +`WALL` copy, hero sub rewritten to explain the lamp language |
| `apps/web/src/features/welcome/WelcomePage.tsx` | Drop the `welcome-tokens.css` import |
| `apps/web/src/features/welcome/WelcomePage.test.tsx` | Extended: wall assertions, bloom assertion, new copy assertion; zero-`<img>` assertions untouched |

Not touched: `useIgnition.ts` (the hook already gates everything; all retiming is CSS), `useReveal.ts`, `StateLamp.tsx` (markup unchanged; its CSS re-points to law names in Task 2), everything in `apps/web/src/ui/`.

---

### Task 1: Signal Bloom tokens (LAW + ALIAS additions to `tokens.css`)

**Files:**
- Create: `apps/web/src/styles/tokens.test.ts`
- Modify: `apps/web/src/styles/tokens.css` (typography block ~line 80, motion block ~line 137, the four palette blocks at lines ~187/273/317/359, ALIAS layer ~line 215)

**Interfaces:**
- Consumes: existing law tokens `--state-live`, the four theme blocks (`:root`, `@media (prefers-color-scheme: light)`, `:root[data-theme='dark']`, `:root[data-theme='light']`), the ALIAS layer in `:root`.
- Produces: `--fs-display-xl: 56px`, `--fs-display-2xl: 72px`, `--dur-ignition: 640ms`, `--glow-hero-alpha` (per-theme raw %), `--glow-hero` (alias, a radial-gradient composed from `var(--state-live)` + `var(--glow-hero-alpha)`). Tasks 4–5 read these via `var()` in `welcome.css`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/styles/tokens.test.ts`:

```ts
import { readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

/*
 * Law test for the Signal Bloom token additions. Vitest runs with `css: false`,
 * so the stylesheet is asserted as text: the tokens exist, sit in the right
 * layers, and introduce no new hue (the bloom must derive from --state-live).
 */
const css = readFileSync(new URL('./tokens.css', import.meta.url), 'utf8');

describe('tokens.css — Signal Bloom additions', () => {
  test('display scale gains the 56px and 72px steps above the 44px top', () => {
    expect(css).toContain('--fs-display-lg: 44px');
    expect(css).toContain('--fs-display-xl: 56px');
    expect(css).toContain('--fs-display-2xl: 72px');
  });

  test('--dur-ignition is one token inside the 500–800ms law window', () => {
    const m = css.match(/--dur-ignition:\s*(\d+)ms/);
    expect(m).not.toBeNull();
    const ms = Number((m as RegExpMatchArray)[1]);
    expect(ms).toBeGreaterThanOrEqual(500);
    expect(ms).toBeLessThanOrEqual(800);
  });

  test('--glow-hero-alpha is a per-theme LAW value (all four theme blocks)', () => {
    expect(css.match(/--glow-hero-alpha:/g)).toHaveLength(4);
  });

  test('--glow-hero is an ALIAS composed from the live cyan — no new hue', () => {
    expect(css.match(/--glow-hero:/g)).toHaveLength(1);
    expect(css).toMatch(/--glow-hero:[^;]*var\(--state-live\)/);
    expect(css).not.toMatch(/--glow-hero:[^;]*#/); // no hex literal in the alias
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/styles/tokens.test.ts`
Expected: FAIL — `--fs-display-xl` not found (and the three sibling tests fail too).

- [ ] **Step 3: Write minimal implementation**

Four edits to `apps/web/src/styles/tokens.css`:

(a) Typography block — after `--fs-display-lg: 44px;`:

```css
  --fs-display-lg: 44px;
  --fs-display-xl: 56px; /* landing display step (Signal Bloom) */
  --fs-display-2xl: 72px; /* landing hero headline ceiling (Signal Bloom) */
```

(b) Motion block — after `--dur-press: 130ms; /* press affordance (scale 0.97) */`:

```css
  --dur-ignition: 640ms; /* hero board ignition total — law window 500–800ms, once per session */
```

(c) LAW blocks — add one line to each of the **four** palette blocks, next to each block's `--lamp-glow` line. Dark blocks (bare `:root` and `:root[data-theme='dark']`):

```css
  --lamp-glow: 0 0 8px currentColor;
  --glow-hero-alpha: 16%; /* hero bloom strength — dark carries the wash */
```

Light blocks (`@media (prefers-color-scheme: light)` `:root` and `:root[data-theme='light']`):

```css
  --lamp-glow: none; /* light theme prints solid dots — no glow */
  --glow-hero-alpha: 4%; /* hero bloom near-off in light (mirrors the lamp-glow rule) */
```

(d) ALIAS layer — after `--selection-bg: var(--selection);` in the `:root` alias section:

```css
  /* Hero bloom (Signal Bloom): a low-alpha radial wash of the LIVE cyan behind
   * the landing headline. Derived — never a new hue; strength is per-theme LAW. */
  --glow-hero: radial-gradient(
    58% 44% at 50% 28%,
    color-mix(in srgb, var(--state-live) var(--glow-hero-alpha), transparent),
    transparent 72%
  );
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/styles/tokens.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Run the full suite to prove no regression**

Run: `pnpm test`
Expected: PASS — token additions are additive; nothing consumes them yet.

- [ ] **Step 6: Commit**

```bash
git add src/styles/tokens.css src/styles/tokens.test.ts
git commit -m "feat(web): add Signal Bloom tokens — 56/72px display steps, --dur-ignition, --glow-hero (LAW+ALIAS)"
```

---

### Task 2: Merge-dedup — retire `welcome-tokens.css`, point `welcome.css` at global law tokens

The file's own header flags this merge-dedup: it exists only because the landing shipped before the global re-skin. The global `tokens.css` now carries identical law values under the law names (`--bg`, `--panel`, `--line`, `--ink`, `--ink-dim`, `--focus`, `--lamp-glow`, `--ease-out`, `--ease-in-out`, `--font-*`), but under **`--state-reply`**-style names — `welcome.css` still reads the short names (`--reply`, `--seq`, …) plus three `--wc-*` locals. Migrate the names, keep the two layout constants locally, delete the file.

**Files:**
- Create: `apps/web/src/features/welcome/welcomeCss.test.ts`
- Modify: `apps/web/src/features/welcome/welcome.css` (token-name migration; whole file affected), `apps/web/src/features/welcome/WelcomePage.tsx:9` (drop the import)
- Delete: `apps/web/src/features/welcome/welcome-tokens.css`

**Interfaces:**
- Consumes: global law tokens from Task 1's file (`--state-reply`, `--state-overdue`, `--state-seq`, `--state-dnc`, `--state-live`, `--state-idle`, `--radius-1`, `--lamp-glow`, `--font-*`, `--ease-*`).
- Produces: `welcome.css` reads **only** global law names + two landing-local layout constants scoped on `.sb-welcome` (`--wc-maxw: 1080px`, `--wc-row-h: 36px` — layout poses, not law; deliberately NOT `var(--row-h)` so the comfortable-density override never reflows the landing). Tasks 4–5 write new CSS against these same names.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/welcome/welcomeCss.test.ts`:

```ts
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';

/*
 * Guards the welcome-tokens.css merge-dedup (spec goal 5): the landing CSS
 * reads the GLOBAL law tokens only. Legacy short names lived in the deleted
 * per-page token file; if they creep back the page silently loses theming.
 */
const css = readFileSync(new URL('./welcome.css', import.meta.url), 'utf8');

describe('welcome.css — global law tokens only (merge-dedup)', () => {
  test('welcome-tokens.css is deleted', () => {
    expect(existsSync(new URL('./welcome-tokens.css', import.meta.url))).toBe(false);
  });

  test('no legacy short state/geometry names — law names only', () => {
    const legacy = [
      'var(--reply)',
      'var(--overdue)',
      'var(--seq)',
      'var(--dnc)',
      'var(--live)',
      'var(--idle)',
      'var(--wc-r-control)',
    ];
    for (const name of legacy) {
      expect(css, `legacy token ${name} must not be referenced`).not.toContain(name);
    }
  });

  test('no 6-digit hex literals — every color resolves from a token', () => {
    // 3-digit #000 inside mask-image gradients is a mask stop, not a color choice.
    expect(css).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/welcome/welcomeCss.test.ts`
Expected: FAIL — `welcome-tokens.css` exists; `var(--reply)` etc. found in `welcome.css`.

- [ ] **Step 3: Migrate `welcome.css` (exact global replacements)**

In `apps/web/src/features/welcome/welcome.css`, apply these exact string replacements (replace-all; the class names like `.sb-welcome__seq` contain no `var(` and are untouched):

| Old (from welcome-tokens.css) | New (global law) |
| --- | --- |
| `var(--reply)` | `var(--state-reply)` |
| `var(--overdue)` | `var(--state-overdue)` |
| `var(--seq)` | `var(--state-seq)` |
| `var(--dnc)` | `var(--state-dnc)` |
| `var(--live)` | `var(--state-live)` |
| `var(--idle)` | `var(--state-idle)` |
| `var(--wc-r-control)` | `var(--radius-1)` |

Then define the two remaining `--wc-*` locals in the existing `.sb-welcome` rule (they are landing layout constants, not law), and fix the stale header comment:

```css
/*
 * The landing page — "Operator Grid". A dense, high-contrast working surface;
 * chrome is achromatic and color is spent ONLY on state (the six lamps and the
 * vignette states). All colors/fonts resolve from the GLOBAL styles/tokens.css
 * law + alias layers (the per-page welcome-tokens.css was merged and deleted).
 * The only choreography is the hero board-ignition; the three acts get a simple
 * scroll reveal; reply+live lamps carry the single ambient pulse (dark only).
 */

/* ── Shell ─────────────────────────────────────────────────────────────────── */
.sb-welcome {
  min-height: 100vh;
  background: var(--bg);
  color: var(--ink);
  font-family: var(--font-body);
  font-size: 15px;
  line-height: 1.5;
  /* Focus ring uses the law focus color inside this subtree. */
  --focus-ring: var(--focus);
  /* Landing layout constants — poses, not law. --wc-row-h is intentionally
   * FIXED (not var(--row-h)) so [data-density='comfortable'] never reflows
   * the marketing wall. */
  --wc-maxw: 1080px;
  --wc-row-h: 36px;
  -webkit-font-smoothing: antialiased;
}
```

- [ ] **Step 4: Drop the import and delete the file**

In `apps/web/src/features/welcome/WelcomePage.tsx` delete line 9:

```diff
-import './welcome-tokens.css';
 import './welcome.css';
```

Then:

```bash
git rm src/features/welcome/welcome-tokens.css
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test src/features/welcome/`
Expected: PASS — `welcomeCss.test.ts` green, and `WelcomePage.test.tsx`'s dark/light theme tests still green (both themes now resolve from global tokens: dark via bare `:root`, light via media query, `[data-theme]` overrides win both directions).

- [ ] **Step 6: Full suite + typecheck**

Run: `pnpm test && pnpm typecheck`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add -A src/features/welcome/ && git add src/features/welcome/welcomeCss.test.ts
git commit -m "refactor(web): merge-dedup welcome-tokens.css into global law tokens; delete the per-page file"
```

(Note for the verifier: DoD item 7 — the side-by-side both-theme render check for this deletion — is executed in Task 7.)

---

### Task 3: Status-wall fixtures (`WALL_ROWS` — 12 deterministic rows, all six states)

**Files:**
- Modify: `apps/web/src/features/welcome/fixtures.ts` (append after `TRIAGE_ROWS`, ~line 86)
- Create: `apps/web/src/features/welcome/fixtures.test.ts`

**Interfaces:**
- Consumes: existing `StateKey` union and `HERO_LAMPS` from `fixtures.ts`.
- Produces: `interface WallRow { id: string; company: string; person: string; line: string; state: StateKey; stateWord: string; time: string }` and `export const WALL_ROWS: readonly WallRow[]` (length 12, unique ids, covers all six states, first row is Northwind Labs). Task 4's `HeroFrame.tsx` maps over `WALL_ROWS`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/welcome/fixtures.test.ts`:

```ts
import { describe, expect, test } from 'vitest';
import { HERO_LAMPS, WALL_ROWS } from './fixtures.ts';

describe('WALL_ROWS — the hero status-wall dataset', () => {
  test('twelve deterministic rows with unique ids', () => {
    expect(WALL_ROWS).toHaveLength(12);
    expect(new Set(WALL_ROWS.map((r) => r.id)).size).toBe(12);
  });

  test('covers every one of the six law states (the wall IS the color budget)', () => {
    const states = new Set(WALL_ROWS.map((r) => r.state));
    for (const lamp of HERO_LAMPS) {
      expect(states.has(lamp.key), `wall must show a ${lamp.key} row`).toBe(true);
    }
  });

  test('every row carries the text equivalent of its lamp (color never alone)', () => {
    for (const row of WALL_ROWS) {
      expect(row.stateWord.length).toBeGreaterThan(0);
    }
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/welcome/fixtures.test.ts`
Expected: FAIL — `WALL_ROWS` is not exported.

- [ ] **Step 3: Write minimal implementation**

Append to `apps/web/src/features/welcome/fixtures.ts` (after `TRIAGE_ROWS`; same demo-dataset names — Ada Okafor, Ben Reyes, Priya Menon, Marcus Lund, Diego Santos; Northwind/Harbor/Vertex/Cedar/Copper/Nova/Bright/Granite/Quantum companies; nothing random, nothing time-derived):

```ts
export interface WallRow {
  id: string;
  company: string;
  person: string;
  line: string;
  /** Full six-state vocabulary — the wall is the page's color budget on display. */
  state: StateKey;
  stateWord: string;
  time: string;
}

/**
 * The hero status wall (Signal Bloom): twelve board rows, deterministic, all
 * six states represented. The first five mirror TRIAGE_ROWS so the narrated
 * feature-act rows and the wall tell one story.
 */
export const WALL_ROWS: readonly WallRow[] = [
  {
    id: 'northwind',
    company: 'Northwind Labs',
    person: 'Priya Menon',
    line: 'Thursday works — send the order form over.',
    state: 'reply',
    stateWord: 'Reply',
    time: '2m',
  },
  {
    id: 'harbor',
    company: 'Harbor Analytics',
    person: 'Marcus Lund',
    line: 'Follow-up call — due 20 minutes ago.',
    state: 'overdue',
    stateWord: 'Overdue',
    time: 'now',
  },
  {
    id: 'vertex',
    company: 'Vertex Robotics',
    person: 'Ada Okafor',
    line: 'Renewal outreach — step 3 of 5 sent.',
    state: 'seq',
    stateWord: 'Sequence',
    time: '18m',
  },
  {
    id: 'cedar',
    company: 'Iron Cedar Freight',
    person: 'Diego Santos',
    line: 'Looping in our CFO on the numbers.',
    state: 'reply',
    stateWord: 'Reply',
    time: '46m',
  },
  {
    id: 'copper',
    company: 'Copper Systems',
    person: 'Ben Reyes',
    line: 'No touch in 6 days.',
    state: 'idle',
    stateWord: 'Idle',
    time: '6d',
  },
  {
    id: 'nova',
    company: 'Nova Capital',
    person: 'Lena Fischer',
    line: 'On the line now — consent announced.',
    state: 'live',
    stateWord: 'Live',
    time: '00:41',
  },
  {
    id: 'bright',
    company: 'Bright Networks',
    person: 'Sam Whitfield',
    line: 'Unsubscribed — outreach locked by the engine.',
    state: 'dnc',
    stateWord: 'Do not contact',
    time: '3d',
  },
  {
    id: 'granite',
    company: 'Granite Foods',
    person: 'Rosa Delgado',
    line: 'Quote follow-up — due this morning.',
    state: 'overdue',
    stateWord: 'Overdue',
    time: '1h',
  },
  {
    id: 'quantum',
    company: 'Quantum Robotics',
    person: 'Ada Okafor',
    line: 'Intro cadence — step 1 of 4 sent.',
    state: 'seq',
    stateWord: 'Sequence',
    time: '2h',
  },
  {
    id: 'northwind-security',
    company: 'Northwind Labs',
    person: 'Ben Reyes',
    line: 'Asked for the security overview.',
    state: 'reply',
    stateWord: 'Reply',
    time: '1h',
  },
  {
    id: 'copper-renewal',
    company: 'Copper Systems',
    person: 'Priya Menon',
    line: 'Renewal outreach — step 2 of 5 sent.',
    state: 'seq',
    stateWord: 'Sequence',
    time: '4h',
  },
  {
    id: 'cedar-idle',
    company: 'Iron Cedar Freight',
    person: 'Marcus Lund',
    line: 'No touch in 9 days.',
    state: 'idle',
    stateWord: 'Idle',
    time: '9d',
  },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test src/features/welcome/fixtures.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/features/welcome/fixtures.ts src/features/welcome/fixtures.test.ts
git commit -m "feat(web): add WALL_ROWS status-wall fixtures — 12 deterministic rows, all six states"
```

---

### Task 4: Full-bleed status wall hero (`HeroFrame.tsx` → wall; extend `WelcomePage.test.tsx`)

The perspective-tilted 5-row frame becomes Signal Bloom's centerpiece: a full-bleed, flat, 12-row status wall. The wall stays **decorative** (`aria-hidden` on the wrap — the feature acts narrate the same rows for AT, and the six lamp words already render accessibly in the hero lamp rail), all live DOM, zero `<img>`. The `WALL` copy strings land in `copy.ts` here because the component consumes them.

**Files:**
- Modify: `apps/web/src/features/welcome/HeroFrame.tsx` (full rewrite of the JSX body), `apps/web/src/features/welcome/copy.ts` (append `WALL`), `apps/web/src/features/welcome/welcome.css` (replace the frame-wrap/tilt block ~lines 395–414 and the frame-wrap ignition rule ~lines 611–621; add wall rules + two dot modifiers), `apps/web/src/features/welcome/WelcomePage.test.tsx:97-105` (frame test → wall test)
- Test: `apps/web/src/features/welcome/WelcomePage.test.tsx`

**Interfaces:**
- Consumes: `WALL_ROWS`/`WallRow` (Task 3), `WORDMARK` from `copy.ts`, `BoardMark` from `./icons.tsx`, law tokens per Task 2 names.
- Produces: DOM contract for CSS/tests — `.sb-welcome__wall-wrap[aria-hidden] > .sb-welcome__wall > (.sb-welcome__wall-bar + ul.sb-welcome__wall-rows > li.sb-welcome__wall-row × 12)`; each row sets `--row-i` (0-based) for the Task 5 ignition stagger; cell classes reuse the existing `sb-welcome__frame-dot/-company/-line/-state/-time` styles. `export const WALL = { crumb: 'Live board · 12 on deck', kbd: 'J / K' } as const` in `copy.ts`.

- [ ] **Step 1: Rewrite the frame test as the wall test (failing first)**

In `apps/web/src/features/welcome/WelcomePage.test.tsx`, replace the test at lines 97–105 (`'the hero product frame is live DOM, decorative, and shows the triage rows'`) with — assertions strictly extended: same decorative + zero-img checks, row count 5 → 12, plus six-state coverage:

```tsx
  test('the hero status wall is live DOM, decorative, and shows twelve six-state rows', () => {
    const { container } = renderWelcome();
    const wall = container.querySelector('.sb-welcome__wall-wrap');
    expect(wall).not.toBeNull();
    expect(wall).toHaveAttribute('aria-hidden', 'true');
    expect(wall?.querySelectorAll('.sb-welcome__wall-row')).toHaveLength(12);
    expect(wall?.textContent).toContain('Northwind Labs');
    // The wall wears the whole color budget: all six state dots present.
    for (const state of ['reply', 'overdue', 'seq', 'dnc', 'live', 'idle']) {
      expect(wall?.querySelector(`.sb-welcome__frame-dot--${state}`)).not.toBeNull();
    }
    expect(wall?.querySelector('img')).toBeNull();
  });
```

Also update the describe title on line 70 to `'WelcomePage — hero wall + nav menu + accounts band'`.

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/welcome/WelcomePage.test.tsx`
Expected: FAIL — `.sb-welcome__wall-wrap` is null (component still renders the tilted frame).

- [ ] **Step 3: Add the WALL copy**

Append to `apps/web/src/features/welcome/copy.ts` (after `HERO_STATS`):

```ts
/** Chrome strings for the hero status wall — 12 fixture rows on deck. */
export const WALL = {
  crumb: 'Live board · 12 on deck',
  kbd: 'J / K',
} as const;
```

- [ ] **Step 4: Rewrite `HeroFrame.tsx` as the status wall**

Replace the whole component body of `apps/web/src/features/welcome/HeroFrame.tsx`:

```tsx
import type { CSSProperties, JSX } from 'react';
import { BoardMark } from './icons.tsx';
import { WALL_ROWS } from './fixtures.ts';
import { WALL, WORDMARK } from './copy.ts';

/*
 * The hero status wall (Signal Bloom): twelve live-DOM board rows, full-bleed
 * across the viewport under the headline — the six state lamps ARE the hero's
 * expressive layer. Not a screenshot: no <img>, both themes, crisp at any DPI.
 * Decorative (the feature acts narrate the same rows for AT), so the whole
 * wall is aria-hidden. --row-i drives the CSS ignition stagger only.
 */
export function HeroFrame(): JSX.Element {
  return (
    <div className="sb-welcome__wall-wrap" aria-hidden="true">
      <div className="sb-welcome__wall">
        <div className="sb-welcome__wall-bar">
          <span className="sb-welcome__frame-brand">
            <BoardMark size={13} />
            {WORDMARK}
          </span>
          <span className="sb-welcome__frame-crumb">{WALL.crumb}</span>
          <span className="sb-welcome__frame-kbd">{WALL.kbd}</span>
        </div>
        <ul className="sb-welcome__wall-rows">
          {WALL_ROWS.map((row, i) => (
            <li
              key={row.id}
              className="sb-welcome__wall-row"
              style={{ '--row-i': i } as CSSProperties}
            >
              <span className={`sb-welcome__frame-dot sb-welcome__frame-dot--${row.state}`} />
              <span className="sb-welcome__frame-company">{row.company}</span>
              <span className="sb-welcome__frame-line">
                {row.person} — {row.line}
              </span>
              <span className={`sb-welcome__frame-state sb-welcome__frame-state--${row.state}`}>
                {row.stateWord}
              </span>
              <span className="sb-welcome__frame-time">{row.time}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Restyle in `welcome.css`**

Replace the block `/* ── Hero product frame … ── */` (the `.sb-welcome__frame-wrap`, `.sb-welcome__frame-tilt`, the `@media (min-width: 861px)` perspective rules, and `.sb-welcome__frame` + `.sb-welcome__frame-bar` rules — keep every `.sb-welcome__frame-dot/-brand/-crumb/-kbd/-company/-line/-state/-time` cell rule) with:

```css
/* ── Hero status wall (Signal Bloom: full-bleed, flat, live DOM) ───────────── */
.sb-welcome__wall-wrap {
  align-self: stretch;
  margin-top: clamp(var(--space-8), 6vw, 72px);
  /* Full-bleed: escape the centered hero column to the viewport edges. */
  margin-inline: calc(50% - 50vw);
  -webkit-mask-image: linear-gradient(to bottom, #000 62%, transparent 98%);
  mask-image: linear-gradient(to bottom, #000 62%, transparent 98%);
}
.sb-welcome__wall {
  background: var(--panel);
  border-block: 1px solid var(--line);
  text-align: left;
}
.sb-welcome__wall-bar {
  display: flex;
  align-items: center;
  gap: var(--space-4);
  height: 34px;
  padding: 0 var(--space-6);
  max-width: var(--wc-maxw);
  margin: 0 auto;
  border-bottom: 1px solid var(--line);
}
.sb-welcome__wall-rows {
  margin: 0;
  padding: 0;
  list-style: none;
}
.sb-welcome__wall-row {
  display: grid;
  grid-template-columns: 9px minmax(96px, 150px) minmax(0, 1fr) auto auto;
  align-items: center;
  gap: var(--space-4);
  height: var(--wc-row-h);
  padding: 0 var(--space-6);
  max-width: var(--wc-maxw);
  margin: 0 auto;
}
.sb-welcome__wall-row + .sb-welcome__wall-row {
  border-top: 1px solid color-mix(in srgb, var(--line) 60%, transparent);
}
```

Extend the dot modifiers (next to the existing four) so the wall can wear all six states:

```css
.sb-welcome__frame-dot--dnc {
  color: var(--state-dnc);
}
.sb-welcome__frame-dot--live {
  color: var(--state-live);
  box-shadow: var(--lamp-glow);
}
```

Update the two `.sb-welcome__frame-*` responsive/ignition selectors that referenced the old wrap:
- In `@media (max-width: 560px)` replace `.sb-welcome__frame-row { grid-template-columns: … }` with `.sb-welcome__wall-row { grid-template-columns: 9px minmax(0, 1fr) auto auto; }` (the `.sb-welcome__frame-line { display: none; }` rule stays as-is — the wall reuses that cell class).
- In the ignition block replace the `.sb-welcome__frame-wrap` rule's selector with `.sb-welcome__hero[data-ignite='igniting'] .sb-welcome__wall-wrap` (timing itself is retuned in Task 5).
- In the reduced-motion block, `.sb-welcome__frame-dot--reply { box-shadow: var(--lamp-glow); }` stays (glow is static; the wall reuses the class).

- [ ] **Step 6: Run tests to verify they pass**

Run: `pnpm test src/features/welcome/`
Expected: PASS — wall test green; page-level zero-`<img>` test (line 161–164) green; axe test green (the wall is one `aria-hidden` subtree); `welcomeCss.test.ts` green (new CSS uses law names only).

- [ ] **Step 7: Full suite + typecheck + lint**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/features/welcome/HeroFrame.tsx src/features/welcome/copy.ts src/features/welcome/welcome.css src/features/welcome/WelcomePage.test.tsx
git commit -m "feat(web): hero status wall — full-bleed 12-row live-DOM board replaces the tilted frame"
```

---

### Task 5: Bloom wash, 56/72px display steps, ignition retimed on `--dur-ignition`

**Files:**
- Modify: `apps/web/src/features/welcome/Hero.tsx` (~line 21, add the bloom layer), `apps/web/src/features/welcome/welcome.css` (headline sizes; the whole `data-ignite='igniting'` block), `apps/web/src/features/welcome/welcomeCss.test.ts` (extend), `apps/web/src/features/welcome/WelcomePage.test.tsx` (extend)
- Test: both test files above

**Interfaces:**
- Consumes: `--glow-hero`, `--dur-ignition`, `--fs-display`, `--fs-display-lg`, `--fs-display-xl`, `--fs-display-2xl` (Task 1); `.sb-welcome__wall-row` + `--row-i` (Task 4); `data-ignite` from `useIgnition.ts` (unchanged — `'lit'` under reduced motion means the `@starting-style` transitions never arm, so reduced motion still collapses the entrance entirely).
- Produces: `.sb-welcome__hero-bloom` decorative div; all ignition delays as `calc(var(--dur-ignition) * fraction)`.

- [ ] **Step 1: Write the failing tests**

(a) Add to the `'WelcomePage — hero wall + nav menu + accounts band'` describe in `WelcomePage.test.tsx`:

```tsx
  test('the hero bloom wash exists and is decorative (cyan derived, CSS-owned)', () => {
    const { container } = renderWelcome();
    const bloom = container.querySelector('.sb-welcome__hero-bloom');
    expect(bloom).not.toBeNull();
    expect(bloom).toHaveAttribute('aria-hidden', 'true');
  });
```

(b) Add to `welcomeCss.test.ts`:

```ts
  test('bloom + ignition are token-driven: --glow-hero paints, --dur-ignition times', () => {
    expect(css).toContain('var(--glow-hero)');
    expect(css).toContain('var(--dur-ignition)');
    // Every choreography delay derives from the one token — no literal-first delays.
    expect(css).not.toMatch(/transition-delay:\s*\d+ms/);
  });

  test('headline reads the new display steps (56/72px used only here)', () => {
    expect(css).toMatch(/__headline[^}]*var\(--fs-display-2xl\)/);
    expect(css).toMatch(/var\(--fs-display-xl\)/);
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `pnpm test src/features/welcome/WelcomePage.test.tsx src/features/welcome/welcomeCss.test.ts`
Expected: FAIL — no `.sb-welcome__hero-bloom` in the DOM; `var(--glow-hero)` not in `welcome.css`; old literal `transition-delay: 400ms`-style values still present.

- [ ] **Step 3: Add the bloom layer to `Hero.tsx`**

In `apps/web/src/features/welcome/Hero.tsx`, directly after the grid div (line 21):

```tsx
      <div className="sb-welcome__hero-grid" aria-hidden="true" />
      <div className="sb-welcome__hero-bloom" aria-hidden="true" />
```

- [ ] **Step 4: CSS — bloom, display steps, retimed choreography**

(a) After the `.sb-welcome__hero-grid` rule in `welcome.css`:

```css
/* Signal Bloom: a low-alpha radial wash of the LIVE cyan behind the headline.
 * Painted entirely by the --glow-hero alias (strength is per-theme LAW —
 * dark carries it, light is near-off). Never a new hue. */
.sb-welcome__hero-bloom {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: var(--glow-hero);
}
```

(b) Headline — replace `font-size: clamp(34px, 6vw, 68px);` in `.sb-welcome__headline` and add the small-viewport step (both new display steps are used here and only here):

```css
.sb-welcome__headline {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(var(--fs-display-lg), 7.2vw, var(--fs-display-2xl));
  line-height: 1.02;
  letter-spacing: -0.02em;
  color: var(--ink);
  max-width: 16ch;
}
@media (max-width: 560px) {
  .sb-welcome__headline {
    font-size: clamp(var(--fs-display), 9vw, var(--fs-display-xl));
  }
}
```

(c) Replace the entire `/* ── Hero ignition (plays once; gated by data-ignite) ── */` block. Total budget check with `--dur-ignition: 640ms`: last text start 0.88×640 = 563ms + 200ms = **763ms**; last wall row 0.55×640 + 11×18 = 550ms + 200ms = **750ms** — both inside the 800ms law ceiling. Transform + opacity only.

```css
/* ── Hero ignition (plays once; gated by data-ignite; all delays derive from
 *    --dur-ignition so the 500–800ms choreography is tunable in one place) ── */
.sb-welcome__hero[data-ignite='igniting'] .sb-welcome__hero-grid {
  transition: opacity calc(var(--dur-ignition) * 0.4) var(--ease-out);
  @starting-style {
    opacity: 0;
  }
}
.sb-welcome__hero[data-ignite='igniting'] .sb-welcome__hero-bloom {
  transition: opacity calc(var(--dur-ignition) * 0.5) var(--ease-out);
  @starting-style {
    opacity: 0;
  }
}
.sb-welcome__hero[data-ignite='igniting'] .sb-welcome__lamps .sb-welcome__lamp {
  transition:
    opacity 200ms var(--ease-out),
    transform 200ms var(--ease-out);
  transition-delay: calc(var(--dur-ignition) * 0.19 + var(--lamp-i, 0) * 46ms);
  @starting-style {
    opacity: 0;
    transform: scale(0.96);
  }
}
.sb-welcome__hero[data-ignite='igniting'] .sb-welcome__headline {
  transition:
    opacity 240ms var(--ease-out),
    transform 240ms var(--ease-out);
  transition-delay: calc(var(--dur-ignition) * 0.62);
  @starting-style {
    opacity: 0;
    transform: translateY(8px);
  }
}
.sb-welcome__hero[data-ignite='igniting'] .sb-welcome__sub {
  transition:
    opacity 200ms var(--ease-out),
    transform 200ms var(--ease-out);
  transition-delay: calc(var(--dur-ignition) * 0.73);
  @starting-style {
    opacity: 0;
    transform: translateY(6px);
  }
}
.sb-welcome__hero[data-ignite='igniting'] .sb-welcome__cta-row {
  transition:
    opacity 200ms var(--ease-out),
    transform 200ms var(--ease-out);
  transition-delay: calc(var(--dur-ignition) * 0.81);
  @starting-style {
    opacity: 0;
    transform: translateY(6px);
  }
}
.sb-welcome__hero[data-ignite='igniting'] .sb-welcome__stats {
  transition: opacity 200ms var(--ease-out);
  transition-delay: calc(var(--dur-ignition) * 0.88);
  @starting-style {
    opacity: 0;
  }
}
/* The wall sweeps on row-by-row — 18ms × 12 rows still lands ≤ 800ms total. */
.sb-welcome__hero[data-ignite='igniting'] .sb-welcome__wall-wrap {
  transition: opacity calc(var(--dur-ignition) * 0.35) var(--ease-out);
  transition-delay: calc(var(--dur-ignition) * 0.5);
  @starting-style {
    opacity: 0;
  }
}
.sb-welcome__hero[data-ignite='igniting'] .sb-welcome__wall-row {
  transition:
    opacity 200ms var(--ease-out),
    transform 200ms var(--ease-out);
  transition-delay: calc(var(--dur-ignition) * 0.55 + var(--row-i, 0) * 18ms);
  @starting-style {
    opacity: 0;
    transform: translateY(6px);
  }
}
```

(Reduced motion needs no new rules here: `useIgnition` returns `'lit'` under `prefers-reduced-motion`, so `data-ignite='igniting'` never appears and none of these transitions arm. The existing `@media (prefers-reduced-motion: reduce)` block continues to suspend the ambient lamp pulse and the act reveal offsets.)

- [ ] **Step 5: Run tests to verify they pass**

Run: `pnpm test src/features/welcome/`
Expected: PASS — including the untouched ignition trio (`igniting`/replay-guard/reduced-motion) in `WelcomePage.test.tsx` and all of `useIgnition.test.tsx`.

- [ ] **Step 6: Full suite + typecheck + lint**

Run: `pnpm test && pnpm typecheck && pnpm lint`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add src/features/welcome/Hero.tsx src/features/welcome/welcome.css src/features/welcome/welcomeCss.test.ts src/features/welcome/WelcomePage.test.tsx
git commit -m "feat(web): Signal Bloom hero — cyan bloom wash, 56/72px display steps, ignition retimed on --dur-ignition"
```

---

### Task 6: Copy pass — the sub explains the lamp language (`copy.ts`)

Plain, honest register; the copy explains the lamp language instead of decorating around it. The headline (`'Pick up the line.' / 'The rest is already dialed.'`) already carries the voice and is pinned by tests — keep it. Rewrite the sub so the state words appear as themselves; keep the phrase `one keystroke away` so the existing assertion at `WelcomePage.test.tsx:120` keeps passing untouched.

**Files:**
- Modify: `apps/web/src/features/welcome/copy.ts:44-48` (`HERO.sub`)
- Test: `apps/web/src/features/welcome/WelcomePage.test.tsx` (extend the `'renders at /welcome…'` test)

**Interfaces:**
- Consumes: `HERO` shape (`headline`/`sub`/`cta`) — unchanged; `Hero.tsx` keeps rendering `{HERO.sub}`.
- Produces: new `HERO.sub` string (below). No shape changes.

- [ ] **Step 1: Extend the test (failing first)**

In the `'renders at /welcome with the headline, sub, and stat readout'` test (line 117), add after the existing `/one keystroke away/i` assertion:

```tsx
    expect(screen.getByText(/wears a state lamp/i)).toBeInTheDocument();
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/features/welcome/WelcomePage.test.tsx`
Expected: FAIL — `/wears a state lamp/i` not found.

- [ ] **Step 3: Rewrite the sub**

In `apps/web/src/features/welcome/copy.ts`, replace `HERO.sub`:

```ts
export const HERO = {
  headline: ['Pick up the line.', 'The rest is already dialed.'],
  sub: 'Every reply, task, and call lines up in one keyboard-driven queue. Each lead wears a state lamp — REPLY, OVERDUE, DNC — so the board reads at a glance and the next move is always one keystroke away.',
  cta: 'Open Switchboard',
} as const;
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm test src/features/welcome/WelcomePage.test.tsx`
Expected: PASS — both the old `/one keystroke away/i` and the new `/wears a state lamp/i` assertions green.

- [ ] **Step 5: Commit**

```bash
git add src/features/welcome/copy.ts src/features/welcome/WelcomePage.test.tsx
git commit -m "copy(web): hero sub explains the lamp language — state words as themselves"
```

---

### Task 7: Verification — full gates, real browser (both themes × both densities, mobile + desktop, reduced motion), motion audit

**Files:**
- No source changes expected. Fix-forward anything found (each fix follows its owning task's TDD loop), then re-run this task from the top.

- [ ] **Step 1: Full test suite**

Run (repo root): `pnpm --filter @switchboard/web test`
Expected: PASS — including unweakened `WelcomePage.test.tsx` (zero-`<img>` assertions intact + extended wall/bloom/copy assertions), `useIgnition.test.tsx`, `useReveal.test.tsx`, `shortcuts.test.ts`, plus the new `tokens.test.ts`, `welcomeCss.test.ts`, `fixtures.test.ts`.

- [ ] **Step 2: Typecheck + lint**

Run: `pnpm --filter @switchboard/web typecheck && pnpm --filter @switchboard/web lint`
Expected: clean — strict TS, no `any` / `@ts-ignore` / `TODO`.

- [ ] **Step 3: Build + dependency freeze check**

Run: `pnpm --filter @switchboard/web build`
Expected: `tsc --noEmit && vite build` succeeds.
Then: `git diff main -- apps/web/package.json`
Expected: **empty** — no new dependencies.

- [ ] **Step 4: Live browser — all four theme × density combinations (mock mode)**

Run: `pnpm --filter @switchboard/web dev` → open `http://localhost:5173/welcome`.

For each of dark/light (DevTools → Rendering → emulate `prefers-color-scheme`, then also force via `document.documentElement.dataset.theme = 'dark' | 'light'` to prove the manual override wins) × dense/comfortable (`document.documentElement.dataset.density = 'comfortable'` and removed):

- Hero: full-bleed wall spans the viewport edge-to-edge; 12 rows; all six dot colors present; DNC row reads its word; LIVE dot glows in dark only.
- Bloom: visible-but-quiet cyan wash behind the headline in dark; near-invisible in light. Headline text stays AA against the composited wash (spot-check with the DevTools contrast picker — the wash is ≤16% alpha over `--bg`, so `--ink`'s 15.03:1 dark / 14.27:1 light headroom holds; do not lighten light-theme state values).
- Type: headline renders IBM Plex Sans Condensed 700 at 72px on a ≥1200px viewport, 56px cap on mobile.
- No layout shift while loading; no console errors; comfortable density does NOT change wall row height (fixed 36px by design).
- Screenshot each of the four combinations for the PR.

- [ ] **Step 5: Mobile + desktop viewport check**

DevTools device toolbar: **375×812** (mobile) and **1280×800** (desktop):
- Mobile: wall rows collapse to the 4-column grid (`9px | company | state | time`, message line hidden); nav collapses to the menu toggle; headline wraps without overflow; no horizontal scrollbar (the `margin-inline: calc(50% - 50vw)` full-bleed must not leak x-overflow — if it does, add `overflow-x: clip` to `.sb-welcome__hero` which already has `overflow: hidden`).
- Desktop: one `<h1>`; sections in order Nav → Hero → AccountsBand → FeatureActs → KeyboardStrip → TrustLine → FooterCta.

- [ ] **Step 6: Ignition + reduced-motion check**

- Fresh session (DevTools → Application → Session Storage → clear, reload): ignition plays once — grid/bloom in, lamps stagger, headline sets, wall sweeps row-by-row; stopwatch ≤ 800ms; reload again → no replay (session flag).
- DevTools → Rendering → `prefers-reduced-motion: reduce`, clear session storage, reload: **no entrance at all** (hero mounts `data-ignite='lit'`), lamp pulse suspended, everything static and fully legible.

- [ ] **Step 7: welcome-tokens.css deletion — both-theme identity check (DoD 7)**

In each theme, in the console:

```js
const s = getComputedStyle(document.querySelector('.sb-welcome'));
['--state-reply', '--state-live', '--bg', '--panel', '--line', '--ink', '--lamp-glow'].map((t) => [t, s.getPropertyValue(t).trim()]);
```

Expected: exact law values from `tokens.css` (dark: `#2ee6a8`, `#56c8ff`, `#141719`, `#1b1f23`, `#30363c`, `#e8ebec`, `0 0 8px currentColor`; light: `#0e7a57`, `#0b7fc4`, `#ecedeb`, `#f7f7f5`, `#d4d6d3`, `#1b1e20`, `none`). Compare the rendered page side-by-side against the `main` branch build (`git stash` or a second checkout) — `/welcome` must render identically apart from the intended Signal Bloom changes.

- [ ] **Step 8: Motion audit table (attach to the PR)**

| Where | Before | After | Rule |
| --- | --- | --- | --- |
| Hero grid fade | 260ms fixed | `calc(--dur-ignition * 0.4)` = 256ms opacity | DESIGN.md §5 — ignition budget, opacity only |
| Hero bloom | — (new) | `calc(--dur-ignition * 0.5)` = 320ms opacity, no delay | one signature entrance; opacity only |
| Lamp stagger | `120ms + i×46ms` fixed | `calc(--dur-ignition * 0.19) + i×46ms` | transform+opacity; ≤800ms total |
| Headline / sub / CTA / stats | fixed 400/470/520/560ms delays | `--dur-ignition` × 0.62/0.73/0.81/0.88 | single token tunes the choreography |
| Frame surface → wall sweep | 220ms fade @580ms | wrap fade @0.5×, rows 200ms @0.55× + i×18ms (last lands 750ms) | ≤800ms; transform+opacity |
| Ambient lamp pulse | 2.2s opacity pulse (reply/live) | unchanged | the only ambient motion; suspended under reduced motion |
| Act scroll reveal | 300ms opacity/translate | unchanged | `useReveal` stays minimal |
| Reduced motion | entrance collapsed via `data-ignite='lit'` | unchanged mechanism, covers bloom + wall too | `prefers-reduced-motion` collapses the entrance entirely |

- [ ] **Step 9: Final commit**

```bash
git add -A
git commit -m "chore(web): Signal Bloom landing makeover — verification pass (screenshots + motion audit in PR)"
```

Then follow `superpowers:finishing-a-development-branch` to merge/PR.

---

## Self-Review Notes

- **Spec goals → tasks:** goal 1 (hero) → Tasks 3–4; goal 2 (tokens-only type/accent) → Tasks 1, 5; goal 3 (tightened ignition, 500–800ms, reduced-motion safe) → Task 5; goal 4 (copy pass) → Tasks 4 (WALL strings) + 6; goal 5 (delete `welcome-tokens.css` iff global law is identical) → Task 2 + Task 7 step 7.
- **Guard rails encoded as tests:** zero `<img>` (existing line 161–164 untouched + wall-scoped check), no new hue (`tokens.test.ts` bans hex in `--glow-hero`), tokens-only CSS (`welcomeCss.test.ts` bans 6-digit hex + legacy names), single tunable ignition (`welcomeCss.test.ts` bans literal `transition-delay`), reduced motion (`useIgnition.test.tsx` + `WelcomePage.test.tsx` ignition trio, all untouched).
- **Known intentional choices:** `--wc-row-h`/`--wc-maxw` stay landing-local layout constants (density toggle must not reflow the marketing wall); the wall remains `aria-hidden` decorative like the frame it replaces (acts narrate the same rows; lamp words render accessibly in the hero lamp rail) so no `VisuallyHidden` additions are needed; `useIgnition.ts` is untouched (spec permits timing-only changes; all timing lives in CSS).

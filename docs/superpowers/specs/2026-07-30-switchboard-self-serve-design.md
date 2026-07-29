# Switchboard — Self-Serve Onboarding + Guided Tour (Design Spec)

Date: 2026-07-30 · App: `apps/web` (`@switchboard/web`) · Status: approved (all decisions recorded below; none open)

## 1. Context

Switchboard is an **internal, single-tenant, SSO-gated** communication-first CRM (see `CLAUDE.md` §1).
Real mode authenticates through company OIDC (`apps/web/src/auth/SsoLoginPage.tsx`); mock mode uses the
dev-login fixture picker (`apps/web/src/auth/DevLoginPage.tsx`). There is **no public signup and none will
be built** — "self-serve" here means: a rep whose IT department just granted them SSO access can sign in,
orient themselves, and reach first value **unaided**.

Today there is no onboarding of any kind: `RootGate` (`apps/web/src/app/AppRoutes.tsx:78`) drops an
authenticated rep straight into `/inbox` with zero orientation, empty states are informational without
next-step actions (`LeadsSurface.tsx:253`, `SequencesList.tsx:102`), and no first-run flag exists anywhere
(the `User` type in `@switchboard/shared` has no `hasOnboarded` field).

**Note on "harbor":** this repo has **no `harbor` app and no safety-protected file list** — that concept
belongs to a different multi-app template. There are consequently no safety flows to route around. The
only governance constraint that applies is doc governance (`CLAUDE.md` §0): `CONTRACTS.md` /
`ARCHITECTURE.md` / `DESIGN.md` are orchestrator-only. This design deliberately avoids all three (see
Decision D-T1).

## 2. Goals

1. **First-run guided tour**: on a rep's first authenticated arrival in the shell, offer a short (6-step,
   ~60-second) keyboard-first tour of the operator surfaces — Inbox, Leads, Pipeline, and (via the command
   palette, see §5 step 5) Sequences — ending at the `?` cheat sheet.
2. **Dismissible and replayable**: Escape or "Skip" ends it instantly; it never auto-opens again for that
   user; it can be replayed on demand from Support & FAQs (`/help`).
3. **Empty-state "get started" path**: the true new-rep empty states on Leads and Sequences gain real
   next-step actions (import CSV; learn how sequences work) so an empty workspace leads somewhere.
4. Built **entirely from the existing kit** (`Modal`, `floating.ts`, `EmptyState`, `Button`, `KbdCombo`),
   obeying every rule in `DESIGN.md` §4 (motion law) and §6 (craft bar).

## 3. Non-goals (explicitly out of scope)

- **No public signup, no account creation, no auth changes.** `AuthProvider`, `RequireAuth`, `RootGate`,
  `SsoLoginPage`, `DevLoginPage`, and `auth/accounts.ts` are untouched. Entry remains company OIDC (real)
  / dev-login (mock).
- **No server-side / cross-device "onboarded" state.** That would require a `CONTRACTS.md` schema change
  (orchestrator-only, versioned). Decision D-T1: per-user `localStorage` flag instead; a rep switching
  browsers may see the tour once more — acceptable for an internal tool.
- **No new dependencies.** No tour library (react-joyride, driver.js, shepherd, floating-ui — all
  rejected). The repo's kit is dependency-free by design; the one net-new primitive (`Coachmark`) is
  built on the existing `ui/floating.ts`.
- **No changes to compliance rails, sequences engine, or any `apps/api` code.** This is a web-only,
  presentation-layer feature.
- **No "spotlight" scrim/mask overlay.** Decision D-T5: the active anchor gets a focus-token highlight
  ring; the page stays visible and operable (non-modal). A masked scrim adds code, blocks the operator,
  and fights the keyboard-first ethos.
- **No sequence-create CTA.** The web app has no sequence-creation UI (verified: no `createSequence` in
  `apps/web/src`), so the Sequences empty state must not advertise one. Its CTA routes to `/help`, which
  truthfully documents how sequences behave.
- **No tour steps inside route content** (e.g. pointing at a specific inbox row). Anchors are limited to
  persistent chrome (LeftRail, TopBar), so the tour works identically on every route and on a completely
  empty workspace.
- **No changes to `mocks/workspace.ts` blank/sample workspace machinery.**

## 4. Recorded decisions

| # | Decision | Rationale |
|---|----------|-----------|
| D-T1 | First-run state = `localStorage` key `sb-tour-v1:<user.id>` (value `'1'`), plus a global kill-switch key `sb-tour-suppress` | Mirrors the proven `useIgnition.ts` pattern (pure decision fn + storage flag, try/catch-safe). Avoids a `CONTRACTS.md` bump. The suppress key keeps the existing jsdom suite and Playwright storageState green without touching dozens of tests, and doubles as a demo kill-switch. |
| D-T2 | Auto-open hook point = a `TourProvider` mounted in `AppShell` (`ShellChrome`), **not** `RootGate` | The tour anchors to shell chrome that exists on every authenticated route; hooking `RootGate` would miss deep links (a rep whose first visit is `/leads/123` still deserves the tour) and would entangle auth-boot logic. `RootGate` stays untouched. |
| D-T3 | The seen-flag is burned when the tour **auto-opens** (like `useIgnition` burns on `igniting`), not on completion | A rep who dismisses instantly is never nagged again; replay stays available from `/help`. |
| D-T4 | Sequences has no rail entry (`PRIMARY_NAV` = inbox/leads/pipeline/views/reports, `apps/web/src/app/nav.tsx:42`), so the tour covers sequences honestly via step 5 (command palette: "sequences, dialer, import") rather than inventing an anchor | Copy must describe only real behavior (DESIGN §6). |
| D-T5 | Anchor highlight = CSS ring (`.sb-tour-anchor`, `box-shadow` using `var(--focus)`), no scrim, no mask | Zero layout shift, works in both themes, page stays operable. |
| D-T6 | Coachmark = **non-modal** `role="dialog"` (no `aria-modal`, no Tab trap). Focus moves into the panel on step change; Escape (document-level, capture phase, `stopPropagation` — the `Tooltip.tsx:96` pattern) ends the tour and restores focus to the pre-tour element | "Must not steal focus destructively"; capture-phase Escape means the tour closes without also closing anything beneath, and global `g <key>` chords keep working mid-tour. |
| D-T7 | Motion: the overlay animates **only on tour open** (opacity + ≤8px transform, 150–200ms `var(--ease-out)`); step→step advances are **instant** (re-keyed mount with `data-instant`) | DESIGN §4: never animate keyboard-initiated actions. Advancing is keyboard-initiated; uniform instant advance is simpler than branching on input modality. Reduced motion: `animation: none` in the existing `@media (prefers-reduced-motion: reduce)` block of `overlays.css`. |
| D-T8 | Tour keys (ArrowRight/ArrowLeft/Enter/Escape) are handled by a document capture-phase listener owned by the overlay, **not** registered in the keyboard registry | Transient chrome doesn't belong in the `?` cheat sheet; capture + `stopPropagation` for exactly these four keys prevents double-handling (e.g. the shell's hidden `escape` blur binding) while leaving `/`, `mod+k`, and `g` chords live. |
| D-T9 | `ui/floating.ts` is extended additively with `side: 'left' | 'right'` and the pure `compute` function is exported (as `computeFloatingPosition`) for unit tests | Rail anchors need `side: 'right'`. Existing top/bottom behavior and all call sites unchanged. |
| D-T10 | Replay entry = one button on `/help` (`HelpPage.tsx`) via `useTour().openTour()` | The Help page is the rail's "about the tool" home and already documents the keyboard map. A palette command was considered and dropped: feature-command wiring is more surface area than the feature warrants (YAGNI); revisit if reps ask. |
| D-T11 | Leads "No leads yet" CTA = "Import leads" → `/import` (the real CSV wizard), rendered as a `Link className="sb-btn"` (the `SequenceDetail.tsx:85` link-as-button precedent — navigation is semantically a link). Search ("No matches") and Smart-View empty cases keep their existing behavior | The import wizard is the existing, complete get-started flow — reuse it, don't duplicate it. |

## 5. The guided tour

### 5.1 First-run detection and flow

```
authenticated shell mounts (any route)
  └─ TourProvider effect: user.id present?
       decideAutoOpen(hasSeenTour(user.id), isTourSuppressed())
         ├─ false → nothing (silent)
         └─ true  → markTourSeen(user.id); open step 1
```

Storage helpers live in `apps/web/src/features/tour/tour.ts` — pure, try/catch-safe (storage failure
degrades to "never auto-open", never a throw), modeled line-for-line on
`features/welcome/useIgnition.ts`.

### 5.2 Steps (final copy — operator voice, short declaratives, numbers over adjectives)

| # | Kind | Anchor (`data-tour`) | Title | Body | Combo hint |
|---|------|----------------------|-------|------|-----------|
| 1 | modal | — | Welcome to Switchboard | Your queue, your leads, your pipeline — one keyboard. This tour takes 60 seconds. | — |
| 2 | coachmark, side right | `nav-inbox` (LeftRail) | Inbox | Everything that needs a reply, in one queue. Work it top to bottom. | `g i` |
| 3 | coachmark, side right | `nav-leads` (LeftRail) | Leads | Every account with its full timeline — calls, email, SMS, notes in one stream. | `g l` |
| 4 | coachmark, side right | `nav-pipeline` (LeftRail) | Pipeline | Deals by stage. Move them as they progress. | `g p` |
| 5 | coachmark, side bottom | `topbar-search` (TopBar) | Search & commands | Search leads here. The command palette runs everything else — sequences, dialer, import. | `mod+k` |
| 6 | modal | — | That's the board | Press ? for every live shortcut. Replay this tour from Support & FAQs. | `?` |

Steps 1 and 6 reuse the existing `Modal` primitive (focus trap, restore, Escape — all already correct).
Steps 2–5 use the new `Coachmark`. A missing anchor (defensive; both anchors render on every shell route,
collapsed rail included) skips forward to the next step rather than erroring.

### 5.3 Interaction contract

- **Keyboard**: `Enter`/`ArrowRight` = next, `ArrowLeft` = back, `Escape` = end tour. Buttons:
  `Skip` / `Back` / `Next` on coachmarks (`Finish` when a coachmark is terminal — supported by the
  primitive), `Start tour` + `Skip` on the welcome card, `Done` on the closing card. All advances are
  0ms (D-T7).
- **Pointer**: same buttons; clicking outside does **not** end the tour (the page stays operable; only
  Escape/Skip/Finish end it).
- **Focus**: panel receives focus on each step (`tabIndex={-1}` on the panel, focus in a layout effect);
  the element focused before the tour opened is restored when it ends. No Tab trap (D-T6).
- **Step indicator**: "Step 2 of 6" rendered as text inside the dialog's described content (also the
  screen-reader announcement, since focus lands on the labelled panel each step).
- **State persistence**: `sb-tour-v1:<user.id>` = `'1'` once auto-opened (D-T3). Replay never rewrites it.

### 5.4 Accessibility (must all hold; tested)

- Coachmark: `role="dialog"`, `aria-labelledby` → title, `aria-describedby` → body + step count; no
  `aria-modal` (non-modal, D-T6).
- Escape handling is capture-phase with `stopPropagation` (exact `Tooltip.tsx` pattern) so nothing
  beneath closes with it.
- Visible focus ring on the panel and all buttons via the existing `--focus` token (2px offset — craft bar).
- Anchor ring is `aria-hidden` decoration (a class on the anchor; no DOM insertion, no layout shift).
- Axe: the shell with the tour open passes the same `axe-core` check pattern used by the existing
  `a11y.test.tsx` suites.
- Reduced motion: entrance collapses to opacity-only/none via the existing
  `@media (prefers-reduced-motion: reduce)` block in `styles/overlays.css` (guarded by
  `e2e/tests/theme-motion.spec.ts`).

## 6. Empty-state get-started path

| Surface | File | Today | Change |
|---------|------|-------|--------|
| Leads (true empty, no query, no view) | `apps/web/src/features/leads/components/LeadsSurface.tsx:253` | "No leads yet", no action | add `actions`: **Import leads** — `Link className="sb-btn"` to `/import` (D-T11) |
| Sequences (empty) | `apps/web/src/features/comms/components/SequencesList.tsx:102` | "No sequences yet", no action | add `actions`: **How sequences work** — `Link className="sb-btn"` to `/help` (honest — no create UI exists) |
| Inbox `ZeroInbox` | `apps/web/src/features/inbox/components/ZeroInbox.tsx` | "You're all caught up" | **unchanged** — it is a done-state, not a new-user state; adding a CTA there would mislabel success as emptiness |
| Views / Pipeline / Reports empty states | various | informational | **unchanged** (Views already has a create action; Pipeline "No pipeline stages" is an admin condition, not a rep task) |

All changes use the existing `EmptyState.actions` slot and `Button` — no new empty-state component.

## 7. Reuse map (what is NOT being built)

| Need | Existing piece reused |
|------|----------------------|
| once-only decision + storage flag pattern | `features/welcome/useIgnition.ts` (pattern copied, not imported) |
| anchored positioning | `ui/floating.ts` `useFloatingPosition` (extended left/right, D-T9) |
| welcome/finish dialogs | `ui/Modal.tsx` (focus trap/restore, Escape, portal — as-is) |
| capture-phase Escape convention | `ui/Tooltip.tsx:90-101` pattern |
| shortcut rendering in tour copy | `keyboard/KbdCombo.tsx` (same combo strings the registry binds) |
| get-started destination | `features/import/` CSV wizard (reused whole; not duplicated) |
| empty-state CTA slot | `ui/EmptyState.tsx` `actions` prop |
| tokens/motion vars | `--surface-2 --border-1 --radius-2 --shadow-2 --z-toast --dur --ease-out --focus` (all already in `styles/overlays.css`) |
| test conventions | Vitest + Testing Library + MSW (`src/test/setup.ts`), `axe-core` a11y pattern, Playwright specs in `e2e/tests/` |

**Foreign UI stacks: none. New runtime dependencies: zero.** New files are confined to
`features/tour/`, `ui/Coachmark.tsx`, and tests.

## 8. Copy tone

Operator's economy (DESIGN §6, HelpPage voice): short declaratives, numbers over adjectives
("takes 60 seconds", "Step 2 of 6"), zero marketing froth, describe only enforced behavior. All tour
copy is in §5.2 verbatim — no lorem, no placeholders.

## 9. Constraints honored (from the readiness scan — normative)

- **Motion law (DESIGN §4)**: transform + opacity only; `var(--ease-out)`; enter ≤ 200ms; keyboard
  advance 0ms (D-T7); reduced motion = gentler-not-zero; hover effects (none added) would be gated on
  `(hover: hover) and (pointer: fine)`.
- **Perf / critical path**: `features/tour` is imported only by `AppShell` (already inside the authed
  bundle) and does no data fetching, no render-blocking work, no effect on `scripts/perf.mjs` (API p95
  gate untouched — no API calls at all).
- **Contract guard**: no `CONTRACTS.md` change (D-T1). One `DECISIONS.md` entry (append-allowed) records
  D-T1–D-T11 at implementation time.
- **Doc governance**: `DESIGN.md`/`ARCHITECTURE.md`/`CONTRACTS.md` untouched.
- **Guard specs**: `e2e/tests/keyboard.spec.ts` and `theme-motion.spec.ts` must stay green — the
  suppress-key seeding in `auth.setup.ts` (Task 9 of the plan) guarantees existing specs never meet the
  tour; D-T8 keeps every registry binding live during it.
- **Craft bar**: semantic HTML, full state coverage (first/last step, missing anchor, reduced motion,
  storage-disabled), keyboard path for everything, visible focus, lucide-style icons only, no layout
  shift (fixed-position portal + box-shadow ring), no console errors.

## 10. Definition of done (real commands)

All of the following, run from `D:/CODE/NEW/close-clone`:

1. `pnpm --filter @switchboard/web typecheck` — clean.
2. `pnpm --filter @switchboard/web lint` — clean.
3. `pnpm --filter @switchboard/web test` — all green, including the new suites
   (`floating.test.ts`, `tour.test.ts`, `Coachmark.test.tsx`, `TourProvider.test.tsx`,
   `HelpPage.test.tsx`, extended `LeadsSurface.test.tsx` + `sequences.test.tsx`).
4. `pnpm --filter @switchboard/web build` (`tsc --noEmit && vite build`) — clean.
5. `pnpm format:check` — clean.
6. E2E (standalone, mock mode): `cd e2e && pnpm install --ignore-workspace && pnpm test` — existing
   `auth.setup / surfaces / keyboard / compliance / rep-loop / ai-confirm / theme-motion` specs still
   green **plus** the new `onboarding.spec.ts` (first-run auto-open, keyboard advance, Escape persists
   across reload, replay from `/help`).
7. Live browser check (mock mode, `pnpm --filter @switchboard/web dev`): tour verified in **light and
   dark** themes, plus once under emulated `prefers-reduced-motion: reduce`.
8. `DECISIONS.md` entry appended; `STATUS.md` updated.

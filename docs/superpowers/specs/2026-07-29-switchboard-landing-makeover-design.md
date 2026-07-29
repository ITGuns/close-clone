# Switchboard landing makeover — slice 1 spec (design) — 2026-07-29

**Status:** DRAFT — awaiting human choice of visual direction (§ Directions).
**Predecessor:** `docs/superpowers/specs/2026-07-16-switchboard-frontend-design-design.md` (W5/W6, shipped).
**Normative annex:** `DESIGN.md` at repo root ("Operator Grid", locked 2026-07-16). This spec **evolves** that identity; it does not replace it. Where this spec and `DESIGN.md` conflict, stop and escalate — `DESIGN.md` is orchestrator-owned law.

---

## Context

Switchboard's front door is the unauthenticated `/welcome` route
(`apps/web/src/features/welcome/`, composed by `WelcomePage.tsx`:
WelcomeNav → Hero → AccountsBand → FeatureActs → KeyboardStrip → TrustLine → FooterCta).
The identity — "Operator Grid": achromatic graphite chrome, the entire color
budget spent on six state tokens (reply / overdue / seq / dnc / live / idle),
square 0-radius panels, 36px rows, IBM Plex Sans Condensed + Inter + JetBrains
Mono — is mature and enforced by tokens
(`apps/web/src/styles/tokens.css`), primitives (`apps/web/src/ui/`), and tests
(`WelcomePage.test.tsx` asserts **zero `<img>` elements** on the landing).

This slice is a customer-facing polish of the landing: evolved color/type
accents, a stronger hero, and a tightened motion pass — all inside the locked
color budget and motion law. App-surface polish is deferred (see Roadmap).

### Visual directions (human picks one; B is the recommended default)

|     | Name                             | Character (color / type / hero)                                                                                                                                                                                                                                                                                                                | Risk        |
| --- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------- |
| A   | **Burnished Console**            | Zero new values — same palette and faces; hero ignition re-choreographed as a staged left-to-right lamp cascade, display numerals promoted one step, deeper surface layering using existing `--panel-*` tokens only.                                                                                                                           | low         |
| B   | **Signal Bloom** _(recommended)_ | Chrome stays achromatic, but the six state tokens become the landing's expressive layer: hero becomes a full-bleed live "status wall" built from `fixtures.ts` rows, the single cyan gains a low-alpha radial wash behind the headline (derived from `--state-live`, no new hue), and IBM Plex Sans Condensed 700 gains 56/72px display steps. | medium      |
| C   | **Phosphor Shift**               | Dark-first CRT register: JetBrains Mono promoted to the hero headline, `--etch-size` grid texture surfaced in the hero, reply/live glow amplified in dark, light theme gets a brushed-metal specular treatment.                                                                                                                                | medium-high |

Why B is the default: it modernizes the hero and adds typographic scale
without introducing a single new hue — the "color is information" contract and
the AA table in `DESIGN.md` §2 survive untouched. C flirts with
"nothing is decorative" (DESIGN.md §1) and the glow budget; A is safe but may
not read as a makeover.

---

## Goals

1. A hero that sells the product in one screen: live DOM, state-lamp-driven,
   recognizably "Operator Grid" but larger, bolder, and more confident.
2. Evolved display type scale and accent treatment (per chosen direction),
   expressed **only** as token additions/edits in
   `apps/web/src/styles/tokens.css` — components keep reading aliases.
3. One tightened signature entrance (the board ignition,
   `useIgnition.ts`), still 500–800ms, once per session, reduced-motion safe.
4. Copy pass on `apps/web/src/features/welcome/copy.ts` in the plain, honest
   register (see Copy tone).
5. Delete `apps/web/src/features/welcome/welcome-tokens.css` if and only if
   the global `tokens.css` now carries identical law values (the file's own
   header flags this merge-dedup; verify in both themes before removing).

## Non-goals

- **App-surface polish** (inbox, leads, pipeline, reports, import, admin,
  ai, `src/pages/` utility pages) — later slices (see Roadmap).
- **Onboarding / product tour** — later slice.
- **No foreign UI stack.** No Tailwind, shadcn, Radix, GSAP, 21st.dev, or any
  animation library. `apps/web/package.json` dependencies stay as-is
  (`lucide-react` + @fontsource + react-query/react-virtual/react-router).
  All motion remains hand-rolled CSS keyframes/transitions.
- **No new color hues.** Chrome stays achromatic; the six `--state-*` tokens
  plus the one cyan (`--focus`/`--state-live`) are the entire palette
  (`DESIGN.md` §2, `apps/web/src/ui/README.md` best-practice #4).
- **No raster images on the landing.** `WelcomePage.test.tsx` line 163
  (`expect(container.querySelectorAll('img')).toHaveLength(0)`) plus the
  per-section checks (lines 104, 112) are review-blocking; keep them green.
- **No pricing page** (see Pricing).
- No changes to `apps/web/src/ui/` primitive behavior or APIs; restyle via
  tokens and landing-scoped CSS only.
- No new fonts or weights beyond what `apps/web/src/styles/fonts.css` already
  self-hosts (payload discipline: only used weights, `font-display: swap`).

## Design tokens (evolved — added to the existing file, not a new file)

All additions land in `apps/web/src/styles/tokens.css`, respecting its
two-layer architecture: raw values in the per-theme **LAW** blocks, semantic
forwards in the theme-independent **ALIAS** layer. No hex/px literals in
component CSS.

Additions (final values set during implementation, per chosen direction):

- **Display scale extension:** add 56px (and, direction B only, 72px) steps to
  the type scale (current top is 44px), used exclusively by the landing hero
  headline in `--font-display` (IBM Plex Sans Condensed 700).
- **`--glow-hero`** (alias layer): low-alpha radial wash derived from the
  law's live cyan — `#56c8ff` in dark, `#0b7fc4` in light — dark theme
  stronger, light theme near-off, mirroring the existing lamp-glow rule
  ("8px glow reserved for reply/live lamps, dark only").
- **`--dur-ignition`** (motion): single token for the hero entrance total
  (500–800ms per `DESIGN.md` §5), so the choreography is tunable in one place.
- Direction C only: an `--etch-hero` opacity token gating the `--etch-size`
  (44px) grid texture in the hero.

Existing tokens are the vocabulary for everything else: surfaces
(`--bg #141719`, `--panel`, `--panel-raised`, `--line`), ink
(`--ink`/`--ink-mid`/`--ink-dim`), states (`--state-reply #2ee6a8`,
`--state-overdue #ffb224`, `--state-seq #b18cff`, `--state-dnc #ff4f66`,
`--state-live #56c8ff`, `--state-idle #4a5258` + `--state-*-bg` washes),
radius law (`--radius-1: 2px` controls, 0 panels, `--radius-pill` lamps only),
spacing `--space-1..10`, easings `--ease-out`/`--ease-in-out`, durations
`--dur-fast/--dur/--dur-press/--lamp-pulse-dur`.

Theming mechanics unchanged: dark is bare `:root`, light via
`@media (prefers-color-scheme: light)`, manual `[data-theme='dark'|'light']`
wins in both directions; `[data-density='comfortable']` untouched.

## Component kit (reuse and restyle — nothing new unless listed)

Reuse from `apps/web/src/ui/` (class convention `sb-*`, BEM-ish, state on
ARIA/`data-*` attributes, tokens-only CSS):

- **Hero/status wall:** `ListRow`, `Lamp`/`LampRail`, `StatusPill`,
  `StateLegend`, `BoardMark` — composed from `features/welcome/fixtures.ts`
  demo data (extend fixtures if the wall needs more rows; keep deterministic,
  no `Math.random`/`Date.now`).
- **CTAs:** `Button` (`.sb-btn`, `--primary`/`--ghost` modifiers) in
  WelcomeNav/Hero/FooterCta.
- **Keyboard strip:** `Kbd` (already themed via the welcome scope).
- **Icons:** only via `apps/web/src/ui/icons.tsx` (lucide wrapper, stroke 1.5,
  decorative-by-default).
- **A11y helpers:** `VisuallyHidden` where the status wall needs text
  equivalents for lamp colors.

Landing-owned styling stays in `apps/web/src/features/welcome/welcome.css`
(the feature owns its layout CSS); any rule that would be useful app-wide gets
promoted to `ui/primitives.css` in a later slice, not this one.

Files expected to change in slice 1:
`styles/tokens.css`, `features/welcome/welcome.css`, `Hero.tsx`,
`HeroFrame.tsx`, `StateLamp.tsx`, `copy.ts`, `fixtures.ts`,
`useIgnition.ts` (timing only), `WelcomePage.test.tsx` (extend, never weaken),
and deletion of `welcome-tokens.css` if the dedup check passes.

## Landing structure

Section order is preserved (it already follows the front-door formula,
`DESIGN.md` §7); the makeover changes weight, not skeleton:

1. **WelcomeNav** — unchanged structure; CTA is "Sign in" (SSO), no signup.
2. **Hero** (`Hero.tsx` + `HeroFrame.tsx`) — the makeover's center of gravity
   per chosen direction. One h1. The perspective-tilted live product frame
   stays live DOM; direction B replaces/augments it with the status wall.
3. **AccountsBand** — typographic wordmarks only (no logos, no `<img>`).
4. **FeatureActs** — three live-component acts; restyle only.
5. **KeyboardStrip** — keyboard map as design object; restyle only.
6. **TrustLine** — compliance line (consent / quiet hours / DNC rails);
   keep — it is the product's honest differentiator.
7. **FooterCta** — mirror of hero CTA.

Entrance: exactly one signature moment — the board ignition
(`useIgnition.ts`, once per session), 500–800ms, transform/opacity only, no
scroll-fade-on-every-section (`useReveal.ts` stays minimal). Keyboard-initiated
actions never animate. Exits ≈ 75% of enter. `prefers-reduced-motion: reduce`
collapses the entrance entirely (existing test `useIgnition.test.tsx` guards
replay; keep it green).

## Pricing

**There is no pricing page and none may be invented.** Switchboard is an
internal, single-tenant, SSO-gated CRM (repo `CLAUDE.md` §1 — "Scope
discipline… No multi-tenancy… or marketing features"). The landing sells the
tool to its own operators, not to buyers. The only commercial-adjacent surface
is TrustLine (compliance posture), which stays factual.

## Copy tone

All copy lives in `apps/web/src/features/welcome/copy.ts` — no strings in
components. Register: plain, honest, explain-like-I'm-5.

- Say what the thing does in words an operator uses: "See every call, email,
  and text on one timeline." Not "omnichannel engagement platform."
- No invented metrics, no fake customer quotes, no urgency theater.
- State words (REPLY / OVERDUE / DNC) appear as themselves — uppercase,
  wide-tracked (`--tracking-label`), in their state color. The copy explains
  the lamp language instead of decorating around it.
- Compliance copy is literal: quiet hours, do-not-call, consent — named as
  rails the system enforces, because it does
  (`apps/api/src/services/sequences/dispatch.ts`).

## Accessibility

- **AA contrast** on both themes for every new/edited pair; the light-theme
  state values (`#0e7a57`, `#8f5b00`, `#5a3ea6`, `#b01e33`, `#0b7fc4`) were
  darkened for AA — do not lighten them. Any new alpha wash must keep the text
  above it at AA against the _composited_ result.
- **One `<h1>`** on the page (the hero headline); sections use `<h2>`.
- **Reduced motion:** all new motion sits behind
  `prefers-reduced-motion: reduce` blocks like the existing ones in
  `welcome.css` / `primitives.css` / `overlays.css`; the lamp pulse
  (`--lamp-pulse-dur 2.2s`) remains the only ambient motion and remains
  suspended under reduced motion.
- **Color never alone:** every lamp/state signal keeps a text or
  `VisuallyHidden` equivalent.
- **axe smoke** green in both themes (axe-core is already a devDependency).
- Focus ring stays 2px/2px offset cyan on all interactive elements.

## Definition of done

Run from `apps/web` (or root with `pnpm --filter @switchboard/web <cmd>`):

1. `pnpm test` — full Vitest suite green, including unweakened
   `WelcomePage.test.tsx` (zero-`<img>` assertions intact, extended for any
   new hero DOM), `useIgnition.test.tsx`, `useReveal.test.tsx`,
   `shortcuts.test.ts`.
2. `pnpm typecheck` and `pnpm lint` — clean (strict TS: no `any` /
   `@ts-ignore` / `TODO`).
3. `pnpm build` — `tsc --noEmit && vite build` succeeds; no new dependencies
   in `apps/web/package.json`.
4. Visual verification in a real browser (mock mode) across **all four
   combinations**: dark/light × dense/comfortable — screenshots attached to
   the PR. Green unit tests alone have hidden real breakage before
   (`DECISIONS.md` D-029).
5. Motion audit table (`| Where | Before | After | Rule |`) covering every
   transition touched, per `DESIGN.md` §4/§5.
6. No console errors, no layout shift (`DESIGN.md` §6 craft bar).
7. If `welcome-tokens.css` is deleted: side-by-side both-theme check that
   `/welcome` renders identically from global tokens.

## Roadmap (later slices)

- **Slice 2 — utility-page coherence:** `apps/web/src/pages/NotFoundPage.tsx`,
  `HelpPage.tsx`, `ViewsPage.tsx` brought up to Operator Grid character.
- **Slice 3 — reports palette:** a chart treatment that works inside the
  state-only color budget (`features/reports/`); audit for off-system colors.
- **Slice 4 — long-form surfaces:** `features/import/` wizard and
  `features/admin/settings/` sections — empty/loading/error coverage to
  primitive-layer standard.
- **Slice 5 — ai assist maturity pass** (`features/ai/`) against the motion
  and craft bar.
- **Slice 6 — feature-CSS coherence audit:** sweep feature-owned layout CSS
  for off-token spacing/colors; promote shared patterns into
  `ui/primitives.css`.
- **Slice 7 — onboarding/tour** (explicitly deferred from slice 1).

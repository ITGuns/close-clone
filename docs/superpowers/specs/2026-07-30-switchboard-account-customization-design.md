# Switchboard — Account-Customization Parity Upgrade (Design Spec)

Date: 2026-07-30 · App: `@switchboard/web` (`apps/web`) · Repo: `D:/CODE/NEW/close-clone`
Status: approved-by-default (decisions delegated; every choice is recorded below — no open questions).
Companion plan: `docs/superpowers/plans/2026-07-30-switchboard-account-customization.md`

## 1. Context

Switchboard is an internal, single-tenant, SSO-gated, communication-first CRM (React 19 +
react-router 6 + TanStack Query 5, Vite, MSW mock layer; design system "Operator Grid",
dense and achromatic). The single `/settings` route (`src/app/AppRoutes.tsx`) hosts an
admin/org console addressed by `?section=` (`src/features/admin/settings/AdminSettingsPage.tsx`
+ `SettingsNav.tsx`), with five sections: users (read-only), custom-fields, templates,
compliance, about.

The audit (2026-07-30) found **almost no personal account-customization surface**: the only
per-user preference in the product is the theme toggle (`src/theme/theme.ts`,
`src/app/ThemeToggle.tsx`, localStorage `sb-theme`). There is no profile editor, no
notification preferences, no timezone UI (despite `User.timezone` existing in
`packages/shared/src/domain.ts` line 125–136), no data export, and the user menu
(`src/app/TopBar.tsx` → `UserMenu`) offers only Sign out.

## 2. Common baseline vs. Switchboard

The portfolio-wide baseline every app should offer (adapted per product): editable profile
(display name + avatar), preferences (theme, notification toggles + quiet hours where
relevant, timezone/locale), account actions (sign-out, connected Google account, export my
data, delete account), and — multi-user apps — workspace name + member/role management.

| Baseline item | Switchboard today | Verdict |
|---|---|---|
| Editable display name | None — name shown read-only in `UserMenu` | **Gap** |
| Avatar | Generated initials only (`initials()` in `src/lib/format.ts`, `.sb-avatar`); no upload | **Has (by design)** — initials are the Operator Grid avatar; no image upload will be added (D-A3) |
| Theme preference | Full: light/dark/system, persisted, anti-flash (`src/theme/*`) — but only a cycling icon button, no labeled control in settings | **Has** (surface gap: no settings control) |
| Notification toggles + quiet hours | None per-user. Org quiet hours exist only as a read-only compliance rail (`ComplianceSection.tsx`) | **Gap** |
| Timezone | In the data model (`User.timezone`), zero UI | **Gap** |
| Locale | None | **Non-goal** — repo law: internal, US/Canada, English, "no i18n" (`CLAUDE.md` §4) |
| Sign-out | Yes — `UserMenu` → `useAuth().logout()`, kills server session in real mode | **Has** |
| Connected Google account | N/A — real mode is company-OIDC SSO only (`SsoLoginPage.tsx`); no per-provider linking | **Non-goal** (SSO identity shown read-only instead, D-A5) |
| Export my data | None | **Gap** (closed minimally, D-A6) |
| Delete account | None; SSO copy references admin-side deactivation | **Non-goal** — IdP/admin owns lifecycle (D-A7); we ship the pointer copy |
| Workspace name | None (product brand fixed in top bar) | **Non-goal** — single-tenant internal tool (D-A8) |
| Member/role management | Read-only `UsersSection.tsx`; roles from directory groups | **Has (read-only, by design)** — write mgmt stays in the IdP (D-A8) |

## 3. Goals

1. A personal **Profile** section on the existing `/settings` surface: editable display
   name + timezone, initials-avatar preview, read-only sign-in/identity block (email, SSO,
   role, directory subject), and "Download my data" (JSON export of profile + preferences).
2. A personal **Preferences** section: a labeled theme control (light/dark/match-system
   radios) and per-user notification preferences (desktop notifications, daily email
   digest, personal notification quiet hours with start/end times).
3. Server-backed persistence for profile + notification prefs via the existing mock/real
   API pattern (`apiRequest`, MSW handlers, TanStack Query), with the contract recorded
   additively in `CONTRACTS.md`.
4. Reachability: settings defaults to Profile (personal-first) and the user menu gains an
   "Account settings" link.

## 4. Non-goals

- **Password management, 2FA, sessions list, account creation/deletion, email change** —
  real mode is internal SSO only; identity lifecycle lives in the company IdP. The UI says
  so explicitly instead of offering controls. (Baseline "connected Google account" is
  likewise out: the only sign-in is company OIDC; the identity block shows it read-only.)
- **Harbor concerns** — harbor is a different app (`D:/CODE/harbor`); its safety/duress/
  consent surfaces are explicitly OUT of this spec and must not leak in as requirements.
- **Locale / i18n** — repo scope law (English-only, internal).
- **Workspace rename, member invite/remove, role editing** — single-tenant; directory-managed.
- **Any change to compliance rails** — recording stays locked (I-REC), honor-unsubscribe and
  outbound SMS quiet hours stay always-on (I-QUIET), only the daily send cap remains
  editable. Personal notification quiet hours are a *different thing* and the copy must say
  so (see §8).
- **Real-API (Fastify) implementation** — this iteration ships the web surface + MSW mock
  parity + the contract entry. The `apps/api` routes are a recorded follow-up (D-A10).
- **Avatar image upload** (D-A3).

## 5. Decisions (delegated; recorded)

- **D-A1 — Reuse the `/settings` `?section=` surface.** Two new sections, `profile` and
  `preferences`, inserted at the top of `SETTINGS_SECTIONS` in
  `src/features/admin/settings/SettingsNav.tsx`. No new routes, no new shell.
- **D-A2 — `DEFAULT_SECTION` changes `'users'` → `'profile'`** (personal-first landing).
  Safe: every existing test and e2e reference addresses sections explicitly
  (`e2e/tests/surfaces.spec.ts` uses `?section=compliance`).
- **D-A3 — Avatars stay generated initials.** No image upload/storage. The Profile section
  shows a live `.sb-avatar` preview that updates as the name is edited, with copy stating
  the rule.
- **D-A4 — Editable identity = display name + timezone only.** Email/role/idpSubject are
  IdP-owned and rendered read-only. Name limit 1–80 chars, trimmed. Timezone options come
  from `Intl.supportedValuesOf('timeZone')` with a small curated fallback.
- **D-A5 — Sign-in block is read-only:** "Company single sign-on (SSO)", email, role chip
  (achromatic, as in `UsersSection`), directory subject in mono. Copy points password/2FA
  and deactivation at the IdP/admin.
- **D-A6 — "Download my data" is a client-side JSON export** (`switchboard-my-data.json`:
  `{exportedAt, profile, preferences}`) assembled from the signed-in user + the prefs
  endpoint. No server export job for personal data in this iteration (org export tooling
  already exists elsewhere in the contract).
- **D-A7 — No delete-account control.** Deactivation is IdP/admin-side; the Profile copy
  says "contact an admin".
- **D-A8 — No workspace rename or member/role write UI.** `UsersSection` stays read-only.
- **D-A9 — Persistence split.**
  - *Server (mock parity now, real later):* profile (`PATCH /users/me` — `{name?, timezone?}`)
    and notification prefs (`GET`/`PATCH /users/me/preferences`). Mock store lives in
    `adminStore` (in-memory, reset-able), handlers in `adminHandlers.ts`; "me" resolves via
    the mock auth blob (`readStoredUser()`, `src/auth/auth.ts`) exactly as the rest of mock
    identity does. Real mode will use the session cookie (server resolves the actor).
  - *Device-local:* theme stays in localStorage `sb-theme` (a browser-rendering concern;
    per-device is correct and keeps the anti-flash bootstrap in `index.html` working).
- **D-A10 — Contract handling.** Additive `CONTRACTS.md` entry (version bump + DECISIONS.md
  entry, per repo law: orchestrator-gated) declaring `PATCH /users/me` and
  `GET|PATCH /users/me/preferences` under the C7 resource list, marked "web+MSW now; real
  route at next api iteration". Preference types stay web-local
  (`src/features/admin/types.ts`) until the real route lands, then promote to
  `@switchboard/shared` zod schemas.
- **D-A11 — Notification prefs shape** (server-persisted, per-user):
  `{ desktopNotifications: boolean; emailDigest: boolean; quietHours: { enabled: boolean; start: 'HH:MM'; end: 'HH:MM' }; updatedAt }`.
  Seed: desktop on, digest off, quiet hours off 20:00–08:00. Switches apply immediately
  (the `Switch` primitive's documented semantics), with rollback-free server write +
  error toast on failure.
- **D-A12 — Theme control in Preferences is a native radio group** (fieldset + three
  radios: Light / Dark / Match system) wired to `useTheme().setChoice`. The top-bar cycling
  `ThemeToggle` stays as the quick control; the settings radios are the labeled,
  discoverable one. Hint copy: "Applies to this browser on this device."

## 6. Surface design & reuse map (do not duplicate)

New files (all under the existing settings feature — no new feature root):

| File | Responsibility |
|---|---|
| `apps/web/src/features/admin/settings/sections/ProfileSection.tsx` | Profile form (name, timezone), avatar preview, identity block, data export |
| `apps/web/src/features/admin/settings/sections/PreferencesSection.tsx` | Theme radios + notification prefs |
| `apps/web/src/features/admin/mocks/accountHandlers.test.ts` | Handler-level TDD for the new endpoints |
| section tests colocated as `ProfileSection.test.tsx` / `PreferencesSection.test.tsx` | |

Modified: `SettingsNav.tsx` (sections + default), `AdminSettingsPage.tsx` (render cases),
`features/admin/icons.tsx` (ProfileIcon = lucide `CircleUserRound`, PreferencesIcon =
`Settings2`, stroke 1.5 via existing `toIcon`), `features/admin/types.ts`,
`features/admin/api.ts`, `features/admin/queryKeys.ts`, `features/admin/mocks/adminStore.ts`,
`features/admin/mocks/adminHandlers.ts`, `features/admin/admin.css` (small additive block),
`src/app/TopBar.tsx` (UserMenu "Account settings" link), plus test updates
(`AdminSettingsPage.test.tsx`, `a11y.test.tsx`).

Reused primitives (`src/ui/index.ts`): `Field` (label/hint/error wiring), `Input`
(incl. `type="time"`), `Select` (native), `Switch` (role=switch, immediate-effect),
`Button` (`variant="primary"`, `loading`), `Skeleton`, `ErrorState`, toasts via
`src/feedback/ToastProvider.tsx`. State via TanStack Query with keys in `queryKeys.ts`
(`['account','preferences']`). Auth propagation after a profile save reuses
`useAuth().login(updatedUser)` — it re-persists the mock blob and re-renders the top bar
without new plumbing.

## 7. Accessibility

- Every field through `Field` (htmlFor/aria-describedby/aria-invalid; errors are
  `role=alert`). Sections keep the `aria-labelledby` + `h1` pattern of existing sections.
- Theme radios are native inputs in a `fieldset`/`legend` (keyboard + SR group semantics
  for free). Notification switches use the real `Switch` primitive (`role=switch`,
  `aria-checked`) — unlike Compliance, these are genuinely interactive, so live controls
  (not decorative glyphs) are correct here; state is also always visible as text labels.
- Achromatic chrome throughout; **no new colors** — state-is-the-color-budget law holds
  (role chip stays colorless; no colored "on" states).
- New sections join the axe smoke in `features/admin/a11y.test.tsx` (zero serious/critical,
  light + dark).

## 8. Copy tone

Operator Grid register: terse, factual, no exclamation marks, every claim true.
Canonical strings (tests assert these):

- Profile desc: "How you appear across Switchboard. Email, role, and sign-in are managed in the company identity provider."
- Avatar note: "Avatars are your initials — they update with your display name. There is no image upload."
- Identity footer: "Password and two-factor settings live in the identity provider, not here. To change your email or deactivate this account, contact an admin."
- Preferences desc: "Personal settings. They follow you, not the workspace."
- Theme hint: "Applies to this browser on this device."
- Notifications desc (the rail firewall — REQUIRED): "Your own notifications only. Outbound quiet hours for calls, email, and SMS are a compliance rail enforced by the engine — see Compliance."
- Toasts: "Profile saved" / "Couldn’t save that preference."

Never imply compliance rails are user-flippable; never use the word "quiet hours" for the
personal setting without the "Notification" qualifier.

## 9. Definition of done

All run from `apps/web` (pnpm 10, Node ≥ 24) unless noted:

1. `pnpm test` — green, including new `accountHandlers.test.ts`, `ProfileSection.test.tsx`,
   `PreferencesSection.test.tsx`, updated `AdminSettingsPage.test.tsx` + `a11y.test.tsx`.
2. `pnpm typecheck` and `pnpm lint` — clean (strict TS; no `any`/`@ts-ignore`/`TODO`).
3. `pnpm build` — passes (`tsc --noEmit && vite build`).
4. Repo root `pnpm -r test` unaffected elsewhere; e2e (`e2e/`) untouched and still passing
   if run (`?section=` deep links preserved).
5. Manual browser check in mock mode (`pnpm dev`): edit name → top-bar chip updates and
   survives route changes; flip a notification switch → survives route change (in-memory
   demo store: not a reload, per the existing demo-functional rule); theme radios stamp
   `data-theme` instantly with no flash on reload.
6. `CONTRACTS.md` bumped additively + `DECISIONS.md` entry appended (orchestrator-gated),
   `STATUS.md` updated.

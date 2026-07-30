# Switchboard Account-Customization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add personal Profile (display name, timezone, identity, data export) and Preferences (theme radios, notification toggles + personal quiet hours) sections to the existing `/settings` surface, server-persisted through the existing mock-API pattern.

**Architecture:** Two new sections slot into the existing `?section=` sub-rail (`features/admin/settings/`). Data flows through the existing layers only: `apiRequest` → new `PATCH /users/me` + `GET|PATCH /users/me/preferences` MSW handlers backed by `adminStore`; profile saves propagate via `useAuth().login(updated)`; theme stays device-local (`sb-theme`). No new routes, features, or state stores.

**Tech Stack:** React 19, react-router-dom 6, TanStack Query 5, MSW 2, Vitest + Testing Library + axe-core, strict TypeScript, `src/ui` primitives ("Operator Grid").

**Spec:** `docs/superpowers/specs/2026-07-30-switchboard-account-customization-design.md` (decisions D-A1…D-A12 live there).

## Global Constraints

- Working dir for all web commands: `D:/CODE/NEW/close-clone/apps/web`. Commands: `pnpm test` (vitest run), `pnpm typecheck`, `pnpm lint`, `pnpm build`. Repo root uses pnpm 10 / Node ≥ 24.
- Run a single test file with: `pnpm vitest run <path>` (from `apps/web`).
- Strict TS: no `any`, no `@ts-ignore`, no `TODO` in committed code.
- Achromatic chrome only; no new colors (state-is-the-color-budget law, `DESIGN.md`).
- Compliance rails untouched: never make recording/unsubscribe/outbound-quiet-hours look user-flippable. The personal setting is always called "Notification quiet hours".
- Canonical copy strings are in spec §8 — use them verbatim; tests assert them.
- `CONTRACTS.md`/`DECISIONS.md` edits are additive + versioned and orchestrator-gated (Task 1 only).
- Every commit message ends with:
  `Co-Authored-By: Claude <noreply@anthropic.com>`

---

### Task 1: Contract + decision record (docs only, orchestrator-gated)

**Files:**

- Modify: `D:/CODE/NEW/close-clone/CONTRACTS.md` (version line + one additive bullet)
- Modify: `D:/CODE/NEW/close-clone/DECISIONS.md` (append one entry)

**Interfaces:**

- Consumes: current CONTRACTS version `1.3.6` (line 3).
- Produces: contract authority for the endpoints Tasks 2–4 implement: `PATCH /users/me`, `GET /users/me/preferences`, `PATCH /users/me/preferences`.

- [ ] **Step 1: Confirm current version and next decision number**

Run (repo root):

```bash
grep -n "^Version:" D:/CODE/NEW/close-clone/CONTRACTS.md
grep -o "D-0[0-9][0-9]" D:/CODE/NEW/close-clone/DECISIONS.md D:/CODE/NEW/close-clone/CONTRACTS.md | grep -o "D-0[0-9][0-9]" | sort -u | tail -1
```

Expected: `Version: 1.3.6.` and the highest existing D-number (D-061 or later). Use version `1.3.7` (or current+1 if it moved) and the next free D-number below; `D-062` is used as the placeholder name in this plan — substitute the real next number consistently.

- [ ] **Step 2: Edit CONTRACTS.md additively**

Change line 3's `Version: 1.3.6.` to `Version: 1.3.7.` (keep the rest of the line). Then, in the C7 resource list paragraph (the one beginning `Resources (CRUD unless noted):` — currently line 173), append this sentence at the end of the paragraph:

```
· **self-service account reads/writes (added v1.3.7/D-062):** `PATCH /users/me` {name? (1–80 chars, trimmed), timezone? (IANA id)} → the updated C1 User (actor = session user; email/role/idpSubject are IdP-owned and not patchable), and `GET|PATCH /users/me/preferences` → `{desktopNotifications: boolean, emailDigest: boolean, quietHours: {enabled: boolean, start: "HH:MM", end: "HH:MM"}, updatedAt}` (per-user notification preferences — NOT the I-QUIET compliance rail, which is untouched and engine-enforced). Served by the web MSW layer now; the production Fastify route lands at the next api iteration and must resolve the actor from the session, never from the body.
```

- [ ] **Step 3: Append the DECISIONS.md entry**

Append, matching the file's existing `- **D-0NN …:**` bullet format:

```
- **D-062 (account-customization parity — self-service profile + notification preferences, v1.3.7):** The web app gains personal Profile and Preferences sections on the existing `/settings?section=` surface (spec: docs/superpowers/specs/2026-07-30-switchboard-account-customization-design.md). Additive C7 endpoints `PATCH /users/me` and `GET|PATCH /users/me/preferences` are declared now and implemented in the MSW mock layer (adminStore/adminHandlers); the production route is deferred to the next api iteration and must derive the actor from the session. Scope guards recorded in the spec: no password/2FA/delete-account UI (internal SSO — IdP owns identity lifecycle), no locale (English-only scope law), no workspace rename or member/role writes (single-tenant, directory-managed), avatars stay generated initials, theme remains device-local (`sb-theme`), and personal "Notification quiet hours" are firewalled in copy from the I-QUIET compliance rail, which is unchanged.
```

- [ ] **Step 4: Commit**

```bash
cd D:/CODE/NEW/close-clone
git add CONTRACTS.md DECISIONS.md
git commit -m "docs(contracts): declare self-service account endpoints (v1.3.7, D-062)"
```

---

### Task 2: Account data layer — types, api functions, mock store + handlers

**Files:**

- Modify: `apps/web/src/features/admin/types.ts`
- Modify: `apps/web/src/features/admin/api.ts`
- Modify: `apps/web/src/features/admin/queryKeys.ts`
- Modify: `apps/web/src/features/admin/mocks/adminStore.ts`
- Modify: `apps/web/src/features/admin/mocks/adminHandlers.ts`
- Test: `apps/web/src/features/admin/mocks/accountHandlers.test.ts` (new)

**Interfaces:**

- Consumes: `apiRequest` (`src/api/client.ts`), `ApiError` (`src/api/index.ts`), `readStoredUser` (`src/auth/auth.ts`), `db` fixtures (`src/mocks/fixtures.ts`), `User` from `@switchboard/shared`.
- Produces (later tasks rely on these exact names):
  - types: `QuietHoursPref { enabled: boolean; start: string; end: string }`, `UserPreferences { desktopNotifications: boolean; emailDigest: boolean; quietHours: QuietHoursPref; updatedAt: string }`, `UserPreferencesPatch { desktopNotifications?; emailDigest?; quietHours? }`, `MePatch { name?: string; timezone?: string }`
  - api: `patchMe(patch: MePatch): Promise<User>`, `getMyPreferences(signal?: AbortSignal): Promise<UserPreferences>`, `patchMyPreferences(patch: UserPreferencesPatch): Promise<UserPreferences>`
  - query key: `MY_PREFERENCES_QUERY_KEY = ['account', 'preferences'] as const`
  - store: `adminStore.preferences: UserPreferences` (seed: desktop on, digest off, quiet hours `{enabled:false, start:'20:00', end:'08:00'}`), rebuilt by `resetAdminStore()`

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/admin/mocks/accountHandlers.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { User } from '@switchboard/shared';
import { ApiError } from '../../../api/index.ts';
import { storeUser } from '../../../auth/auth.ts';
import { db } from '../../../mocks/fixtures.ts';
import { server } from '../../../mocks/server.ts';
import { getMyPreferences, patchMe, patchMyPreferences } from '../api.ts';
import { adminHandlers } from './adminHandlers.ts';
import { adminStore, resetAdminStore } from './adminStore.ts';

/*
 * Handler-level coverage for the self-service account endpoints (C7 v1.3.7):
 * PATCH /users/me resolves "me" from the mock auth blob and writes the fixture
 * row; /users/me/preferences reads+writes the adminStore singleton with strict
 * validation. The store is the store under test.
 */

function fixtureUser(): User {
  const u = db.users[0];
  if (!u) throw new Error('fixture users missing');
  return u;
}

beforeEach(() => {
  resetAdminStore();
  server.use(...adminHandlers);
  storeUser(fixtureUser());
});
afterEach(() => {
  storeUser(null);
});

describe('PATCH /users/me', () => {
  test('updates name and timezone on the fixture row and returns the user', async () => {
    const me = fixtureUser();
    const updated = await patchMe({ name: 'Ada O. Okafor', timezone: 'America/Chicago' });
    expect(updated.id).toBe(me.id);
    expect(updated.name).toBe('Ada O. Okafor');
    expect(updated.timezone).toBe('America/Chicago');
    expect(db.users[0]?.name).toBe('Ada O. Okafor');
  });

  test('rejects an empty name without writing', async () => {
    const before = db.users[0]?.name;
    await expect(patchMe({ name: '   ' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(db.users[0]?.name).toBe(before);
  });

  test('is UNAUTHENTICATED with no signed-in user', async () => {
    storeUser(null);
    await expect(patchMe({ name: 'Nobody' })).rejects.toBeInstanceOf(ApiError);
    await expect(patchMe({ name: 'Nobody' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('/users/me/preferences', () => {
  test('GET returns the seeded preferences', async () => {
    const prefs = await getMyPreferences();
    expect(prefs.desktopNotifications).toBe(true);
    expect(prefs.emailDigest).toBe(false);
    expect(prefs.quietHours).toEqual({ enabled: false, start: '20:00', end: '08:00' });
  });

  test('PATCH flips a toggle and persists it in the store', async () => {
    const prefs = await patchMyPreferences({ emailDigest: true });
    expect(prefs.emailDigest).toBe(true);
    expect(adminStore.preferences.emailDigest).toBe(true);
  });

  test('PATCH accepts valid quiet hours', async () => {
    const prefs = await patchMyPreferences({
      quietHours: { enabled: true, start: '22:00', end: '07:30' },
    });
    expect(prefs.quietHours).toEqual({ enabled: true, start: '22:00', end: '07:30' });
  });

  test('PATCH rejects malformed quiet-hour times without writing', async () => {
    await expect(
      patchMyPreferences({ quietHours: { enabled: true, start: '25:00', end: '08:00' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(adminStore.preferences.quietHours.enabled).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run (from `apps/web`): `pnpm vitest run src/features/admin/mocks/accountHandlers.test.ts`
Expected: FAIL — `patchMe`/`getMyPreferences`/`patchMyPreferences` are not exported from `../api.ts` (compile error).

- [ ] **Step 3: Implement the data layer**

3a. Append to `apps/web/src/features/admin/types.ts`:

```ts
// ── Account: self-service profile + notification preferences (C7 v1.3.7) ─────

/** Personal notification quiet hours — NOT the I-QUIET compliance rail. */
export interface QuietHoursPref {
  enabled: boolean;
  /** 24h "HH:MM" */
  start: string;
  /** 24h "HH:MM" */
  end: string;
}

export interface UserPreferences {
  desktopNotifications: boolean;
  emailDigest: boolean;
  quietHours: QuietHoursPref;
  updatedAt: string;
}

export interface UserPreferencesPatch {
  desktopNotifications?: boolean;
  emailDigest?: boolean;
  quietHours?: QuietHoursPref;
}

/** The only IdP-independent identity fields (D-A4). */
export interface MePatch {
  name?: string;
  timezone?: string;
}
```

3b. In `apps/web/src/features/admin/api.ts`: extend the shared import to
`import type { Lead, OrgSettings, Snippet, Template, User } from '@switchboard/shared';`,
extend the types import with `MePatch, UserPreferences, UserPreferencesPatch`, and append:

```ts
// ── Account: self-service profile + notification preferences (C7 v1.3.7) ─────

/** PATCH /users/me — display name / timezone only; identity is IdP-owned. */
export function patchMe(patch: MePatch): Promise<User> {
  return apiRequest<User>('/users/me', { method: 'PATCH', body: patch });
}

export function getMyPreferences(signal?: AbortSignal): Promise<UserPreferences> {
  return apiRequest<UserPreferences>('/users/me/preferences', signal ? { signal } : {});
}

export function patchMyPreferences(patch: UserPreferencesPatch): Promise<UserPreferences> {
  return apiRequest<UserPreferences>('/users/me/preferences', { method: 'PATCH', body: patch });
}
```

3c. Append to `apps/web/src/features/admin/queryKeys.ts`:

```ts
export const MY_PREFERENCES_QUERY_KEY = ['account', 'preferences'] as const;
```

3d. In `apps/web/src/features/admin/mocks/adminStore.ts`: extend the types import with
`UserPreferences`; add a seed, and wire it into `AdminStore`, `build()`, and `resetAdminStore()`:

```ts
function seedMyPreferences(): UserPreferences {
  return {
    desktopNotifications: true,
    emailDigest: false,
    quietHours: { enabled: false, start: '20:00', end: '08:00' },
    updatedAt: FIXED_NOW,
  };
}
```

`AdminStore` gains `preferences: UserPreferences;`, `build()` gains
`preferences: seedMyPreferences(),`, and `resetAdminStore()` gains
`adminStore.preferences = fresh.preferences;`.

3e. In `apps/web/src/features/admin/mocks/adminHandlers.ts`: add imports
`import type { Lead, User } from '@switchboard/shared';` (extend the existing Lead import),
`import { readStoredUser } from '../../../auth/auth.ts';`, add near `SNAKE_CASE`:

```ts
const HHMM = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
```

and append these handlers inside the `adminHandlers` array:

```ts
  // ── Account: self-service profile (C7 v1.3.7 PATCH /users/me) ──────────────
  // "Me" is the mock auth blob — the same identity source the dev-login flow
  // uses. Real mode resolves the actor from the session cookie server-side.
  http.patch(api('/users/me'), async ({ request }) => {
    const me = readStoredUser();
    if (!me) return errorJson(401, 'UNAUTHENTICATED', 'No signed-in user');
    const body = await readJson(request);
    if (!body) return errorJson(400, 'VALIDATION_FAILED', 'Invalid body');

    const row = db.users.find((u) => u.id === me.id) ?? null;
    const next: User = { ...(row ?? me) };
    if (body.name !== undefined) {
      const name = typeof body.name === 'string' ? body.name.trim() : '';
      if (name.length === 0 || name.length > 80) {
        return errorJson(400, 'VALIDATION_FAILED', 'name must be 1–80 characters', {
          field: 'name',
        });
      }
      next.name = name;
    }
    if (body.timezone !== undefined) {
      if (typeof body.timezone !== 'string' || body.timezone.trim().length === 0) {
        return errorJson(400, 'VALIDATION_FAILED', 'timezone must be an IANA zone id', {
          field: 'timezone',
        });
      }
      next.timezone = body.timezone;
    }
    next.updatedAt = nowIso();
    if (row) Object.assign(row, next);
    return HttpResponse.json(next satisfies User);
  }),

  // ── Account: notification preferences (C7 v1.3.7 /users/me/preferences) ────
  // Personal notification quiet hours only — the I-QUIET outbound rail is a
  // different, engine-enforced thing and is not touched here.
  http.get(api('/users/me/preferences'), () => HttpResponse.json(adminStore.preferences)),
  http.patch(api('/users/me/preferences'), async ({ request }) => {
    const body = await readJson(request);
    if (!body) return errorJson(400, 'VALIDATION_FAILED', 'Invalid body');
    const prefs = adminStore.preferences;
    if (body.desktopNotifications !== undefined) {
      if (typeof body.desktopNotifications !== 'boolean') {
        return errorJson(400, 'VALIDATION_FAILED', 'desktopNotifications must be a boolean', {
          field: 'desktopNotifications',
        });
      }
      prefs.desktopNotifications = body.desktopNotifications;
    }
    if (body.emailDigest !== undefined) {
      if (typeof body.emailDigest !== 'boolean') {
        return errorJson(400, 'VALIDATION_FAILED', 'emailDigest must be a boolean', {
          field: 'emailDigest',
        });
      }
      prefs.emailDigest = body.emailDigest;
    }
    if (body.quietHours !== undefined) {
      const qh = body.quietHours;
      if (
        !isRecord(qh) ||
        typeof qh.enabled !== 'boolean' ||
        typeof qh.start !== 'string' ||
        typeof qh.end !== 'string' ||
        !HHMM.test(qh.start) ||
        !HHMM.test(qh.end)
      ) {
        return errorJson(
          400,
          'VALIDATION_FAILED',
          'quietHours must be { enabled, start "HH:MM", end "HH:MM" }',
          { field: 'quietHours' },
        );
      }
      prefs.quietHours = { enabled: qh.enabled, start: qh.start, end: qh.end };
    }
    prefs.updatedAt = nowIso();
    return HttpResponse.json(prefs);
  }),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/features/admin/mocks/accountHandlers.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Guard against regressions + commit**

Run: `pnpm vitest run src/features/admin && pnpm typecheck`
Expected: all existing admin tests still green; typecheck clean.

```bash
cd D:/CODE/NEW/close-clone
git add apps/web/src/features/admin/types.ts apps/web/src/features/admin/api.ts apps/web/src/features/admin/queryKeys.ts apps/web/src/features/admin/mocks/adminStore.ts apps/web/src/features/admin/mocks/adminHandlers.ts apps/web/src/features/admin/mocks/accountHandlers.test.ts
git commit -m "feat(web): self-service account data layer (users/me + preferences, mock parity)"
```

---

### Task 3: ProfileSection component

**Files:**

- Create: `apps/web/src/features/admin/settings/sections/ProfileSection.tsx`
- Modify: `apps/web/src/features/admin/admin.css` (append one block)
- Test: `apps/web/src/features/admin/settings/sections/ProfileSection.test.tsx` (new)

**Interfaces:**

- Consumes: Task 2's `patchMe`, `getMyPreferences`; `useAuth()` (`user`, `login`) from `src/auth/AuthProvider.tsx`; `useToast` from `src/feedback/ToastProvider.tsx`; `initials` from `src/lib/format.ts`; `Button`, `Field`, `Input`, `Select` from `src/ui/index.ts`.
- Produces: `export function ProfileSection(): JSX.Element` (consumed by Task 5's `AdminSettingsPage`).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/admin/settings/sections/ProfileSection.test.tsx`:

```tsx
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { User } from '@switchboard/shared';
import { ToastProvider } from '../../../../feedback/ToastProvider.tsx';
import { AuthProvider } from '../../../../auth/AuthProvider.tsx';
import { readStoredUser, storeUser } from '../../../../auth/auth.ts';
import { db } from '../../../../mocks/fixtures.ts';
import { server } from '../../../../mocks/server.ts';
import { adminHandlers } from '../../mocks/adminHandlers.ts';
import { resetAdminStore } from '../../mocks/adminStore.ts';
import { ProfileSection } from './ProfileSection.tsx';

function fixtureUser(): User {
  const u = db.users[0];
  if (!u) throw new Error('fixture users missing');
  return u;
}

function renderProfile(): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider ttl={0}>
        <AuthProvider>
          <ProfileSection />
        </AuthProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetAdminStore();
  server.use(...adminHandlers);
  storeUser(fixtureUser());
});
afterEach(() => {
  storeUser(null);
  cleanup();
  vi.restoreAllMocks();
});

describe('identity', () => {
  test('shows the editable fields and the read-only SSO identity block', () => {
    const me = fixtureUser();
    renderProfile();

    expect(screen.getByLabelText('Display name')).toHaveValue(me.name);
    expect(screen.getByLabelText('Timezone')).toHaveValue(me.timezone);
    expect(screen.getByText(me.email)).toBeInTheDocument();
    expect(screen.getByText('Company single sign-on (SSO)')).toBeInTheDocument();
    expect(screen.getByText(me.idpSubject)).toBeInTheDocument();
    // Internal SSO: no password management surface, ever.
    expect(screen.queryByLabelText(/password/i)).toBeNull();
    expect(
      screen.getByText(/Password and two-factor settings live in the identity provider/),
    ).toBeInTheDocument();
  });
});

describe('saving', () => {
  test('saves name + timezone, toasts, and propagates to the auth session', async () => {
    const user = userEvent.setup();
    renderProfile();

    const nameInput = screen.getByLabelText('Display name');
    await user.clear(nameInput);
    await user.type(nameInput, 'Ada O. Okafor');
    await user.selectOptions(screen.getByLabelText('Timezone'), 'America/Chicago');
    await user.click(screen.getByRole('button', { name: 'Save profile' }));

    await screen.findByText('Profile saved');
    expect(db.users[0]?.name).toBe('Ada O. Okafor');
    expect(db.users[0]?.timezone).toBe('America/Chicago');
    // useAuth().login re-persisted the mock session blob → top bar re-renders.
    expect(readStoredUser()?.name).toBe('Ada O. Okafor');
  });

  test('an empty name disables save and shows a field error', async () => {
    const user = userEvent.setup();
    const before = db.users[0]?.name;
    renderProfile();

    await user.clear(screen.getByLabelText('Display name'));
    expect(await screen.findByRole('alert')).toHaveTextContent('Display name is required');
    expect(screen.getByRole('button', { name: 'Save profile' })).toBeDisabled();
    expect(db.users[0]?.name).toBe(before);
  });
});

describe('my data', () => {
  test('Download my data builds a JSON blob download named switchboard-my-data.json', async () => {
    const user = userEvent.setup();
    const downloads: string[] = [];
    Object.defineProperty(URL, 'createObjectURL', {
      value: vi.fn(() => 'blob:sb-test'),
      configurable: true,
      writable: true,
    });
    Object.defineProperty(URL, 'revokeObjectURL', {
      value: vi.fn(),
      configurable: true,
      writable: true,
    });
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      downloads.push(this.download);
    });

    renderProfile();
    await user.click(screen.getByRole('button', { name: 'Download my data' }));

    await waitFor(() => expect(downloads).toEqual(['switchboard-my-data.json']));
    expect(URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/admin/settings/sections/ProfileSection.test.tsx`
Expected: FAIL — cannot resolve `./ProfileSection.tsx`.

- [ ] **Step 3: Implement ProfileSection**

Create `apps/web/src/features/admin/settings/sections/ProfileSection.tsx`:

```tsx
import { useState } from 'react';
import type { FormEvent, JSX } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { User } from '@switchboard/shared';
import { Button, Field, Input, Select } from '../../../../ui/index.ts';
import { useAuth } from '../../../../auth/AuthProvider.tsx';
import { useToast } from '../../../../feedback/ToastProvider.tsx';
import { ApiError } from '../../../../api/index.ts';
import { initials } from '../../../../lib/format.ts';
import { getMyPreferences, patchMe } from '../../api.ts';

/*
 * Profile — the personal identity surface (spec D-A3..D-A7). Display name and
 * timezone are the only user-writable identity fields; email, role, and sign-in
 * are IdP-owned (internal SSO — Switchboard holds no passwords). Avatars are
 * generated initials by design; no image upload. "Download my data" exports the
 * signed-in user's profile + preferences as client-side JSON.
 */

const NAME_MAX = 80;

const FALLBACK_TIMEZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'America/Vancouver',
  'UTC',
] as const;

function timezoneOptions(current: string): string[] {
  let zones: string[];
  try {
    zones = Intl.supportedValuesOf('timeZone');
  } catch {
    zones = [...FALLBACK_TIMEZONES];
  }
  return zones.includes(current) ? zones : [current, ...zones];
}

function errorText(err: unknown): string {
  return err instanceof ApiError ? err.message : 'Something went wrong.';
}

async function downloadMyData(user: User): Promise<void> {
  const preferences = await getMyPreferences().catch(() => null);
  const payload = { exportedAt: new Date().toISOString(), profile: user, preferences };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'switchboard-my-data.json';
  anchor.click();
  URL.revokeObjectURL(url);
}

export function ProfileSection(): JSX.Element {
  const { user, login } = useAuth();
  const { toast } = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [timezone, setTimezone] = useState(user?.timezone ?? 'America/New_York');

  const save = useMutation({
    mutationFn: () => patchMe({ name: name.trim(), timezone }),
    onSuccess: (updated) => {
      // Re-adopt the updated user: AuthProvider re-persists the mock session
      // blob and the top-bar chip re-renders — no extra plumbing.
      login(updated);
      toast('Profile saved');
    },
  });

  // /settings sits behind RequireAuth; this only guards the type.
  if (!user) return <section className="admin-section" aria-label="Profile" />;

  const trimmed = name.trim();
  const nameError =
    trimmed.length === 0
      ? 'Display name is required'
      : trimmed.length > NAME_MAX
        ? `Keep it under ${NAME_MAX} characters`
        : undefined;
  const dirty = trimmed !== user.name || timezone !== user.timezone;

  const onSubmit = (e: FormEvent): void => {
    e.preventDefault();
    if (nameError === undefined && dirty) save.mutate();
  };

  return (
    <section className="admin-section" aria-labelledby="admin-profile-title">
      <header className="admin-section__head">
        <h1 id="admin-profile-title" className="admin-section__title">
          Profile
        </h1>
        <p className="admin-section__desc">
          How you appear across Switchboard. Email, role, and sign-in are managed in the company
          identity provider.
        </p>
      </header>

      <form className="admin-stack admin-profile__form" onSubmit={onSubmit} noValidate>
        <div className="admin-profile__avatar-row">
          <span className="sb-avatar admin-profile__avatar" aria-hidden="true">
            {initials(trimmed.length > 0 ? trimmed : user.name)}
          </span>
          <p className="admin-profile__avatar-note">
            Avatars are your initials — they update with your display name. There is no image
            upload.
          </p>
        </div>

        <Field label="Display name" error={nameError}>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </Field>

        <Field label="Timezone" hint="Used for task due times and activity timestamps.">
          <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
            {timezoneOptions(user.timezone).map((tz) => (
              <option key={tz} value={tz}>
                {tz}
              </option>
            ))}
          </Select>
        </Field>

        {save.isError ? (
          <p role="alert" className="sb-field__error">
            {errorText(save.error)}
          </p>
        ) : null}

        <div>
          <Button
            type="submit"
            variant="primary"
            loading={save.isPending}
            disabled={!dirty || nameError !== undefined}
          >
            Save profile
          </Button>
        </div>
      </form>

      <h2 className="admin-section__subtitle">Sign-in &amp; account</h2>
      <dl className="admin-identity">
        <dt>Email</dt>
        <dd className="admin-mono">{user.email}</dd>
        <dt>Sign-in</dt>
        <dd>Company single sign-on (SSO)</dd>
        <dt>Role</dt>
        <dd>
          <span className="admin-chip" data-role={user.role}>
            {user.role}
          </span>
        </dd>
        <dt>Directory subject</dt>
        <dd className="admin-mono">{user.idpSubject}</dd>
      </dl>
      <p className="admin-section__desc">
        Password and two-factor settings live in the identity provider, not here. To change your
        email or deactivate this account, contact an admin.
      </p>

      <h2 className="admin-section__subtitle">Your data</h2>
      <p className="admin-section__desc">
        Download a copy of your profile and preferences as JSON.
      </p>
      <Button type="button" onClick={() => void downloadMyData(user)}>
        Download my data
      </Button>
    </section>
  );
}
```

Append to `apps/web/src/features/admin/admin.css` (achromatic; existing tokens only):

```css
/* ── Account: profile + preferences ──────────────────────────────────────── */

.admin-section__subtitle {
  margin: var(--space-7) 0 var(--space-3);
  font-size: var(--fs-base);
  font-weight: var(--fw-semibold);
  color: var(--ink-0);
}

.admin-profile__form {
  max-width: 420px;
}

.admin-profile__avatar-row {
  display: flex;
  align-items: center;
  gap: var(--space-4);
}

.admin-profile__avatar {
  width: 40px;
  height: 40px;
  font-size: var(--fs-base);
}

.admin-profile__avatar-note,
.admin-identity dt {
  color: var(--ink-2);
  font-size: var(--fs-base);
}

.admin-profile__avatar-note {
  margin: 0;
}

.admin-identity {
  display: grid;
  grid-template-columns: max-content 1fr;
  gap: var(--space-2) var(--space-6);
  margin: 0 0 var(--space-4);
}

.admin-identity dd {
  margin: 0;
  font-size: var(--fs-base);
  color: var(--ink-0);
}

.admin-radio-row {
  display: flex;
  gap: var(--space-6);
}

.admin-radio {
  display: inline-flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--fs-base);
  color: var(--ink-0);
}

.admin-fieldset {
  margin: 0 0 var(--space-6);
  padding: 0;
  border: 0;
}

.admin-prefs-row {
  display: flex;
  align-items: center;
  padding: var(--space-2) 0;
  border-bottom: 1px solid var(--line);
}

.admin-prefs-times {
  display: flex;
  gap: var(--space-6);
  max-width: 420px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/features/admin/settings/sections/ProfileSection.test.tsx`
Expected: PASS (4 tests). If `Field`'s label association fails for `Select`, pass an explicit `id` pair (`<Field id="profile-tz" …>` is not needed when `Select` consumes `FieldContext` — it does, like `Input`).

- [ ] **Step 5: Commit**

```bash
cd D:/CODE/NEW/close-clone
git add apps/web/src/features/admin/settings/sections/ProfileSection.tsx apps/web/src/features/admin/settings/sections/ProfileSection.test.tsx apps/web/src/features/admin/admin.css
git commit -m "feat(web): Profile settings section — name/timezone, SSO identity, data export"
```

---

### Task 4: PreferencesSection component

**Files:**

- Create: `apps/web/src/features/admin/settings/sections/PreferencesSection.tsx`
- Test: `apps/web/src/features/admin/settings/sections/PreferencesSection.test.tsx` (new)

**Interfaces:**

- Consumes: Task 2's `getMyPreferences`, `patchMyPreferences`, `MY_PREFERENCES_QUERY_KEY`, `UserPreferences`, `UserPreferencesPatch`; `useTheme` (`src/theme/ThemeProvider.tsx`), `THEME_CHOICES`/`ThemeChoice` (`src/theme/theme.ts`); `ErrorState`, `Field`, `Input`, `Skeleton`, `Switch` from `src/ui/index.ts`; CSS classes added in Task 3.
- Produces: `export function PreferencesSection(): JSX.Element` (consumed by Task 5).

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/features/admin/settings/sections/PreferencesSection.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/admin/settings/sections/PreferencesSection.test.tsx`
Expected: FAIL — cannot resolve `./PreferencesSection.tsx`.

- [ ] **Step 3: Implement PreferencesSection**

Create `apps/web/src/features/admin/settings/sections/PreferencesSection.tsx`:

```tsx
import type { JSX } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ErrorState, Field, Input, Skeleton, Switch } from '../../../../ui/index.ts';
import { useTheme } from '../../../../theme/ThemeProvider.tsx';
import { THEME_CHOICES, type ThemeChoice } from '../../../../theme/theme.ts';
import { useToast } from '../../../../feedback/ToastProvider.tsx';
import { ApiError } from '../../../../api/index.ts';
import { getMyPreferences, patchMyPreferences } from '../../api.ts';
import { MY_PREFERENCES_QUERY_KEY } from '../../queryKeys.ts';
import type { UserPreferences, UserPreferencesPatch } from '../../types.ts';

/*
 * Preferences — personal, per-user settings (spec D-A9/D-A11/D-A12). Theme is
 * device-local (`sb-theme`, same store as the top-bar toggle); notification
 * preferences are server-persisted. The switches are the real interactive
 * Switch primitive (immediate effect), UNLIKE the Compliance section's
 * decorative glyphs — these settings genuinely belong to the user. The
 * personal "Notification quiet hours" are firewalled in copy from the I-QUIET
 * outbound compliance rail, which this section must never appear to control.
 */

const THEME_LABELS: Record<ThemeChoice, string> = {
  light: 'Light',
  dark: 'Dark',
  system: 'Match system',
};

function loadErrorText(err: unknown): string {
  return err instanceof ApiError ? `${err.message} (${err.code})` : 'Something went wrong.';
}

export function PreferencesSection(): JSX.Element {
  const { choice, setChoice } = useTheme();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const prefsQuery = useQuery({
    queryKey: MY_PREFERENCES_QUERY_KEY,
    queryFn: ({ signal }) => getMyPreferences(signal),
  });

  const save = useMutation({
    mutationFn: (patch: UserPreferencesPatch) => patchMyPreferences(patch),
    onSuccess: (updated) =>
      queryClient.setQueryData<UserPreferences>(MY_PREFERENCES_QUERY_KEY, updated),
    onError: (err) =>
      toast(err instanceof ApiError ? err.message : 'Couldn’t save that preference.'),
  });

  const prefs = prefsQuery.data;

  return (
    <section className="admin-section" aria-labelledby="admin-preferences-title">
      <header className="admin-section__head">
        <h1 id="admin-preferences-title" className="admin-section__title">
          Preferences
        </h1>
        <p className="admin-section__desc">
          Personal settings. They follow you, not the workspace.
        </p>
      </header>

      <fieldset className="admin-fieldset">
        <legend className="admin-section__subtitle">Theme</legend>
        <div className="admin-radio-row">
          {THEME_CHOICES.map((themeChoice) => (
            <label key={themeChoice} className="admin-radio">
              <input
                type="radio"
                name="theme-choice"
                value={themeChoice}
                checked={choice === themeChoice}
                onChange={() => setChoice(themeChoice)}
              />
              {THEME_LABELS[themeChoice]}
            </label>
          ))}
        </div>
        <p className="sb-field__hint">Applies to this browser on this device.</p>
      </fieldset>

      <h2 className="admin-section__subtitle">Notifications</h2>
      <p className="admin-section__desc">
        Your own notifications only. Outbound quiet hours for calls, email, and SMS are a compliance
        rail enforced by the engine — see Compliance.
      </p>

      {prefsQuery.isLoading ? (
        <div className="admin-stack" aria-hidden="true">
          <Skeleton height={36} />
          <Skeleton height={36} />
          <Skeleton height={36} />
        </div>
      ) : prefsQuery.isError || prefs === undefined ? (
        <ErrorState
          title="Couldn’t load preferences"
          description={loadErrorText(prefsQuery.error)}
          onRetry={() => void prefsQuery.refetch()}
        />
      ) : (
        <div className="admin-stack">
          <div className="admin-prefs-row">
            <Switch
              label="Desktop notifications"
              checked={prefs.desktopNotifications}
              onCheckedChange={(checked) => save.mutate({ desktopNotifications: checked })}
            />
          </div>
          <div className="admin-prefs-row">
            <Switch
              label="Daily email digest"
              checked={prefs.emailDigest}
              onCheckedChange={(checked) => save.mutate({ emailDigest: checked })}
            />
          </div>
          <div className="admin-prefs-row">
            <Switch
              label="Notification quiet hours"
              checked={prefs.quietHours.enabled}
              onCheckedChange={(checked) =>
                save.mutate({ quietHours: { ...prefs.quietHours, enabled: checked } })
              }
            />
          </div>
          {prefs.quietHours.enabled ? (
            <div className="admin-prefs-times">
              <Field label="From" hint="Notifications pause at this time.">
                <Input
                  type="time"
                  value={prefs.quietHours.start}
                  onChange={(e) => {
                    if (e.target.value) {
                      save.mutate({ quietHours: { ...prefs.quietHours, start: e.target.value } });
                    }
                  }}
                />
              </Field>
              <Field label="Until">
                <Input
                  type="time"
                  value={prefs.quietHours.end}
                  onChange={(e) => {
                    if (e.target.value) {
                      save.mutate({ quietHours: { ...prefs.quietHours, end: e.target.value } });
                    }
                  }}
                />
              </Field>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/features/admin/settings/sections/PreferencesSection.test.tsx`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
cd D:/CODE/NEW/close-clone
git add apps/web/src/features/admin/settings/sections/PreferencesSection.tsx apps/web/src/features/admin/settings/sections/PreferencesSection.test.tsx
git commit -m "feat(web): Preferences settings section — theme radios + notification prefs"
```

---

### Task 5: Wire the sections into the settings surface (nav, icons, page, default)

**Files:**

- Modify: `apps/web/src/features/admin/icons.tsx`
- Modify: `apps/web/src/features/admin/settings/SettingsNav.tsx`
- Modify: `apps/web/src/features/admin/settings/AdminSettingsPage.tsx`
- Test: `apps/web/src/features/admin/settings/AdminSettingsPage.test.tsx` (modify)

**Interfaces:**

- Consumes: `ProfileSection` (Task 3), `PreferencesSection` (Task 4); lucide `CircleUserRound`, `Settings2`.
- Produces: section ids `'profile'` and `'preferences'`; `DEFAULT_SECTION = 'profile'`; icons `ProfileIcon`, `PreferencesIcon` (used by Task 6's a11y additions only through the page).

- [ ] **Step 1: Write the failing tests (modify AdminSettingsPage.test.tsx)**

In `apps/web/src/features/admin/settings/AdminSettingsPage.test.tsx`:

1a. Extend imports:

```tsx
import { ThemeProvider } from '../../../theme/ThemeProvider.tsx';
import { AuthProvider } from '../../../auth/AuthProvider.tsx';
import { storeUser } from '../../../auth/auth.ts';
import type { User } from '@switchboard/shared';
import { db } from '../../../mocks/fixtures.ts';
```

1b. Replace the `renderSettings` helper and hooks with:

```tsx
function fixtureUser(): User {
  const u = db.users[0];
  if (!u) throw new Error('fixture users missing');
  return u;
}

function renderSettings(section?: string): void {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={qc}>
      <ToastProvider ttl={0}>
        <ThemeProvider>
          <AuthProvider>
            <MemoryRouter initialEntries={[section ? `/settings?section=${section}` : '/settings']}>
              <AdminSettingsPage />
            </MemoryRouter>
          </AuthProvider>
        </ThemeProvider>
      </ToastProvider>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  resetAdminStore();
  server.use(...adminHandlers);
  storeUser(fixtureUser());
});
afterEach(() => {
  storeUser(null);
  localStorage.removeItem('sb-theme');
  document.documentElement.removeAttribute('data-theme');
  cleanup();
});
```

1c. In the existing `describe('navigation')` block, rename the first test to
`'renders the addressed section and switches sections via the sub-rail'` (its body is
unchanged — it already passes `'users'` explicitly), and add:

```tsx
test('defaults to Profile (personal-first) and reaches Preferences via the sub-rail', async () => {
  const user = userEvent.setup();
  renderSettings();

  await screen.findByRole('heading', { name: 'Profile', level: 1 });
  expect(screen.getByLabelText('Display name')).toHaveValue(fixtureUser().name);

  await user.click(screen.getByRole('link', { name: 'Preferences' }));
  await screen.findByRole('heading', { name: 'Preferences', level: 1 });
  await screen.findByRole('switch', { name: 'Desktop notifications' });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/features/admin/settings/AdminSettingsPage.test.tsx`
Expected: the new test FAILS (default section is still Users; no Profile link); existing tests still pass.

- [ ] **Step 3: Implement the wiring**

3a. `apps/web/src/features/admin/icons.tsx` — extend the lucide import with
`CircleUserRound, Settings2` and add to the "Settings nav + sections" group:

```tsx
export const ProfileIcon = toIcon(CircleUserRound);
export const PreferencesIcon = toIcon(Settings2);
```

3b. `apps/web/src/features/admin/settings/SettingsNav.tsx` — extend the icon import with
`PreferencesIcon, ProfileIcon`, and change the section table:

```tsx
export const SETTINGS_SECTIONS: readonly SettingsSectionMeta[] = [
  { id: 'profile', label: 'Profile', icon: ProfileIcon },
  { id: 'preferences', label: 'Preferences', icon: PreferencesIcon },
  { id: 'users', label: 'Users', icon: UsersIcon },
  { id: 'custom-fields', label: 'Custom fields', icon: CustomFieldsIcon },
  { id: 'templates', label: 'Templates & snippets', icon: TemplatesIcon },
  { id: 'compliance', label: 'Compliance', icon: ComplianceIcon },
  { id: 'about', label: 'About', icon: AboutIcon },
];

export const DEFAULT_SECTION = 'profile';
```

3c. `apps/web/src/features/admin/settings/AdminSettingsPage.tsx` — import the two new
sections and change `renderSection` to:

```tsx
function renderSection(section: string): JSX.Element {
  switch (section) {
    case 'users':
      return <UsersSection />;
    case 'custom-fields':
      return <CustomFieldsSection />;
    case 'templates':
      return <TemplatesSection />;
    case 'compliance':
      return <ComplianceSection />;
    case 'about':
      return <AboutSection />;
    case 'preferences':
      return <PreferencesSection />;
    case 'profile':
    default:
      return <ProfileSection />;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `pnpm vitest run src/features/admin/settings/AdminSettingsPage.test.tsx`
Expected: PASS (all navigation/users/custom-fields/templates/compliance tests plus the new default-section test).

- [ ] **Step 5: Commit**

```bash
cd D:/CODE/NEW/close-clone
git add apps/web/src/features/admin/icons.tsx apps/web/src/features/admin/settings/SettingsNav.tsx apps/web/src/features/admin/settings/AdminSettingsPage.tsx apps/web/src/features/admin/settings/AdminSettingsPage.test.tsx
git commit -m "feat(web): wire Profile + Preferences into /settings, personal-first default"
```

---

### Task 6: Axe smoke for the new sections

**Files:**

- Test: `apps/web/src/features/admin/a11y.test.tsx` (modify)

**Interfaces:**

- Consumes: the page wiring from Task 5; existing `Providers`, `expectNoSeriousViolations`, and hooks in `a11y.test.tsx`; `ThemeProvider`, `AuthProvider`, `storeUser`, `db` (already imported for `db`).

- [ ] **Step 1: Write the failing-or-passing test (axe is the assertion)**

In `apps/web/src/features/admin/a11y.test.tsx`, extend imports:

```tsx
import type { User } from '@switchboard/shared';
import { ThemeProvider } from '../../theme/ThemeProvider.tsx';
import { AuthProvider } from '../../auth/AuthProvider.tsx';
import { storeUser } from '../../auth/auth.ts';
```

Add inside the existing `describe('settings — axe')` block (theme is driven via
`sb-theme` because `ThemeProvider` owns the `data-theme` attribute for these renders):

```tsx
test('the profile and preferences sections have no serious/critical violations (light + dark)', async () => {
  const u: User | undefined = db.users[0];
  if (!u) throw new Error('fixture users missing');
  storeUser(u);
  try {
    for (const section of ['profile', 'preferences'] as const) {
      for (const theme of ['light', 'dark'] as const) {
        localStorage.setItem('sb-theme', theme);
        const { container, unmount } = render(
          <Providers>
            <ThemeProvider>
              <AuthProvider>
                <MemoryRouter initialEntries={[`/settings?section=${section}`]}>
                  <AdminSettingsPage />
                </MemoryRouter>
              </AuthProvider>
            </ThemeProvider>
          </Providers>,
        );
        if (section === 'profile') {
          await screen.findByLabelText('Display name');
        } else {
          await screen.findByRole('switch', { name: 'Desktop notifications' });
        }
        await expectNoSeriousViolations(container);
        unmount();
      }
    }
  } finally {
    storeUser(null);
    localStorage.removeItem('sb-theme');
  }
});
```

- [ ] **Step 2: Run and fix any violations**

Run: `pnpm vitest run src/features/admin/a11y.test.tsx`
Expected: PASS. If axe reports a serious/critical violation, fix it in the section component (not by loosening the assertion) and re-run.

- [ ] **Step 3: Commit**

```bash
cd D:/CODE/NEW/close-clone
git add apps/web/src/features/admin/a11y.test.tsx
git commit -m "test(web): axe smoke for Profile + Preferences sections (light + dark)"
```

---

### Task 7: "Account settings" link in the user menu

**Files:**

- Modify: `apps/web/src/app/TopBar.tsx`
- Test: `apps/web/src/app/TopBar.test.tsx` (new)

**Interfaces:**

- Consumes: `Link` from react-router-dom; the `profile` section id from Task 5.
- Produces: a `sb-usermenu__panel` link "Account settings" → `/settings?section=profile`.

- [ ] **Step 1: Write the failing test**

Create `apps/web/src/app/TopBar.test.tsx`:

```tsx
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run src/app/TopBar.test.tsx`
Expected: FAIL — no link named "Account settings".

- [ ] **Step 3: Implement the link**

In `apps/web/src/app/TopBar.tsx`: add `Link` to the react-router-dom import
(`import { Link, useNavigate } from 'react-router-dom';`) and, inside `UserMenu`'s
`sb-usermenu__panel` div, insert between the name/email block and the Sign out button:

```tsx
<Link to="/settings?section=profile" className="sb-btn sb-btn--ghost sb-usermenu__settings">
  Account settings
</Link>
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run src/app/TopBar.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd D:/CODE/NEW/close-clone
git add apps/web/src/app/TopBar.tsx apps/web/src/app/TopBar.test.tsx
git commit -m "feat(web): Account settings link in the user menu"
```

---

### Task 8: Full verification, browser check, status

**Files:**

- Modify: `D:/CODE/NEW/close-clone/STATUS.md` (append one line to the current-state notes)

- [ ] **Step 1: Full gates**

Run (from `apps/web`):

```bash
pnpm test && pnpm typecheck && pnpm lint && pnpm build
```

Expected: all green. Fix anything red before proceeding — no green, no done (repo golden rule).

- [ ] **Step 2: Real-browser check (mock mode)**

Run `pnpm dev` (from `apps/web`), open the app, sign in via dev login, then verify:

1. `/settings` lands on Profile; sub-rail shows Profile, Preferences, Users, Custom fields, Templates & snippets, Compliance, About.
2. Edit display name → Save profile → toast; top-bar chip + initials update; navigate away and back — the change survives (route changes; a reload resets the in-memory demo store, which is the existing demo rule).
3. Preferences: pick Dark → instant theme change, reload → no flash, still dark; flip Daily email digest; enable Notification quiet hours → time fields appear and edit cleanly.
4. Compliance section unchanged: recording locked, no switches.
5. User menu shows "Account settings" and it navigates to Profile.

- [ ] **Step 3: Update STATUS.md**

Append to the current-state section of `D:/CODE/NEW/close-clone/STATUS.md`:

```
- Account-customization parity (2026-07-30): personal Profile + Preferences sections on /settings (display name, timezone, initials avatar, SSO identity block, data export; theme radios, notification toggles + personal quiet hours), mock-API parity via adminStore/adminHandlers, C7 v1.3.7/D-062. Real Fastify routes for `/users/me*` deferred to the next api iteration (spec: docs/superpowers/specs/2026-07-30-switchboard-account-customization-design.md).
```

- [ ] **Step 4: Final commit**

```bash
cd D:/CODE/NEW/close-clone
git add STATUS.md
git commit -m "docs(status): account-customization parity shipped (web + mock parity)"
```

---

## Self-review notes (performed at plan-writing time)

- Spec coverage: Profile (Task 3), Preferences (Task 4), persistence + contract (Tasks 1–2), reachability/default (Tasks 5, 7), a11y (Task 6 + primitives), DoD (Task 8). Locale/delete-account/workspace/member-mgmt/password are non-goals — no tasks, by design.
- `e2e/tests/surfaces.spec.ts` uses `?section=compliance` explicitly — unaffected by the default-section change.
- Runtime MSW registration needs no change: `src/mocks/browser.ts` and `src/mocks/server.ts` already spread `adminHandlers`, so the new handlers are live in dev/demo automatically.
- Handler paths (`*/api/v1/users/me`, `*/api/v1/users/me/preferences`) cannot collide with the existing `GET */api/v1/users` (different paths; MSW matches full paths, and PATCH is a different method anyway).
- Type/name consistency check: `patchMe`/`getMyPreferences`/`patchMyPreferences`, `MY_PREFERENCES_QUERY_KEY`, `UserPreferences`/`UserPreferencesPatch`/`QuietHoursPref`/`MePatch`, `adminStore.preferences`, section ids `profile`/`preferences` — used identically across Tasks 2–7.

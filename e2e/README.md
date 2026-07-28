# Switchboard E2E (Playwright)

End-to-end tests that drive the **real web app** (`apps/web`) in **MOCK mode** — MSW
service worker + synthetic fixtures, **zero external accounts**. This is the
machine-verifiable coverage of the build guide §8 "full rep loop" and the key
surfaces.

The app is served as a production build (`vite build` → `vite preview`) on a fixed
port; in mock mode the bundle ships the MSW service worker
(`apps/web/public/mockServiceWorker.js`), so the static site answers the whole
REST surface from fixtures with no backend. Data is byte-deterministic (every
timestamp anchors to `REFERENCE_NOW = 2026-07-15T17:00:00Z`), so the asserted
ids/counts/numbers are stable.

## Why this lives outside the pnpm workspace

`e2e/` is **not** a `pnpm-workspace.yaml` member (same choice as `deploy/`). Its
heavy browser-test deps (`@playwright/test`, `playwright`) stay out of the
application dependency graph. Install/run it standalone with `--ignore-workspace`;
it has its own `pnpm-lock.yaml`. Because of this, the root `pnpm -r test` /
`pnpm --filter @switchboard/web test` vitest suites never pick these specs up.

## Running locally

```bash
# 1) one-time: install the Playwright browser (downloads chromium over the network)
pnpm --dir e2e install --ignore-workspace
pnpm --dir e2e exec playwright install chromium

# 2) run the suite (builds apps/web, serves it via vite preview, runs chromium)
pnpm --dir e2e test
```

- The `webServer` in `playwright.config.ts` builds `apps/web` then previews it on
  `http://127.0.0.1:4173` locally (one command, clean checkout works). In CI the
  dist is prebuilt by the workflow, so it previews only. `reuseExistingServer` is
  on locally, so if you already have a preview on `:4173` it is reused (no
  rebuild) — handy for fast iteration.
- **Browser download note:** `playwright install` fetches chromium (~180 MB) from
  `cdn.playwright.dev`. On a host without that network access the browser can't be
  installed and the suite can't run locally — that's expected; **CI installs and
  runs the browsers** (`.github/workflows/e2e.yml`).
- Useful: `pnpm --dir e2e test -- --ui` (interactive), `pnpm --dir e2e report`
  (open the last HTML report), `pnpm --dir e2e run typecheck`.

## What's covered

| Spec                   | Guide §8 step                | Asserts                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ---------------------- | ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `rep-loop.spec.ts`     | 1–4 (the continuous journey) | `/welcome` ignition → **Open Switchboard** → dev-login → land in `/inbox`; open Leads → open a lead → **timeline renders**; open the **Email composer** → live merge-tag (`{{lead.name}}`) resolves in the preview → close; Inbox queue renders; **completing a task** removes its row and drops "Needs you now" (and lifts "Done today"); **a reply sends** and its row leaves.                                                                                                                                                                                      |
| `surfaces.spec.ts`     | 5–9 (the key surfaces)       | **Sequences:** step ladder (3 steps, "Needs review"), the **`Paused · reply`** enrollment (I-SEND-2), and **Enroll → roster count ticks +1**. **Pipeline:** board with the 5 stage columns + currency-separated sums + "Weighted" header + deal count. **Reports:** Activity/Funnel/Sequences tabs render numbers, and **switching the range re-queries** (Calls-logged 810 @30D → 189 @7D). **Settings → Compliance:** the invariant-tagged rails render (recording **Off**/I-REC, unsubscribe **On**/I-SEND-5, quiet-hours window/I-QUIET, daily cap 200/I-SEND-4). |
| `keyboard.spec.ts`     | 10                           | **Ctrl/Cmd+K** opens the command palette immediately, typing filters it, **Enter navigates**; **?** opens the shortcut sheet (Escape closes).                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `compliance.spec.ts`   | rails                        | The email composer on a **DNC lead** shows the do-not-contact block and **disables Send** — no override control (I-DNC / SUPPRESSED).                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `theme-motion.spec.ts` | themes + reduced motion      | Toggling the theme **persists across reload** (`<html data-theme>` + `sb-theme`); the app renders in **dark** color scheme; the app renders under **`prefers-reduced-motion: reduce`** (leads surface flags `data-reduced-motion="true"`).                                                                                                                                                                                                                                                                                                                            |
| `ai-confirm.spec.ts`   | AI confirm-before-commit     | See skip list below, plus a positive guard: the composer exposes **no AI write-path** (Send is the only commit).                                                                                                                                                                                                                                                                                                                                                                                                                                                      |

`auth.setup.ts` is a Playwright **setup project**: it logs in once through the real
dev-login UI (as the admin fixture user **Ada Okafor**, so Settings is reachable)
and saves the authenticated `localStorage` as `storageState`. Every authed spec
reuses it; `rep-loop.spec.ts` opts out (`test.use({ storageState: … empty }`) so it
exercises the real welcome → login flow itself.

## Skip list (with reasons)

- **`ai-confirm.spec.ts` → "AI output requires an explicit user confirm before it
  writes"** — `test.skip`. As of this build there is **no AI affordance wired into
  the web UI**. The three AI paths in ARCHITECTURE §7 (call-summary draft note,
  email draft/rewrite, NL → Smart View) have no rendered control on any surface
  this suite drives (composer, inbox, pipeline, reports, sequences, settings were
  all verified free of AI/draft/rewrite/generate controls). There is no AI
  write-path to confirm end-to-end yet, so per task 5d the confirm-flow is skipped
  rather than fabricated. A passing guard test in the same file locks in that the
  composer's only backend write is the explicit **Send** button. Enable the skipped
  test once an AI affordance appears (assert: invoking AI must not mutate/send
  until the rep clicks a confirm control — I-AI: the confirming request carries
  `confirmedBy`).

## CI

`.github/workflows/e2e.yml` (separate from `ci.yml`) runs on push to `main` and on
PRs: installs deps, `playwright install --with-deps chromium`, builds the web app
(mock mode), runs the suite, and uploads the HTML report + traces as artifacts on
failure. Traces are captured `on-first-retry`.

---

# `container-smoke.mjs` — the composed-stack gate

Everything above this line drives the **mock** bundle. `container-smoke.mjs` is
the opposite: it drives the **real composed stack** — nginx → Fastify → Postgres,
from the images `deploy/docker-compose.yml` builds — in a real chromium. It is a
plain Node script, **not** a Playwright spec (no `playwright.config.ts`, no
`webServer`, no MSW), so `pnpm --dir e2e test` does not pick it up.

It exists because of `DECISIONS.md` **D-061**: every layer of this repo's testing
mocks the one beneath it, so ~4,000 green tests coexisted with a deployed app
whose every write returned 403.

## Running it locally

```bash
cp deploy/.env.example deploy/.env   # set POSTGRES_PASSWORD, SESSION_SECRET,
                                     # LIST_UNSUBSCRIBE_SECRET (>=32 chars, different);
                                     # MOCK_MODE=1 is correct here
cd deploy && docker compose up -d --wait --build && cd ..
node e2e/container-smoke.mjs         # or: SMOKE_BASE_URL=http://host:port node …
```

Checks (all gating; the script exits non-zero if any fails):

1. the front door responds;
2. `/healthz` answers **through the nginx proxy** — separates "the SPA is broken"
   from "the api never came up";
3. dev-login lands in `/inbox`;
4. **a write survives a reload** (the point of the file — optimistic UI will show
   a change the server rejected);
5. a mutation **without** `x-switchboard-csrf` is refused with 403;
6. no console errors.

On any failure it writes a screenshot, the served DOM and the console log to
`e2e/test-results/container-smoke/` (already gitignored / prettierignored) and
prints two non-gating `NOTE` lines naming which login screen rendered and what
`GET /api/v1/auth/dev-users` returned.

## CI

`.github/workflows/ci.yml` → job **`container-smoke`** (`needs: build-test`, so
lint/typecheck/unit failures surface before this much slower job runs). It
synthesizes `deploy/.env` (gitignored, so CI must create it), validates the
compose file, **builds both images** (`apps/api/Dockerfile` and
`apps/web/Dockerfile` — nothing else in CI builds them), brings the stack up with
`docker compose up -d --wait`, runs this script as a hard gate, and on failure
dumps `docker compose ps` plus api/web/postgres/redis logs and uploads the
artifacts above.

## Known blockers (as of this writing — the job is expected RED on first run)

Both are **outside** `e2e/` and were reported rather than worked around:

- **The composed web bundle cannot authenticate at all.** `apps/web/Dockerfile`
  builds with `VITE_API_MODE=real`, so `auth/LoginPage.tsx` renders
  `SsoLoginPage`, not the dev-login picker — and `auth/AuthProvider.tsx` derives
  `isAuthenticated` **only** from `localStorage`; nothing in `apps/web/src` ever
  calls `GET /api/v1/auth/me`. After an OIDC round-trip the API's session cookie
  is set but the SPA still considers itself logged out, so `RequireAuth` bounces
  back to `/login`. Check 3 cannot pass until a real-mode session bootstrap
  exists.
- **A freshly composed stack has an empty database.** The entrypoint runs
  migrations only; there is no production seed path, and `GET
/api/v1/auth/dev-users` reads the `users` table — so the dev-login picker is
  empty and the inbox has no completable work (checks 3 and 4).

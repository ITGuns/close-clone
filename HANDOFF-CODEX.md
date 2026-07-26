# Handoff → Codex

**Repo:** `D:\CODE\NEW\close-clone` · branch `main` (always work on `main`; it is the deploy source)
**As of:** 2026-07-20. `main` is SHARED — another agent session (Codex) is pushing to it too; the
`D-057` audit-finish pass (combobox primitive, dependency-advisory upgrades, deploy fixes) landed while
this file was being written. **Always `git fetch && git rebase origin/main` before you start**, and
re-read `STATUS.md` + the tail of `DECISIONS.md` (latest entry `D-058`) for the true current state
rather than trusting any test count written here.

Read this file, then `CLAUDE.md` (operating rules), then `CONTRACTS.md` (the law) before touching code.

---

## 1. What this is, in one paragraph

**Switchboard** — an internal, single-tenant, communication-first CRM (a Close.com-style product). The
unit of work is the **conversation on a per-lead timeline**, not the record. Calls/emails/SMS/notes all
ingest into one append-only activity stream. **Compliance rails** (consent, quiet hours, DNC,
suppression, rate caps) are a **hard gate enforced in the engine layer on every outbound** — the API has
no privileged bypass. Smart Views (a small query DSL → parameterized SQL) and sequences drive daily work.

pnpm monorepo: `apps/api` (Fastify + Drizzle + Postgres, Redis/BullMQ behind a `QueueDriver`),
`apps/web` (React + Vite, MSW for the mock/demo layer), `packages/shared` (zod contracts + the DSL
compiler). `deploy/` and `e2e/` are standalone, outside the workspace.

---

## 2. Where things stand

**Built and green:** the whole MVP + Wave A readiness (SSO/RBAC, API tokens, webhooks with a
transactional outbox, observability, deploy kit) + Phase 3 integrations mock-first (telephony, SMS,
AI summaries/drafting/NL→SmartView) + real product-CRUD routes + the four UI surfaces (calling, SMS,
AI, CSV import). All five lead-header actions are **live**: Call, SMS, Email, Task, Enroll.

**Two runtime modes:**

|                    | how                                    | what it is                                                                                                                                                |
| ------------------ | -------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **mock** (default) | `pnpm --filter @switchboard/web dev`   | MSW in-browser, seeded fixtures. This is what the public demo serves.                                                                                     |
| **real**           | `VITE_API_MODE=real` + the API running | real Fastify + Postgres. Product CRUD works end-to-end; external providers (Gmail/Twilio/Deepgram/Anthropic/OIDC) need credentials — see `HUMAN_TODO.md`. |

**Public demo (mock):** <https://switchboard-demo-omega.vercel.app> — Vercel project
`switchboard-demo` under the **`pllxrgn-ui`** account (GitHub-linked, pllxrgn@gmail.com).
GitHub Pages is a second mirror that auto-deploys on push.

**Demo account system** (mock only, `apps/web/src/auth/accounts.ts`): sign-up with username +
password, salted SHA-256 in `localStorage`. Each account owns its **own blank workspace** whose data
persists on that device (`apps/web/src/mocks/workspace.ts`). It is **intentionally demo-grade** — no
server, so it is not a security boundary. Real mode uses OIDC and never mounts any of it.

---

## 3. THE IMMEDIATE TASK — finish Vercel Git auto-deploy

`apps/web/vercel.json` is committed (install/build/output/SPA-rewrite). What remains:

**A human must click this once** (OAuth grant — an agent cannot and must not do it):

1. vercel.com/dashboard as `pllxrgn-ui` → open the existing **`switchboard-demo`** project
   (using the existing project preserves the `switchboard-demo-omega.vercel.app` URL the boss has).
2. **Settings → Git → Connect Git Repository** → GitHub → `pllxrgn-ui/close-clone`.
3. **Settings → Build and Deployment → Root Directory** → `apps/web` → Save. Leave install/build
   empty; `vercel.json` supplies them. Production branch = `main`.

**Then your job:** push a trivial commit, confirm Vercel builds it, and verify the live URL serves the
new bundle (compare the `assets/index-*.js` hash in the served HTML before/after). Report honestly if
the build fails — the monorepo needs the workspace install to resolve `@switchboard/shared`.

Until that is connected, redeploy manually with the recipe in `DEPLOY-PREVIEW.md`.

---

## 4. Commands

```bash
# install
pnpm install

# gates (run ALL before claiming done)
pnpm --filter @switchboard/web exec tsc --noEmit
pnpm --filter @switchboard/web test --run
pnpm --filter @switchboard/api test --run          # slower: PGlite
pnpm --filter @switchboard/web lint
npx prettier --check <changed files>

# run the demo (mock mode)
pnpm --filter @switchboard/web dev                 # :5173
```

There is a `.claude/launch.json` entry `web-mock` (port 5199) used for browser verification.

---

## 5. Gotchas that already cost hours — do not relearn these

1. **A failed `tsc` silently ships a stale bundle.** `apps/web` build is `tsc --noEmit && vite build`.
   If tsc fails, `dist/` keeps the PREVIOUS build and a deploy looks successful while shipping old
   code. Always confirm the build printed `✓ built in …`, and `rm -rf apps/web/dist` first.
2. **Vercel alias pinning.** On the old account a manual `alias set` detached auto-promotion, so
   `--prod` deploys stopped updating the public URL. The new project should auto-update; verify by
   diffing the served chunk hash, not by trusting the CLI's "Ready".
3. **Mock stores seed at MODULE INIT from the shared `db`.** `features/{comms,sms,calling,ai}/data/store.ts`
   fabricate sample history. In a personal/blank workspace that history was being invented **on the
   user's own imported leads** (phantom enrollments, a suppression silently blocking their own number).
   All four now gate on `workspaceMode() === 'blank'`. **Any new store must do the same.**
4. **Stale-chunk white screen.** Every deploy rotates chunk hashes, so an open tab crashed on its next
   lazy route. `apps/web/src/app/ErrorBoundary.tsx` now auto-reloads once (sessionStorage guard).
5. **Timeout cliffs.** Lazy-route assertions that pass alone fail under full-suite CPU contention.
   Several `findBy*` calls carry explicit generous timeouts on purpose. If a test fails in the full run
   but passes isolated, that is the cause — but check for a real perf regression before widening again.
6. **Demo accounts are per-browser.** There is no shared login to hand anyone; each person creates
   their own on their own device. Do not promise otherwise.
7. **MSW handler order is first-match-wins.** Route collisions are silent; there are regression tests
   pinning production handler order. Green unit tests have hidden real browser breakage before (D-029)
   — **always verify user-facing changes in a real browser in mock mode.**

---

## 6. Rules that are not negotiable

- **Compliance rails live in the engine layer**, re-checked _inside_ the send transaction
  (`apps/api/src/services/sequences/dispatch.ts`). No API bypass (I-RAIL-API).
- **`CONTRACTS.md` is the interface.** Additive changes only, bump the version, log the decision in
  `DECISIONS.md` (append, never renumber — check the tail for the latest number).
- **Prove it or it isn't done.** Ship the tests; no green, no done; verify UI in a real browser.
- **No secrets in code or logs.** Strict TypeScript: no `any`, no `@ts-ignore`, no committed `TODO`.
- Keep `STATUS.md` / `DECISIONS.md` current and committed on `main`.

---

## 7. Open items

**Needs a human (not an agent):**

- The Vercel Git connect above.
- Real service credentials for real mode: Gmail OAuth, Twilio, Deepgram, Anthropic, an OIDC IdP
  (`HUMAN_TODO.md` has the full list).
- Delete two stale projects (`switchboard-demo`, `switchboard-crm-demo`) left on the **former** Vercel
  account `pdvillorente12-1736`; their old URLs still serve outdated copies.
- ~~Repoint the git remote~~ — done: `origin` is now `github.com/pllxrgn-ui/close-clone`.

**Known accepted gaps (documented, not bugs to "discover"):**

- The inbox store synthesizes queue display rows from lead signals rather than reading actual activity
  text (display fidelity only, no state corruption) — a future inbox-from-activities pass.
- A UI/UX audit's P2 backlog is open: a muted micro-text family measuring ~3.6–4.1:1 contrast
  (below WCAG AA for text), a few sub-24px tap targets, and compliance-block toasts that fade after 4s
  when they are the only explanation for a refused action.

**Concurrency warning.** Because two agent sessions share `main`, assume anything below may already be
fixed. A six-dimension audit (compliance rails, security, web state/persistence, doc drift, build/deploy,
test health) was run on 2026-07-20 in parallel with the `D-057` pass; before acting on any finding,
verify it still reproduces on the current tree.

# Multi-tenancy + self-serve signup — scoping study

**Status: PLAN ONLY. Nothing here is built. Not approved.**
Dated 2026-08-03. Produced because the pilot's Google sign-in raised "can strangers
just sign up?" — the answer is that they can *authenticate* today, and that is
precisely the danger (§7).

---

## 0. The number, first

**~50–80 engineer-days of focused work — 60–75 is the planning number.**
10–16 weeks solo; 3–4 months calendar with review and QA. Roughly 55% API,
20% web, 25% tests-and-migration. Expect Phases 2 and 3 to each overrun.

Plus two **non-engineering gates that can dominate the calendar** (§8): Google
OAuth restricted-scope verification, and Twilio A2P 10DLC as an ISV.

Why it is not "add a `tenant_id` column":

| Reality | Evidence |
|---|---|
| 31 tables, ~29 tenant-scoped | `apps/api/src/db/schema.ts` (31 `pgTable`, lines 92–753), plus a 32nd created at runtime (`services/tokens/rate-limit.ts:71`) |
| ~408 Drizzle query sites + 41 raw `sql` templates across 120 files | `apps/api/src`, non-test |
| 41,355 LOC non-test API; 30,631 LOC across 161 test files | every fixture builder assumes one org |
| The single query authority emits raw SQL from **another package** | `packages/shared/src/dsl/compile.ts:166–179` — no TS chokepoint in `apps/api` can see it |
| `org_settings` is a literal singleton, one value snapshotted at **process boot** | `apps/api/src/main.ts:474–477` `loadOrgTimezone` |
| Compliance rails key on global, unqualified identity | `suppressions` unique on `(kind, value)` (`schema.ts:546`); `resolveContactByPhone` matches any contact anywhere (`services/telephony/phone.ts:32`) |
| Telephony is single-number-per-process | `TWILIO_PHONE_NUMBER` → `main.ts:397–403`, `main.ts:809` |
| `CLAUDE.md` §4 states the opposite as a golden rule | "Scope discipline. Internal, single-tenant… **No multi-tenancy**" — this is a deliberate repeal and must be logged in `DECISIONS.md` |

**A trap specific to this repo.** `apps/web/src/auth/accounts.ts` and
`apps/web/src/mocks/workspace.ts` already implement self-serve signup with a
per-account isolated workspace — entirely in `localStorage`, mock-mode only. The
demo *already looks like* multi-tenancy. Nothing on the server is tenant-aware.
Any "it already works" intuition from the demo is exactly the D-061 illusion.

---

## 1. Data model

### 1.1 Identity: global `users` + a `memberships` join table

Not tenant-local users. Because:
- `users.idp_subject` is already globally unique (`schema.ts:106`) and
  `provisionUser` upserts on it (`auth/provisioning.ts:62–95`). Google's `sub` is
  one identity everywhere; tenant-local users would need duplicate rows (breaking
  that index) or a synthetic composite subject.
- One human will legitimately be in two workspaces (own trial + a customer's).
  Tenant-local users make that a second account with a second login.

```
organizations   id, name, slug (unique citext), created_by → users, plan,
                status ('active'|'suspended'), created_at, updated_at
memberships     id, organization_id → organizations, user_id → users,
                role ('rep'|'admin'|'owner'), status ('active'|'invited'|'disabled'),
                invited_by?, invited_email citext?, invite_token_hash?,
                invite_expires_at?, accepted_at?, created_at, updated_at
                UNIQUE (organization_id, user_id)
                UNIQUE (organization_id, invited_email) WHERE status = 'invited'
```

`users.role` (`schema.ts:98`) becomes **legacy**. CONTRACTS is additive-only, so
the column stays and keeps being written; `memberships.role` becomes
authoritative and `auth/guards.ts:104` `requireAdmin` reads the membership.
Document it as "frozen, non-authoritative" — do **not** silently drop it.

### 1.2 Scoped vs global

**Tenant-scoped (`tenant_id uuid NOT NULL REFERENCES organizations(id)`) — 29:**
`leads` `lead_statuses` `opportunity_stages` `contacts` `opportunities`
`custom_field_defs` `activities` `tasks` `notes` `email_accounts` `email_threads`
`email_messages` `templates` `snippets` `sequences` `sequence_steps`
`sequence_enrollments` `send_intents` `suppressions` `calls` `sms_messages`
`smart_views` `api_tokens` `audit_log` `org_settings` `sync_events` `imports`
`webhook_subscriptions` `webhook_deliveries`

`lead_statuses` / `opportunity_stages` are reference data *each tenant edits* —
per-tenant, or one tenant renaming "Qualified" renames it for everyone.

**Global, each with a named reason:**

| Table | Reason |
|---|---|
| `users` | global identity |
| `organizations` | the tenant table |
| `memberships` | the join; `organization_id` *is* the tenant column |
| `webhook_inbox` | pre-resolution ingress buffer — a Twilio/Gmail push arrives before any tenant is known. Untrusted; never join to tenant data without resolution |
| `api_rate_limit_windows` | infra counters — but the **key** must include tenant or one tenant starves another (§5.5) |

There is no fourth category.

### 1.3 Composite FKs — what makes cross-tenant *writes* impossible

Today `leads.owner_id → users.id` (`schema.ts:134`) can legally point at a user in
another org. Instead:

```sql
ALTER TABLE memberships ADD UNIQUE (organization_id, user_id);
ALTER TABLE leads ADD CONSTRAINT leads_owner_in_tenant
  FOREIGN KEY (tenant_id, owner_id) REFERENCES memberships (organization_id, user_id);
ALTER TABLE contacts ADD CONSTRAINT contacts_lead_in_tenant
  FOREIGN KEY (tenant_id, lead_id) REFERENCES leads (tenant_id, id);
```

Every parent-child FK becomes `(tenant_id, parent_id) → (tenant_id, id)`, needing
`UNIQUE (tenant_id, id)` on each parent (cheap; doubles as an RLS-friendly index).
**The database itself then refuses to attach tenant B's contact to tenant A's
lead** — independent of RLS, of the application, of anyone remembering a `WHERE`.

Apply at minimum to: `contacts.lead_id` · `opportunities.{lead_id,contact_id,stage_id,owner_id}` ·
`activities.{lead_id,contact_id,user_id}` · `tasks.{lead_id,assignee_id,created_by}` ·
`notes.{lead_id,author_id}` · `email_accounts.user_id` · `email_threads.lead_id` ·
`email_messages.{account_id,thread_id}` · `sequence_steps.{sequence_id,template_id}` ·
`sequence_enrollments.{sequence_id,lead_id,contact_id,email_account_id,enrolled_by}` ·
`send_intents.{enrollment_id,step_id}` · `calls.{lead_id,contact_id,user_id}` ·
`sms_messages.{lead_id,contact_id,user_id}` · `smart_views.owner_id` ·
`templates.owner_id` · `snippets.owner_id` · `imports.created_by` ·
`audit_log.actor_id` · `suppressions.{created_by,released_by}` · `sync_events.account_id` ·
`webhook_deliveries.subscription_id` · `org_settings.recording_enabled_by` · `leads.status_id`

### 1.4 Unique-constraint rewrites — each a decision, not a mechanical edit

| Index | Change | Why |
|---|---|---|
| `suppressions_kind_value_key` (`schema.ts:546`) | → `(tenant_id, kind, value)` | **Product/legal decision.** Global would leak that a competitor's prospect unsubscribed, and let tenant A block tenant B. Someone who unsubscribed from Acme said nothing to Beta. Log in DECISIONS |
| `suppressions_active_lookup_idx` (`:550`) | → `(tenant_id, kind, value) WHERE released_at IS NULL` | hot compliance path |
| `custom_field_defs_entity_key_key` (`:274`) | → `(tenant_id, entity, key)` | two tenants both want `custom.industry` |
| `calls_twilio_sid_key` (`:578`), `sms_messages_provider_sid_key` (`:599`) | leave **global** | provider SIDs are globally unique; tenant-prefixing lets a spoofed SID collide |
| `api_tokens_hash_key` (`:664`) | leave global | a token hash must resolve to exactly one tenant |
| `email_messages_account_{rfc,provider}_key` (`:418–419`) | leave | `account_id` is tenant-scoped already |
| all 15 partial/hot indexes on `leads` (`:157–195`) | prefix `tenant_id` | else every list read scans all tenants then filters — this is where the 150ms p95 budget is spent or saved |
| `activities_lead_occurred_idx` (`:299–303`) | prefix `tenant_id` | timeline hot path |
| `send_intents_state_due_idx` (`:525`) | leave | the sweeper deliberately scans **across** tenants (§5.2) |

### 1.5 Migrating the pilot data

Risk lives in the DDL, not the data.

1. `0013_tenancy_core.sql` — create `organizations` + `memberships`; one org row; a membership per existing user carrying `users.role`.
2. `0014_tenant_columns.sql` — `ADD COLUMN tenant_id uuid` nullable → backfill → `SET NOT NULL` → FK. That order is what makes it re-runnable.
3. `0015_tenant_indexes.sql` — **`CREATE INDEX CONCURRENTLY` cannot run inside the Drizzle migrator's transaction.** Split it out and run manually against Neon, or bypass the wrapper. `migrateOnBoot` (`main.ts:129–136`) holds an advisory lock for the duration — seconds on pilot data, an outage on real data. Decide and document.
4. `0016_tenant_uniques.sql` — uniqueness *widens* (global → per-tenant), so no existing row can violate. Safe direction.
5. `0017_composite_fks.sql` — `UNIQUE (tenant_id, id)` on parents, then composite FKs via `NOT VALID` + `VALIDATE CONSTRAINT` to avoid a long exclusive lock.
6. `0018_rls.sql` — policies (Phase 3).

**`org_settings` needs care**: read as `LIMIT 1` with no `WHERE` in at least four
places — `services/admin/org-settings.ts` `readSingleton`, `dispatch.ts:147`,
`dispatch.ts:168`, `main.ts:474`. Each new org needs a row created **transactionally
at signup**, or every rail falls back to defaults (`DEFAULT_DAILY_CAP = 200`,
`'UTC'`, `sendingWindow: null` — `dispatch.ts:157–158`). **Silently defaulting a new
tenant's compliance config is a compliance bug, not a convenience.**

---

## 2. Query scoping — the chokepoint

### 2.1 Options considered and rejected

- **Repository layer** — rejected as primary: a rewrite of 408 sites across 120
  files, can't reach `packages/shared`'s compiler at all, and is still "remember
  to use the repo" — the exact failure mode we're eliminating.
- **Drizzle middleware/wrapper** — rejected. Drizzle has no query middleware, and
  `.where()` **replaces** rather than appends, so an injected predicate is silently
  overwritten by the caller's own `.where()`. `db.execute(sql\`…\`)` (41 sites,
  including every compliance probe) is opaque to it. **Its real danger is producing
  a convincing false sense of structure.**
- **Lint/test guard** — necessary but insufficient; keep as supplement (§2.4).
- **Schema-per-tenant** — worth naming: `SET search_path`, zero `tenant_id` columns,
  all 408 sites unchanged. Rejected because many small self-serve tenants degrade
  it (migration = N × DDL under one advisory lock, `pg_catalog` bloat), and it
  doesn't solve the hard part — you still must pin `search_path` to the right
  connection, the same chokepoint problem. **If you expect <~50 enterprise-sized
  tenants, revisit — it would cut Phase 2 entirely.**

### 2.2 Recommendation: RLS + tenant-bound executor + composite FKs

```sql
ALTER TABLE leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE leads FORCE ROW LEVEL SECURITY;        -- owner must not bypass
CREATE POLICY leads_tenant ON leads
  USING      (tenant_id = current_setting('app.tenant_id', false)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', false)::uuid);
```

`current_setting(…, false)` — **missing setting raises, does not return NULL.**
Fail loud. Requires a **non-superuser, non-owner** role: superusers always bypass
RLS; owners bypass unless `FORCE`.

### 2.3 The four files that become the chokepoint

Routes destructure `db` once at registration and pass it to every service
(`routes/leads.ts:106` → `listLeads(db, …)` at `:126`); all 27 route modules follow
this, driven by `RouteDeps.db: Db` (`routes/index.ts:45`). Services never construct
a handle. **So if the `Db` handed to a service is already tenant-bound, no service
changes at all.**

| File | Change |
|---|---|
| **`db/tenant.ts`** *(new)* | `withTenant(pool, tenantId, fn)` — checks out one client, sets `app.tenant_id`, wraps a Drizzle handle **and** a `RawQueryable` over that *same* client. The only place `app.tenant_id` is ever written |
| **`routes/index.ts`** | **Delete `db: Db` from `RouteDeps` (line 45)**, replace with `dbFor(request)`. After this a route *cannot* obtain an unscoped handle — attempts are a **TypeScript error**, not a review miss |
| **`main.ts`** | Build the resolver near the existing session preHandler (705–720). Delete `loadOrgTimezone` (474–477) — a boot snapshot of a now-per-tenant value |
| **`services/smartviews/support.ts:38`** | `rawClientOf(db)` digs out `db.$client` — **in production that's the `pg.Pool`, not a pinned connection.** Delete the fallback; `withTenant` must inject it. **The single highest-risk line in the migration** |

**Long-running-transaction problem.** `SET LOCAL` needs an open transaction, but
some handlers make provider network calls (Gmail send). Holding a transaction
across a multi-second HTTP call is unacceptable. Two mitigations, both needed:
use session-level `SET` on a **pinned pooled client** with `RESET ALL` in a
`finally` (safe iff release always runs — enforce inside `withTenant`, never hand
the raw client out); and keep provider calls **outside** transactions, which
`dispatch.ts` already does correctly (commits at 543, `provider.send` at 560,
re-locks at 576). Audit the one-off engines for the same property before Phase 3.

### 2.4 Supplements (cheap, keep)

- ESLint: ban importing `drizzle-orm/node-postgres` / `pg` outside `db/`, `main.ts`, `cli/`, `perf/`.
- ESLint: ban `current_setting` / `SET app.tenant_id` literals outside `db/tenant.ts`.
- Types: brand `TenantDb` (`Db & { __tenant: true }`) so a service taking a raw `Db` won't accept it.

---

## 3. The D-061 lesson applied

D-061 was **code written, tested, green, and never connected in the artifact you
deploy** — five instances, root cause two composition roots (`dev/boot.ts` vs
`main.ts`) that drifted, with every "verified against the real API" check aimed at
the wrong one. The structural fix was the route-mount manifest
(`main.test.ts:564–740`).

### 3.1 The equivalent silently-unwired failures

**(A) The GUC is set on a different connection than the one running the query.**
`db/test-helpers.ts:29` creates **PGlite** — **single-connection**, so a session
`SET` persists forever. `dev/boot.ts` uses it too. Production (`main.ts:616`) uses
`new pg.Pool(…)`, where consecutive statements land on **different** connections.

So: all 161 test files pass, `dev/boot.ts` works perfectly, local real-mode works
perfectly — and in the container `smartviews/query.ts:78/:101/:145` execute the
compiler's SQL through `rawClientOf(db)` (**the pool**) on a connection that never
saw `SET app.tenant_id`. With `current_setting(…, false)` Smart Views throw 500;
with the "friendlier" `true` variant someone will suggest in review, they
**silently return another tenant's leads**. Same shape as D-061, with a data
breach at the end instead of a 403.

**(B) RLS enabled but not enforced against the connecting role.** The app connects
as the schema owner today (CI `DATABASE_URL`, `.github/workflows/ci.yml:43`).
Owners bypass RLS unless `FORCE`; superusers bypass even `FORCE`. PGlite runs as
`postgres` — **superuser**. A suite seeding two tenants and asserting isolation
passes **vacuously** whether or not any policy exists.

**(C) A worker path with no tenant context.** `main.ts:837–848` dispatches
`processIntent` with `dispatchDeps` built at boot (788–811) holding the raw `db`;
`sweepDueIntents` (854) scans across all tenants by design. If `processIntent`
inherits a GUC left on a recycled connection, the DNC probe (`dispatch.ts:424–431`)
and suppression probe (`:434`) evaluate against **the wrong tenant's list** — i.e.
"we texted someone who said STOP".

**(D)** A new table lands without `tenant_id`. Ordinary drift.

### 3.2 The tests — and yes, a manifest is the right shape

**Test 1 — tenancy manifest** (`db/tenancy.manifest.test.ts`), direct analogue of
`PRODUCTION_MOUNT_MANIFEST`. A declared `Record<tableName, {scope, reason?}>`,
set-equality **both directions** against tables actually exported from `schema.ts`
(enumerate via `import * as schema` + `is(x, PgTable)`, as `routeModulesOnDisk()`
reads the directory at `main.test.ts:667`). For each `tenant` entry assert against
the live catalog: column exists + NOT NULL + FK; `relrowsecurity` **and**
`relforcerowsecurity` true; ≥1 policy with **both** `qual` and `with_check`. For
each `global` entry, `reason` must be non-empty. Catches (D) and half of (B).

**Test 2 — cross-tenant probe suite, real Postgres, pool ≥ 2, non-superuser role.**
`apps/api/src/tenancy.crosstenant.test.ts`, gated on `DATABASE_URL` the way
`perf/run.ts:73–85` gates its authoritative mode. **Must not run on PGlite.**
- Compose through `registerProductionRoutes` — the same function `main.test.ts:650`
  uses, so it's provably production wiring, not a bespoke harness.
- Seed orgs A and B with a lead, contact, suppression, sequence, smart view each.
- Iterate `PRODUCTION_MOUNT_MANIFEST` (reuse it — one manifest, two suites); for
  every route, request as an A-member with a B-owned id. Assert 404 or empty page.
  **Never 200-with-data, never 500.**
- Assert the inverse too (A-member, A id → 200), else a globally-broken filter
  passes the isolation half vacuously.
- `pool.max = 4`, ≥8 concurrent interleaved A/B requests. **This is what catches (A).**

**Test 3 — non-superuser enforcement, asserted not assumed.** `SELECT rolsuper,
rolbypassrls FROM pg_roles WHERE rolname = current_user` → both false. Plus a
boot-time assertion in `main.ts` beside `assertRealModeConfig` (161) refusing to
boot as superuser/`BYPASSRLS` — same fail-closed posture as the existing IdP and
Twilio checks. Catches (B) permanently.

**Test 4 — worker tenant context.** Property test beside
`services/sequences/send-safety.property.test.ts`: two tenants, both with an intent
to the *same* destination, B has a suppression, A does not; interleave
`processIntent` across a shared pool. Assert A sends, B is `BLOCKED` reason
`suppressed`, and flipping the suppression flips the result. Catches (C) — **the
single most important test in the plan.**

**Test 5** — add the real-PG tenancy job to `.github/workflows/ci.yml` (the
`build-test` job already has `postgres:16`), as a **required** check. The lesson of
D-061 is exactly that unit-green is not evidence for this class.

---

## 4. Auth

### 4.1 Replacing the verified-domain strategy

`resolveRole` (`auth/rbac.ts:99–132`) answers "does this token deserve a role in
*the* org". That splits into three:
1. **Authentic?** Keep every existing check verbatim — `email` present (`:108`),
   `email_verified === true` (`:112`). The comment at `:109–111` ("an unverified
   email is an ATTACKER-CHOSEN string") is *more* important with self-serve.
2. **Which orgs?** New `resolveMemberships(db, userId)`, replacing the
   `hd`/`AUTH_ALLOWED_DOMAIN` checks (`:114–125`).
3. **What role?** `memberships.role`, replacing `domain.adminEmails` (`:129`).

**Retain the `groups` strategy** (`:100–104`) — it's how an enterprise tenant with
its own Keycloak provisions, and `assertRealModeConfig` (`main.ts:176–186`) already
encodes the "Google emits no groups" trap. Reframe per-org:
`organizations.auth_strategy ∈ ('self_serve'|'groups'|'verified_domain')`. The
existing pilot becomes org #1 with `verified_domain` — **so Phase 5 ships without
breaking the pilot.**

Boot assertions need revisiting: `AUTH_ALLOWED_DOMAIN` stops being process-level,
so "Google issuer without AUTH_ALLOWED_DOMAIN refuses to boot" (`main.ts:179–186`)
becomes wrong — with self-serve, Google + no domain is *normal*. Replace with:
refuse to boot if neither `SELF_SERVE_SIGNUP=1` nor any org strategy is configured,
so "SSO that can never admit anyone" stays a boot failure. Invert the test at
`main.test.ts:100–110` under the new flag.

### 4.2 Signup vs login — split the outcome, not the route

`GET /api/v1/auth/callback` resolves claims unchanged (`routes.ts:117–142`), then:

| Identity state | Behaviour |
|---|---|
| Known subject, ≥1 active membership | log in, redirect to last-used org (existing, `:173–179`) |
| Known subject, 1 pending invite matching `claims.email` | accept invite atomically, log in |
| Known subject, 0 memberships | redirect to `/onboarding` — **do not auto-create an org** (that makes org-spam one click) |
| Unknown subject + invite token in txn cookie | create user + accept invite in one transaction |
| Unknown subject, no invite, `SELF_SERVE_SIGNUP=1` | create user → `/onboarding` (org creation an explicit second step) |
| Unknown subject, no invite, self-serve off | `auditDenied('no_membership')` → `failRedirect('no_access')` — byte-identical to today's refusal (`:135–140`) |

`provisionUser` (`provisioning.ts:62–95`) stays nearly intact — it already row-locks
on `idp_subject` (`:69`). Add `provisionMembership(tx, …)` in the same transaction.
Its `inactive` handling (`:73`) moves to membership level: **deactivating a user in
org A must not lock them out of org B.**

### 4.3 First-user-creates-org

`POST /api/v1/orgs` (session required, membership not): one transaction →
`organizations` → `memberships` role `owner` → **`org_settings` with explicit
defaults** (§1.5) → default `lead_statuses`/`opportunity_stages` (now per-tenant;
reuse `services/seed/reference.ts`) → `audit_log`.

Introduce **`owner` as a third role** rather than reusing `admin`: `requireAdmin`
(`guards.ts:104`) gates destructive config; `owner` additionally gates billing, org
deletion, last-admin-removal. Additive to `userRoleValues`, landing on
`memberships.role`, leaving frozen `users.role` untouched.

**Rate-limit org creation per user** (reuse `PostgresRateLimiter`, `main.ts:685`) —
without it one Google account mints unlimited orgs.

### 4.4 Invites

`POST /api/v1/admin/invites {email, role}` → `memberships` `status='invited'` with a
**hashed** token (mirror `api_tokens.hash`, `schema.ts:657` — never plaintext) +
expiry. Delivery via the existing `EmailProvider` adapter, so it works under
`MOCK_MODE=1` with zero accounts.

`GET /api/v1/auth/login?invite=<token>` stashes the token in the existing
`OidcTxnCodec` cookie (`auth/session/txn.ts`, issued `routes.ts:85–91`) so it
survives the IdP round-trip **without appearing in the redirect URL**. Acceptance
must require `claims.email === invited_email` — **otherwise a leaked invite link is
an account takeover.**

### 4.5 Session carries the active org

`SessionCodec` encodes `userId` only (`main.ts:145–150`). Add `orgId`. `requireSession`
(`guards.ts:96`) resolves the membership, rejects if absent/disabled, decorates
`request.org` beside `request.user`/`request.actor` (`:90–91`). Add
`POST /api/v1/auth/switch-org`.

**The org must come from the signed cookie, never a header or body.** An
`X-Org-Id` header would be a one-line cross-tenant read — the same reasoning as
`NO_SESSION_ACTOR_SENTINEL` (`main.ts:436–444`), applied to tenancy.

Bearer tokens (`main.ts:684–689`): `api_tokens` is tenant-scoped, so the token row
*is* the tenant — no header needed. `smart-views`/`bulk` already refuse tokens via
`requireHumanActor` (`main.ts:456–465`); leave that alone.

---

## 5. Compliance rails — highest risk

### 5.1 Rails that leak *across* tenants (over-blocking — annoying)

| Rail | Site |
|---|---|
| Email suppression | `services/sequences/suppression.ts:16` — A's unsubscribe blocks B |
| Phone suppression | `services/telephony/suppression.ts:21` |
| DNC by phone | `services/compliance/dnc.ts:64` — deliberately not lead-scoped (docblock 29–33: "DNC attaches to a human, not a row"). **Correct within a tenant, void across.** Amend that D-060 rationale, don't silently contradict it |
| DNC by email | `services/compliance/dnc.ts:89` |

### 5.2 Rails that leak the other way (under-blocking — this ends the company)

**Workers with no tenant context.** `dispatchDeps` is built once at boot
(`main.ts:788–811`); the sweeper runs every 15s (`:853–876`). `sweepDueIntents` must
scan across tenants; `processIntent` must **adopt the intent's tenant** before any
rail runs. Otherwise it claims an intent for B while `app.tenant_id` is still A's,
B's suppression is invisible, **and the send goes to someone who unsubscribed.**

Fix structurally: change `DispatchDeps.db: Db` (`dispatch.ts:91`) to a
`withTenant`-shaped factory; the first thing `processIntent` does is resolve the
intent's tenant in an unscoped bootstrap query, then run everything inside
`withTenant(...)`. Same for `sweepDueIntents`, `services/telephony/process.ts`
(`main.ts:862`), `sweepPendingWebhookDeliveries` (`:869`), `handleTelephonyJob` (`:844`).
**The bootstrap query is the one query allowed to run unscoped** — it lives in
`db/tenant.ts` with a name that says so: `resolveTenantForWork(kind, id)`.

**Per-tenant org config.** `loadOrgConfig` (`dispatch.ts:147`) and `loadQuietHours`
(`:168`) both `SELECT … LIMIT 1`. After migration that returns *an arbitrary
tenant's* row unless scoped — `dailySendCap`, `sendingWindow`, `companyTimezone`,
`quietHours` all from the wrong org, so I-SEND-4 and I-QUIET evaluate against a
stranger's settings. RLS fixes it *provided* the connection is bound; still change
`LIMIT 1` to an explicit `WHERE tenant_id = …` as defence in depth.

**Recording consent (I-REC).** `org_settings.recording_enabled` +
`recording_legal_signoff_ref` (`schema.ts:684–688`) become per-tenant. The existing
refusal to flip without a legal sign-off ref is correct, just needs the tenant.
**A new self-serve tenant must default to `recording_enabled = false`** — schema
default is already `false`; verify signup doesn't override it.

### 5.3 Ingress — paths with no tenant

**`/wh/twilio/*`.** Impossible today: one process-level `TWILIO_PHONE_NUMBER`
(`main.ts:397/402/809`). Inbound resolves by *caller* number
(`services/telephony/process.ts:344` → `phone.ts:32–47`), a **global** lookup on
trailing-10-digits with no tenant predicate. So:
- A number that is a contact in two tenants routes to whichever is older
  (`ORDER BY c.created_at ASC`, `phone.ts:44`) — **one tenant's prospect's message
  on another tenant's timeline.**
- A STOP keyword writes a suppression (`process.ts:363/:397`) that must belong to
  *the tenant whose number was texted*.

**The correct key is `To` (the org's own number), not `From`.** That needs
per-tenant numbers — Twilio subaccounts, or at minimum a `tenant_phone_numbers`
table populated at provisioning. Then `processSms` resolves tenant from `To`,
enters `withTenant`, *then* calls `resolveContactByPhone` (now RLS-filtered).
**Until per-tenant numbers exist, telephony cannot be safely multi-tenant** — a
hard dependency. Correspondingly, a tenant with half-configured telephony must be
**paused for that tenant**, not for the process.

**`/wh/gmail`** resolves cleanly: payload `emailAddress` → `email_accounts.address`
→ tenant. Low risk.

**`/api/v1/unsubscribe/:token`** (exempt from the session gate, `main.ts:694`).
`createUnsubscribeToken` (`services/sequences/unsubscribe.ts:35–38`) HMACs **only
the email address**, then writes a global suppression — so a token minted by A
would suppress for whichever tenant the connection is bound to, or all of them.
**Fix: version the token** — `v2.<b64url(tenantId|email)>.<mac>`, with
`verifyUnsubscribeToken` accepting v1 (email-only → pilot org) and v2. Additive and
versioned exactly as CONTRACTS permits; the v1 window is what stops every
already-delivered email's unsubscribe link from breaking.
`LIST_UNSUBSCRIBE_SECRET` stays process-level — it authenticates the token, and the
tenant is *inside* the authenticated payload.

### 5.4 I-RAIL-API grows a clause

Add: **and a valid token for tenant A cannot cause any effect in tenant B.** Extend
each existing bypass-attempt test with a cross-tenant variant.

### 5.5 Cross-tenant denial of service

Per-mailbox daily cap (`dispatch.ts:471–483`) is naturally tenant-scoped. But the
**BullMQ queue is shared** — one tenant enrolling 10,000 leads starves everyone
else's sends. Not a leak, but a compliance risk: a starved tenant's sends drift out
of their legal window. Needs per-tenant fairness (weighted round-robin over
partitioned queues, or a per-tenant in-flight cap). Phase 8; note it, don't pretend
it's free.

---

## 6. CONTRACTS.md impact — target v1.4.0

All additive. Nothing removed; two things marked frozen.

| Section | Change |
|---|---|
| **§C1** | Add `organizations`, `memberships`. Add `tenant_id` to the 29. Amend `suppressions` unique + per-tenant rationale. `org_settings`: "singleton" → "one row per organization". Mark `users.role` **frozen/non-authoritative** → `memberships.role`. Add `owner`. Note the deliberately-global tables with reasons |
| **§C3** | Grammar unchanged, but two normative facts move: `owner in (me)` binds within the active org, and relative dates resolve in **the acting org's** timezone (today a boot snapshot, `main.ts:474`). State that the compiler relies on RLS and **must not** get a tenant predicate at the AST level — one enforcement point, not two that can disagree |
| **§C6** | Amend **I-DNC** (D-060's "attaches to the human" language: correct within a tenant, void across). Amend **I-QUIET**: "globally" → "across the acting organization"; add the `To`-number rule. Amend **I-SEND-3/4/5** to name the tenant's `org_settings`. Amend **I-REC**: per-org sign-off, new orgs default off. Extend **I-RAIL-API** (§5.4). Add **I-TENANT**: "no read or write observes or mutates a row outside the acting organization; enforced by `FORCE ROW LEVEL SECURITY` under a non-superuser role, proven by the cross-tenant probe suite on real Postgres with a pool ≥ 2" |
| **§C7** | New: `POST /orgs`, `GET /orgs`, `POST /auth/switch-org`, `GET\|POST\|DELETE /admin/invites`, `POST /auth/invites/:token/accept`. Session cookie carries `(userId, orgId)`; org **never** from header or body. `admin/*` gains `owner`-only surfaces. Unsubscribe token versioned. `GET /users` (v1.2.0/D-023) now scoped to co-members |
| **§C8** | `FORBIDDEN` 403 where existence is already known; **`NOT_FOUND` 404 for cross-org reads** (existence-non-leaking, matching the D-061 precedent). Consider `ORG_REQUIRED` 409 so the SPA routes to `/onboarding` without string-matching |
| **§C9** | DB tests asserting tenant isolation are **not authoritative on PGlite** (single-connection, superuser) — same carve-out the latency gate already has |

Numbered `DECISIONS.md` entries needed for the genuine judgment calls: per-tenant
suppressions; global-users-plus-memberships; `owner` as a third role; org creation
explicit rather than auto-on-login; 404-not-403 for cross-tenant reads; and the
repeal of `CLAUDE.md` §4's single-tenant scope rule.

---

## 7. Phases

| # | Phase | Days |
|---|---|---|
| 0 | Decisions + contract → v1.4.0, DECISIONS D-066…D-072, amend `CLAUDE.md` §4 and §1. **No code** — ship first, CONTRACTS is law | 2–3 |
| 1 | `organizations` + `memberships`, backfilled, **unused**. Manifest test v1 lands declaring every table `global` with reason "not yet scoped", so later phases flip entries rather than invent the harness. Green trivially, zero behaviour change | 3–5 |
| 2 | `tenant_id` columns, indexes, uniques, composite FKs. All 29 tables. Identical rows (one tenant). Fixtures + `services/seed/*` + `db/test-helpers.ts` learn to stamp a tenant. **Touches the most test files (161) — this is where the day count hides.** `org_settings` per-tenant; `loadOrgTimezone` deleted, consumers (`main.ts:559/:566`) take it per-request | 8–12 |
| 3 | **The chokepoint.** RLS policies + `FORCE`; new non-superuser role; `db/tenant.ts`; `RouteDeps.db` deleted; 27 route modules edited; `rawClientOf` fallback deleted; boot-time superuser refusal. **Tests 2 + 3 land and become required CI checks.** Highest risk; makes everything after it safe | 10–15 |
| 4 | Workers + ingress tenant resolution; unsubscribe token v2. **Test 4 lands.** Telephony gated on per-tenant numbers (§5.3) — if not ready, ship with telephony **explicitly paused** for all but the pilot org | 6–10 |
| 5 | Auth: signup, org creation, invites, membership roles; `SessionCodec` carries `orgId`; boot assertions revised. Pilot keeps `verified_domain` so nothing regresses | 6–10 |
| 6 | Web: signup/onboarding, org switcher, invite UI, "no org yet" gate. `AuthProvider` grows an org dimension — **D-062's three-state lesson applies identically**: needs a fourth state, "authenticated but org not yet known", or the redirect loop returns. MSW parity. Retire/quarantine `auth/accounts.ts` + `mocks/workspace.ts` so localStorage demo-tenancy can't be mistaken for the real thing | 10–15 |
| 7 | Assurance hardening: Test 2 across every route × every id-bearing parameter (path, body, query, `ids=` at `routes/leads.ts:50`, **cursors** — an opaque keyset cursor from A is an attacker-supplied blob, `smartviews/support.ts:65`). Adversarial: forged cursors, forged `ids=`, org id in a header, expired invite reuse, cross-org bearer token, `POST /leads/merge` across orgs (`routes/leads.ts:147`). Fuzz the DSL against the boundary | 4–6 |
| 8 | Per-tenant provider credentials + fairness: Twilio subaccounts/number ownership, per-tenant sender identity, queue fairness (§5.5), quotas, billing | 10–15 + vendor lead time |

**Total 49–91; plan for 60–75.**

### What could go catastrophically wrong

| Failure | Blast radius | Proof it hasn't |
|---|---|---|
| **Cross-tenant read** | Breach. Notifiable. Company-ending for a CRM | Test 2 — real PG, pool ≥ 2, every route × every id param, both directions |
| **Cross-tenant compliance miss** — send to someone who said STOP | Regulatory (TCPA/CAN-SPAM/CASL) + "the CRM texted someone who opted out" | Test 4 — two tenants, same destination, suppression on one, interleaved workers |
| **RLS silently bypassed** (superuser/owner, or `FORCE` omitted) | Every isolation test passes vacuously forever | Test 3 + boot-time role refusal |
| **GUC on the wrong pooled connection** | Another tenant's data, or 500 in prod while green in dev | Test 2 with `pool.max ≥ 2` + concurrency. **Cannot be caught on PGlite** |
| **Migration takes the pilot down** — `CREATE INDEX` without `CONCURRENTLY` under the boot migrator's advisory lock | Outage; possibly a stuck lock | Rehearse on a Neon branch with `EXPLAIN`/timing; split those migrations out |
| **`org_settings` defaults silently applied** — no window, cap 200, UTC | Sends outside the tenant's legal window from day one | Create an org via `POST /orgs`; assert an explicit settings row with `recording_enabled=false`; assert `loadOrgConfig` never returns its `DEFAULT_DAILY_CAP` fallback (`dispatch.ts:157`) |
| **Inbound SMS to the wrong tenant's timeline** | Confidential message on a stranger's screen | Same number as a contact in two orgs; webhook to A's `To`; assert activity only in A |
| **Invite link = account takeover** | Full access to a customer's CRM | Accept with mismatched `claims.email` → refused + audited |
| **Org-creation spam** | Abuse, cost | Rate-limit test on `POST /orgs` |
| **Unsubscribe replay across tenants** | Suppression against the wrong org | v1 token resolves only to pilot org; v2 for A leaves B untouched |

---

## 8. Not code — and possibly the long pole

**Google OAuth verification.** Gmail today works because it's an internal Workspace
app (`providers/email/gmail-email-provider.ts`, gated `main.ts:308`). Publishing to
strangers means OAuth verification, and Gmail read scopes are **restricted** →
annual third-party CASA security assessment. Months and real money. **Start it in
parallel with Phase 1, not after Phase 8.** Until it clears, self-serve tenants can
sign in but **cannot connect a mailbox** — which removes the product's spine
(`CLAUDE.md` §1: "communication-first"). Decide up front whether the first
self-serve release ships without email sync.

**Twilio A2P 10DLC.** Self-serve SMS to US numbers needs brand + campaign
registration. As an ISV you either register each tenant as a sub-brand (an
onboarding flow you don't have) or your traffic gets filtered. With §5.3's
per-tenant-number requirement, **telephony is what makes multi-tenancy expensive**,
not the database work.

**And the one nobody budgets.** The moment strangers' contact data lands in your
Postgres you are a **data processor** for other companies: DPA, subprocessor list,
privacy policy, breach-notification process, deletion/export SLAs (`services/export/`
is a good start), security-questionnaire posture. Legal and operational work with
its own calendar — `HUMAN_TODO.md` material. It gates the first paying tenant, not
the first commit.

---

## Critical files

- `apps/api/src/db/schema.ts` — all 31 tables; every index and unique to rewrite; what the manifest test enumerates
- `apps/api/src/main.ts` — production composition root: request-scoped binding (near 705–720), workers (788–848), sweeper (853–876), `loadOrgTimezone` (474–477) to delete, boot assertions (161–262) to revise
- `apps/api/src/routes/index.ts` — `RouteDeps.db: Db` (line 45): the handle that must stop existing
- `apps/api/src/services/sequences/dispatch.ts` — the send transaction; every rail (147, 168, 424/812, 434/829, 442, 471) must become tenant-correct; `DispatchDeps.db` (91) must stop being a raw handle
- `apps/api/src/main.test.ts` — `PRODUCTION_MOUNT_MANIFEST` (564–606) + suite (675–740): the pattern to copy, and the route list to reuse
- `apps/api/src/services/smartviews/support.ts:38` — `rawClientOf` returns the **pool**; the single highest-risk line

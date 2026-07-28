# Switchboard deploy kit

One command brings up the whole stack on an internal Docker host / small VM
(ARCHITECTURE section 8). Everything here is self-contained: `docker compose`,
two Dockerfiles, backup/restore scripts, and the docs. TLS is terminated upstream
by the company proxy; the app speaks plain HTTP behind it.

```
            company TLS proxy / internal LB   (terminates HTTPS)
                          │  http
                    ┌─────▼─────┐  :8080
                    │    web    │  nginx: static SPA + gzip + security headers
                    │  (nginx)  │  reverse-proxy /api /ws /wh /healthz
                    └─────┬─────┘
                          │  http (compose network — no host ports)
                    ┌─────▼─────┐
                    │    api    │  Fastify. role=server: migrate-on-boot → serve
                    │ (node TS) │  role=worker: sweep/send (profile-gated, see below)
                    └──┬─────┬──┘
              ┌────────▼─┐ ┌─▼────────┐
              │ postgres │ │  redis   │   internal only, named volumes,
              │  (truth) │ │ (BullMQ) │   postgres → WAL archive volume
              └──────────┘ └──────────┘
```

## Prerequisites

- Docker Engine + the Compose v2 plugin (`docker compose version`).
- A copy of this repo on the host.
- `.env` created from `.env.example` (see the matrix below). Three values are
  required for a first mock-mode bring-up: `POSTGRES_PASSWORD`, `SESSION_SECRET`,
  and `LIST_UNSUBSCRIBE_SECRET` (the api refuses to start in production on the
  committed placeholder, an empty value, or anything under 32 chars — and
  `SESSION_SECRET` and `LIST_UNSUBSCRIBE_SECRET` must differ). A fourth,
  `GMAIL_PUSH_TOKEN`, becomes required the moment you run `MOCK_MODE=0` with
  `GOOGLE_CLIENT_ID` set — see its section below.

## Quickstart (one command)

```bash
cp deploy/.env.example deploy/.env
# edit deploy/.env: set POSTGRES_PASSWORD, SESSION_SECRET,
# LIST_UNSUBSCRIBE_SECRET (MOCK_MODE=1 is fine)
docker compose -f deploy/docker-compose.yml up -d --build
```

> **The env file that matters is `deploy/.env`** — note the path. With
> `-f deploy/docker-compose.yml` and no `--project-directory`, Compose takes
> `deploy/` as the project directory, so `deploy/.env` is what it auto-loads for
> `${VAR}` substitution _and_ what the api service's `env_file: .env` resolves
> to. A `.env` at the repo root is **not** read by this stack. (The root
> `.env.example` documents the same variables for a non-compose / local run.)

Then verify per **`deploy/VERIFY.md`** (compose config validates, all health
checks go green, `/healthz` responds, the restore drill prints PASS).

Stop / tear down:

```bash
docker compose -f deploy/docker-compose.yml down          # keep volumes (data safe)
docker compose -f deploy/docker-compose.yml down -v       # ALSO delete volumes (wipes data)
# `-v` destroys ALL five named volumes — the database, the WAL archive, the
# Redis AOF, staged import CSVs, and generated admin exports. See "Persistent
# state" below.
```

## `.env` matrix

| Variable                                                     | Service(s)     | Secret                            | Notes                                                                                          |
| ------------------------------------------------------------ | -------------- | --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `MOCK_MODE`                                                  | api            | no                                | `1` = all providers mocked, zero accounts. `0` = real integrations.                            |
| `NODE_ENV`                                                   | api            | no                                | `production`.                                                                                  |
| `PORT`                                                       | api            | no                                | In-container api port (3000). Not host-published.                                              |
| `WEB_HTTP_PORT`                                              | web            | no                                | Host port for the nginx front door (default 8080).                                             |
| `POSTGRES_USER`                                              | postgres, api  | no                                | Also composes `DATABASE_URL`.                                                                  |
| `POSTGRES_PASSWORD`                                          | postgres, api  | **yes**                           | **Set before first boot.**                                                                     |
| `POSTGRES_DB`                                                | postgres, api  | no                                | Database name.                                                                                 |
| `DATABASE_URL`                                               | api            | yes                               | Auto-derived to in-cluster postgres; set only to use an external DB.                           |
| `REDIS_URL`                                                  | api            | no                                | Auto-derived to in-cluster redis; set only for external Redis.                                 |
| `SESSION_SECRET`                                             | api            | **yes**                           | Signs sessions AND derives the OAuth-token encryption key. Rotating it forces mailbox re-auth. |
| `LIST_UNSUBSCRIBE_SECRET`                                    | api            | **yes**                           | Signs one-click unsubscribe tokens (I-SEND-5). Must differ from `SESSION_SECRET`.              |
| `LOG_LEVEL`                                                  | api            | no                                | pino level (`fatal`…`trace`), default `info`. Logs rotate at 10 MiB × 5 per container.         |
| `APP_VERSION`                                                | api            | no                                | `/healthz` `version` + error-sink `release`. Leave commented if unused (blank ⇒ `""`).         |
| `IMPORT_STORAGE_DIR`                                         | api            | no                                | Uploaded raw CSVs. **Compose sets it and mounts the `importdata` volume there.**               |
| `TMPDIR`                                                     | api            | no                                | Admin exports live under it. **Compose sets it and mounts `exportdata` there.** See below.     |
| `SENTRY_DSN`                                                 | api            | **yes**                           | Sentry-protocol error sink; unset/malformed ⇒ console. GlitchTip DSNs work.                    |
| `OIDC_ISSUER` / `OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`      | api            | secret=client secret              | Company SSO. Groups `sales-crm-users` / `sales-crm-admins`. Dev-login stub covers until set.   |
| `WEB_ORIGIN`                                                 | api            | no                                | Front-door origin; builds the OIDC `redirect_uri` + post-login redirect. Set it with `OIDC_*`. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`                  | api            | secret=secret                     | Gmail two-way sync (real mode). The only real provider adapter that is wired.                  |
| `GMAIL_SENDER_ADDRESS`                                       | api            | no                                | Default From / Message-ID domain for the real Gmail adapter.                                   |
| `GMAIL_PUSH_TOKEN`                                           | api            | **yes**                           | Authenticates `POST /wh/gmail`. **Boot fails** when `MOCK_MODE=0` + `GOOGLE_CLIENT_ID` is set. |
| `UNSUBSCRIBE_MAILBOX`                                        | api            | no                                | `List-Unsubscribe` mailto. Default `unsubscribe@switchboard.internal` is NOT deliverable.      |
| `PUBLIC_WEBHOOK_URL`                                         | api            | no                                | Public HTTPS the proxy forwards to `/wh/*`. Also the unsubscribe-link base.                    |
| `ANTHROPIC_API_KEY`                                          | api            | **yes**                           | **NOT WIRED** — see "Not-yet-wired providers" below. Setting it enables nothing.               |
| `TWILIO_*` (5)                                               | api            | secret=auth token, api-key secret | **NOT WIRED** — see "Not-yet-wired providers" below. Setting it enables nothing.               |
| `DEEPGRAM_API_KEY`                                           | api            | **yes**                           | **NOT WIRED** — see "Not-yet-wired providers" below. Setting it enables nothing.               |
| `GLITCHTIP_SECRET_KEY`                                       | glitchtip      | **yes**                           | Only if the `glitchtip` profile is enabled.                                                    |
| `GLITCHTIP_DB` / `GLITCHTIP_DOMAIN` / `GLITCHTIP_FROM_EMAIL` | glitchtip      | no                                | GlitchTip config.                                                                              |
| `BACKUP_DIR` / `BACKUP_RETENTION`                            | backup scripts | no                                | Override backup location / retention (default N=14).                                           |

The stack is fully bring-up-able and verifiable with `MOCK_MODE=1` and none of
the provider variables set.

### `GMAIL_PUSH_TOKEN` — required once Gmail is real

`POST /wh/gmail` is an internet-facing ingress that the company proxy forwards
straight through. It has no user session and no signature to check, so a shared
token is the only thing authenticating it — before that token existed the
endpoint accepted any well-formed JSON from anyone who found the URL.

- **Unused under `MOCK_MODE=1`.** Nothing to set for a mock bring-up.
- **Required before boot when `MOCK_MODE=0` _and_ `GOOGLE_CLIENT_ID` is set** —
  the composition root throws rather than mounting the webhook unauthenticated.
  A real-mode deploy with no Gmail integration may leave it unset.
- **≥32 chars in production**, same floor as `SESSION_SECRET` /
  `LIST_UNSUBSCRIBE_SECRET`, and a distinct value from both.
- **Keep the example placeholder byte-for-byte** until you replace it. The exact
  string `change-me-to-a-random-gmail-push-token` is on the blocklist in
  `apps/api/src/config.ts`, so a deploy that forgets to change it fails closed at
  boot. It is 38 characters — it clears the length floor, and only the blocklist
  catches it. Invent your own placeholder and it would be silently accepted.
- **Create the Google Pub/Sub push subscription with the same token.** If they
  disagree, every push Google sends is rejected and mailbox sync goes quiet with
  no error on the Google side.

Generate one with
`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`.

> **Blank vs. commented.** Several of these are read as `env['X'] ?? 'default'`.
> An empty `X=` line in an env file arrives as the empty string, which is not
> `undefined`, so it **defeats the default** rather than selecting it. Where a
> blank value is harmful (`APP_VERSION`, `UNSUBSCRIBE_MAILBOX`, `WEB_ORIGIN`)
> the `.env.example` entries are commented out on purpose — keep them that way
> unless you are supplying a real value.

### Not-yet-wired providers (`TWILIO_*`, `DEEPGRAM_API_KEY`, `ANTHROPIC_API_KEY`)

**Setting these does not turn anything on.** `apps/api/src/providers/registry.ts`
constructs the telephony / ASR / AI adapters **only** under `MOCK_MODE=1`; its
real branch builds the Gmail email provider and nothing else. So with
`MOCK_MODE=0`, click-to-call, SMS, the `/wh/twilio/*` ingress, call
transcription, and the AI summary/drafting/NL-search routes are simply **not
mounted**, regardless of what those variables contain — the composition root
only registers them when a provider object exists.

They stay in `.env.example` so the credential names are settled and the
switch-on is a registry change rather than an env archaeology dig. The real
adapters plus the accounts they need are tracked in `HUMAN_TODO.md` /
`WIRING.md` §5. Until they land, exercise those features with `MOCK_MODE=1`.

(`TWILIO_AUTH_TOKEN` and `TWILIO_PHONE_NUMBER` _are_ read by the composition
root — but only inside the branch guarded on a telephony provider existing,
which in real mode it does not. Mock mode uses a fixed test token, not yours.)

## TLS

The app never terminates TLS. The company reverse proxy / internal LB terminates
HTTPS and forwards plain HTTP to the `web` service on `WEB_HTTP_PORT`. `web`
(nginx) serves the SPA and proxies `/api`, `/ws`, `/wh`, `/healthz` to `api` on
the internal compose network. **HSTS belongs on the upstream terminator**, not in
`deploy/web/nginx.conf` (an HSTS header sent over plain HTTP is ignored). Postgres
and Redis publish **no** host ports — they are reachable only inside the compose
network.

## Services & health

| Service                          | Image                           | Health probe                  | Notes                                             |
| -------------------------------- | ------------------------------- | ----------------------------- | ------------------------------------------------- |
| `web`                            | `switchboard-web:0.1.0` (built) | `GET /nginx-health`           | Non-root nginx-unprivileged, :8080.               |
| `api`                            | `switchboard-api:0.1.0` (built) | `GET /healthz`                | server role; migrates on boot.                    |
| `worker`                         | `switchboard-api:0.1.0` (built) | heartbeat file                | **Profile `worker`, OFF by default** (see below). |
| `postgres`                       | `postgres:16`                   | `pg_isready`                  | Data volume + WAL-archive volume.                 |
| `redis`                          | `redis:7`                       | `redis-cli ping`              | Append-only persistence.                          |
| `glitchtip` / `glitchtip-worker` | `glitchtip/glitchtip:v4.0`      | HTTP `/health/` / celery ping | **Profile `glitchtip`, OFF by default.**          |

`depends_on` uses health conditions: `api` waits for postgres+redis healthy; `web`
waits for api healthy. Every service has a restart policy (`unless-stopped`) and a
memory limit sized for a small VM (honoured by `docker compose up` in Compose v2).

## Workers & multi-replica

`api` and `worker` are the **same image**; the role is chosen by `APP_ROLE`
(`server` | `worker`) in `deploy/scripts/entrypoint.sh`.

- **v1 (default):** the sequence sweeper/sender runs **in-process** in the `api`
  server. The dedicated `worker` service is **profile-gated OFF** because the
  standalone worker composition root (`apps/api/src/worker.ts`) is a tracked
  follow-up — the entrypoint fails fast with a clear message if you enable the
  profile before that entry exists.
- **When the worker entry lands:** `docker compose --profile worker up -d` runs it.
  Set `MIGRATE_ON_BOOT=0` on every non-primary process (already set on `worker`).
- **Multiple api replicas:** only ONE process may migrate. Run migrations as a
  one-shot before rolling the fleet (see `MIGRATION-SAFETY.md`), and set
  `MIGRATE_ON_BOOT=0` on the replicas. The migrate step also takes a Postgres
  advisory lock as a backstop.

> Runtime note: this repo runs TypeScript **directly** via Node type-stripping (no
> JS build; `apps/api "start": node src/index.ts`). The image ships the TS source +
> a pnpm-workspace `node_modules` so `@switchboard/shared` resolves through its
> symlink — the layout Node's `--experimental-strip-types` requires. `src/index.ts`
> is a thin launcher that calls `main()` in `src/main.ts`, the production
> composition root: it boots the **full** app — migrations, auth/RBAC, every
> route, the provider registry, the queue and the in-process workers — honouring
> `APP_ROLE` and `MIGRATE_ON_BOOT`. (An earlier revision of this README said it
> served only `/healthz`; that was true of the `buildServer()` test helper
> `index.ts` used to call, and has not been true since it was switched to
> `main()`.)

## Persistent state (named volumes)

| Volume       | Mounted at                                  | Holds                          | Losing it costs you                                           |
| ------------ | ------------------------------------------- | ------------------------------ | ------------------------------------------------------------- |
| `pgdata`     | `postgres:/var/lib/postgresql/data`         | The database.                  | Everything. This is the source of truth.                      |
| `pgwal`      | `postgres:/var/lib/postgresql/wal-archive`  | Archived WAL (PITR base).      | Point-in-time recovery beyond the last dump.                  |
| `redisdata`  | `redis:/data`                               | BullMQ AOF.                    | Nothing correctness-wise — every job is re-derivable from PG. |
| `importdata` | `api`,`worker:/var/lib/switchboard/imports` | Uploaded raw CSVs.             | In-flight imports (see below).                                |
| `exportdata` | `api`,`worker:/var/lib/switchboard/tmp`     | `TMPDIR`; admin export output. | Completed export bundles.                                     |

**Why imports need a volume.** The import lifecycle spans three separate HTTP
requests: `POST /api/v1/imports` **writes** the CSV, `POST /api/v1/imports/:id/dry-run`
**re-reads** it, and only `commit` is DB-only. Without a durable mount, any
container restart or redeploy between upload and dry-run leaves the import row
pointing at a `file_ref` that no longer exists — and there is **no re-upload
route**, so that import is unrecoverable. Re-running a dry-run after correcting
a column mapping, an entirely normal workflow, hits the same window. The compose
file therefore sets `IMPORT_STORAGE_DIR` explicitly instead of relying on the
code default, so the mount target and the writer cannot drift apart.

The image creates `/var/lib/switchboard/{imports,tmp}` and chowns them to the
runtime user (`node`, uid 1000) **before** the `USER` switch — `/var/lib` is
`root:root 0755` in `node:22-bookworm-slim`, so the lazy `mkdir` on first upload
used to fail with `EACCES` and the very first CSV upload of a fresh deploy 500'd.

**Backups do not cover these two volumes.** `deploy/scripts/backup.sh` dumps
Postgres only. `importdata` holds transient upload staging (acceptable) and
`exportdata` holds generated artifacts that can be regenerated from the DB — but
if you need either, back up the volumes separately.

### Admin exports — known gap

`POST /api/v1/admin/exports` writes a JSONL/CSV bundle to
`$TMPDIR/switchboard/exports/<exportId>/` and returns the manifest. Two caveats,
both real today:

1. **The route has no env var of its own.** It accepts an `exportsRoot`
   dependency, but the composition root passes none, so it falls back to
   `os.tmpdir()`. Redirecting `TMPDIR` onto the `exportdata` volume (what compose
   does) is the only way to make exports survive a restart from outside the code.
2. **There is no download endpoint.** Nothing serves a finished bundle over
   HTTP, and nothing prunes old ones. To retrieve one:
   ```bash
   docker compose -f deploy/docker-compose.yml cp \
     api:/var/lib/switchboard/tmp/switchboard/exports/<exportId> ./export-<exportId>
   ```
   Delete bundles you no longer need — the volume grows monotonically.

## Log rotation

Docker's default `json-file` driver is **unbounded**, and the api logs a line per
request. On a small VM that fills the disk and takes Postgres down with it, so
every service in the compose file carries:

```yaml
logging: *default-logging # json-file, max-size 10m, max-file 5
```

That caps each container at 50 MiB (~450 MiB with every profile enabled). If you
need more history, raise `max-file` rather than `max-size` — rotation cost scales
with file size. If you ship logs off-box, replace the `x-logging` anchor at the
top of the compose file with your driver (`journald`, `gelf`, …) in one place.

## Upload size limits

`nginx` defaults `client_max_body_size` to **1 MB**, while the app accepts a
64 MiB CSV. A 5,000-row lead file is 1–2 MB, so every realistic import used to
die on a bare nginx `413` the API never saw. `deploy/web/nginx.conf` now sets:

- `location /api/` → `client_max_body_size 65m`. The extra ~1 MiB over the app's
  64 MiB cap is multipart framing overhead: nginx measures the whole request
  body, the app measures only the file part, so the headroom keeps the
  over-cap case owned by the app (a structured error) instead of nginx (bare
  HTML). **If you change the app's cap, change this too.**
- `location /wh/` → `client_max_body_size 1m`, stated explicitly. Webhook
  payloads are kilobytes and the ingress is unauthenticated; this is a
  deliberate cap, not an oversight.

## Backups & the restore drill

Nightly compressed dump with rotation (default N=14), taken **inside** the postgres
container (no published DB port), streamed to a host directory:

```bash
# Linux/macOS host:
deploy/scripts/backup.sh
# Windows host:
powershell -File deploy\scripts\backup.ps1
```

Schedule it (cron / systemd-timer / Task Scheduler), e.g.
`0 2 * * * /srv/switchboard/deploy/scripts/backup.sh >> /var/log/sb-backup.log 2>&1`.

The **restore drill** proves a backup is restorable without touching prod: it
restores the newest dump into a throwaway scratch database, runs a row-count
sanity query, prints `PASS`/`FAIL`, and drops the scratch db. Exit code 0/1 — wire
it into monitoring to catch silent backup rot.

```bash
deploy/scripts/restore.sh            # newest dump; or pass a path
powershell -File deploy\scripts\restore.ps1
```

## Upgrade runbook

1. **Back up first** — `deploy/scripts/backup.sh` (the backup is your rollback).
2. Pull the new code, rev the image tags if desired (`switchboard-api:0.1.0` →
   your new tag in `deploy/docker-compose.yml`).
3. `docker compose -f deploy/docker-compose.yml up -d --build`.
   - `api` (server role) applies pending migrations on boot behind the advisory
     lock, then serves. Follow additive-first / expand-migrate-contract discipline
     for schema changes (`MIGRATION-SAFETY.md`).
4. Watch health: `docker compose -f deploy/docker-compose.yml ps` until all
   `healthy`; `curl -fsS http://localhost:${WEB_HTTP_PORT:-8080}/healthz`.

## Rollback / restore runbook

Rolling back the **app**: redeploy the previous image tag.

Restoring the **database** (deliberate, downtime operation — the drill script is
NOT this):

1. Stop the api/worker so nothing writes:
   `docker compose -f deploy/docker-compose.yml stop api worker`.
2. Restore into prod (inside the postgres container). Example, adjusting names:
   ```bash
   docker compose -f deploy/docker-compose.yml exec -T postgres \
     pg_restore --clean --if-exists --no-owner -U "$POSTGRES_USER" -d "$POSTGRES_DB" < deploy/backups/<dump>
   ```
3. Restart: `docker compose -f deploy/docker-compose.yml start api worker` and
   re-verify `/healthz`.

Point-in-time recovery beyond the last dump uses the archived WAL on the `pgwal`
volume as a base — see the Postgres PITR docs; the archive is populated by the
`archive_command` in the compose `postgres` service.

## GlitchTip (optional error tracking)

OFF by default. To enable: create a `glitchtip` database in the bundled postgres
(or point `GLITCHTIP_DB`/`DATABASE_URL` at an external one), set
`GLITCHTIP_SECRET_KEY`, then:

```bash
docker compose --profile glitchtip -f deploy/docker-compose.yml up -d
```

`glitchtip` (web + migrations) and `glitchtip-worker` (celery) share the bundled
Redis (db 1). Confirm the image tag and required env against the GlitchTip docs
for your version before relying on it in production.

## Fly.io private-app variant

ARCHITECTURE section 8 notes a Fly.io private-app option. The same api image runs
there: a Fly Postgres app + Upstash/Fly Redis, `fly deploy` building
`apps/api/Dockerfile`, `MIGRATE_ON_BOOT=1` on the primary machine, the Fly proxy
terminating TLS. The web can be a second Fly app (this nginx image) or any static
host. Not scripted here — the compose stack is the supported single-host path.

## The compose-invariants test

`deploy/` ships a vitest suite that statically asserts the deploy contract (right
services, health checks everywhere, no `:latest`, non-root, internal-only data
stores, WAL archiving) plus a script-safety smoke (`bash -n` / PowerShell parse).
It is standalone (not a pnpm-workspace member) so its dev deps stay out of the app
graph:

```bash
pnpm test:deploy        # from the repo root
```

#!/bin/sh
# Switchboard api/worker image entrypoint (ARCHITECTURE §8).
#
# ONE image, role chosen at runtime by APP_ROLE:
#   server (default) — optionally migrate (advisory-lock gated), bootstrap the
#                      required reference data, then serve.
#   worker           — run the sequence sweeper/sender (see "Workers" in README).
#   admin            — one-shot `switchboard-admin` CLI run; the remaining args
#                      are the command. This is the ONLY way to reach the admin
#                      CLI from a composed stack, because the image ships no
#                      other entry for it:
#                        docker compose run --rm -e APP_ROLE=admin api user-lookup ada
#
# POSIX sh (the slim runtime may not ship bash). `pipefail` is a bashism, so we
# use `set -eu`; migrate.mjs and the server are single commands (no pipes) whose
# own exit codes propagate.
set -eu

ROLE="${APP_ROLE:-server}"
APP_DIR="/app/apps/api"
# TS runs directly via Node type-stripping (the repo emits no JS — see
# apps/api "start": node src/index.ts). Flag kept explicit for Node 22.x.
NODE_TS="node --experimental-strip-types"
# The admin CLI's import graph reaches @switchboard/shared's barrel, which uses a
# TS parameter property (packages/shared/src/dsl/compile.ts) — strip-ONLY mode
# rejects that at load, so the CLI needs the transforming flag. See the note at
# the top of apps/api/src/cli/index.ts.
NODE_TS_ADMIN="node --experimental-transform-types"
CLI_ENTRY="$APP_DIR/src/cli/index.ts"
export MIGRATIONS_DIR="${MIGRATIONS_DIR:-$APP_DIR/src/db/migrations}"

run_migrations() {
  echo "[entrypoint] migrating (advisory-lock gated)…"
  node "$APP_DIR/migrate.mjs"
  echo "[entrypoint] migrations complete"
}

# Reference data the product cannot work without: lead_statuses (no statuses ⇒ a
# lead cannot be created at all), opportunity_stages, and the org_settings
# singleton (absent ⇒ GET /api/v1/admin/org-settings 404s and the send engine
# runs on hardcoded policy defaults instead of configured ones). The migrations
# insert NO rows, so before this existed every freshly composed stack came up
# non-functional. It is additive, idempotent and production-correct — hence run
# on boot rather than hidden behind the demo-seed gate. Set BOOTSTRAP_ON_BOOT=0
# to skip (e.g. on replicas that must not write).
#
# NOT the demo seed. `seed-demo` is a separate command with its own explicit
# ALLOW_DEMO_SEED=1 gate and is never run from here.
run_bootstrap() {
  echo "[entrypoint] bootstrapping reference data (idempotent)…"
  # shellcheck disable=SC2086
  $NODE_TS_ADMIN "$CLI_ENTRY" bootstrap
}

case "$ROLE" in
server)
  if [ "${MIGRATE_ON_BOOT:-1}" != "0" ]; then
    run_migrations
  else
    echo "[entrypoint] MIGRATE_ON_BOOT=0 — skipping migrations"
  fi
  if [ "${BOOTSTRAP_ON_BOOT:-1}" != "0" ]; then
    run_bootstrap
  else
    echo "[entrypoint] BOOTSTRAP_ON_BOOT=0 — skipping reference-data bootstrap"
  fi
  echo "[entrypoint] starting api server on :${PORT:-3000}"
  # shellcheck disable=SC2086
  exec $NODE_TS "$APP_DIR/src/index.ts"
  ;;
worker)
  # v1 runs sweep/send in-process in the api server; the standalone worker
  # composition root (apps/api/src/worker.ts) is a tracked follow-up. Fail fast
  # with an actionable message rather than idling silently.
  WORKER_ENTRY="${WORKER_ENTRY:-$APP_DIR/src/worker.ts}"
  if [ ! -f "$WORKER_ENTRY" ]; then
    echo "[entrypoint] APP_ROLE=worker but no worker entry at $WORKER_ENTRY." >&2
    echo "[entrypoint] v1 runs sweep/send in-process in 'api'; the standalone" >&2
    echo "[entrypoint] worker is a follow-up (see deploy/README.md 'Workers')." >&2
    exit 1
  fi
  # Liveness heartbeat for the compose healthcheck (updated every 30s).
  ( while true; do touch /tmp/worker-alive; sleep 30; done ) &
  echo "[entrypoint] starting worker"
  # shellcheck disable=SC2086
  exec $NODE_TS "$WORKER_ENTRY"
  ;;
admin)
  # One-shot admin CLI. Everything after the image name is the command, e.g.
  #   docker compose run --rm -e APP_ROLE=admin api bootstrap
  #   docker compose run --rm -e APP_ROLE=admin -e ALLOW_DEMO_SEED=1 api seed-demo
  # No migrations here: the `server` role owns schema changes.
  if [ "$#" -eq 0 ]; then
    echo "[entrypoint] APP_ROLE=admin needs a command, e.g. 'bootstrap'." >&2
    echo "[entrypoint] Run with 'help' for the full list." >&2
    exit 1
  fi
  echo "[entrypoint] switchboard-admin $*"
  # shellcheck disable=SC2086
  exec $NODE_TS_ADMIN "$CLI_ENTRY" "$@"
  ;;
*)
  echo "[entrypoint] unknown APP_ROLE='$ROLE' (expected server|worker|admin)" >&2
  exit 1
  ;;
esac

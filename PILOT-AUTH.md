# Switchboard pilot — real Google sign-in

How the local real-mode pilot authenticates, and the two things only you can do.

## What exists now (2026-08-03)

Switchboard has its **own** Google Cloud project and OAuth client — it no longer
shares SpendTrack's. That's why the consent screen used to say "to continue to
SpendTrack": one client was serving all four pilots, so every app borrowed
SpendTrack's branding, and one leaked secret would have hit all four.

| Thing | Value |
|---|---|
| Google Cloud project | **Switchboard** (`switchboard-504319`) |
| Consent screen app name | **Switchboard** — External, **Testing** mode |
| OAuth client | "Switchboard pilot" (Web application) |
| Credentials | in gitignored `.env` (`OIDC_CLIENT_ID` / `OIDC_CLIENT_SECRET`) |
| Registered redirect URIs | `http://localhost:5176/api/v1/auth/callback` |

`.env` also carries `MOCK_MODE=0`, real Neon `DATABASE_URL`, Upstash `REDIS_URL`,
`OIDC_ISSUER=https://accounts.google.com`, `AUTH_ALLOWED_DOMAIN=gmail.com`.

## The two manual steps

Both are in the Google Cloud console, both ~30 seconds.

### 1. Add yourself as a test user — REQUIRED, nothing works without it

The consent screen is in **Testing** mode with **zero** test users, so Google
refuses every sign-in with `access_denied` no matter how correct the config is.

→ https://console.cloud.google.com/auth/audience?project=switchboard-504319

**Test users** → **+ Add users** → `pllxrgn@gmail.com` → **Save**.
Confirm the table shows a row (the panel silently discards the entry if the
address isn't committed before you hit Save).

### 2. Only if you want sign-in through the Cloudflare tunnel

→ https://console.cloud.google.com/auth/clients?project=switchboard-504319
→ "Switchboard pilot" → **Authorized redirect URIs** → **+ Add URI**:

```
https://<current-tunnel-host>/api/v1/auth/callback
```

Then set `WEB_ORIGIN` in `.env` to `https://<current-tunnel-host>` and restart
the API.

## The tunnel gotcha (read this before you fight it)

**A free `trycloudflare.com` quick tunnel gets a NEW random hostname every time
it starts.** It changed hostnames within minutes during setup. Since the OIDC
state lives in a cookie on the origin you started at, and `redirect_uri` is built
from `WEB_ORIGIN` (`apps/api/src/main.ts:739`), any mismatch between "where you
browsed" and "where Google sends you back" lands on
`That sign-in attempt expired` (`apps/api/src/auth/routes.ts:113`, `txn === null`).

So tunnel sign-in costs you a Google console edit **every single restart**.

**Recommended split:** `WEB_ORIGIN=http://localhost:5176` for actually using the
app (stable, already registered, never breaks), and the tunnel purely to show
the landing page to someone else. A stable public sign-in URL needs either Fly.io
(see `deploy/fly/RUNBOOK.md`, needs a card) or a *named* Cloudflare tunnel (needs
a domain on your Cloudflare account).

## Running the pilot

```bash
# API (real mode, reads .env natively — do NOT `source` .env, it mangles the URLs)
node --experimental-strip-types --env-file=.env apps/api/src/index.ts

# web (separate terminal)
pnpm --filter @switchboard/web dev    # :5176, proxies /api → :3000
```

`ECONNRESET` spam in the API log is free-tier Upstash Redis, not a fault.
`/healthz` hanging is the same cause — it does a deep PG+Redis probe.

## Why the sign-in button says "Company single sign-on"

It *is* the Google button. Switchboard is designed as an internal SSO-gated tool,
so the IdP is deliberately unnamed in the UI (`apps/web/src/auth/SsoLoginPage.tsx:64`).
Clicking it goes to Google. There is no separate "Sign in with Google" to add.

## Self-serve signup is NOT what this is

Anyone with a `gmail.com` address who gets past the test-user list lands in the
**same single workspace** with a `rep` role and full read/write on every lead,
call and contact — `resolveRole`'s domain strategy (`apps/api/src/auth/rbac.ts:99`)
has no tenant boundary and no per-user allowlist. Do not publish the OAuth app
expecting isolated accounts. Real multi-tenancy is scoped separately — it is a
~60–75 engineer-day project, not a config flag.

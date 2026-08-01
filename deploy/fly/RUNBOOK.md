# Switchboard → real public deploy on Fly.io

Two Fly apps, reusing everything from your local pilot:

```
  Internet ──HTTPS──▶  switchboard-web (nginx, PUBLIC)
                          │  proxies /api /ws /wh /healthz
                          ▼  over Fly's private network (flycast)
                       switchboard-api (Fastify, PRIVATE — no public IP)
                          │
                          ├─▶ Neon Postgres   (DATABASE_URL)
                          ├─▶ Upstash Redis   (REDIS_URL)
                          └─▶ Google OIDC      (accounts.google.com)
```

The SPA and its login cookie stay **same-origin** (`https://switchboard-web.fly.dev`), so there's no cross-origin cookie pain. It builds from your **current branch**, so deploy from `feat/welcome-noir` to ship the noir landing.

> Cost: two `shared-cpu-1x` machines (api kept warm, web scales to zero). Small — a few $/mo on Fly, well under the container hosts' minimums. Not $0, but close.

---

## 0. One-time: Fly account + CLI (yours)
```bash
# install flyctl (https://fly.io/docs/flyctl/install), then:
fly auth signup   # or: fly auth login
```

## 1. Create the two apps
```bash
cd D:/CODE/NEW/close-clone
fly apps create switchboard-api
fly apps create switchboard-web
```

## 2. Make the API private (flycast only, no public IP)
```bash
fly ips allocate-v6 --private -a switchboard-api
# do NOT allocate public IPs for the api. (If `fly launch` added any, release them.)
```

## 3. Give the API its secrets — reused straight from your pilot `.env`
Run from the repo root (where `.env` is). This pulls **only** the 7 real secrets and never prints them:
```bash
grep -E '^(DATABASE_URL|REDIS_URL|OIDC_CLIENT_ID|OIDC_CLIENT_SECRET|SESSION_SECRET|LIST_UNSUBSCRIBE_SECRET|AUTH_ADMIN_EMAILS)=' .env | fly secrets import -a switchboard-api
```
(The non-secret config — `OIDC_ISSUER`, `AUTH_ALLOWED_DOMAIN`, `MOCK_MODE=0`, `PORT` — is already in `fly.api.toml`. `WEB_ORIGIN` is set in step 6.)

## 4. Deploy the API
```bash
fly deploy -c deploy/fly/fly.api.toml
```
It builds the image, boots, and runs migrations against Neon (idempotent — the schema's already there). Watch: `fly logs -a switchboard-api` → expect `switchboard api listening ... mockMode:false`.

## 5. Deploy the web
```bash
fly deploy -c deploy/fly/fly.web.toml
```
This one gets a public URL — note it (e.g. `https://switchboard-web.fly.dev`).

## 6. Point the API's origin at the public web URL
```bash
fly secrets set WEB_ORIGIN=https://switchboard-web.fly.dev -a switchboard-api
```
(Sets the OIDC `redirect_uri` base + the CORS allow-origin; restarts the api.)

## 7. Register the public URL with Google OAuth
On the shared `SaaS Pilot (localhost)` client (Google Cloud → Auth Platform → Clients), **add**:
- **Authorized redirect URI:** `https://switchboard-web.fly.dev/api/v1/auth/callback`
- (JS origin not required — OIDC is a server-side redirect flow.)

Give Google a few minutes to propagate. *(I can drive this in the browser for you once you have the URL.)*

## 8. Test
Open `https://switchboard-web.fly.dev` → **Sign in · SSO** → Google (`pllxrgn@gmail.com`) → you're in, on the real Neon data.

---

## Watch-points (where a first deploy usually needs a nudge)
1. **flycast networking.** If `/api` returns 502/504, nginx can't reach the api. Check both logs:
   `fly logs -a switchboard-web` (nginx resolver errors) and `fly logs -a switchboard-api` (is it up?).
   Fix candidates: confirm the private IPv6 (step 2) exists (`fly ips list -a switchboard-api`); the upstream in `nginx.fly.conf` is `switchboard-api.flycast:3000`.
2. **`/healthz` + Upstash lag.** The deep health probe can hang on the free Upstash tier. The api has **no strict Fly health check** for this reason; if the app still cycles, check `fly logs -a switchboard-api` for Redis timeouts (BullMQ). Worst case, provision a Fly Redis (Upstash-on-Fly) in the same region.
3. **OIDC redirect mismatch.** `redirect_uri_mismatch` = the URL in step 7 doesn't exactly match `WEB_ORIGIN` in step 6, or Google hasn't propagated yet.

## Notes
- OAuth consent is still **Testing mode + `gmail.com` domain guard**, so only your test-user email can actually log in — fine for a gated internal tool. To open it wider, add test users (or publish the app; the `openid email profile` scopes are non-sensitive, so publishing needs no verification review).
- The **worker** (sequence dispatch) isn't deployed here — the server handles the request path; add `switchboard-worker` (same image, `APP_ROLE=worker`) as a third app when you want cadences to auto-advance in prod.

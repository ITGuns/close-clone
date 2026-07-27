# Deploying the showcase preview (mock-data demo app)

The shared deployment is the **web app in demo mode**: the full UI (landing → login → app) backed by MSW with the synthetic fixture dataset. No backend, no secrets, no real data. The real-engine demo (PGlite API + 5k leads) runs locally per `DEMO.md`.

## The two live addresses

| Target                    | URL                                             | How it updates                                                                           |
| ------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| **Vercel** (primary)      | **<https://switchboard-demo-omega.vercel.app>** | **Manual CLI upload today** — Git auto-deploy is not connected yet (see below).          |
| **GitHub Pages** (mirror) | <https://pllxrgn-ui.github.io/close-clone/>     | Automatic on every push to `main` **that passes CI** (typecheck · lint · format · test). |

There is exactly one Vercel URL. Anything else you may have been sent
(`switchboard-crm-demo…`) belongs to the retired account listed under
[Stale projects](#stale-projects) and must not be shared.

Share `<url>/welcome` as the front door. Deep links work on both targets (SPA
rewrite on Vercel, a copied `404.html` on Pages); the Pages build is compiled
with `VITE_BASE=/close-clone/`.

## Vercel

Repo: `github.com/pllxrgn-ui/close-clone`. Account: `pllxrgn-ui`
(GitHub-linked, pllxrgn@gmail.com). Project: **`switchboard-demo`** — the
project that owns the `switchboard-demo-omega.vercel.app` alias.

### Configuration (already committed)

`apps/web/vercel.json` is the single authoritative Vercel config; there is no
root-level `vercel.json` any more. It supplies:

- `installCommand`: `corepack enable && pnpm install --frozen-lockfile` —
  `corepack enable` is what pins **pnpm 10.31.0** (from the root
  `package.json` `packageManager` field, which Corepack finds by walking up
  from `apps/web`). Without it Vercel picks its own pnpm version.
- `buildCommand`: `pnpm --filter @switchboard/web build`
- `outputDirectory`: `dist` (relative to the Root Directory, i.e. `apps/web/dist`)
- `framework`: `null` — no framework preset; the commands above are used verbatim.
- one SPA rewrite so `/inbox`, `/leads/:id`, … serve `index.html`.

This file is only read once the project's **Root Directory** is set to
`apps/web`. `pnpm install` run from `apps/web` still installs the whole
workspace (pnpm walks up to `pnpm-workspace.yaml`), so the
`@switchboard/shared` workspace dependency resolves.

### Connecting Git auto-deploy — still an open human TODO

Auto-deploy is **not live**. Pushing to `main` does **not** update the Vercel
URL today. A human must click this once (OAuth grant; an agent cannot do it) —
the same item tracked in `HANDOFF-CODEX.md` §3 and `HUMAN_TODO.md`:

1. vercel.com/dashboard as `pllxrgn-ui` → open the existing **`switchboard-demo`**
   project (reusing it preserves the `switchboard-demo-omega.vercel.app` URL).
2. **Settings → Git → Connect Git Repository** → GitHub → `pllxrgn-ui/close-clone`.
3. **Settings → Build and Deployment → Root Directory** → `apps/web` → Save.
   Leave Install/Build/Output empty — `apps/web/vercel.json` supplies them.
   Framework preset: **Other**. Production branch: `main`.

No environment variables are needed: the build defaults to mock mode
(`VITE_API_MODE` unset ⇒ MSW on).

Optional: Project → Settings → Deployment Protection → password-protect the URL.

After connecting, verify it actually works: push a trivial commit and compare
the `assets/index-*.js` hash in the served HTML before and after. Do not trust
the dashboard's "Ready" alone.

### Manual redeploy (the current, working path)

Paste as-is from the repo root:

```bash
rm -rf apps/web/dist                      # dist accumulates otherwise
pnpm --filter @switchboard/web build      # must print "built in ..." (a tsc error = stale dist!)
STAGE="$(mktemp -d)/switchboard-demo"     # dir name = Vercel project name
mkdir -p "$STAGE"
cp -r apps/web/dist/. "$STAGE/"
printf '{ "rewrites": [{ "source": "/(.*)", "destination": "/index.html" }] }' > "$STAGE/vercel.json"
(
  cd "$STAGE"
  DEPLOY="$(npx vercel deploy --prod --yes 2>&1 | grep -oE 'https://[a-z0-9.-]+vercel\.app' | tail -1)"
  npx vercel alias set "$DEPLOY" switchboard-demo-omega.vercel.app
)
```

Notes:

- The staging directory **must** be named `switchboard-demo` — the Vercel CLI
  infers the project name from it. That is the only project; there is no second
  URL to update.
- `--prod` auto-updates the production alias on this project; the explicit
  `alias set` is belt-and-braces.
- The edge may keep serving the previous HTML for a couple of minutes.

## GitHub Pages

Publishing lives in `.github/workflows/ci.yml` as the `pages-build` /
`pages-deploy` jobs, gated on `needs: build-test`. A failing typecheck, lint,
format or test run now blocks the publish; previously a standalone
`pages.yml` shipped every push to `main` regardless of CI.

**One-time click (yours):** repo → Settings → Pages → _Build and deployment_ →
Source: **GitHub Actions**.

## Do not

- Do not set `VITE_API_MODE=real` on Vercel — there is no API there; the app would show connection errors.
- Do not add secrets to the Vercel project; the demo build needs none.
- Do not `vercel alias set` onto a _different_ project — on the old account that
  detached auto-promotion and `--prod` deploys silently stopped updating the
  public URL.

## Stale projects

Two projects remain on the **former** account `pdvillorente12-1736`:
`switchboard-demo` and `switchboard-crm-demo`. Their URLs still serve outdated
copies. Delete both via that account's dashboard (Settings → Delete Project).

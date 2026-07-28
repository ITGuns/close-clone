import { chromium } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/*
 * CONTAINER SMOKE — the check that has never been run, and whose absence let a
 * total write-path outage ship.
 *
 * Every existing suite mocks the layer beneath it: Playwright drives MSW and never
 * touches the API (e2e/playwright.config.ts), the api tests bypass the auth layer,
 * the local "real API" dev boot mounts no session guard at all (dev/boot.ts), and
 * CI never builds either Docker image. So ~4,000 green tests coexisted with an app
 * that returns 403 on every POST once it is actually deployed.
 *
 * This drives the REAL composed stack through a REAL browser doing a REAL write.
 * It is deliberately small: one login, one mutation, one reload. The reload is the
 * point — optimistic UI will happily show a change the server rejected.
 *
 *   1. bring the stack up:  cd deploy && docker compose --env-file .env up -d
 *   2. node container-smoke.mjs         (from e2e/)
 *
 * Exits non-zero on failure so CI can gate on it
 * (.github/workflows/ci.yml → job `container-smoke`, which also builds both
 * images and boots the stack).
 */

const BASE = process.env.SMOKE_BASE_URL ?? 'http://localhost:8080';

// Failure evidence, resolved from this file so it does not depend on cwd, and
// uploaded as a CI artifact. A screenshot plus the served DOM answers "which
// login screen rendered / what did the page actually say" without a re-run.
// It lives under e2e/test-results/ deliberately: that path is already covered by
// e2e/.gitignore and .prettierignore, so a local run leaves nothing for git or
// `pnpm format:check` to trip over.
const ARTIFACT_DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'test-results',
  'container-smoke',
);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
};

/** Non-gating context lines. These explain a failure; they never cause one. */
const note = (label, value) => console.log(`NOTE  ${label} — ${value}`);

const browser = await chromium.launch();
const page = await browser.newPage();
const consoleErrors = [];
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text());
});

try {
  // --- 1. The app is served at all -----------------------------------------
  const res = await page.goto(BASE, { waitUntil: 'networkidle', timeout: 30_000 });
  check('front door responds', (res?.status() ?? 0) < 400, `status ${res?.status()}`);

  // --- 1b. nginx actually reaches the api ------------------------------------
  // Distinguishes "the SPA is broken" from "the api never came up / the reverse
  // proxy is misrouted" — the same 4xx/5xx would otherwise surface as a
  // mysterious failure three checks later.
  const health = await page.request.get(`${BASE}/healthz`);
  check('api reachable through the proxy (/healthz)', health.ok(), `status ${health.status()}`);

  // --- 2. Sign in -----------------------------------------------------------
  await page.goto(`${BASE}/login`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(1500);

  // Which sign-in screen was served? apps/web/src/auth/LoginPage.tsx picks by
  // VITE_API_MODE, which is baked at image build time — so a bundle built the
  // wrong way shows up here as a named cause rather than as "no admin button".
  const devUsers = await page.request.get(`${BASE}/api/v1/auth/dev-users`);
  const devUserCount = devUsers.ok() ? ((await devUsers.json().catch(() => [])) ?? []).length : -1;
  note(
    'login screen',
    (await page.locator('.sb-login__title').count()) > 0 ? 'rendered' : 'absent',
  );
  note(
    'dev-login picker source',
    devUsers.ok()
      ? `GET /api/v1/auth/dev-users → 200, ${devUserCount} user(s)`
      : `GET /api/v1/auth/dev-users → ${devUsers.status()} (not MOCK_MODE, or route absent)`,
  );

  let signedIn = false;
  for (const b of await page.getByRole('button').all()) {
    if (/admin/i.test((await b.textContent()) ?? '')) {
      await b.click();
      signedIn = true;
      break;
    }
  }
  await page.waitForTimeout(3000);
  check('dev-login lands in the app', signedIn && /\/inbox$/.test(page.url()), page.url());

  // --- 3. THE WRITE. This is what the whole file exists for. ----------------
  // "Complete" on an inbox task is a single-click PATCH — the least fragile
  // mutation in the product, and representative: if this 403s, so does every
  // note, call log, stage move and import commit.
  await page.goto(`${BASE}/inbox`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(2500);

  const completeButtons = page.getByRole('button', { name: /Complete/i });
  const before = await completeButtons.count();
  check('inbox has completable work', before > 0, `${before} Complete buttons`);

  let wroteOk = false;
  let writeDetail = 'not attempted';
  if (before > 0) {
    const failedRequests = [];
    page.on('response', (r) => {
      if (r.request().method() !== 'GET' && r.url().includes('/api/') && !r.ok()) {
        failedRequests.push(`${r.request().method()} ${new URL(r.url()).pathname} → ${r.status()}`);
      }
    });

    await completeButtons.first().click();
    await page.waitForTimeout(3000);

    // The reload is the real assertion: optimistic UI lies, the server does not.
    await page.reload({ waitUntil: 'networkidle' });
    await page.waitForTimeout(2500);
    const after = await page.getByRole('button', { name: /Complete/i }).count();

    wroteOk = failedRequests.length === 0 && after < before;
    writeDetail =
      failedRequests.length > 0
        ? failedRequests.join('; ')
        : `${before} → ${after} after reload${after >= before ? ' (did NOT persist)' : ''}`;
  }
  check('a write persists across a reload', wroteOk, writeDetail);

  // --- 4. The guard is actually on ------------------------------------------
  // Complement to the above: a mutation WITHOUT the CSRF header must be refused.
  // If this passes while step 3 fails, the guard is on and the SPA is the problem.
  // If both fail, the guard is off — which would be its own emergency.
  const guard = await page.evaluate(async () => {
    try {
      const r = await fetch('/api/v1/notes', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadId: '00000000-0000-4000-8000-000000000000', body: 'smoke' }),
      });
      return r.status;
    } catch (e) {
      return `threw: ${String(e)}`;
    }
  });
  check('CSRF guard rejects a header-less mutation', guard === 403, `got ${guard}`);

  check('no console errors', consoleErrors.length === 0, consoleErrors.slice(0, 3).join(' | '));
} catch (err) {
  check('smoke run completed', false, String(err));
} finally {
  // Evidence first, then close. Best-effort: a dump failure must never mask the
  // real result, and must never turn a passing run red.
  if (results.some((r) => !r.ok)) {
    try {
      await mkdir(ARTIFACT_DIR, { recursive: true });
      await page.screenshot({ path: resolve(ARTIFACT_DIR, 'page.png'), fullPage: true });
      await writeFile(resolve(ARTIFACT_DIR, 'page.html'), await page.content(), 'utf8');
      await writeFile(
        resolve(ARTIFACT_DIR, 'console.log'),
        `url: ${page.url()}\n\n${consoleErrors.join('\n')}\n`,
        'utf8',
      );
      console.log(`\nartifacts written to ${ARTIFACT_DIR}`);
    } catch (dumpErr) {
      console.log(`\nartifact dump failed: ${String(dumpErr)}`);
    }
  }
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) {
  console.log(`FAILED: ${failed.map((f) => f.name).join(', ')}`);
  process.exit(1);
}

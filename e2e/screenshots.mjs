import { mkdirSync } from 'node:fs';
import { chromium } from '@playwright/test';

/*
 * Regenerates the boss-facing screenshot deck in `screenshots/` (gitignored —
 * these are build artifacts, not source).
 *
 *   1. start the app:  the `web-mock` config in .claude/launch.json, or
 *                      `pnpm --dir apps/web dev --port 5199 --strictPort`
 *   2. from e2e/:      node screenshots.mjs
 *
 * Drives the REAL app in mock mode (MSW + synthetic fixtures) through the same
 * dev-login path the E2E suite uses. Captures at 2x device scale so the images
 * hold up on a projector or in a slide deck.
 *
 * Waits are deliberate wall-clock pauses rather than networkidle alone: several
 * surfaces animate in (the design system caps motion at 300ms) and a screenshot
 * taken mid-transition looks broken in a way a test would not catch.
 */

const BASE = 'http://localhost:5199';
const OUT = 'D:/CODE/NEW/close-clone/screenshots';
mkdirSync(OUT, { recursive: true });

const SURFACES = [
  ['02-inbox', '/inbox'],
  ['03-leads', '/leads'],
  ['04-pipeline', '/pipeline'],
  ['05-sequences', '/sequences'],
  ['06-reports', '/reports'],
  ['07-dialer', '/dialer'],
  ['08-import', '/import'],
  ['09-views', '/views'],
  ['10-view-builder', '/views/new'],
  ['11-settings', '/settings'],
];

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 1600, height: 1000 },
  deviceScaleFactor: 2,
});

const shot = async (name) => {
  await page.waitForTimeout(900);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`captured ${name}`);
};

const visit = async (path, wait = 900) => {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
};

await visit('/welcome');
await shot('01-welcome');

// Sign in through the real dev-login UI, as tests/auth.setup.ts does.
await visit('/login', 1200);
for (const b of await page.getByRole('button').all()) {
  if (/admin/i.test((await b.textContent()) ?? '')) {
    await b.click();
    break;
  }
}
await page.waitForTimeout(2500);
if (!page.url().endsWith('/inbox')) throw new Error(`login failed, landed on ${page.url()}`);

for (const [name, path] of SURFACES) {
  await visit(path);
  await shot(name);
}

// The lead timeline is the product's central idea, so it gets its own capture.
// Rows are role="row" divs (not anchors) — index 0 is the header.
await visit('/leads', 2000);
await page.locator('[role="row"]:not(.lead-table__row--head)').nth(1).click();
await page.waitForTimeout(3000);
await shot('12-lead-timeline');

// The command palette shows this is built for keyboard-first operators.
await visit('/leads', 1500);
await page.keyboard.press('Control+k');
await page.waitForTimeout(1200);
await shot('13-command-palette');

await browser.close();
console.log('done');

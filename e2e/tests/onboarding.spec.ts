import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN_USER } from './support/app';

/*
 * First-run onboarding: the guided tour auto-opens exactly once after a fresh
 * dev-login, advances on the keyboard (0ms — DESIGN §4), dismisses with Escape,
 * stays dismissed across reloads, and replays on demand from Support & FAQs.
 */

// Completely fresh profile — no auth, no tour flags.
test.use({ storageState: { cookies: [], origins: [] } });

async function loginFresh(page: Page): Promise<void> {
  await page.goto('/welcome');
  await page.getByRole('link', { name: 'Open Switchboard' }).first().click();
  await expect(page).toHaveURL(/\/login$/);
  await page.getByRole('button', { name: new RegExp(ADMIN_USER.name) }).click();
  await expect(page).toHaveURL(/\/inbox$/);
}

test('first run: tour auto-opens, advances by keyboard, and stays dismissed', async ({ page }) => {
  test.setTimeout(60_000);
  await loginFresh(page);

  const welcome = page.getByRole('dialog', { name: 'Welcome to Switchboard' });
  await expect(welcome).toBeVisible();
  await welcome.getByRole('button', { name: 'Start tour' }).click();

  await expect(page.getByRole('dialog', { name: 'Inbox' })).toBeVisible();
  await expect(page.getByText('Step 2 of 6')).toBeVisible();

  await page.keyboard.press('ArrowRight');
  await expect(page.getByRole('dialog', { name: 'Leads' })).toBeVisible();
  await page.keyboard.press('ArrowLeft');
  await expect(page.getByRole('dialog', { name: 'Inbox' })).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Inbox' })).toBeHidden();

  // Dismissal persists: a reload never re-opens the tour.
  await page.reload();
  await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Welcome to Switchboard' })).toBeHidden();
});

test('replay: Support & FAQs relaunches the tour to completion', async ({ page }) => {
  test.setTimeout(60_000);
  await loginFresh(page);

  // Dismiss the first-run instance.
  const welcome = page.getByRole('dialog', { name: 'Welcome to Switchboard' });
  await expect(welcome).toBeVisible();
  await welcome.getByRole('button', { name: 'Skip' }).click();
  await expect(welcome).toBeHidden();

  await page.goto('/help');
  await page.getByRole('button', { name: 'Replay the guided tour' }).click();
  await expect(page.getByRole('dialog', { name: 'Welcome to Switchboard' })).toBeVisible();
  await page.getByRole('button', { name: 'Start tour' }).click();

  // Walk all four coachmarks (the rail + topbar anchors exist on /help too).
  for (const name of ['Inbox', 'Leads', 'Pipeline', 'Search & commands']) {
    await expect(page.getByRole('dialog', { name })).toBeVisible();
    await page.keyboard.press('ArrowRight');
  }
  const finish = page.getByRole('dialog', { name: /That.s the board/ });
  await expect(finish).toBeVisible();
  await finish.getByRole('button', { name: 'Done' }).click();
  await expect(finish).toBeHidden();
});

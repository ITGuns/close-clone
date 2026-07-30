import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import type { User } from '@switchboard/shared';
import { ApiError } from '../../../api/index.ts';
import { storeUser } from '../../../auth/auth.ts';
import { db } from '../../../mocks/fixtures.ts';
import { server } from '../../../mocks/server.ts';
import { getMyPreferences, patchMe, patchMyPreferences } from '../api.ts';
import { adminHandlers } from './adminHandlers.ts';
import { adminStore, resetAdminStore } from './adminStore.ts';

/*
 * Handler-level coverage for the self-service account endpoints (C7 v1.3.7):
 * PATCH /users/me resolves "me" from the mock auth blob and writes the fixture
 * row; /users/me/preferences reads+writes the adminStore singleton with strict
 * validation. The store is the store under test.
 */

function fixtureUser(): User {
  const u = db.users[0];
  if (!u) throw new Error('fixture users missing');
  return u;
}

beforeEach(() => {
  resetAdminStore();
  server.use(...adminHandlers);
  storeUser(fixtureUser());
});
afterEach(() => {
  storeUser(null);
});

describe('PATCH /users/me', () => {
  test('updates name and timezone on the fixture row and returns the user', async () => {
    const me = fixtureUser();
    const updated = await patchMe({ name: 'Ada O. Okafor', timezone: 'America/Chicago' });
    expect(updated.id).toBe(me.id);
    expect(updated.name).toBe('Ada O. Okafor');
    expect(updated.timezone).toBe('America/Chicago');
    expect(db.users[0]?.name).toBe('Ada O. Okafor');
  });

  test('rejects an empty name without writing', async () => {
    const before = db.users[0]?.name;
    await expect(patchMe({ name: '   ' })).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(db.users[0]?.name).toBe(before);
  });

  test('is UNAUTHENTICATED with no signed-in user', async () => {
    storeUser(null);
    await expect(patchMe({ name: 'Nobody' })).rejects.toBeInstanceOf(ApiError);
    await expect(patchMe({ name: 'Nobody' })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });
});

describe('/users/me/preferences', () => {
  test('GET returns the seeded preferences', async () => {
    const prefs = await getMyPreferences();
    expect(prefs.desktopNotifications).toBe(true);
    expect(prefs.emailDigest).toBe(false);
    expect(prefs.quietHours).toEqual({ enabled: false, start: '20:00', end: '08:00' });
  });

  test('PATCH flips a toggle and persists it in the store', async () => {
    const prefs = await patchMyPreferences({ emailDigest: true });
    expect(prefs.emailDigest).toBe(true);
    expect(adminStore.preferences.emailDigest).toBe(true);
  });

  test('PATCH accepts valid quiet hours', async () => {
    const prefs = await patchMyPreferences({
      quietHours: { enabled: true, start: '22:00', end: '07:30' },
    });
    expect(prefs.quietHours).toEqual({ enabled: true, start: '22:00', end: '07:30' });
  });

  test('PATCH rejects malformed quiet-hour times without writing', async () => {
    await expect(
      patchMyPreferences({ quietHours: { enabled: true, start: '25:00', end: '08:00' } }),
    ).rejects.toMatchObject({ code: 'VALIDATION_FAILED' });
    expect(adminStore.preferences.quietHours.enabled).toBe(false);
  });
});

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createTestDb, type TestDb } from '../../db/test-helpers.ts';
import { leads, orgSettings, suppressions, users } from '../../db/index.ts';
import { loadOpenSnapshot } from '../inbox/load.ts';
import { buildDemoDataset, DEMO_ANCHOR_ISO } from './demo-data.ts';
import { DEMO_SEED_ENV_FLAG, SeedRefusedError, probeForeignRows, seedDemoData } from './demo.ts';

/**
 * The demo seed's failure paths are the point of this file. A seed that works is
 * table stakes; a seed that cannot be run by accident against a real database is
 * the requirement.
 */

let t: TestDb;

const ALLOW = { [DEMO_SEED_ENV_FLAG]: '1' };

beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.close();
});

async function count(table: string): Promise<number> {
  const res = (await t.db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`))) as {
    rows: { n: number }[];
  };
  return res.rows[0]?.n ?? -1;
}

async function totalBusinessRows(): Promise<number> {
  let total = 0;
  for (const table of ['users', 'leads', 'contacts', 'tasks', 'activities', 'notes']) {
    total += await count(table);
  }
  return total;
}

describe('seedDemoData — the gate', () => {
  it('refuses when ALLOW_DEMO_SEED is absent, and writes nothing', async () => {
    await expect(seedDemoData(t.db, { env: {} })).rejects.toThrow(SeedRefusedError);
    expect(await totalBusinessRows()).toBe(0);
  });

  it.each([['0'], ['true'], ['yes'], [''], ['1 ']])(
    'refuses when ALLOW_DEMO_SEED is %j (only the exact string "1" opts in)',
    async (value) => {
      await expect(seedDemoData(t.db, { env: { [DEMO_SEED_ENV_FLAG]: value } })).rejects.toThrow(
        /ALLOW_DEMO_SEED/,
      );
      expect(await totalBusinessRows()).toBe(0);
    },
  );

  it('is NOT implied by MOCK_MODE or NODE_ENV', async () => {
    await expect(
      seedDemoData(t.db, { env: { MOCK_MODE: '1', NODE_ENV: 'development' } }),
    ).rejects.toThrow(SeedRefusedError);
    expect(await totalBusinessRows()).toBe(0);
  });

  it('--force does NOT override the env gate', async () => {
    await expect(seedDemoData(t.db, { env: {}, force: true })).rejects.toThrow(/ALLOW_DEMO_SEED/);
    expect(await totalBusinessRows()).toBe(0);
  });

  it('refuses when the database holds a user the seed did not author', async () => {
    await t.db.insert(users).values({
      email: 'real.person@company.example',
      name: 'Real Person',
      role: 'admin',
      idpSubject: 'oidc|real',
    });

    await expect(seedDemoData(t.db, { env: ALLOW })).rejects.toThrow(/foreign rows: users=1/);
    expect(await count('leads')).toBe(0);
  });

  it('refuses on a row in a table the seed never writes (suppressions)', async () => {
    await t.db
      .insert(suppressions)
      .values({ kind: 'phone', value: '+15551230000', source: 'stop_keyword' });

    await expect(seedDemoData(t.db, { env: ALLOW })).rejects.toThrow(
      /foreign rows: suppressions=1/,
    );
    expect(await totalBusinessRows()).toBe(0);
  });

  it('the refusal names the tables and points at --force without ever suggesting the env flag be defaulted', async () => {
    await t.db.insert(users).values({
      email: 'real.person@company.example',
      name: 'Real Person',
      role: 'rep',
      idpSubject: 'oidc|real2',
    });
    const err = await seedDemoData(t.db, { env: ALLOW }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(SeedRefusedError);
    expect(String(err)).toContain('users=1');
    expect(String(err)).toContain('--force');
  });

  it('--force overrides the non-empty refusal only', async () => {
    await t.db.insert(users).values({
      email: 'real.person@company.example',
      name: 'Real Person',
      role: 'rep',
      idpSubject: 'oidc|real3',
    });

    const result = await seedDemoData(t.db, { env: ALLOW, force: true });
    expect(result.foreignRows).toEqual([{ table: 'users', count: 1 }]);
    expect(result.inserted['leads']).toBeGreaterThan(0);
  });
});

describe('seedDemoData — what it produces', () => {
  it('seeds users, leads, contacts, tasks, opportunities, notes and activities', async () => {
    const result = await seedDemoData(t.db, { env: ALLOW });

    expect(result.alreadySeeded).toBe(false);
    expect(result.foreignRows).toEqual([]);
    for (const table of ['users', 'leads', 'contacts', 'tasks', 'activities']) {
      expect(result.inserted[table], table).toBeGreaterThan(0);
      expect(await count(table), table).toBe(result.inserted[table]);
    }
  });

  it('brings the reference data with it (a fresh database has no statuses/stages/org_settings)', async () => {
    const result = await seedDemoData(t.db, { env: ALLOW });
    expect(result.reference.leadStatuses).toBe(5);
    expect(result.reference.opportunityStages).toBe(4);
    expect(result.reference.orgSettings).toBe(1);
    expect(await count('org_settings')).toBe(1);
    const settings = await t.db.select({ tz: orgSettings.companyTimezone }).from(orgSettings);
    expect(settings[0]?.tz).toBe('UTC');
  });

  it('gives the dev-login picker an admin to pick (mock-mode sign-in reads `users` directly)', async () => {
    await seedDemoData(t.db, { env: ALLOW });
    const rows = await t.db
      .select({ id: users.id, role: users.role, name: users.name })
      .from(users);
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.filter((r) => r.role === 'admin')).toHaveLength(1);
  });

  it('gives the inbox completable work — asserted through the real inbox projection', async () => {
    await seedDemoData(t.db, { env: ALLOW });

    // The smoke clicks "Complete" on an inbox task; this is the server-side
    // projection that decides whether such a row exists at all.
    const snapshot = await loadOpenSnapshot(t.db, Date.now());
    expect(snapshot.tasks.length).toBeGreaterThanOrEqual(5);
    expect(snapshot.tasks.every((task) => task.completedAt === null)).toBe(true);
  });

  it('the inbox still has work when the anchor is recent', async () => {
    const anchor = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    await seedDemoData(t.db, { env: ALLOW, anchor });
    const snapshot = await loadOpenSnapshot(t.db, Date.now());
    expect(snapshot.tasks.length).toBeGreaterThanOrEqual(5);
  });

  it('every seeded lead resolves to a real status row', async () => {
    await seedDemoData(t.db, { env: ALLOW });
    const orphans = (await t.db.execute(
      sql`SELECT count(*)::int AS n FROM leads l LEFT JOIN lead_statuses s ON s.id = l.status_id WHERE s.id IS NULL`,
    )) as { rows: { n: number }[] };
    expect(orphans.rows[0]?.n).toBe(0);
  });
});

describe('seedDemoData — idempotence', () => {
  it('a second run inserts nothing and reports alreadySeeded', async () => {
    const first = await seedDemoData(t.db, { env: ALLOW });
    const before = await totalBusinessRows();

    const second = await seedDemoData(t.db, { env: ALLOW });

    expect(second.alreadySeeded).toBe(true);
    expect(second.foreignRows).toEqual([]);
    expect(Object.values(second.inserted).reduce((a, b) => a + b, 0)).toBe(0);
    expect(await totalBusinessRows()).toBe(before);
    expect(second.dataset).toEqual(first.dataset);
  });

  it('a re-run does not trip its own emptiness probe', async () => {
    await seedDemoData(t.db, { env: ALLOW });
    const foreign = await probeForeignRows(t.db, buildDemoDataset(DEMO_ANCHOR_ISO));
    expect(foreign).toEqual([]);
  });

  it('a run after a real lead was created refuses rather than topping up', async () => {
    await seedDemoData(t.db, { env: ALLOW });
    const status = (await t.db.execute(sql`SELECT id FROM lead_statuses LIMIT 1`)) as {
      rows: { id: string }[];
    };
    await t.db
      .insert(leads)
      .values({ name: 'A Real Customer', statusId: status.rows[0]?.id ?? null });

    await expect(seedDemoData(t.db, { env: ALLOW })).rejects.toThrow(/foreign rows: leads=1/);
  });
});

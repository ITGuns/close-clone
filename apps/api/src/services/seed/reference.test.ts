import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createTestDb, type TestDb } from '../../db/test-helpers.ts';
import { leadStatuses, opportunityStages, orgSettings, users } from '../../db/index.ts';
import {
  LEAD_STATUS_LABELS,
  OPPORTUNITY_STAGE_LABELS,
  bootstrapReferenceData,
} from './reference.ts';

/**
 * `switchboard-admin bootstrap` — reference data only. This command is designed
 * to be safe to run against a PRODUCTION database, so the tests here are as much
 * about what it does NOT do as what it does.
 */

let t: TestDb;

beforeEach(async () => {
  t = await createTestDb();
});
afterEach(async () => {
  await t.close();
});

async function count(table: 'lead_statuses' | 'opportunity_stages' | 'org_settings' | 'users') {
  const res = (await t.db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`))) as {
    rows: { n: number }[];
  };
  return res.rows[0]?.n ?? -1;
}

describe('bootstrapReferenceData', () => {
  it('creates the org_settings singleton and both dimension tables', async () => {
    const result = await bootstrapReferenceData(t.db);

    expect(result.leadStatuses).toBe(LEAD_STATUS_LABELS.length);
    expect(result.opportunityStages).toBe(OPPORTUNITY_STAGE_LABELS.length);
    expect(result.orgSettings).toBe(1);

    expect(await count('lead_statuses')).toBe(LEAD_STATUS_LABELS.length);
    expect(await count('opportunity_stages')).toBe(OPPORTUNITY_STAGE_LABELS.length);
    expect(await count('org_settings')).toBe(1);
  });

  it('creates NO users and no business data (an admin user is not bootstrap data)', async () => {
    await bootstrapReferenceData(t.db);
    expect(await count('users')).toBe(0);
  });

  it('is idempotent — a second run inserts nothing', async () => {
    await bootstrapReferenceData(t.db);
    const second = await bootstrapReferenceData(t.db);

    expect(second).toEqual({ leadStatuses: 0, opportunityStages: 0, orgSettings: 0 });
    expect(await count('lead_statuses')).toBe(LEAD_STATUS_LABELS.length);
    expect(await count('org_settings')).toBe(1);
  });

  it('never adds a second org_settings row, even when the existing one has a foreign id', async () => {
    await t.db.insert(orgSettings).values({ dailySendCap: 17, companyTimezone: 'America/Denver' });

    const result = await bootstrapReferenceData(t.db);

    expect(result.orgSettings).toBe(0);
    expect(await count('org_settings')).toBe(1);
    const rows = await t.db.select({ cap: orgSettings.dailySendCap }).from(orgSettings);
    // The operator's configured cap survives untouched.
    expect(rows[0]?.cap).toBe(17);
  });

  it('does not duplicate a status label that already exists under a different id', async () => {
    await t.db.insert(leadStatuses).values({ label: 'Qualified', sortOrder: 99 });

    const result = await bootstrapReferenceData(t.db);

    expect(result.leadStatuses).toBe(LEAD_STATUS_LABELS.length - 1);
    expect(await count('lead_statuses')).toBe(LEAD_STATUS_LABELS.length);
    const labels = (await t.db.select({ label: leadStatuses.label }).from(leadStatuses)).map(
      (r) => r.label,
    );
    expect(labels.filter((l) => l === 'Qualified')).toHaveLength(1);
  });

  it('does not duplicate an opportunity stage label that already exists', async () => {
    await t.db.insert(opportunityStages).values({ label: 'Proposal', sortOrder: 42 });
    const result = await bootstrapReferenceData(t.db);
    expect(result.opportunityStages).toBe(OPPORTUNITY_STAGE_LABELS.length - 1);
    expect(await count('opportunity_stages')).toBe(OPPORTUNITY_STAGE_LABELS.length);
  });

  it('leaves an existing user population alone', async () => {
    await t.db.insert(users).values({
      email: 'real.person@example.com',
      name: 'Real Person',
      role: 'admin',
      idpSubject: 'oidc|real',
    });
    await bootstrapReferenceData(t.db);
    expect(await count('users')).toBe(1);
  });
});

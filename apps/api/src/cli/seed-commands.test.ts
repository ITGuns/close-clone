import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';

import { createTestDb, type TestDb } from '../db/test-helpers.ts';
import { users } from '../db/index.ts';
import { DEMO_SEED_ENV_FLAG } from '../services/seed/index.ts';
import { runCli } from './index.ts';

/**
 * `switchboard-admin bootstrap` / `seed-demo` through the real argv dispatch —
 * exit codes and refusal output, which is what the container step and any human
 * operator actually observe.
 */

let ctx: TestDb;
let out: string[];
let err: string[];

const write = (sink: string[]) => (line: string) => {
  sink.push(line);
};

beforeEach(async () => {
  ctx = await createTestDb();
  out = [];
  err = [];
  delete process.env[DEMO_SEED_ENV_FLAG];
});

afterEach(async () => {
  delete process.env[DEMO_SEED_ENV_FLAG];
  await ctx.close();
});

function run(argv: string[]): Promise<number> {
  return runCli(argv, ctx.db, write(out), write(err));
}

async function count(table: string): Promise<number> {
  const res = (await ctx.db.execute(sql.raw(`SELECT count(*)::int AS n FROM ${table}`))) as {
    rows: { n: number }[];
  };
  return res.rows[0]?.n ?? -1;
}

describe('bootstrap', () => {
  it('exits 0 and creates the reference data', async () => {
    expect(await run(['bootstrap'])).toBe(0);
    expect(await count('lead_statuses')).toBe(5);
    expect(await count('opportunity_stages')).toBe(4);
    expect(await count('org_settings')).toBe(1);
    expect(out.join('\n')).toContain('reference data created');
  });

  it('runs without ALLOW_DEMO_SEED — it is not demo data', async () => {
    expect(process.env[DEMO_SEED_ENV_FLAG]).toBeUndefined();
    expect(await run(['bootstrap'])).toBe(0);
  });

  it('is a reported no-op the second time', async () => {
    await run(['bootstrap']);
    out = [];
    expect(await run(['bootstrap'])).toBe(0);
    expect(out.join('\n')).toContain('already present');
  });

  it('emits machine-readable output with --json', async () => {
    expect(await run(['bootstrap', '--json'])).toBe(0);
    expect(JSON.parse(out.join('\n'))).toEqual({
      leadStatuses: 5,
      opportunityStages: 4,
      orgSettings: 1,
    });
  });

  it('creates no users', async () => {
    await run(['bootstrap']);
    expect(await count('users')).toBe(0);
  });
});

describe('seed-demo', () => {
  it('exits 1 and writes nothing when ALLOW_DEMO_SEED is unset', async () => {
    expect(await run(['seed-demo'])).toBe(1);
    expect(err.join('\n')).toContain(DEMO_SEED_ENV_FLAG);
    expect(await count('leads')).toBe(0);
    expect(await count('users')).toBe(0);
  });

  it('exits 1 even with --force when the env flag is unset', async () => {
    expect(await run(['seed-demo', '--force'])).toBe(1);
    expect(await count('leads')).toBe(0);
  });

  it('seeds and exits 0 when the flag is set', async () => {
    process.env[DEMO_SEED_ENV_FLAG] = '1';
    expect(await run(['seed-demo'])).toBe(0);
    expect(await count('leads')).toBeGreaterThan(0);
    expect(await count('users')).toBeGreaterThan(0);
    expect(out.join('\n')).toContain('demo data seeded');
  });

  it('exits 1 on a database holding foreign rows, naming them', async () => {
    process.env[DEMO_SEED_ENV_FLAG] = '1';
    await ctx.db.insert(users).values({
      email: 'someone.real@company.example',
      name: 'Someone Real',
      role: 'admin',
      idpSubject: 'oidc|someone',
    });

    expect(await run(['seed-demo'])).toBe(1);
    expect(err.join('\n')).toContain('users=1');
    expect(await count('leads')).toBe(0);
  });

  it('accepts --anchor and reports it', async () => {
    process.env[DEMO_SEED_ENV_FLAG] = '1';
    expect(await run(['seed-demo', '--anchor', '2026-03-04T12:00:00.000Z', '--json'])).toBe(0);
    const parsed = JSON.parse(out.join('\n')) as { anchor: string };
    expect(parsed.anchor).toBe('2026-03-04T12:00:00.000Z');
  });

  it('exits 1 on a malformed --anchor without writing', async () => {
    process.env[DEMO_SEED_ENV_FLAG] = '1';
    expect(await run(['seed-demo', '--anchor', 'tomorrow'])).toBe(1);
    expect(err.join('\n')).toMatch(/anchor/i);
    expect(await count('leads')).toBe(0);
  });

  it('is a reported no-op on a re-run', async () => {
    process.env[DEMO_SEED_ENV_FLAG] = '1';
    await run(['seed-demo']);
    const leadsAfterFirst = await count('leads');
    out = [];
    expect(await run(['seed-demo'])).toBe(0);
    expect(out.join('\n')).toContain('already present');
    expect(await count('leads')).toBe(leadsAfterFirst);
  });
});

describe('usage', () => {
  it('lists both new commands', async () => {
    expect(await run(['help'])).toBe(0);
    const text = out.join('\n');
    expect(text).toContain('bootstrap');
    expect(text).toContain('seed-demo');
    expect(text).toContain('ALLOW_DEMO_SEED=1');
  });
});

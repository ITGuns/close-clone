import { sql } from 'drizzle-orm';

import {
  activities,
  contacts,
  leadStatuses,
  leads,
  notes,
  opportunities,
  opportunityStages,
  tasks,
  users,
  type Db,
} from '../../db/index.ts';
import {
  DEMO_ANCHOR_ISO,
  buildDemoDataset,
  datasetCounts,
  datasetIds,
  type DemoDataset,
} from './demo-data.ts';
import { bootstrapReferenceData } from './reference.ts';

/**
 * DEMO SEED — the dangerous half, and the gate that keeps it from being an
 * incident.
 *
 * Seeding fictional leads into a production database is a serious event: it
 * pollutes the audit trail, the reports, every Smart View and the compliance
 * surface, and there is no undo short of a restore. So this module refuses by
 * default and only proceeds when THREE independent things line up:
 *
 *  1. `ALLOW_DEMO_SEED=1` must be present in the environment. Explicit, opt-in,
 *     and deliberately NOT derived from `MOCK_MODE`, `NODE_ENV`, an empty
 *     database, or anything else that could be true by accident — a mock-mode
 *     stack is a perfectly ordinary thing to run, and it must not imply consent
 *     to write fixture data. `--force` does NOT override this check.
 *  2. The database must contain no rows this seed did not author. The probe is
 *     `id NOT IN (<the ids this dataset occupies>)` per table, plus a plain count
 *     on the tables the seed never writes at all, so the property is exactly
 *     "refuse if anything here is somebody else's". `--force` overrides ONLY this
 *     check, and the refusal message names the tables and counts.
 *  3. The dataset itself is unreachable: `.invalid` addresses and NANP fictional
 *     555-01xx phone numbers (see `demo-data.ts`). Not a gate, a blast radius —
 *     if the first two ever fail, nothing in here can reach a real person.
 *
 * Because both the ids and the content are deterministic, a re-run against a
 * database holding exactly this seed passes the probe (no foreign rows), inserts
 * nothing (`onConflictDoNothing` on every predicted primary key) and reports
 * `alreadySeeded`. Idempotent, not merely repeatable.
 *
 * No enums / namespaces / parameter properties (host type-stripping constraint).
 */

/** The env var that must be `1`. Never inferred from anything else. */
export const DEMO_SEED_ENV_FLAG = 'ALLOW_DEMO_SEED';

/** A deliberate refusal (bad gate, non-empty database). Exit code 1 in the CLI. */
export class SeedRefusedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SeedRefusedError';
  }
}

export interface ForeignRowCount {
  table: string;
  count: number;
}

export interface SeedDemoOptions {
  /** Environment to read the gate from. Defaults to `process.env`. */
  env?: Record<string, string | undefined>;
  /** Override the non-empty-database refusal. Never overrides the env gate. */
  force?: boolean;
  /** ISO instant the dataset is dated relative to. */
  anchor?: string;
}

export interface SeedDemoResult {
  anchor: string;
  /** Rows actually inserted, per table. */
  inserted: Record<string, number>;
  /** The dataset's full size, whether or not it was inserted this run. */
  dataset: Record<string, number>;
  /** True when the run was a no-op because the seed was already present. */
  alreadySeeded: boolean;
  /** Foreign rows found; non-empty only when `force` let the run continue. */
  foreignRows: ForeignRowCount[];
  reference: { leadStatuses: number; opportunityStages: number; orgSettings: number };
}

/** `count(*) WHERE id NOT IN (…)`, or a plain count when the id list is empty. */
async function countForeign(db: Db, table: string, ids: readonly string[]): Promise<number> {
  const query =
    ids.length === 0
      ? sql.raw(`SELECT count(*)::int AS n FROM ${table}`)
      : sql`${sql.raw(`SELECT count(*)::int AS n FROM ${table} WHERE id NOT IN (`)}${sql.join(
          ids.map((id) => sql`${id}::uuid`),
          sql`, `,
        )}${sql.raw(')')}`;
  const res = (await db.execute(query)) as { rows: { n: number }[] };
  return res.rows[0]?.n ?? 0;
}

/**
 * Tables the demo seed never writes. ANY row in one of these is somebody else's
 * data, so their presence alone is enough to refuse.
 */
const UNSEEDED_TABLES = [
  'email_messages',
  'email_threads',
  'email_accounts',
  'calls',
  'sms_messages',
  'sequence_enrollments',
  'send_intents',
  'suppressions',
  'imports',
  'api_tokens',
] as const;

/**
 * Every row in the database that this dataset did not author, per table. An
 * empty result is the only state in which the demo seed will run unforced.
 */
export async function probeForeignRows(db: Db, dataset: DemoDataset): Promise<ForeignRowCount[]> {
  const ids = datasetIds(dataset);
  const found: ForeignRowCount[] = [];

  const seeded: [string, string[]][] = [
    ['users', ids.users],
    ['leads', ids.leads],
    ['contacts', ids.contacts],
    ['opportunities', ids.opportunities],
    ['tasks', ids.tasks],
    ['notes', ids.notes],
    ['activities', ids.activities],
  ];
  for (const [table, tableIds] of seeded) {
    const n = await countForeign(db, table, tableIds);
    if (n > 0) found.push({ table, count: n });
  }
  for (const table of UNSEEDED_TABLES) {
    const n = await countForeign(db, table, []);
    if (n > 0) found.push({ table, count: n });
  }
  return found;
}

function refusalForForeignRows(foreign: ForeignRowCount[]): string {
  const detail = foreign.map((f) => `${f.table}=${f.count}`).join(' ');
  return [
    'refusing to seed demo data: this database already contains rows the seed did not author',
    `  foreign rows: ${detail}`,
    '  This is almost certainly a real database. If you are certain it is not,',
    '  re-run with --force (which overrides ONLY this check, never the',
    `  ${DEMO_SEED_ENV_FLAG}=1 requirement).`,
  ].join('\n');
}

/**
 * Seed the demo/CI dataset. Refuses unless gated; see the module docblock.
 *
 * @throws SeedRefusedError when the env gate is unset or the database is not ours.
 */
export async function seedDemoData(db: Db, opts: SeedDemoOptions = {}): Promise<SeedDemoResult> {
  const env = opts.env ?? process.env;
  if (env[DEMO_SEED_ENV_FLAG] !== '1') {
    throw new SeedRefusedError(
      [
        `refusing to seed demo data: ${DEMO_SEED_ENV_FLAG} is not set to "1"`,
        '  Demo data is fictional leads, contacts and tasks. Loading it into a',
        '  production database pollutes the audit log, reports and every Smart',
        '  View, and cannot be undone without a restore.',
        `  Set ${DEMO_SEED_ENV_FLAG}=1 in the environment of THIS command only if`,
        '  you are certain the target database is a demo, CI or scratch database.',
      ].join('\n'),
    );
  }

  const anchor = opts.anchor ?? DEMO_ANCHOR_ISO;
  const dataset = buildDemoDataset(anchor);
  const force = opts.force ?? false;

  const foreignRows = await probeForeignRows(db, dataset);
  if (foreignRows.length > 0 && !force) {
    throw new SeedRefusedError(refusalForForeignRows(foreignRows));
  }

  // Reference data first: the demo leads/opportunities reference these ids.
  const reference = await bootstrapReferenceData(db);

  const inserted = await db.transaction(async (tx) => {
    async function put<TRow extends Record<string, unknown>>(
      table: Parameters<Db['insert']>[0],
      rows: TRow[],
    ): Promise<number> {
      if (rows.length === 0) return 0;
      const written = await tx
        .insert(table)
        .values(rows)
        .onConflictDoNothing()
        .returning({
          id: sql<string>`id`,
        });
      return written.length;
    }

    // Dimension rows are re-asserted here so a partially-bootstrapped database
    // still satisfies the FKs below; conflicts are no-ops.
    await put(leadStatuses, dataset.leadStatuses);
    await put(opportunityStages, dataset.opportunityStages);

    return {
      users: await put(users, dataset.users),
      leads: await put(leads, dataset.leads),
      contacts: await put(contacts, dataset.contacts),
      opportunities: await put(opportunities, dataset.opportunities),
      tasks: await put(tasks, dataset.tasks),
      notes: await put(notes, dataset.notes),
      activities: await put(activities, dataset.activities),
    };
  });

  const total = Object.values(inserted).reduce((a, b) => a + b, 0);
  return {
    anchor,
    inserted,
    dataset: datasetCounts(dataset),
    alreadySeeded: total === 0,
    foreignRows,
    reference,
  };
}

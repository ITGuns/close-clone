import { pathToFileURL } from 'node:url';

import { drizzle } from 'drizzle-orm/node-postgres';
import pg from 'pg';

import { loadConfig } from '../config.ts';
import type { Db } from '../db/index.ts';
import { bootstrapReferenceData, seedDemoData } from '../services/seed/index.ts';
import { flagBool, flagString, parseArgs } from './args.ts';
import { hardDeleteLead } from './hard-delete.ts';
import { mergeLeads } from './merge.ts';
import { userLookup } from './user-lookup.ts';

/**
 * `switchboard-admin` CLI entrypoint (Task 5g). Thin argv → command dispatch over
 * a real-Postgres handle built from `DATABASE_URL`. The command implementations
 * live in sibling modules and take an INJECTED `Db`, so they are smoke-tested
 * end-to-end against PGlite without this entry (which is the only place `pg` is
 * imported). Sessions are pinned to UTC per CONTRACTS §C3.
 *
 * Exit codes: 0 success; 1 any refusal (missing reason, open enrollments) or
 * error.
 *
 * Runtime: `pnpm --filter @switchboard/api admin <command>`, which runs
 * `node --experimental-transform-types src/cli/index.ts`. The CLI's own modules
 * hold to the host type-stripping constraint (no enums / namespaces / parameter
 * properties), but the command modules transitively import `@switchboard/shared`,
 * whose barrel pulls in the DSL compiler — and that module uses a TS parameter
 * property, which strip-ONLY mode (`--experimental-strip-types`) rejects at load.
 * `--experimental-transform-types` transforms rather than strips, so it runs the
 * whole graph with zero added dependencies. (Reported as friction: the parameter
 * property lives in `packages/shared/src/dsl/compile.ts`, outside this task's
 * allowlist.)
 */

type Out = (line: string) => void;

const BOOLEAN_FLAGS = ['force', 'json'] as const;

function printUsage(out: Out): void {
  out('switchboard-admin — internal admin operations');
  out('');
  out('Usage:');
  out('  user-lookup <emailOrName>');
  out('  merge-leads <winnerId> <loserId> [--actor <userId>]');
  out('  hard-delete-lead <leadId> --reason <text> [--force] [--actor <userId>]');
  out('  bootstrap                       create required reference data (safe on prod)');
  out('  seed-demo [--anchor <iso>] [--force]');
  out('                                  load the demo/CI dataset — requires');
  out('                                  ALLOW_DEMO_SEED=1 in the environment');
  out('');
  out('Global flags: --json (machine-readable output), --actor <userId>');
}

/**
 * `bootstrap` — tier 1. Reference data only (`lead_statuses`,
 * `opportunity_stages`, `org_settings`). Idempotent and additive, so it carries
 * no gate: a fresh deployment CANNOT create a lead until this has run, and
 * running it twice is a no-op.
 */
async function runBootstrap(db: Db, json: boolean, out: Out): Promise<number> {
  const result = await bootstrapReferenceData(db);
  if (json) {
    out(JSON.stringify(result, null, 2));
    return 0;
  }
  const total = result.leadStatuses + result.opportunityStages + result.orgSettings;
  out(total === 0 ? 'reference data already present — nothing to do' : 'reference data created');
  out(
    `  lead_statuses=+${result.leadStatuses} opportunity_stages=+${result.opportunityStages} ` +
      `org_settings=+${result.orgSettings}`,
  );
  return 0;
}

/**
 * `seed-demo` — tier 3. Fictional leads/contacts/tasks. Refuses unless
 * `ALLOW_DEMO_SEED=1` is set AND the database contains nothing the seed did not
 * author (`--force` overrides only the latter). See services/seed/demo.ts.
 */
async function runSeedDemo(
  db: Db,
  flags: Record<string, string | boolean>,
  json: boolean,
  out: Out,
): Promise<number> {
  const anchor = flagString(flags, 'anchor');
  const result = await seedDemoData(db, {
    force: flagBool(flags, 'force'),
    ...(anchor === undefined ? {} : { anchor }),
  });
  if (json) {
    out(JSON.stringify(result, null, 2));
    return 0;
  }
  out(
    result.alreadySeeded
      ? 'demo data already present — nothing inserted'
      : `demo data seeded (anchor ${result.anchor})`,
  );
  out(
    `  reference: lead_statuses=+${result.reference.leadStatuses} ` +
      `opportunity_stages=+${result.reference.opportunityStages} ` +
      `org_settings=+${result.reference.orgSettings}`,
  );
  const inserted = Object.entries(result.inserted)
    .map(([table, n]) => `${table}=+${n}`)
    .join(' ');
  out(`  inserted:  ${inserted}`);
  if (result.foreignRows.length > 0) {
    out(
      `  WARNING --force was used; pre-existing foreign rows: ` +
        result.foreignRows.map((f) => `${f.table}=${f.count}`).join(' '),
    );
  }
  return 0;
}

function resolveActor(
  flags: Record<string, string | boolean>,
): { actorId: string; actorType: 'user' } | { actorType: 'system' } {
  const actorId = flagString(flags, 'actor');
  return actorId !== undefined ? { actorId, actorType: 'user' } : { actorType: 'system' };
}

async function runUserLookup(
  db: Db,
  positionals: string[],
  json: boolean,
  out: Out,
  err: Out,
): Promise<number> {
  const query = positionals[0];
  if (query === undefined) {
    err('user-lookup requires <emailOrName>');
    return 1;
  }
  const results = await userLookup(db, query);
  if (json) {
    out(JSON.stringify(results, null, 2));
    return 0;
  }
  if (results.length === 0) {
    out(`no users match "${query}"`);
    return 0;
  }
  for (const u of results) {
    out(`${u.email}  (${u.name})`);
    out(`  id=${u.id}  role=${u.role}  active=${u.isActive}  tz=${u.timezone}`);
    out(
      `  leadsOwned=${u.counts.leadsOwned} opportunities=${u.counts.opportunitiesOwned} ` +
        `activities=${u.counts.activities} tasksAssigned=${u.counts.tasksAssigned} ` +
        `notes=${u.counts.notesAuthored}`,
    );
  }
  return 0;
}

async function runMergeLeads(
  db: Db,
  positionals: string[],
  flags: Record<string, string | boolean>,
  json: boolean,
  out: Out,
  err: Out,
): Promise<number> {
  const winnerId = positionals[0];
  const loserId = positionals[1];
  if (winnerId === undefined || loserId === undefined) {
    err('merge-leads requires <winnerId> <loserId>');
    return 1;
  }
  const result = await mergeLeads(db, { winnerId, loserId, actor: resolveActor(flags) });
  if (json) {
    out(JSON.stringify(result, null, 2));
    return 0;
  }
  const r = result.reparented;
  out(`merged lead ${loserId} → ${winnerId}`);
  out(
    `  re-parented: contacts=${r.contacts} opportunities=${r.opportunities} ` +
      `activities=${r.activities} tasks=${r.tasks} notes=${r.notes} ` +
      `threads=${r.emailThreads} enrollments=${r.enrollments} calls=${r.calls} sms=${r.sms}`,
  );
  out(
    `  deduped contacts=${result.dedupedContacts.length} ` +
      `unenrolled collisions=${result.unenrolledCollisions.length}`,
  );
  out(`  lead_merged activity=${result.activityId}  audit=${result.auditId}`);
  return 0;
}

async function runHardDelete(
  db: Db,
  positionals: string[],
  flags: Record<string, string | boolean>,
  json: boolean,
  out: Out,
  err: Out,
): Promise<number> {
  const leadId = positionals[0];
  if (leadId === undefined) {
    err('hard-delete-lead requires <leadId>');
    return 1;
  }
  const reason = flagString(flags, 'reason');
  if (reason === undefined) {
    err('hard-delete-lead requires --reason <text>');
    return 1;
  }
  const result = await hardDeleteLead(db, {
    leadId,
    reason,
    force: flagBool(flags, 'force'),
    actor: resolveActor(flags),
  });
  if (json) {
    out(JSON.stringify(result, null, 2));
    return 0;
  }
  const d = result.deleted;
  out(`hard-deleted lead ${leadId}`);
  out(
    `  deleted: contacts=${d.contacts} opportunities=${d.opportunities} ` +
      `activities=${d.activities} tasks=${d.tasks} notes=${d.notes} ` +
      `calls=${d.calls} sms=${d.sms} enrollments=${d.enrollments} sendIntents=${d.sendIntents}`,
  );
  out(`  threads unlinked=${result.threadsUnlinked}  unenrolled=${result.unenrolled}`);
  out(`  audit: requested=${result.requestedAuditId} completed=${result.completedAuditId}`);
  return 0;
}

export async function runCli(argv: readonly string[], db: Db, out: Out, err: Out): Promise<number> {
  const parsed = parseArgs(argv, { booleans: [...BOOLEAN_FLAGS] });
  const json = flagBool(parsed.flags, 'json');

  try {
    switch (parsed.command) {
      case 'user-lookup':
        return await runUserLookup(db, parsed.positionals, json, out, err);
      case 'merge-leads':
        return await runMergeLeads(db, parsed.positionals, parsed.flags, json, out, err);
      case 'hard-delete-lead':
        return await runHardDelete(db, parsed.positionals, parsed.flags, json, out, err);
      case 'bootstrap':
        return await runBootstrap(db, json, out);
      case 'seed-demo':
        return await runSeedDemo(db, parsed.flags, json, out);
      default:
        printUsage(out);
        return parsed.command === null || parsed.command === 'help' ? 0 : 1;
    }
  } catch (error) {
    // Typed refusals (missing reason, open enrollments, lead not found, …) and
    // any other failure surface as a message + non-zero exit.
    err(error instanceof Error ? error.message : String(error));
    return 1;
  }
}

async function main(): Promise<number> {
  const argv = process.argv.slice(2);
  const first = argv[0];

  // Usage/help needs no DB connection.
  if (first === undefined || first === 'help' || first === '--help' || first === '-h') {
    printUsage((line) => console.log(line));
    return 0;
  }

  const config = loadConfig();
  const pool = new pg.Pool({ connectionString: config.databaseUrl, options: '-c timezone=UTC' });
  const db = drizzle(pool);
  try {
    return await runCli(
      argv,
      db,
      (line) => console.log(line),
      (line) => console.error(line),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  } finally {
    await pool.end();
  }
}

/**
 * Run `main` only when this file is the executed script — never on import (so the
 * command modules stay unit-testable via `runCli` without a DB connection or a
 * `process.exit`).
 */
const entryArg = process.argv[1];
const isEntry = entryArg !== undefined && import.meta.url === pathToFileURL(entryArg).href;
if (isEntry) {
  main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
      console.error(error);
      process.exit(1);
    });
}

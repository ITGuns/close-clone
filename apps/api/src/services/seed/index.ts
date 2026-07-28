/**
 * Seeding, in three deliberately separate tiers (see `reference.ts` and `demo.ts`
 * for the full rationale):
 *
 *   1. REFERENCE data — `lead_statuses`, `opportunity_stages`, `org_settings`.
 *      Required for ANY working deployment: without statuses a lead cannot be
 *      created at all, and without the `org_settings` singleton the admin
 *      settings screen 404s and the send engine falls back to hardcoded policy
 *      defaults instead of configured ones. Idempotent, additive, and correct to
 *      run against production — so it is NOT behind the demo gate.
 *   2. BOOTSTRAP — an initial admin user. Deliberately NOT implemented; real-mode
 *      sign-in provisions users just-in-time from the IdP assertion and derives
 *      `admin` from the directory groups, so a pre-created row would be an
 *      unreachable second identity. See `reference.ts`.
 *   3. DEMO / CI data — leads, contacts, tasks, activities. An incident if it
 *      lands in production, so it is gated on an explicit `ALLOW_DEMO_SEED=1`
 *      plus an "is this database ours?" probe.
 */

export {
  LEAD_STATUS_LABELS,
  OPPORTUNITY_STAGE_LABELS,
  bootstrapReferenceData,
  leadStatusId,
  leadStatusRows,
  opportunityStageId,
  opportunityStageRows,
  type BootstrapResult,
} from './reference.ts';

export {
  DEMO_ANCHOR_ISO,
  DEMO_EMAIL_DOMAIN,
  buildDemoDataset,
  datasetCounts,
  datasetIds,
  demoEmail,
  demoPhone,
  type DemoDataset,
} from './demo-data.ts';

export {
  DEMO_SEED_ENV_FLAG,
  SeedRefusedError,
  probeForeignRows,
  seedDemoData,
  type ForeignRowCount,
  type SeedDemoOptions,
  type SeedDemoResult,
} from './demo.ts';

export { seedUuid, SEED_NAMESPACE } from './uuid.ts';

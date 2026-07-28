import { inArray } from 'drizzle-orm';
import type { InferInsertModel } from 'drizzle-orm';

import { leadStatuses, opportunityStages, orgSettings, type Db } from '../../db/index.ts';
import { seedUuid } from './uuid.ts';

/**
 * BOOTSTRAP — the minimum a real first deployment needs, and nothing more.
 *
 * A freshly migrated database has no seeded rows at all (`grep "INSERT INTO"
 * apps/api/src/db/migrations/*.sql` returns nothing), which leaves three gaps
 * that have nothing to do with demo data:
 *
 *   - `org_settings` is a singleton the code reads but never creates.
 *     `getOrgSettings` (services/admin/org-settings.ts) throws `AdminNotFoundError`
 *     when the row is absent, so `GET /api/v1/admin/org-settings` 404s and the
 *     admin settings screen is dead on a fresh deployment. (The compliance rails
 *     themselves fail SAFE without it — `parseQuietHours` defaults to the I-QUIET
 *     08:00–21:00 window and `loadOrgConfig` to DEFAULT_DAILY_CAP — so this is a
 *     usability gap, not a rail gap.)
 *   - `lead_statuses` is empty, so no lead can be given a status and the board
 *     has no columns.
 *   - `opportunity_stages` is empty, so the pipeline has no stages.
 *
 * What bootstrap deliberately does NOT create is a user. Real-mode sign-in has no
 * password store at all: the IdP assertion is the only credential, and
 * `auth/provisioning.ts` upserts the user just-in-time on first login with the
 * role `groupsToRole` derives from the directory groups — including `admin` for
 * `sales-crm-admins`. So the first admin provisions themselves, and a
 * bootstrap-created row would either be unreachable (no idp_subject anyone can
 * present) or a second identity for someone who already has one. In MOCK_MODE
 * the dev-login picker does read `users` directly, but that is demo territory —
 * see `demo.ts`, which is gated accordingly.
 *
 * Everything here is additive and idempotent: safe to run on any database,
 * including production, as many times as you like.
 *
 * No enums / namespaces / parameter properties (host type-stripping constraint).
 */

/** CONTRACTS §C1 `lead_statuses` — the labels named in the contract. */
export const LEAD_STATUS_LABELS = ['Potential', 'Contacted', 'Qualified', 'Won', 'Lost'] as const;

/** CONTRACTS §C1 `opportunity_stages`. */
export const OPPORTUNITY_STAGE_LABELS = ['Discovery', 'Proposal', 'Negotiation', 'Closed'] as const;

/** Deterministic id for a canonical lead status (shared with the demo dataset). */
export function leadStatusId(label: string): string {
  return seedUuid(`lead_status:${label}`);
}

/** Deterministic id for a canonical opportunity stage. */
export function opportunityStageId(label: string): string {
  return seedUuid(`opportunity_stage:${label}`);
}

export function leadStatusRows(): InferInsertModel<typeof leadStatuses>[] {
  return LEAD_STATUS_LABELS.map((label, i) => ({
    id: leadStatusId(label),
    label,
    sortOrder: i,
  }));
}

export function opportunityStageRows(): InferInsertModel<typeof opportunityStages>[] {
  return OPPORTUNITY_STAGE_LABELS.map((label, i) => ({
    id: opportunityStageId(label),
    label,
    sortOrder: i,
  }));
}

export interface BootstrapResult {
  leadStatuses: number;
  opportunityStages: number;
  orgSettings: number;
}

/**
 * Create the reference data a deployment cannot function without. Returns the
 * number of rows actually inserted per table (all zeroes on a re-run).
 *
 * Existing rows are never modified: a label already present under a foreign id is
 * left alone rather than duplicated, and an existing `org_settings` row keeps its
 * operator-configured values.
 */
export async function bootstrapReferenceData(db: Db): Promise<BootstrapResult> {
  return db.transaction(async (tx) => {
    const wantStatuses = leadStatusRows();
    const existingStatusLabels = new Set(
      (
        await tx
          .select({ label: leadStatuses.label })
          .from(leadStatuses)
          .where(
            inArray(
              leadStatuses.label,
              wantStatuses.map((r) => r.label),
            ),
          )
      ).map((r) => r.label),
    );
    const newStatuses = wantStatuses.filter((r) => !existingStatusLabels.has(r.label));
    if (newStatuses.length > 0) {
      await tx.insert(leadStatuses).values(newStatuses).onConflictDoNothing();
    }

    const wantStages = opportunityStageRows();
    const existingStageLabels = new Set(
      (
        await tx
          .select({ label: opportunityStages.label })
          .from(opportunityStages)
          .where(
            inArray(
              opportunityStages.label,
              wantStages.map((r) => r.label),
            ),
          )
      ).map((r) => r.label),
    );
    const newStages = wantStages.filter((r) => !existingStageLabels.has(r.label));
    if (newStages.length > 0) {
      await tx.insert(opportunityStages).values(newStages).onConflictDoNothing();
    }

    // Singleton: presence is the check, not the id — an operator-created row with
    // a random id must not be joined by a second one.
    const existingSettings = await tx.select({ id: orgSettings.id }).from(orgSettings).limit(1);
    let settingsInserted = 0;
    if (existingSettings.length === 0) {
      await tx
        .insert(orgSettings)
        .values({ id: seedUuid('org_settings:singleton') })
        .onConflictDoNothing();
      settingsInserted = 1;
    }

    return {
      leadStatuses: newStatuses.length,
      opportunityStages: newStages.length,
      orgSettings: settingsInserted,
    };
  });
}

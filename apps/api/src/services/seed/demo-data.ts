import type { InferInsertModel } from 'drizzle-orm';

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
} from '../../db/index.ts';
import {
  LEAD_STATUS_LABELS,
  OPPORTUNITY_STAGE_LABELS,
  leadStatusId,
  leadStatusRows,
  opportunityStageId,
  opportunityStageRows,
} from './reference.ts';
import { seedUuid } from './uuid.ts';

/**
 * The demo/CI dataset, built as a PURE function of an anchor timestamp.
 *
 * Two hard properties, both asserted in `demo-data.test.ts`:
 *
 *  1. **Deterministic.** No `Math.random`, no `Date.now`, no I/O anywhere in this
 *     module (CLAUDE.md). Every id comes from {@link seedUuid} and every
 *     timestamp is an offset from the caller-supplied anchor, so the same anchor
 *     always produces byte-identical rows — which is what lets the writer use
 *     `onConflictDoNothing` and call a re-run a no-op.
 *
 *  2. **Unreachable by design.** Every address is under `demo.switchboard.invalid`
 *     (`.invalid` is reserved by RFC 2606 and can never resolve) and every phone
 *     number is in the NANP fictional block 555-0100…555-0199. This is the last
 *     line of defence behind the gate in `demo.ts`: if a demo seed ever did land
 *     in a production database, the compliance engine still could not deliver a
 *     message to a real human from it, because there is no real human in it.
 *
 * The anchor defaults to a frozen constant so an unattended run (CI) is fully
 * reproducible. Pass `--anchor <iso>` for a demo that looks freshly worked.
 * Tasks are placed BEFORE the anchor on purpose: overdue tasks are what the
 * inbox queue projects (`services/inbox/load.ts` selects `due_at <= now`), so the
 * app has visible work no matter how long after seeding it is opened.
 *
 * No enums / namespaces / parameter properties (host type-stripping constraint).
 */

/** Frozen default anchor. Everything is dated relative to this instant. */
export const DEMO_ANCHOR_ISO = '2026-01-05T09:00:00.000Z';

/** RFC 2606 reserved TLD — nothing here can ever be delivered. */
export const DEMO_EMAIL_DOMAIN = 'demo.switchboard.invalid';

/** NANP fictional range: 555-0100 … 555-0199. */
const DEMO_PHONE_MIN = 100;
const DEMO_PHONE_MAX = 199;

export interface DemoDataset {
  users: InferInsertModel<typeof users>[];
  leadStatuses: InferInsertModel<typeof leadStatuses>[];
  opportunityStages: InferInsertModel<typeof opportunityStages>[];
  leads: InferInsertModel<typeof leads>[];
  contacts: InferInsertModel<typeof contacts>[];
  opportunities: InferInsertModel<typeof opportunities>[];
  tasks: InferInsertModel<typeof tasks>[];
  notes: InferInsertModel<typeof notes>[];
  activities: InferInsertModel<typeof activities>[];
}

interface UserSpec {
  key: string;
  name: string;
  role: 'rep' | 'admin';
  timezone: string;
}

const USER_SPECS: readonly UserSpec[] = [
  { key: 'dana.ruiz', name: 'Dana Ruiz', role: 'admin', timezone: 'America/New_York' },
  { key: 'miles.okafor', name: 'Miles Okafor', role: 'rep', timezone: 'America/Chicago' },
  { key: 'priya.raman', name: 'Priya Raman', role: 'rep', timezone: 'America/Los_Angeles' },
];

interface CompanySpec {
  slug: string;
  name: string;
  domain: string;
  area: string;
  blurb: string;
  contacts: { first: string; last: string; title: string }[];
}

/**
 * Ten fictional companies. Names are invented; the domains are all under the
 * reserved `.invalid` demo domain via {@link contactEmail}, never the real
 * `example.com` (which resolves) or anything an operator might mistake for a
 * live account.
 */
const COMPANIES: readonly CompanySpec[] = [
  {
    slug: 'northwind-freight',
    name: 'Northwind Freight',
    domain: 'northwind-freight',
    area: '312',
    blurb: 'Regional LTL carrier modernizing dispatch. Referred by the logistics meetup.',
    contacts: [
      { first: 'Ada', last: 'Beaumont', title: 'VP Operations' },
      { first: 'Curtis', last: 'Nwosu', title: 'Dispatch Manager' },
    ],
  },
  {
    slug: 'harborline-medical',
    name: 'Harborline Medical',
    domain: 'harborline-medical',
    area: '617',
    blurb: 'Multi-site clinic group. Evaluating a replacement for a spreadsheet pipeline.',
    contacts: [{ first: 'Rosalind', last: 'Achebe', title: 'Director of Growth' }],
  },
  {
    slug: 'quill-and-co',
    name: 'Quill & Co Stationers',
    domain: 'quill-and-co',
    area: '503',
    blurb: 'Wholesale stationery. Small team, high call volume, no CRM at all today.',
    contacts: [{ first: 'Tomas', last: 'Halvorsen', title: 'Owner' }],
  },
  {
    slug: 'cedarpoint-analytics',
    name: 'Cedarpoint Analytics',
    domain: 'cedarpoint-analytics',
    area: '206',
    blurb: 'Data consultancy. Inbound from the pricing page; asked about API tokens.',
    contacts: [
      { first: 'Ingrid', last: 'Vasquez', title: 'Head of Revenue' },
      { first: 'Peter', last: 'Oyelaran', title: 'Solutions Lead' },
    ],
  },
  {
    slug: 'baywater-outfitters',
    name: 'Baywater Outfitters',
    domain: 'baywater-outfitters',
    area: '415',
    blurb: 'Outdoor retail chain. Seasonal hiring drives their outreach cadence.',
    contacts: [{ first: 'Nora', last: 'Kilbride', title: 'Regional Manager' }],
  },
  {
    slug: 'ferro-tooling',
    name: 'Ferro Tooling Group',
    domain: 'ferro-tooling',
    area: '216',
    blurb: 'Precision machining. Long cycle, procurement-heavy, wants call recording off.',
    contacts: [{ first: 'Halvard', last: 'Simms', title: 'Procurement Lead' }],
  },
  {
    slug: 'lumen-schoolworks',
    name: 'Lumen Schoolworks',
    domain: 'lumen-schoolworks',
    area: '512',
    blurb: 'K-12 software reseller. Budget cycle closes in the spring.',
    contacts: [{ first: 'Beatriz', last: 'Alcantara', title: 'Partnerships' }],
  },
  {
    slug: 'stonebridge-legal',
    name: 'Stonebridge Legal',
    domain: 'stonebridge-legal',
    area: '404',
    blurb: 'Boutique firm. Compliance-sensitive; asked about consent capture in writing.',
    contacts: [{ first: 'Anselm', last: 'Rutherford', title: 'Managing Partner' }],
  },
  {
    slug: 'greenfell-agritech',
    name: 'Greenfell Agritech',
    domain: 'greenfell-agritech',
    area: '515',
    blurb: 'Sensor hardware for row crops. Went quiet after the pilot proposal.',
    contacts: [{ first: 'Marisol', last: 'Ferreira', title: 'COO' }],
  },
  {
    slug: 'pallas-interiors',
    name: 'Pallas Interiors',
    domain: 'pallas-interiors',
    area: '646',
    blurb: 'Commercial interior fit-out. Won last quarter; expansion conversation open.',
    contacts: [{ first: 'Devon', last: 'Ashworth', title: 'Principal' }],
  },
];

// --- Deterministic helpers --------------------------------------------------

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '.')
    .replace(/^\.+|\.+$/g, '');
}

/** A demo mailbox. Always under the reserved `.invalid` demo domain. */
export function demoEmail(localPart: string): string {
  return `${slugify(localPart)}@${DEMO_EMAIL_DOMAIN}`;
}

/** A demo phone number, always inside the NANP fictional 555-01xx block. */
export function demoPhone(area: string, index: number): string {
  const span = DEMO_PHONE_MAX - DEMO_PHONE_MIN + 1;
  const line = DEMO_PHONE_MIN + (((index % span) + span) % span);
  return `+1${area}555${String(line).padStart(4, '0')}`;
}

/** `anchor` shifted by `minutes` (negative = into the past). Pure. */
function shift(anchorMs: number, minutes: number): string {
  return new Date(anchorMs + minutes * 60_000).toISOString();
}

const MINUTES_PER_DAY = 24 * 60;

// --- The dataset ------------------------------------------------------------

/**
 * Build the full demo dataset. Pure — same anchor in, same rows out.
 *
 * @param anchorIso ISO instant everything is dated relative to.
 */
export function buildDemoDataset(anchorIso: string = DEMO_ANCHOR_ISO): DemoDataset {
  const anchorMs = Date.parse(anchorIso);
  if (Number.isNaN(anchorMs)) {
    throw new Error(`buildDemoDataset: anchor must be an ISO instant, got "${anchorIso}"`);
  }

  const userRows: InferInsertModel<typeof users>[] = USER_SPECS.map((spec) => ({
    id: seedUuid(`user:${spec.key}`),
    email: demoEmail(spec.key),
    name: spec.name,
    role: spec.role,
    idpSubject: `demo|${spec.key}`,
    isActive: true,
    timezone: spec.timezone,
  }));
  const userIds = userRows.map((u) => u.id ?? '');

  function ownerFor(index: number): string {
    return userIds[index % userIds.length] ?? '';
  }

  const leadRows: InferInsertModel<typeof leads>[] = [];
  const contactRows: InferInsertModel<typeof contacts>[] = [];
  const opportunityRows: InferInsertModel<typeof opportunities>[] = [];
  const taskRows: InferInsertModel<typeof tasks>[] = [];
  const noteRows: InferInsertModel<typeof notes>[] = [];
  const activityRows: InferInsertModel<typeof activities>[] = [];

  COMPANIES.forEach((company, i) => {
    const leadId = seedUuid(`lead:${company.slug}`);
    const ownerId = ownerFor(i);
    const statusLabel = LEAD_STATUS_LABELS[i % LEAD_STATUS_LABELS.length] ?? 'Potential';
    // Leads are created between 120 and 30 days before the anchor.
    const createdAt = shift(anchorMs, -(120 - i * 9) * MINUTES_PER_DAY);
    const lastContactedAt = shift(anchorMs, -(9 + i * 2) * MINUTES_PER_DAY);
    // Open tasks are always overdue relative to the anchor so the inbox has work.
    const taskDueAt = shift(anchorMs, -(1 + i) * MINUTES_PER_DAY - 30);

    leadRows.push({
      id: leadId,
      name: company.name,
      url: `https://${company.domain}.${DEMO_EMAIL_DOMAIN}`,
      description: company.blurb,
      statusId: leadStatusId(statusLabel),
      ownerId,
      custom: {},
      dnc: false,
      lastContactedAt,
      lastInboundAt: i % 3 === 0 ? shift(anchorMs, -(6 + i) * MINUTES_PER_DAY) : null,
      nextTaskDueAt: taskDueAt,
      lastCallAt: i % 2 === 0 ? lastContactedAt : null,
      lastEmailAt: i % 2 === 1 ? lastContactedAt : null,
      lastSmsAt: null,
      createdAt,
    });

    company.contacts.forEach((person, c) => {
      const contactId = seedUuid(`contact:${company.slug}:${person.first}.${person.last}`);
      contactRows.push({
        id: contactId,
        leadId,
        name: `${person.first} ${person.last}`,
        title: person.title,
        emails: [
          { email: demoEmail(`${person.first}.${person.last}.${company.domain}`), type: 'work' },
        ],
        phones: [{ phone: demoPhone(company.area, i * 3 + c), type: 'work' }],
        dnc: false,
      });
    });

    const primaryContactId = seedUuid(
      `contact:${company.slug}:${company.contacts[0]?.first ?? 'x'}.${company.contacts[0]?.last ?? 'y'}`,
    );

    // Opportunities on every other lead.
    if (i % 2 === 0) {
      const stageLabel =
        OPPORTUNITY_STAGE_LABELS[(i / 2) % OPPORTUNITY_STAGE_LABELS.length] ?? 'Discovery';
      opportunityRows.push({
        id: seedUuid(`opportunity:${company.slug}`),
        leadId,
        contactId: primaryContactId,
        valueCents: (12_000 + i * 4_500) * 100,
        currency: 'USD',
        stageId: opportunityStageId(stageLabel),
        confidence: 20 + i * 5,
        closeDate: shift(anchorMs, (20 + i * 7) * MINUTES_PER_DAY).slice(0, 10),
        ownerId,
        status: 'active',
        note: `Scoping ${company.name} — ${stageLabel.toLowerCase()} stage.`,
      });
    }

    // One OPEN, overdue task per lead — this is what the inbox projects.
    taskRows.push({
      id: seedUuid(`task:${company.slug}:followup`),
      leadId,
      assigneeId: ownerId,
      title: `Follow up with ${company.contacts[0]?.first ?? 'the'} at ${company.name}`,
      dueAt: taskDueAt,
      completedAt: null,
      createdBy: ownerId,
      createdAt: shift(anchorMs, -(20 + i) * MINUTES_PER_DAY),
    });

    // Every third lead also carries a finished task, so "done" is not empty.
    if (i % 3 === 0) {
      const doneAt = shift(anchorMs, -(2 + i) * MINUTES_PER_DAY);
      taskRows.push({
        id: seedUuid(`task:${company.slug}:intro`),
        leadId,
        assigneeId: ownerId,
        title: `Send the intro deck to ${company.name}`,
        dueAt: shift(anchorMs, -(4 + i) * MINUTES_PER_DAY),
        completedAt: doneAt,
        createdBy: ownerId,
        createdAt: shift(anchorMs, -(25 + i) * MINUTES_PER_DAY),
      });
      activityRows.push({
        id: seedUuid(`activity:${company.slug}:task_completed`),
        leadId,
        contactId: null,
        userId: ownerId,
        type: 'task_completed',
        occurredAt: doneAt,
        payload: { taskId: seedUuid(`task:${company.slug}:intro`), completedAt: doneAt },
      });
    }

    // A note on every other lead.
    if (i % 2 === 1) {
      const noteId = seedUuid(`note:${company.slug}`);
      const noteAt = shift(anchorMs, -(5 + i) * MINUTES_PER_DAY);
      noteRows.push({
        id: noteId,
        leadId,
        authorId: ownerId,
        bodyMd: `**${company.name}** — ${company.blurb}\n\nNext step: confirm the timeline in writing.`,
        status: 'final',
        aiGenerated: false,
        createdAt: noteAt,
      });
      activityRows.push({
        id: seedUuid(`activity:${company.slug}:note_added`),
        leadId,
        contactId: null,
        userId: ownerId,
        type: 'note_added',
        occurredAt: noteAt,
        payload: { noteId, aiGenerated: false },
      });
    }

    // Timeline spine: creation + one outreach touch per lead.
    activityRows.push({
      id: seedUuid(`activity:${company.slug}:lead_created`),
      leadId,
      contactId: null,
      userId: ownerId,
      type: 'lead_created',
      occurredAt: createdAt,
      payload: { source: 'demo_seed' },
    });
    activityRows.push(
      i % 2 === 0
        ? {
            id: seedUuid(`activity:${company.slug}:call_logged`),
            leadId,
            contactId: primaryContactId,
            userId: ownerId,
            type: 'call_logged',
            occurredAt: lastContactedAt,
            payload: { direction: 'outbound', durationS: 180 + i * 15, outcome: 'connected' },
          }
        : {
            id: seedUuid(`activity:${company.slug}:email_sent`),
            leadId,
            contactId: primaryContactId,
            userId: ownerId,
            type: 'email_sent',
            occurredAt: lastContactedAt,
            payload: { subject: `Following up — ${company.name}` },
          },
    );
    activityRows.push({
      id: seedUuid(`activity:${company.slug}:task_created`),
      leadId,
      contactId: null,
      userId: ownerId,
      type: 'task_created',
      occurredAt: shift(anchorMs, -(20 + i) * MINUTES_PER_DAY),
      payload: {
        taskId: seedUuid(`task:${company.slug}:followup`),
        dueAt: taskDueAt,
        title: `Follow up with ${company.name}`,
      },
    });
  });

  return {
    users: userRows,
    leadStatuses: leadStatusRows(),
    opportunityStages: opportunityStageRows(),
    leads: leadRows,
    contacts: contactRows,
    opportunities: opportunityRows,
    tasks: taskRows,
    notes: noteRows,
    activities: activityRows,
  };
}

/** Every id the dataset would occupy, per table. Used by the emptiness probe. */
export interface DatasetIds {
  users: string[];
  leads: string[];
  contacts: string[];
  opportunities: string[];
  tasks: string[];
  notes: string[];
  activities: string[];
}

export function datasetIds(dataset: DemoDataset): DatasetIds {
  const ids = (rows: { id?: string | undefined }[]): string[] =>
    rows.map((r) => r.id).filter((id): id is string => id !== undefined);
  return {
    users: ids(dataset.users),
    leads: ids(dataset.leads),
    contacts: ids(dataset.contacts),
    opportunities: ids(dataset.opportunities),
    tasks: ids(dataset.tasks),
    notes: ids(dataset.notes),
    activities: ids(dataset.activities),
  };
}

/** Row counts the dataset represents, for reporting. */
export function datasetCounts(dataset: DemoDataset): Record<string, number> {
  return {
    users: dataset.users.length,
    leads: dataset.leads.length,
    contacts: dataset.contacts.length,
    opportunities: dataset.opportunities.length,
    tasks: dataset.tasks.length,
    notes: dataset.notes.length,
    activities: dataset.activities.length,
  };
}

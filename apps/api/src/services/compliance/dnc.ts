import { sql } from 'drizzle-orm';
import type { Db } from '../../db/index.ts';

/**
 * Destination-resolved I-DNC (CONTRACTS §C6). The invariant reads "every send/dial
 * path checks contact+lead DNC at execution time" — but the one-off engines only
 * checked the contact the CALLER NAMED. Every one of them also accepts a raw
 * destination (`to`), and `contactId` is optional, so the check was skippable:
 *
 *   POST /sms/send   {leadId, to: "<the DNC'd contact's number>"}   → sent
 *   POST /calls/dial {leadId, to: "<the DNC'd contact's number>"}   → dialed
 *   POST /emails/send{leadId, to: ["<the DNC'd contact's address>"]}→ sent
 *
 * The lead-level flag still blocked, but contact-level DNC — the flag a rep sets
 * when a specific human says stop — did not, and a valid API token was enough
 * (so this was an I-RAIL-API hole too). Phone/email SUPPRESSIONS did not cover it:
 * a rep ticking `contacts.dnc` writes no suppression row.
 *
 * The fix is to resolve the DESTINATION rather than trust the named contact, which
 * also closes the subtler variant where `contactId` points at a clean contact while
 * `to` carries a different, DNC'd person's address.
 *
 * Two deliberate scoping calls (D-060):
 *
 *  - **Not lead-scoped.** DNC attaches to a human, not to a row. The same number on
 *    two leads (a contact who changed employers) is one person, and they said no
 *    once. Over-blocking is recoverable; contacting someone who opted out is not.
 *  - **Live contacts only** (`deleted_at IS NULL`), but ANY lead state. A live DNC
 *    record is visible and clearable in the UI, so a block is always explainable
 *    and escapable. Honouring soft-deleted contacts would create permanent blocks
 *    with no surface to lift them; the durable "this human said no" mechanism is
 *    the `suppressions` table, which STOP writes and which admins release with an
 *    audit trail. A soft-deleted LEAD does not un-DNC its contact, so leads are
 *    deliberately not joined here (`resolveContactByPhone` does join them — that
 *    one is routing inbound traffic to a timeline, a different question).
 *
 * Read-only and executor-taking, so it composes inside a send transaction.
 *
 * No enums / namespaces / parameter properties (host type-stripping constraint).
 */

export interface DncHit {
  /** The live, DNC-flagged contact that owns the destination. */
  contactId: string;
  /** The destination that matched, as the caller supplied it. */
  value: string;
}

/** Build a `text[]` SQL literal from string params (safe: each is bound). */
function textArray(values: string[]): ReturnType<typeof sql> {
  if (values.length === 0) return sql`ARRAY[]::text[]`;
  return sql`ARRAY[${sql.join(
    values.map((v) => sql`${v}`),
    sql`, `,
  )}]::text[]`;
}

/**
 * The DNC-flagged contact owning `phone`, or null. Matches on the trailing-10-digit
 * key (`phoneMatchKey` semantics, inlined in SQL) so formatting never opens a hole.
 * `key` must already be a match key; an empty key (fewer than 10 digits) matches
 * nothing rather than everything.
 */
export async function findPhoneDnc(exec: Db, key: string, value: string): Promise<DncHit | null> {
  if (key === '') return null;
  const result = await exec.execute(sql`
    SELECT c.id AS contact_id
    FROM contacts c
    WHERE c.deleted_at IS NULL
      AND c.dnc = true
      AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(c.phones) AS p
        WHERE right(regexp_replace(p->>'phone', '[^0-9]', '', 'g'), 10) = ${key}
      )
    ORDER BY c.created_at ASC, c.id ASC
    LIMIT 1
  `);
  const row = (result as { rows: Record<string, unknown>[] }).rows[0];
  if (row === undefined) return null;
  return { contactId: String(row['contact_id']), value };
}

/**
 * The first of `addresses` owned by a DNC-flagged contact, or null. Case-insensitive;
 * the returned `value` is the caller's original casing so the C8 error names what
 * they actually sent. Checks EVERY recipient — cc included — because a DNC'd person
 * on cc has still been contacted.
 */
export async function findEmailDnc(exec: Db, addresses: string[]): Promise<DncHit | null> {
  const needles = [
    ...new Set(addresses.map((a) => a.trim().toLowerCase()).filter((a) => a.length > 0)),
  ];
  if (needles.length === 0) return null;

  const result = await exec.execute(sql`
    SELECT c.id AS contact_id, lower(e->>'email') AS matched
    FROM contacts c
    CROSS JOIN LATERAL jsonb_array_elements(c.emails) AS e
    WHERE c.deleted_at IS NULL
      AND c.dnc = true
      AND lower(e->>'email') = ANY(${textArray(needles)})
    ORDER BY c.created_at ASC, c.id ASC
    LIMIT 1
  `);
  const row = (result as { rows: Record<string, unknown>[] }).rows[0];
  if (row === undefined) return null;
  const matched = String(row['matched']);
  const original = addresses.find((a) => a.trim().toLowerCase() === matched) ?? matched;
  return { contactId: String(row['contact_id']), value: original };
}

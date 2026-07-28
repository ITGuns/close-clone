import { describe, expect, it } from 'vitest';

import {
  DEMO_ANCHOR_ISO,
  DEMO_EMAIL_DOMAIN,
  buildDemoDataset,
  datasetCounts,
  demoPhone,
} from './demo-data.ts';

/**
 * The demo dataset is a pure function. These tests pin the two properties the
 * rest of the safety story leans on: determinism, and the fact that nothing in
 * the dataset can reach a real person.
 */

describe('buildDemoDataset', () => {
  it('is byte-identical for the same anchor', () => {
    expect(buildDemoDataset(DEMO_ANCHOR_ISO)).toEqual(buildDemoDataset(DEMO_ANCHOR_ISO));
  });

  it('shifts with the anchor without changing shape', () => {
    const a = buildDemoDataset('2026-01-05T09:00:00.000Z');
    const b = buildDemoDataset('2026-06-05T09:00:00.000Z');
    expect(datasetCounts(a)).toEqual(datasetCounts(b));
    // Same ids (ids are name-derived, not time-derived) …
    expect(a.leads.map((l) => l.id)).toEqual(b.leads.map((l) => l.id));
    // … different timestamps.
    expect(a.tasks[0]?.dueAt).not.toBe(b.tasks[0]?.dueAt);
  });

  it('rejects a non-ISO anchor', () => {
    expect(() => buildDemoDataset('yesterday')).toThrow(/anchor/i);
  });

  it('has exactly one admin user, and every user is active', () => {
    const d = buildDemoDataset();
    expect(d.users.filter((u) => u.role === 'admin')).toHaveLength(1);
    expect(d.users.every((u) => u.isActive === true)).toBe(true);
  });

  it('puts every open task BEFORE the anchor so the inbox always has work', () => {
    const anchorMs = Date.parse(DEMO_ANCHOR_ISO);
    const open = buildDemoDataset().tasks.filter((t) => t.completedAt === null);
    expect(open.length).toBeGreaterThan(3);
    for (const t of open) {
      expect(typeof t.dueAt).toBe('string');
      expect(Date.parse(String(t.dueAt))).toBeLessThan(anchorMs);
    }
  });

  it('routes every email address to the reserved .invalid demo domain', () => {
    const d = buildDemoDataset();
    for (const u of d.users) expect(u.email.endsWith(`@${DEMO_EMAIL_DOMAIN}`)).toBe(true);
    for (const c of d.contacts) {
      for (const e of c.emails ?? []) {
        expect(e.email.endsWith(`@${DEMO_EMAIL_DOMAIN}`)).toBe(true);
      }
    }
    // Nothing may use a domain that actually resolves.
    const serialized = JSON.stringify(d);
    expect(serialized).not.toMatch(/@example\.(com|org|net)/);
    expect(serialized).not.toMatch(/@(gmail|outlook|yahoo)\./);
  });

  it('uses only NANP fictional 555-01xx phone numbers', () => {
    const d = buildDemoDataset();
    const phones = d.contacts.flatMap((c) => (c.phones ?? []).map((p) => p.phone));
    expect(phones.length).toBeGreaterThan(5);
    for (const phone of phones) {
      expect(phone).toMatch(/^\+1\d{3}55501\d{2}$/);
    }
  });

  it('keeps demoPhone inside the fictional block for any index', () => {
    for (const i of [0, 1, 99, 100, 1000, 12345]) {
      expect(demoPhone('415', i)).toMatch(/^\+141555501\d{2}$/);
    }
  });

  it('never sets a DNC flag (a demo lead must not look like a compliance record)', () => {
    const d = buildDemoDataset();
    expect(d.leads.every((l) => l.dnc === false)).toBe(true);
    expect(d.contacts.every((c) => c.dnc === false)).toBe(true);
  });

  it('produces unique primary keys within every table', () => {
    const d = buildDemoDataset();
    for (const [name, rows] of Object.entries(d)) {
      const ids = (rows as { id?: string }[]).map((r) => r.id);
      expect(new Set(ids).size, `${name} has duplicate ids`).toBe(ids.length);
    }
  });
});

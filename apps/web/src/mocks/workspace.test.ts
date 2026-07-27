import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import type { Lead } from '@switchboard/shared';
import {
  clearBlankWorkspace,
  clearWorkspaceOwner,
  hasBlankSnapshot,
  loadBlankSnapshot,
  saveBlankSnapshot,
  setWorkspaceMode,
  setWorkspaceOwner,
  startWorkspacePersistence,
  stopWorkspacePersistence,
  workspaceMode,
  WORKSPACE_KEY,
} from './workspace.ts';
import type { BlankSnapshot } from './workspace.ts';
import { hoursAgo, makeLead, makeUser } from '../features/leads/test/factories.ts';

/*
 * Workspace mode + blank-db persistence. The fixture-integration tests use
 * vi.resetModules() + dynamic import so fixtures.ts re-evaluates under the
 * localStorage state THIS test controls (vitest isolates modules per file, so
 * nothing here leaks into other suites).
 */

beforeEach(() => localStorage.clear());
afterEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe('workspace mode + snapshot primitives', () => {
  test('defaults to sample; set/clear round-trips', () => {
    expect(workspaceMode()).toBe('sample');
    setWorkspaceMode('blank');
    expect(workspaceMode()).toBe('blank');
    expect(localStorage.getItem(WORKSPACE_KEY)).toBe('blank');
    setWorkspaceMode('sample');
    expect(workspaceMode()).toBe('sample');
    expect(localStorage.getItem(WORKSPACE_KEY)).toBeNull();
  });

  test('snapshot save/load/clear round-trips; junk never parses', () => {
    expect(loadBlankSnapshot()).toBeNull();
    const lead: Lead = makeLead({ name: 'Boss Test Co' });
    saveBlankSnapshot({
      v: 1,
      leads: [lead],
      contacts: [],
      opportunities: [],
      activities: [[lead.id, []]],
      smartViews: [],
    });
    expect(hasBlankSnapshot()).toBe(true);
    expect(loadBlankSnapshot()?.leads[0]?.name).toBe('Boss Test Co');

    localStorage.setItem('sb-blank-db-v1', '{not json');
    expect(loadBlankSnapshot()).toBeNull();

    clearBlankWorkspace();
    expect(hasBlankSnapshot()).toBe(false);
  });
});

describe('fixtures under workspace modes', () => {
  test('blank mode boots EMPTY but keeps the org scaffolding', async () => {
    setWorkspaceMode('blank');
    vi.resetModules();
    const { db } = await import('./fixtures.ts');
    expect(db.leads).toHaveLength(0);
    expect(db.contacts).toHaveLength(0);
    expect(db.opportunities).toHaveLength(0);
    expect(db.activitiesByLead.size).toBe(0);
    expect(db.searchIndex).toHaveLength(0);
    // The org itself is intact: users to sign in as, statuses, stages, views.
    expect(db.users.length).toBeGreaterThan(0);
    expect(db.leadStatuses.length).toBeGreaterThan(0);
    expect(db.opportunityStages.length).toBeGreaterThan(0);
    expect(db.smartViews.length).toBeGreaterThan(0);
  });

  test('a persisted snapshot hydrates the blank workspace (data survives reload)', async () => {
    const lead = makeLead({ name: 'Willowbrook Dental' });
    setWorkspaceMode('blank');
    saveBlankSnapshot({
      v: 1,
      leads: [lead],
      contacts: [],
      opportunities: [],
      activities: [
        [
          lead.id,
          [
            {
              id: '11111111-1111-4111-8111-111111111111',
              leadId: lead.id,
              contactId: null,
              userId: null,
              type: 'lead_created',
              occurredAt: lead.createdAt,
              payload: {},
              createdAt: lead.createdAt,
              updatedAt: lead.createdAt,
            },
          ],
        ],
      ],
      smartViews: [],
    });
    vi.resetModules();
    const { db, snapshotDb } = await import('./fixtures.ts');
    expect(db.leads).toHaveLength(1);
    expect(db.leads[0]?.name).toBe('Willowbrook Dental');
    expect(db.activitiesByLead.get(lead.id)).toHaveLength(1);
    // And the outgoing snapshot round-trips what the db now holds.
    const snap = snapshotDb();
    expect(snap.leads[0]?.name).toBe('Willowbrook Dental');
    expect(snap.activities).toHaveLength(1);
  });

  test('sample mode is untouched by a lingering blank snapshot', async () => {
    saveBlankSnapshot({
      v: 1,
      leads: [makeLead({ name: 'Should not appear' })],
      contacts: [],
      opportunities: [],
      activities: [],
      smartViews: [],
    });
    vi.resetModules();
    const { db } = await import('./fixtures.ts');
    expect(db.leads.length).toBeGreaterThanOrEqual(200);
    expect(db.leads.some((l) => l.name === 'Should not appear')).toBe(false);
  });
});

describe('personal-account workspace owners', () => {
  test('an owner forces blank mode and isolates snapshots per account', async () => {
    const { setWorkspaceOwner, clearWorkspaceOwner, getWorkspaceOwner } =
      await import('./workspace.ts');
    const userA = { id: 'a', name: 'A' } as never;

    setWorkspaceOwner({ username: 'alice', user: userA });
    expect(getWorkspaceOwner()?.username).toBe('alice');
    expect(workspaceMode()).toBe('blank');
    saveBlankSnapshot({
      v: 1,
      leads: [makeLead({ name: 'Alice Lead' })],
      contacts: [],
      opportunities: [],
      activities: [],
      smartViews: [],
    });
    expect(loadBlankSnapshot()?.leads[0]?.name).toBe('Alice Lead');

    // Switch owner: bob sees NOTHING of alice's workspace.
    setWorkspaceOwner({ username: 'bob', user: userA });
    expect(loadBlankSnapshot()).toBeNull();

    // Anonymous blank picker is a third, separate space.
    clearWorkspaceOwner();
    expect(loadBlankSnapshot()).toBeNull();

    // Alice's data is still there when she signs back in.
    setWorkspaceOwner({ username: 'alice', user: userA });
    expect(loadBlankSnapshot()?.leads[0]?.name).toBe('Alice Lead');
  });

  test('fixtures under an owner: solo org — the user list is just the owner', async () => {
    const { setWorkspaceOwner } = await import('./workspace.ts');
    setWorkspaceOwner({
      username: 'pol',
      user: {
        id: '99999999-9999-4999-8999-999999999999',
        email: 'pol@switchboard.local',
        name: 'Pol V',
        role: 'admin',
        idpSubject: 'demo:pol',
        isActive: true,
        timezone: 'America/Los_Angeles',
        createdAt: '2026-07-19T00:00:00.000Z',
        updatedAt: '2026-07-19T00:00:00.000Z',
      },
    });
    vi.resetModules();
    const { db } = await import('./fixtures.ts');
    expect(db.leads).toHaveLength(0);
    expect(db.users).toHaveLength(1);
    expect(db.users[0]?.name).toBe('Pol V');
    expect(db.leadStatuses.length).toBeGreaterThan(0);
  });
});

describe('persistence loop: owner-key invariant (I-WS-KEY)', () => {
  const ANON_KEY = 'sb-blank-db-v1';
  const keyFor = (username: string): string => `${ANON_KEY}:u:${username}`;
  const snapWith = (name: string): BlankSnapshot => ({
    v: 1,
    leads: [makeLead({ name })],
    contacts: [],
    opportunities: [],
    activities: [],
    smartViews: [],
  });
  const leadNameAt = (key: string): string | undefined => {
    const raw = localStorage.getItem(key);
    if (raw === null) return undefined;
    return (JSON.parse(raw) as BlankSnapshot).leads[0]?.name;
  };

  // Loops are torn down by the flows under test; this is a belt-and-braces
  // guard so a failing assertion can never leak a live interval into the suite.
  afterEach(() => stopWorkspacePersistence());

  test('sign-in: the unload save cannot write the anonymous db under the new owner key', () => {
    // Regression (data loss): signing into "alice" from the anonymous blank
    // workspace fired the unload save AFTER the owner switched, overwriting
    // alice's persisted leads with the anonymous page's (empty) db.
    setWorkspaceMode('blank');
    localStorage.setItem(keyFor('alice'), JSON.stringify(snapWith('Alice Existing Lead')));

    startWorkspacePersistence(() => snapWith('Anonymous Lead'));
    // DevLoginPage.enterWorkspace order: owner first, THEN navigation unloads.
    setWorkspaceOwner({ username: 'alice', user: makeUser() });
    window.dispatchEvent(new Event('beforeunload'));

    expect(leadNameAt(keyFor('alice'))).toBe('Alice Existing Lead'); // untouched
    expect(leadNameAt(ANON_KEY)).toBe('Anonymous Lead'); // flushed under its OWN key
  });

  test('owner switch: A’s db never lands under B’s key, even bypassing the owner API', () => {
    setWorkspaceOwner({ username: 'alice', user: makeUser() });
    startWorkspacePersistence(() => snapWith('Alice Lead'));

    // Worst case: the owner record changes WITHOUT setWorkspaceOwner (so no
    // teardown hook ran). The save must refuse on the key mismatch alone.
    localStorage.setItem(
      'sb-workspace-owner',
      JSON.stringify({ username: 'bob', user: makeUser() }),
    );
    window.dispatchEvent(new Event('beforeunload'));
    expect(localStorage.getItem(keyFor('bob'))).toBeNull();

    // The mismatch killed the loop: even an explicit stop-flush writes nothing.
    stopWorkspacePersistence();
    expect(localStorage.getItem(keyFor('bob'))).toBeNull();
  });

  test('sign-out: the account db cannot leak into the anonymous key', () => {
    // Regression (cross-account leak on a shared device): TopBar clears the
    // owner then navigates; the unload save wrote alice's data anonymously.
    setWorkspaceOwner({ username: 'alice', user: makeUser() });
    startWorkspacePersistence(() => snapWith('Alice Lead'));

    clearWorkspaceOwner(); // TopBar order: clear owner, THEN navigate (unload)
    window.dispatchEvent(new Event('beforeunload'));

    expect(localStorage.getItem(ANON_KEY)).toBeNull(); // no leak
    expect(leadNameAt(keyFor('alice'))).toBe('Alice Lead'); // flushed under her key
  });

  test('the disposer stops the heartbeat; reset is not immediately re-written', () => {
    vi.useFakeTimers();
    try {
      setWorkspaceMode('blank');
      const stop = startWorkspacePersistence(() => snapWith('Tick'));
      vi.advanceTimersByTime(5_000);
      expect(leadNameAt(ANON_KEY)).toBe('Tick');

      stop();
      clearBlankWorkspace(); // resetBlank flow — also kills any live loop itself
      window.dispatchEvent(new Event('beforeunload'));
      vi.advanceTimersByTime(60_000);
      expect(localStorage.getItem(ANON_KEY)).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('blank mode: feature stores seed NO fabricated history', () => {
  test('with hydrated user data present, comms/sms/calls stores stay clean', async () => {
    // Regression: after a reload, sample seeding used the USER's imported
    // leads/contacts as candidates — phantom enrollments, threads, and even a
    // suppression on the user's first phone number.
    const lead = makeLead({ name: 'My Real Company', dnc: false });
    setWorkspaceMode('blank');
    saveBlankSnapshot({
      v: 1,
      leads: [lead],
      contacts: [
        {
          id: '22222222-2222-4222-8222-222222222222',
          leadId: lead.id,
          name: 'Real Contact',
          title: null,
          emails: [{ email: 'real@example.com', type: 'work' }],
          phones: [{ phone: '+12065550000', type: 'work' }],
          dnc: false,
          createdAt: lead.createdAt,
          updatedAt: lead.createdAt,
          deletedAt: null,
        },
      ],
      opportunities: [],
      activities: [],
      smartViews: [],
    });
    vi.resetModules();
    const { db } = await import('./fixtures.ts');
    expect(db.contacts).toHaveLength(1);

    const { commsStore } = await import('../features/comms/data/store.ts');
    expect(commsStore.enrollments).toHaveLength(0);
    expect(commsStore.suppressedEmails.size).toBe(0);
    // Scaffolding survives: sequences + steps exist to enroll into.
    expect(commsStore.sequences.length).toBeGreaterThan(0);
    expect(commsStore.steps.length).toBeGreaterThan(0);

    const { smsStore } = await import('../features/sms/data/store.ts');
    expect(smsStore.messages).toHaveLength(0);
    expect(smsStore.suppressedNumbers.size).toBe(0);

    const { callsStore } = await import('../features/calling/data/callsStore.ts');
    expect(callsStore.suppressedPhones.size).toBe(0);

    const { aiStore } = await import('../features/ai/data/store.ts');
    expect(aiStore.calls).toHaveLength(0);
  });

  test('reports seed fabricates zero activity for a blank workspace', async () => {
    // Regression: buildReportSeed built a fixed 90-day per-rep activity profile
    // regardless of leads — a brand-new EMPTY account opened Reports and saw
    // hundreds of calls/emails and a full funnel attributed to their own name.
    setWorkspaceMode('blank');
    saveBlankSnapshot({
      v: 1,
      leads: [makeLead({ name: 'My Real Company' })],
      contacts: [],
      opportunities: [],
      activities: [],
      smartViews: [],
    });
    vi.resetModules();
    const { buildReportSeed } = await import('../features/reports/mocks/seed.ts');
    const seed = buildReportSeed();
    expect(seed.activityEvents).toHaveLength(0);
    expect(seed.calls).toHaveLength(0);
    expect(seed.funnelOpps).toHaveLength(0);
    expect(seed.stageChanges).toHaveLength(0);
    expect(seed.sequences).toHaveLength(0);
    expect(seed.enrollments).toHaveLength(0);
    expect(seed.sequenceEvents).toHaveLength(0);
    // Real scaffolding survives so the surface can render its empty state.
    expect(seed.reps.length).toBeGreaterThan(0);
    expect(seed.stages.length).toBeGreaterThan(0);
  });

  test('inbox seed synthesizes zero reviews/tasks/done-today from the user’s own leads', async () => {
    // Regression: blank-mode db.leads are the USER's imported leads; the seed
    // spun fake "awaiting review" sequence steps and 8 pre-completed tasks
    // ("Done today: 8") out of them. The lead below carries every signal that
    // triggers synthesis in sample mode — it must still produce nothing.
    const lead = makeLead({
      name: 'My Real Company',
      dnc: false,
      lastInboundAt: hoursAgo(2),
      lastContactedAt: hoursAgo(30),
      nextTaskDueAt: hoursAgo(5),
    });
    setWorkspaceMode('blank');
    saveBlankSnapshot({
      v: 1,
      leads: [lead],
      contacts: [],
      opportunities: [],
      activities: [],
      smartViews: [],
    });
    vi.resetModules();
    const { buildInboxSeed } = await import('../features/inbox/model/seed.ts');
    const seed = buildInboxSeed();
    expect(seed.threads.size).toBe(0);
    expect(seed.reviews.size).toBe(0);
    expect(seed.tasks.size).toBe(0); // no open tasks AND no fabricated done-today baseline
    // The DNC rail's lead-derived scaffolding stays real (store.ts isLeadDnc).
    expect(seed.leadNames.get(lead.id)).toBe('My Real Company');
    expect(seed.leadDnc.get(lead.id)).toBe(false);
  });
});

describe('snapshot resilience', () => {
  test('a snapshot missing smartViews loads without throwing', async () => {
    // Regression: fixtures read snapshot.smartViews.length unguarded — a
    // truncated snapshot threw at module init and bricked the app on every
    // route. It must hydrate the rest and fall back to the shipped views.
    setWorkspaceMode('blank');
    const truncated = {
      v: 1,
      leads: [makeLead({ name: 'Truncated Co' })],
      contacts: [],
      opportunities: [],
      activities: [],
      // no smartViews key at all
    };
    localStorage.setItem('sb-blank-db-v1', JSON.stringify(truncated));
    vi.resetModules();
    const { db } = await import('./fixtures.ts');
    expect(db.leads).toHaveLength(1);
    expect(db.leads[0]?.name).toBe('Truncated Co');
    expect(db.smartViews.length).toBeGreaterThan(0); // shipped views fall back in
  });
});

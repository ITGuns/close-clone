import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { and, eq, isNull } from 'drizzle-orm';
import { calls, contacts, webhookInbox, type Db } from '../../db/index.ts';
import { createTestDb, type TestDb } from '../../db/test-helpers.ts';
import {
  createMockTelephonyProvider,
  readTwilioFixtureFiles,
  type MockTelephonyProvider,
  type TwilioFixtureFile,
} from '../../providers/telephony/index.ts';
import {
  parseTwilioWebhook,
  persistTwilioWebhook,
  processPendingTwilioWebhooks,
  type ProcessResult,
  type TelephonyProcessDeps,
  type TwilioChannel,
} from './index.ts';
import { sendSms } from '../sms/send.ts';
import {
  activitiesFor,
  activePhoneSuppressions,
  callsFor,
  seedContact,
  seedLead,
  seedOrgSettings,
  seedUser,
  smsFor,
} from './test-helpers.ts';

/**
 * Telephony inbox worker (task 3b): lifecycle → EXACTLY-ONCE C4 timeline events,
 * driven by the recorded 3a fixtures (no Twilio account). Covers the acceptance
 * bars: replay/shuffle is a no-op, each call yields exactly one terminal event,
 * inbound voicemail maps to `voicemail_received`, and inbound STOP suppresses +
 * emits `sms_opt_out` + confirms once (I-QUIET).
 */

const LEAD_NUMBER = '+13055550147';
const REP_NUMBER = '+15617770123';

let ctx: TestDb;
let mock: MockTelephonyProvider;
let deps: TelephonyProcessDeps;
let fixtures: TwilioFixtureFile[];
let lead: string;

function channelForUrl(url: string): TwilioChannel {
  if (url.endsWith('/sms')) return 'sms';
  if (url.endsWith('/voice')) return 'voice';
  return 'status';
}

function pick(prefix: string): TwilioFixtureFile[] {
  return fixtures.filter((f) => f.relativePath.startsWith(prefix));
}

async function persist(db: Db, files: TwilioFixtureFile[]): Promise<void> {
  for (const f of files) {
    const parsed = parseTwilioWebhook(channelForUrl(f.envelope.url), f.envelope.rawBody);
    await persistTwilioWebhook(db, parsed, f.envelope.receivedAt);
  }
}

function shuffle<T>(items: T[], seed: number): T[] {
  // Deterministic LCG shuffle so the test is reproducible.
  const out = [...items];
  let state = seed;
  for (let i = out.length - 1; i > 0; i -= 1) {
    state = (state * 1103515245 + 12345) & 0x7fffffff;
    const j = state % (i + 1);
    const a = out[i];
    const b = out[j];
    if (a !== undefined && b !== undefined) {
      out[i] = b;
      out[j] = a;
    }
  }
  return out;
}

beforeEach(async () => {
  ctx = await createTestDb();
  mock = createMockTelephonyProvider();
  deps = { db: ctx.db, provider: mock };
  fixtures = readTwilioFixtureFiles();
  lead = await seedLead(ctx.db, { name: 'Acme' });
  await seedContact(ctx.db, lead, [LEAD_NUMBER], { name: 'Dana' });
}, 120_000);

afterEach(async () => {
  await ctx.close();
});

describe('outbound recorded call', () => {
  test('maps to exactly one call_logged, sets recording_ref, and records consent once', async () => {
    await persist(ctx.db, pick('voice-outbound-recorded/'));
    await processPendingTwilioWebhooks(deps);

    const acts = await activitiesFor(ctx.db, lead);
    expect(acts.filter((a) => a.type === 'call_logged')).toHaveLength(1);
    expect(acts.filter((a) => a.type === 'recording_consent_played')).toHaveLength(1);
    // §I-REC ordering: consent is on the timeline no later than the logged call.
    const consent = acts.find((a) => a.type === 'recording_consent_played');
    const logged = acts.find((a) => a.type === 'call_logged');
    expect(consent && logged && consent.occurredAt <= logged.occurredAt).toBe(true);

    const [call] = await callsFor(ctx.db, lead);
    expect(call?.direction).toBe('outbound');
    expect(call?.status).toBe('completed');
    expect(call?.durationS).toBeGreaterThan(0);
    expect(call?.recordingRef).toContain('/Recordings/');
  });
});

describe('outbound unrecorded call', () => {
  test('maps to one call_logged with NO consent event and NO recording_ref', async () => {
    await persist(ctx.db, pick('voice-outbound-unrecorded/'));
    await processPendingTwilioWebhooks(deps);

    const acts = await activitiesFor(ctx.db, lead);
    expect(acts.filter((a) => a.type === 'call_logged')).toHaveLength(1);
    expect(acts.filter((a) => a.type === 'recording_consent_played')).toHaveLength(0);
    const [call] = await callsFor(ctx.db, lead);
    expect(call?.recordingRef).toBeNull();
  });
});

describe('inbound call to voicemail', () => {
  test('maps to exactly one voicemail_received carrying the recording ref', async () => {
    await persist(ctx.db, pick('voice-inbound-voicemail/'));
    await processPendingTwilioWebhooks(deps);

    const acts = await activitiesFor(ctx.db, lead);
    const vm = acts.filter((a) => a.type === 'voicemail_received');
    expect(vm).toHaveLength(1);
    expect(String(vm[0]?.payload['recordingRef'])).toContain('/Recordings/');
    expect(acts.filter((a) => a.type === 'call_logged')).toHaveLength(0);

    const [call] = await callsFor(ctx.db, lead);
    expect(call?.direction).toBe('inbound');
    expect(call?.status).toBe('voicemail');
  });
});

describe('replay / shuffle is a no-op (exactly-once per call)', () => {
  test('all voice fixtures, shuffled and duplicated, yield one terminal event per call', async () => {
    const voice = [
      ...pick('voice-outbound-recorded/'),
      ...pick('voice-outbound-unrecorded/'),
      ...pick('voice-inbound-voicemail/'),
    ];
    const doubled = shuffle([...voice, ...voice], 42);
    await persist(ctx.db, doubled);
    // Process twice, too — a second sweep must find nothing to do.
    await processPendingTwilioWebhooks(deps);
    await processPendingTwilioWebhooks(deps);

    const acts = await activitiesFor(ctx.db, lead);
    expect(acts.filter((a) => a.type === 'call_logged')).toHaveLength(2);
    expect(acts.filter((a) => a.type === 'voicemail_received')).toHaveLength(1);
    expect(acts.filter((a) => a.type === 'recording_consent_played')).toHaveLength(1);
    // Three distinct calls, each terminal exactly once.
    expect(await callsFor(ctx.db, lead)).toHaveLength(3);
    // Every inbox row processed.
    const unprocessed = await ctx.db
      .select({ id: webhookInbox.id })
      .from(webhookInbox)
      .where(and(eq(webhookInbox.provider, 'twilio'), isNull(webhookInbox.processedAt)));
    expect(unprocessed).toHaveLength(0);
  });
});

describe('inbound SMS (I-QUIET)', () => {
  test('a STOP suppresses the number, emits sms_opt_out, and confirms exactly once', async () => {
    const stop = pick('sms-inbound/').filter((f) => f.relativePath.includes('-stop.json'));
    await persist(ctx.db, stop);
    await processPendingTwilioWebhooks(deps);

    const acts = await activitiesFor(ctx.db, lead);
    expect(acts.filter((a) => a.type === 'sms_opt_out')).toHaveLength(1);
    expect(await activePhoneSuppressions(ctx.db)).toContain('3055550147');

    const confirmations = mock.getOutboundSms();
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]?.to).toBe(LEAD_NUMBER);
    expect(confirmations[0]?.from).toBe(REP_NUMBER);

    // Inbound STOP itself is persisted; re-processing sends no second confirmation.
    await processPendingTwilioWebhooks(deps);
    expect(mock.getOutboundSms()).toHaveLength(1);
    expect((await smsFor(ctx.db, lead)).filter((s) => s.direction === 'inbound')).toHaveLength(1);
  });

  test('an ordinary reply maps to sms_received and does not suppress', async () => {
    const reply = pick('sms-inbound/').filter((f) => f.relativePath.includes('-reply.json'));
    await persist(ctx.db, reply);
    await processPendingTwilioWebhooks(deps);

    const acts = await activitiesFor(ctx.db, lead);
    expect(acts.filter((a) => a.type === 'sms_received')).toHaveLength(1);
    expect(acts.filter((a) => a.type === 'sms_opt_out')).toHaveLength(0);
    expect(await activePhoneSuppressions(ctx.db)).toHaveLength(0);
    expect(mock.getOutboundSms()).toHaveLength(0);
  });

  test('every STOP-family keyword is classified as an opt-out', async () => {
    const optOuts = pick('sms-inbound/').filter((f) => !f.relativePath.includes('-reply.json'));
    await persist(ctx.db, optOuts);
    await processPendingTwilioWebhooks(deps);
    const acts = await activitiesFor(ctx.db, lead);
    expect(acts.filter((a) => a.type === 'sms_opt_out')).toHaveLength(5);
    expect(mock.getOutboundSms()).toHaveLength(5);
  });
});

describe('inbound STOP from an UNMATCHED number (I-QUIET, D-060)', () => {
  /**
   * I-QUIET says "suppress the number GLOBALLY" — the ingress used to return early
   * on an unresolvable sender, so a STOP from a number whose contact record had
   * drifted (phone edited, contact deleted, lead merged, second handset) left that
   * number fully sendable. These drive the real ingress with the contact removed.
   */
  async function stopFromStranger(): Promise<ProcessResult[]> {
    await ctx.db.delete(contacts).where(eq(contacts.leadId, lead));
    await persist(
      ctx.db,
      pick('sms-inbound/').filter((f) => f.relativePath.includes('-stop.json')),
    );
    return processPendingTwilioWebhooks(deps);
  }

  test('suppresses the number and still confirms exactly once', async () => {
    const results = await stopFromStranger();

    expect(await activePhoneSuppressions(ctx.db)).toContain('3055550147');
    const confirmations = mock.getOutboundSms();
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]?.to).toBe(LEAD_NUMBER);
    // No timeline event is possible — activities.lead_id is NOT NULL and there is
    // no lead. The inbox note says so rather than claiming a failure.
    expect(results.some((r) => r.error === 'opt_out_suppressed_without_contact')).toBe(true);
    expect(results.every((r) => r.activity !== 'sms_opt_out')).toBe(true);

    // Re-processing is a no-op: the claim is idempotent, so no second confirmation.
    await processPendingTwilioWebhooks(deps);
    expect(mock.getOutboundSms()).toHaveLength(1);
  });

  test('the number is genuinely unsendable afterwards — the point of the rail', async () => {
    await stopFromStranger();

    const rep = await seedUser(ctx.db, { name: 'Rep' });
    const other = await seedLead(ctx.db, { name: 'Another lead' });
    await seedOrgSettings(ctx.db, { companyTimezone: 'UTC' });
    const sendMock = createMockTelephonyProvider();

    await expect(
      sendSms(
        {
          db: ctx.db,
          provider: sendMock,
          now: () => new Date('2026-07-15T16:00:00.000Z'),
          fromNumber: REP_NUMBER,
        },
        { userId: rep, leadId: other, to: LEAD_NUMBER, body: 'Hi again' },
      ),
    ).rejects.toMatchObject({ name: 'SmsSuppressedError', reason: 'phone_suppressed' });
    expect(sendMock.sendSmsCount).toBe(0);
  });

  test('an ordinary reply from an unmatched number still suppresses nothing', async () => {
    await ctx.db.delete(contacts).where(eq(contacts.leadId, lead));
    await persist(
      ctx.db,
      pick('sms-inbound/').filter((f) => f.relativePath.includes('-reply.json')),
    );
    const results = await processPendingTwilioWebhooks(deps);

    expect(await activePhoneSuppressions(ctx.db)).toHaveLength(0);
    expect(mock.getOutboundSms()).toHaveLength(0);
    expect(results.every((r) => r.error === 'no_contact_for_number')).toBe(true);
  });
});

describe('unknown number', () => {
  test('an inbound callback from an unmatched number is processed with an error note, no call', async () => {
    // Remove the only contact carrying the fixture number → nothing resolves.
    await ctx.db.delete(contacts).where(eq(contacts.leadId, lead));
    await persist(ctx.db, pick('voice-inbound-voicemail/'));
    const results = await processPendingTwilioWebhooks(deps);

    expect(await callsFor(ctx.db, lead)).toHaveLength(0);
    expect(results.every((r) => r.error === 'no_contact_for_number')).toBe(true);
    const errored = await ctx.db
      .select({ error: webhookInbox.error, processedAt: webhookInbox.processedAt })
      .from(webhookInbox)
      .where(eq(webhookInbox.provider, 'twilio'));
    expect(errored.length).toBeGreaterThan(0);
    expect(
      errored.every((r) => r.processedAt !== null && r.error === 'no_contact_for_number'),
    ).toBe(true);
  });
});

describe('userId attribution', () => {
  test('an outbound call pre-created by dial keeps its user_id through the callbacks', async () => {
    const rep = await seedUser(ctx.db, { name: 'Rep' });
    const recorded = pick('voice-outbound-recorded/');
    const callSid = new URLSearchParams(recorded[0]?.envelope.rawBody ?? '').get('CallSid') ?? '';
    // Pre-create the outbound call row exactly as dialCall would.
    await ctx.db.insert(calls).values({
      leadId: lead,
      userId: rep,
      direction: 'outbound',
      twilioSid: callSid,
      status: 'queued',
    });
    await persist(ctx.db, recorded);
    await processPendingTwilioWebhooks(deps);
    const [call] = await callsFor(ctx.db, lead);
    expect(call?.userId).toBe(rep);
  });
});

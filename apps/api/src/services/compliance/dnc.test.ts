import { afterEach, beforeEach, describe, expect, test } from 'vitest';
import { sql } from 'drizzle-orm';
import { emailAccounts, type Db } from '../../db/index.ts';
import { createTestDb, type TestDb } from '../../db/test-helpers.ts';
import {
  createMockTelephonyProvider,
  type MockTelephonyProvider,
} from '../../providers/telephony/index.ts';
import { MockEmailProvider } from '../../providers/mock/mock-email-provider.ts';
import { TokenCipher } from '../sync/token-cipher.ts';
import { sendSms, SmsSuppressedError, type SmsSendDeps } from '../sms/send.ts';
import { dialCall, DialBlockedError, type DialDeps } from '../telephony/dial.ts';
import { sendOneOff, SuppressedError, type SendServiceDeps } from '../email/send.ts';
import {
  seedContact as seedPhoneContact,
  seedLead as seedTelLead,
  seedOrgSettings,
  seedUser as seedTelUser,
} from '../telephony/test-helpers.ts';
import {
  seedContact as seedEmailContact,
  seedLead as seedEmailLead,
  seedUser as seedEmailUser,
} from '../email/test-helpers.ts';

/**
 * I-DNC bypass regression suite (CONTRACTS §C6, D-060). Every one-off engine took
 * an OPTIONAL `contactId` alongside a free-form destination, and checked DNC only
 * on the contact the caller named — so simply omitting `contactId` reached a
 * do-not-contact human through the front door, with a valid API token, which made
 * it an I-RAIL-API hole as well.
 *
 * These tests drive the real engines (not the probe) and assert the PROVIDER IS
 * NEVER CALLED, because "throws" without that says nothing about whether the SMS
 * left the building. Each engine gets the same three shapes:
 *
 *   1. raw destination, no `contactId`   — the bypass as reported;
 *   2. clean `contactId` + a DNC'd destination — the subtler cross-contact variant;
 *   3. an unflagged destination still sends — proof the rail did not become a wall.
 *
 * The two scoping decisions from `dnc.ts` are pinned here too: a DNC contact on a
 * DIFFERENT lead still blocks (DNC attaches to the human), and a SOFT-DELETED
 * contact does not (otherwise the block is permanent with no UI to lift it).
 */

const REP_NUMBER = '+15617770123';
const DNC_NUMBER = '+13055550147'; // NPA 305 → America/New_York
const CLEAN_NUMBER = '+13055550188';
// Noon Eastern (16:00 UTC in July DST) — comfortably inside the I-QUIET window, so
// a block here is I-DNC and never quiet hours.
const INSIDE = new Date('2026-07-15T16:00:00.000Z');

let ctx: TestDb;
let telMock: MockTelephonyProvider;
let rep: string;
let lead: string;

function smsDeps(): SmsSendDeps {
  return { db: ctx.db, provider: telMock, now: () => INSIDE, fromNumber: REP_NUMBER };
}

function dialDeps(): DialDeps {
  return { db: ctx.db, provider: telMock, now: () => INSIDE, callerId: REP_NUMBER };
}

async function markContactDnc(db: Db, contactId: string): Promise<void> {
  await db.execute(sql`UPDATE contacts SET dnc = true WHERE id = ${contactId}::uuid`);
}

async function softDeleteContact(db: Db, contactId: string): Promise<void> {
  await db.execute(sql`UPDATE contacts SET deleted_at = now() WHERE id = ${contactId}::uuid`);
}

beforeEach(async () => {
  ctx = await createTestDb();
  telMock = createMockTelephonyProvider();
  rep = await seedTelUser(ctx.db, { name: 'Rep' });
  lead = await seedTelLead(ctx.db, { name: 'Acme' });
  await seedOrgSettings(ctx.db, { companyTimezone: 'UTC' });
}, 120_000);

afterEach(async () => {
  await ctx.close();
});

// --- SMS -------------------------------------------------------------------

describe('POST /sms/send — I-DNC follows the destination, not the named contact', () => {
  test('a raw `to` with no contactId cannot text a DNC contact', async () => {
    await seedPhoneContact(ctx.db, lead, [DNC_NUMBER], { name: 'Dana', dnc: true });

    await expect(
      sendSms(smsDeps(), { userId: rep, leadId: lead, to: DNC_NUMBER, body: 'Hi Dana' }),
    ).rejects.toMatchObject({ name: 'SmsSuppressedError', reason: 'contact_dnc' });
    expect(telMock.sendSmsCount).toBe(0);
  });

  test('formatting does not open the hole', async () => {
    await seedPhoneContact(ctx.db, lead, [DNC_NUMBER], { name: 'Dana', dnc: true });

    await expect(
      sendSms(smsDeps(), { userId: rep, leadId: lead, to: '(305) 555-0147', body: 'Hi' }),
    ).rejects.toBeInstanceOf(SmsSuppressedError);
    expect(telMock.sendSmsCount).toBe(0);
  });

  test('naming a CLEAN contact does not license texting a DNC number', async () => {
    const clean = await seedPhoneContact(ctx.db, lead, [CLEAN_NUMBER], { name: 'Sam' });
    await seedPhoneContact(ctx.db, lead, [DNC_NUMBER], { name: 'Dana', dnc: true });

    await expect(
      sendSms(smsDeps(), {
        userId: rep,
        leadId: lead,
        contactId: clean,
        to: DNC_NUMBER,
        body: 'Hi',
      }),
    ).rejects.toBeInstanceOf(SmsSuppressedError);
    expect(telMock.sendSmsCount).toBe(0);
  });

  test('DNC on a DIFFERENT lead still blocks — the flag attaches to the human', async () => {
    const otherLead = await seedTelLead(ctx.db, { name: 'Former employer' });
    await seedPhoneContact(ctx.db, otherLead, [DNC_NUMBER], { name: 'Dana', dnc: true });

    await expect(
      sendSms(smsDeps(), { userId: rep, leadId: lead, to: DNC_NUMBER, body: 'Hi' }),
    ).rejects.toBeInstanceOf(SmsSuppressedError);
    expect(telMock.sendSmsCount).toBe(0);
  });

  test('a SOFT-DELETED DNC contact does not block — the block must stay liftable', async () => {
    const gone = await seedPhoneContact(ctx.db, lead, [DNC_NUMBER], { name: 'Dana', dnc: true });
    await softDeleteContact(ctx.db, gone);

    const out = await sendSms(smsDeps(), {
      userId: rep,
      leadId: lead,
      to: DNC_NUMBER,
      body: 'Hi',
    });
    expect(out.providerSid.length).toBeGreaterThan(0);
    expect(telMock.sendSmsCount).toBe(1);
  });

  test('an unflagged number still sends', async () => {
    await seedPhoneContact(ctx.db, lead, [CLEAN_NUMBER], { name: 'Sam' });

    const out = await sendSms(smsDeps(), {
      userId: rep,
      leadId: lead,
      to: CLEAN_NUMBER,
      body: 'Hi Sam',
    });
    expect(out.to).toBe(CLEAN_NUMBER);
    expect(telMock.sendSmsCount).toBe(1);
  });
});

// --- Dial ------------------------------------------------------------------

describe('POST /calls/dial — I-DNC follows the destination', () => {
  test('a raw `to` with no contactId cannot dial a DNC contact', async () => {
    await seedPhoneContact(ctx.db, lead, [DNC_NUMBER], { name: 'Dana', dnc: true });

    await expect(
      dialCall(dialDeps(), { userId: rep, leadId: lead, to: DNC_NUMBER }),
    ).rejects.toMatchObject({ name: 'DialBlockedError', reason: 'contact_dnc' });
    expect(telMock.dialCount).toBe(0);
  });

  test('naming a CLEAN contact does not license dialing a DNC number', async () => {
    const clean = await seedPhoneContact(ctx.db, lead, [CLEAN_NUMBER], { name: 'Sam' });
    await seedPhoneContact(ctx.db, lead, [DNC_NUMBER], { name: 'Dana', dnc: true });

    await expect(
      dialCall(dialDeps(), { userId: rep, leadId: lead, contactId: clean, to: DNC_NUMBER }),
    ).rejects.toBeInstanceOf(DialBlockedError);
    expect(telMock.dialCount).toBe(0);
  });

  test('an unflagged number still dials', async () => {
    await seedPhoneContact(ctx.db, lead, [CLEAN_NUMBER], { name: 'Sam' });

    const out = await dialCall(dialDeps(), { userId: rep, leadId: lead, to: CLEAN_NUMBER });
    expect(out.callSid.length).toBeGreaterThan(0);
    expect(telMock.dialCount).toBe(1);
  });
});

// --- Email -----------------------------------------------------------------

describe('POST /emails/send — I-DNC covers every recipient, cc included', () => {
  const DNC_ADDRESS = 'dana@acme.test';
  const CLEAN_ADDRESS = 'sam@acme.test';

  let emailProviders: Map<string, MockEmailProvider>;
  let emailDeps: SendServiceDeps;
  let emailRep: string;
  let emailLead: string;
  let accountId: string;

  function providerFor(identity: { address: string }): MockEmailProvider {
    const key = identity.address.toLowerCase();
    let p = emailProviders.get(key);
    if (p === undefined) {
      p = new MockEmailProvider({ address: identity.address });
      emailProviders.set(key, p);
    }
    return p;
  }

  function sendCalls(): number {
    return providerFor({ address: 'rep@mock.test' }).sendCallCount;
  }

  beforeEach(async () => {
    const cipher = new TokenCipher('dnc-suite-secret');
    emailProviders = new Map();
    emailDeps = { db: ctx.db, providerFor, cipher };
    emailRep = await seedEmailUser(ctx.db, { email: 'rep@example.com' });
    emailLead = await seedEmailLead(ctx.db, 'Acme');
    const rows = await ctx.db
      .insert(emailAccounts)
      .values({
        userId: emailRep,
        address: 'rep@mock.test',
        provider: 'mock',
        syncStatus: 'LIVE',
        oauthTokens: cipher.encrypt({
          accessToken: 'access',
          refreshToken: 'refresh',
          expiresAt: new Date('2030-01-01T00:00:00.000Z').toISOString(),
          scope: 'https://www.googleapis.com/auth/gmail.modify',
          tokenType: 'Bearer',
        }),
      })
      .returning({ id: emailAccounts.id });
    accountId = rows[0]!.id;
  });

  test('a raw `to` with no contactId cannot email a DNC contact', async () => {
    const dana = await seedEmailContact(ctx.db, emailLead, [DNC_ADDRESS], { name: 'Dana' });
    await markContactDnc(ctx.db, dana);

    await expect(
      sendOneOff(emailDeps, {
        actorId: emailRep,
        accountId,
        leadId: emailLead,
        to: [DNC_ADDRESS],
        body: 'Hi',
      }),
    ).rejects.toMatchObject({ name: 'SuppressedError', reason: 'contact_dnc' });
    expect(sendCalls()).toBe(0);
  });

  test('a DNC address hidden on cc blocks the whole send', async () => {
    await seedEmailContact(ctx.db, emailLead, [CLEAN_ADDRESS], { name: 'Sam' });
    const dana = await seedEmailContact(ctx.db, emailLead, [DNC_ADDRESS], { name: 'Dana' });
    await markContactDnc(ctx.db, dana);

    await expect(
      sendOneOff(emailDeps, {
        actorId: emailRep,
        accountId,
        leadId: emailLead,
        to: [CLEAN_ADDRESS],
        cc: [DNC_ADDRESS],
        body: 'Hi',
      }),
    ).rejects.toBeInstanceOf(SuppressedError);
    expect(sendCalls()).toBe(0);
  });

  test('address casing does not open the hole', async () => {
    const dana = await seedEmailContact(ctx.db, emailLead, [DNC_ADDRESS], { name: 'Dana' });
    await markContactDnc(ctx.db, dana);

    await expect(
      sendOneOff(emailDeps, {
        actorId: emailRep,
        accountId,
        leadId: emailLead,
        to: ['Dana@ACME.test'],
        body: 'Hi',
      }),
    ).rejects.toBeInstanceOf(SuppressedError);
    expect(sendCalls()).toBe(0);
  });

  test('an unflagged recipient still sends', async () => {
    await seedEmailContact(ctx.db, emailLead, [CLEAN_ADDRESS], { name: 'Sam' });

    const res = await sendOneOff(emailDeps, {
      actorId: emailRep,
      accountId,
      leadId: emailLead,
      to: [CLEAN_ADDRESS],
      body: 'Hi Sam',
    });
    expect(res.messageId.length).toBeGreaterThan(0);
    expect(sendCalls()).toBe(1);
  });
});

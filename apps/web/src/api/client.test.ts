import { describe, expect, test } from 'vitest';
import { http, HttpResponse } from 'msw';
import { server } from '../mocks/server.ts';
import { apiRequest, CSRF_HEADER } from './client.ts';
import { ApiError } from './errors.ts';
import { getLead, getLeadTimeline, listLeads } from './leads.ts';
import { previewSmartView } from './smartViews.ts';
import { search } from './search.ts';

describe('leads endpoints', () => {
  test('lists a keyset page with a nextCursor', async () => {
    const page = await listLeads({ limit: 50 });
    expect(page.items).toHaveLength(50);
    expect(typeof page.nextCursor).toBe('string');
  });

  test('keyset pages do not overlap and advance', async () => {
    const first = await listLeads({ limit: 40 });
    const cursor = first.nextCursor;
    if (!cursor) throw new Error('expected a nextCursor on the first page');
    const second = await listLeads({ limit: 40, cursor });
    expect(second.items.length).toBeGreaterThan(0);
    const firstIds = new Set(first.items.map((l) => l.id));
    expect(second.items.some((l) => firstIds.has(l.id))).toBe(false);
  });

  test('gets a single lead by id', async () => {
    const page = await listLeads({ limit: 1 });
    const lead = page.items.at(0);
    if (!lead) throw new Error('fixture must contain at least one lead');
    const got = await getLead(lead.id);
    expect(got.id).toBe(lead.id);
    expect(got.name).toBe(lead.name);
  });

  // failure path: unknown id → typed NOT_FOUND
  test('getLead(unknown) throws ApiError NOT_FOUND', async () => {
    const err: unknown = await getLead('00000000-0000-4000-8000-000000000000').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    if (err instanceof ApiError) {
      expect(err.code).toBe('NOT_FOUND');
      expect(err.status).toBe(404);
    }
  });

  test('reads a lead timeline page (C4 events, newest first)', async () => {
    const page = await listLeads({ limit: 1 });
    const lead = page.items.at(0);
    if (!lead) throw new Error('fixture must contain at least one lead');
    const timeline = await getLeadTimeline(lead.id, { limit: 5 });
    expect(timeline.items.length).toBeGreaterThan(0);
    for (const event of timeline.items) {
      expect(event.leadId).toBe(lead.id);
      expect(typeof event.occurredAt).toBe('string');
    }
  });
});

describe('search endpoint', () => {
  test('returns hits for a matching query', async () => {
    const res = await search('Labs');
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.items[0]?.type).toBeDefined();
  });

  // failure path: empty query → VALIDATION_FAILED
  test('empty query throws ApiError VALIDATION_FAILED', async () => {
    const err: unknown = await search('   ').catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    if (err instanceof ApiError) {
      expect(err.code).toBe('VALIDATION_FAILED');
      expect(err.status).toBe(400);
    }
  });
});

describe('smart-view preview', () => {
  test('valid DSL returns a first page + count-estimate', async () => {
    const res = await previewSmartView({ dsl: 'dnc = true' });
    expect(res.items.length).toBeGreaterThan(0);
    expect(res.countEstimate).toBeGreaterThan(0);
  });

  // failure path: invalid DSL → VALIDATION_FAILED with a position detail
  test('invalid DSL throws ApiError VALIDATION_FAILED', async () => {
    const err: unknown = await previewSmartView({ dsl: 'status ~~ "x"' }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    if (err instanceof ApiError) {
      expect(err.code).toBe('VALIDATION_FAILED');
      expect(err.details).toBeTruthy();
    }
  });
});

/*
 * The API's session guard (apps/api/src/auth/guards.ts → auth/csrf.ts) rejects any
 * mutating request that does not carry the custom CSRF header with 403 FORBIDDEN.
 * The client never sent it, so every write from the deployed SPA failed. These
 * tests pin the header onto mutating methods and keep safe methods free of it
 * (GET/HEAD/OPTIONS are never gated, and sending it would only widen the CORS
 * preflight surface for reads).
 */
describe('CSRF custom header', () => {
  const captured: { method: string; csrf: string | null }[] = [];

  function probeHandlers() {
    const record = ({ request }: { request: Request }) => {
      captured.push({ method: request.method, csrf: request.headers.get(CSRF_HEADER) });
      return HttpResponse.json({ ok: true });
    };
    return [
      http.get('*/api/v1/csrf-probe', record),
      http.post('*/api/v1/csrf-probe', record),
      http.patch('*/api/v1/csrf-probe', record),
      http.put('*/api/v1/csrf-probe', record),
      http.delete('*/api/v1/csrf-probe', record),
    ];
  }

  test.each(['POST', 'PATCH', 'PUT', 'DELETE'])(
    '%s carries a non-empty CSRF header',
    async (method) => {
      captured.length = 0;
      server.use(...probeHandlers());
      await apiRequest<{ ok: boolean }>('/csrf-probe', { method });
      expect(captured).toHaveLength(1);
      expect(captured[0]?.csrf ?? '').not.toBe('');
      expect(captured[0]?.csrf).toBeTruthy();
    },
  );

  test('a mutating request with a JSON body still carries the header', async () => {
    captured.length = 0;
    server.use(...probeHandlers());
    await apiRequest<{ ok: boolean }>('/csrf-probe', { method: 'POST', body: { a: 1 } });
    expect(captured[0]?.csrf).toBeTruthy();
  });

  test('GET does not send the header (safe methods are never gated)', async () => {
    captured.length = 0;
    server.use(...probeHandlers());
    await apiRequest<{ ok: boolean }>('/csrf-probe');
    expect(captured).toHaveLength(1);
    expect(captured[0]?.method).toBe('GET');
    expect(captured[0]?.csrf).toBeNull();
  });

  test('an explicit per-request header override wins', async () => {
    captured.length = 0;
    server.use(...probeHandlers());
    await apiRequest<{ ok: boolean }>('/csrf-probe', {
      method: 'POST',
      headers: { [CSRF_HEADER]: 'caller-supplied' },
    });
    expect(captured[0]?.csrf).toBe('caller-supplied');
  });
});

describe('error mapping', () => {
  // failure path: non-JSON 5xx body still yields a typed INTERNAL ApiError
  test('non-JSON server error maps to INTERNAL', async () => {
    server.use(
      http.get('*/api/v1/leads/:id', () => new HttpResponse('upstream exploded', { status: 500 })),
    );
    const err: unknown = await getLead('11111111-1111-4111-8111-111111111111').catch(
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    if (err instanceof ApiError) {
      expect(err.code).toBe('INTERNAL');
      expect(err.status).toBe(500);
    }
  });
});

import { beforeEach, describe, expect, test } from 'vitest';
import { http, HttpResponse } from 'msw';
import { CSRF_HEADER } from '../../../api/client.ts';
import { ApiError } from '../../../api/errors.ts';
import { server } from '../../../mocks/server.ts';
import { resetImportStore } from '../data/store.ts';
import { importHandlers } from '../mocks/importHandlers.ts';
import { defaultDedupeConfig } from '../types.ts';
import { commitImport, dryRunImport, uploadImport } from './imports.ts';

/*
 * Transport-level tests for the import client. The upload builds its own `fetch`
 * instead of going through apiRequest, so it inherits nothing: every header it
 * needs has to be pinned here. The one that broke the deployed app is the CSRF
 * header — apps/api/src/auth/guards.ts answers 403 FORBIDDEN to any mutating
 * request that arrives without it, which made "commit import" (and every other
 * write) impossible for a signed-in rep.
 */

const CSV =
  'Company,Website,Email\n' +
  'Marlowe Textiles,marlowe-textiles.example.com,dana@marlowe-textiles.example.com\n' +
  'Kestrel Provisions,kestrel-provisions.example.com,amir@kestrel-provisions.example.com';

function csvFile(name = 'leads.csv'): File {
  return new File([CSV], name, { type: 'text/csv' });
}

const UPLOADED = {
  id: 'import-1',
  filename: 'leads.csv',
  status: 'uploaded',
  rowCount: null,
  createdBy: 'u1',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

interface Seen {
  contentType: string | null;
  csrf: string | null;
  body: string;
}

beforeEach(() => {
  resetImportStore();
  server.use(...importHandlers);
});

describe('uploadImport transport', () => {
  async function captureUpload(file: File): Promise<Seen> {
    let seen: Seen | null = null;
    server.use(
      http.post('*/api/v1/imports', async ({ request }) => {
        seen = {
          contentType: request.headers.get('content-type'),
          csrf: request.headers.get(CSRF_HEADER),
          body: await request.text(),
        };
        return HttpResponse.json(UPLOADED, { status: 201 });
      }),
    );
    await uploadImport(file);
    const got: Seen | null = seen;
    if (got === null) throw new Error('the upload never reached the handler');
    return got;
  }

  test('carries the CSRF header the session guard requires', async () => {
    const seen = await captureUpload(csvFile());
    expect(seen.csrf ?? '').not.toBe('');
  });

  test('sends a multipart body whose declared boundary matches the framing', async () => {
    const seen = await captureUpload(csvFile());
    const boundary = /boundary=(.+)$/.exec(seen.contentType ?? '')?.[1];
    expect(boundary).toBeTruthy();
    expect(seen.body.startsWith(`--${boundary ?? ''}\r\n`)).toBe(true);
    expect(seen.body.endsWith(`--${boundary ?? ''}--\r\n`)).toBe(true);
    expect(seen.body).toContain('name="file"');
    expect(seen.body).toContain('filename="leads.csv"');
    expect(seen.body).toContain('Marlowe Textiles');
  });

  // failure path: a filename cannot break out of the Content-Disposition line
  test('a filename containing quotes/CRLF cannot forge multipart headers', async () => {
    const seen = await captureUpload(csvFile('evil".csv\r\nX-Injected: 1'));
    // The text survives, but only INSIDE the quoted filename value — never as a
    // header line of its own, and never closing the quote early.
    expect(seen.body).not.toContain('\r\nX-Injected');
    expect(seen.body).toContain('filename="evil.csvX-Injected: 1"\r\n');
  });

  test('round-trips filename + content through the real multipart handler', async () => {
    const row = await uploadImport(csvFile('quarterly-leads.csv'));
    expect(row.filename).toBe('quarterly-leads.csv');
    expect(row.status).toBe('uploaded');

    // Proof the CSV survived the multipart round trip: the dry-run parses the
    // stored text and must see both data rows.
    const plan = await dryRunImport(row.id, {
      mapping: {
        columns: [
          { source: 'Company', target: 'lead.name' },
          { source: 'Website', target: 'lead.url' },
          { source: 'Email', target: 'contact.email' },
        ],
      },
      dedupeConfig: {
        ...defaultDedupeConfig(),
        matchOn: { email: true, domain: true, fuzzyName: false },
      },
    });
    expect(plan.counts.totalRows).toBe(2);
  });

  test('a nameless file still uploads under the fallback filename', async () => {
    const row = await uploadImport(new File([CSV], '', { type: 'text/csv' }));
    expect(row.filename).toBe('import.csv');
  });

  // failure path: a §C8 error envelope becomes a typed ApiError
  test('a rejected upload throws a typed ApiError', async () => {
    server.use(
      http.post('*/api/v1/imports', () =>
        HttpResponse.json(
          { error: { code: 'VALIDATION_FAILED', message: 'file exceeds the 5 MB import limit' } },
          { status: 400 },
        ),
      ),
    );
    const err: unknown = await uploadImport(csvFile()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    if (err instanceof ApiError) {
      expect(err.code).toBe('VALIDATION_FAILED');
      expect(err.status).toBe(400);
    }
  });

  // failure path: a non-JSON body still maps to a typed error, not a parse crash
  test('a non-JSON upload failure maps to INTERNAL', async () => {
    server.use(
      http.post('*/api/v1/imports', () => new HttpResponse('nginx bailed', { status: 500 })),
    );
    const err: unknown = await uploadImport(csvFile()).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    if (err instanceof ApiError) expect(err.code).toBe('INTERNAL');
  });
});

describe('dry-run + commit transport', () => {
  test('both mutating calls carry the CSRF header', async () => {
    const csrf: (string | null)[] = [];
    server.use(
      http.post('*/api/v1/imports/:id/dry-run', ({ request }) => {
        csrf.push(request.headers.get(CSRF_HEADER));
        return HttpResponse.json({
          importId: 'import-1',
          counts: {
            totalRows: 0,
            leadsCreated: 0,
            contactsCreated: 0,
            merged: 0,
            skipped: 0,
            errors: 0,
            suppressed: 0,
          },
          rows: [],
        });
      }),
      http.post('*/api/v1/imports/:id/commit', ({ request }) => {
        csrf.push(request.headers.get(CSRF_HEADER));
        return HttpResponse.json({
          importId: 'import-1',
          status: 'committed',
          resumed: false,
          counters: { leads: 0, contacts: 0, merged: 0, activities: 0 },
          nextRowIndex: 0,
        });
      }),
    );

    await dryRunImport('import-1', {
      mapping: { columns: [{ source: 'Company', target: 'lead.name' }] },
      dedupeConfig: defaultDedupeConfig(),
    });
    await commitImport('import-1');

    expect(csrf).toHaveLength(2);
    for (const value of csrf) expect(value ?? '').not.toBe('');
  });
});

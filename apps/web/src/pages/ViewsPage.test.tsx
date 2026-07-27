import { afterEach, describe, expect, test } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import type { SmartView } from '@switchboard/shared';
import { KeyboardProvider } from '../keyboard/index.ts';
import { server } from '../mocks/server.ts';
import { makeSmartView } from '../features/leads/test/factories.ts';
import { ViewsPage } from './ViewsPage.tsx';

/*
 * /views is the saved Smart View index. These tests pin the two things that were
 * previously wrong: the page must not describe the shipped builder/DSL editor as
 * unbuilt, and it must offer a way INTO the builder (/views/new was unreachable
 * from the UI). Error copy is asserted to stay user-facing — no "mock API".
 */

const api = (p: string): string => `*/api/v1${p}`;

const views: SmartView[] = [
  makeSmartView({ name: 'My open leads', dsl: 'owner in (me)', shared: false }),
  makeSmartView({ name: 'Overdue follow-ups', dsl: 'next_task_due < now', shared: true }),
];

function renderViews() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <KeyboardProvider>
        <MemoryRouter initialEntries={['/views']}>
          <Routes>
            <Route path="/views" element={<ViewsPage />} />
            <Route path="/views/new" element={<div data-testid="builder" />} />
            <Route path="/views/:id" element={<div data-testid="view-detail" />} />
          </Routes>
        </MemoryRouter>
      </KeyboardProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('ViewsPage — honest copy', () => {
  test('lists saved views with their DSL instead of a "later phase" placeholder', async () => {
    server.use(http.get(api('/smart-views'), () => HttpResponse.json(views)));
    renderViews();

    const list = await screen.findByRole('listbox', { name: 'Saved Smart Views' });
    const options = within(list).getAllByRole('option');
    expect(options).toHaveLength(2);
    expect(within(list).getByText('My open leads')).toBeInTheDocument();
    expect(within(list).getByText('owner in (me)')).toBeInTheDocument();
    expect(within(list).getByText('Shared')).toBeInTheDocument();

    // The builder and the DSL editor both shipped — the page may not say otherwise.
    expect(screen.queryByText(/later phase/i)).toBeNull();
    expect(screen.queryByText(/Recent leads/i)).toBeNull();
    expect(document.body.textContent).not.toMatch(/demonstrat/i);
  });

  test('subtitle describes what the body actually shows', async () => {
    server.use(http.get(api('/smart-views'), () => HttpResponse.json(views)));
    renderViews();
    await screen.findByRole('listbox', { name: 'Saved Smart Views' });

    expect(
      screen.getByText('Saved queries over your leads. Each one re-runs when you open it.'),
    ).toBeInTheDocument();
  });

  test('failure state is user-facing and offers a retry (never names the mock API)', async () => {
    server.use(
      http.get(api('/smart-views'), () =>
        HttpResponse.json({ error: { code: 'INTERNAL', message: 'boom' } }, { status: 500 }),
      ),
    );
    renderViews();

    const alert = await screen.findByRole('alert');
    expect(within(alert).getByText('Couldn’t load your views')).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Retry' })).toBeInTheDocument();
    expect(alert.textContent).not.toMatch(/mock|MSW|API request failed/i);
  });
});

describe('ViewsPage — creating a view', () => {
  test('the header "New view" button reaches the builder at /views/new', async () => {
    const user = userEvent.setup();
    server.use(http.get(api('/smart-views'), () => HttpResponse.json(views)));
    renderViews();
    await screen.findByRole('listbox', { name: 'Saved Smart Views' });

    await user.click(screen.getByRole('button', { name: 'New view' }));
    expect(await screen.findByTestId('builder')).toBeInTheDocument();
  });

  test('the empty state offers the same way in', async () => {
    const user = userEvent.setup();
    server.use(http.get(api('/smart-views'), () => HttpResponse.json([])));
    renderViews();

    expect(await screen.findByText('No saved views yet')).toBeInTheDocument();
    const buttons = screen.getAllByRole('button', { name: 'New view' });
    await user.click(buttons[buttons.length - 1] as HTMLElement);
    expect(await screen.findByTestId('builder')).toBeInTheDocument();
  });
});

describe('ViewsPage — keyboard', () => {
  test('j moves and Enter opens the highlighted view', async () => {
    const user = userEvent.setup();
    server.use(http.get(api('/smart-views'), () => HttpResponse.json(views)));
    renderViews();

    const list = await screen.findByRole('listbox', { name: 'Saved Smart Views' });
    const first = within(list).getAllByRole('option')[0] as HTMLElement;
    act(() => first.focus());
    await user.keyboard('j');

    const options = within(screen.getByRole('listbox', { name: 'Saved Smart Views' })).getAllByRole(
      'option',
    );
    expect(options[1]).toHaveAttribute('aria-selected', 'true');

    await user.keyboard('{Enter}');
    expect(await screen.findByTestId('view-detail')).toBeInTheDocument();
  });
});

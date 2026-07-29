import { afterEach, describe, expect, test, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { http, HttpResponse } from 'msw';
import { KeyboardProvider } from '../keyboard/index.ts';
import { server } from '../mocks/server.ts';
import { makeSmartView } from '../features/leads/test/factories.ts';
import { HelpPage } from './HelpPage.tsx';
import { ViewsPage } from './ViewsPage.tsx';

const openTour = vi.fn();
vi.mock('../features/tour/index.ts', () => ({
  useTour: () => ({ openTour }),
}));

/*
 * Help tells the user how to build a Smart View. This walks that instruction end
 * to end — follow the link, find the control it names — so the sentence cannot
 * rot back into a dead end.
 */

const api = (p: string): string => `*/api/v1${p}`;

function renderHelp() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <KeyboardProvider>
        <MemoryRouter initialEntries={['/help']}>
          <Routes>
            <Route path="/help" element={<HelpPage />} />
            <Route path="/views" element={<ViewsPage />} />
            <Route path="/views/new" element={<div data-testid="builder" />} />
          </Routes>
        </MemoryRouter>
      </KeyboardProvider>
    </QueryClientProvider>,
  );
}

afterEach(cleanup);

describe('HelpPage — "build one under Views" is walkable', () => {
  test('the Views link lands on a page carrying the New view control', async () => {
    const user = userEvent.setup();
    server.use(
      http.get(api('/smart-views'), () => HttpResponse.json([makeSmartView({ name: 'Mine' })])),
    );
    renderHelp();

    expect(screen.getByText('What is a Smart View?')).toBeInTheDocument();
    await user.click(screen.getByRole('link', { name: 'Views' }));

    const newView = await screen.findByRole('button', { name: 'New view' });
    await user.click(newView);
    expect(await screen.findByTestId('builder')).toBeInTheDocument();
  });

  test('points at Settings → About for build details, not a version number', () => {
    renderHelp();
    expect(screen.getByRole('link', { name: 'Settings → About' })).toBeInTheDocument();
    expect(document.body.textContent).toContain('Build and workspace details live in');
  });
});

describe('HelpPage — guided-tour replay', () => {
  test('offers a guided-tour replay in the page actions', async () => {
    render(
      <MemoryRouter>
        <HelpPage />
      </MemoryRouter>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Replay the guided tour' }));
    expect(openTour).toHaveBeenCalledTimes(1);
  });
});

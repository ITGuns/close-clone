import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { KeyboardProvider } from '../../../keyboard/index.ts';
import { makeSmartView } from '../test/factories.ts';
import { SmartViewsSidebar } from './SmartViewsSidebar.tsx';

/*
 * The rail is where a rep already is when they want another view, so it carries
 * the second entry point into the builder. Nothing else in the product linked to
 * /views/new before this.
 */

function renderRail(props: Partial<Parameters<typeof SmartViewsSidebar>[0]> = {}) {
  return render(
    <KeyboardProvider>
      <MemoryRouter initialEntries={['/leads']}>
        <Routes>
          <Route
            path="/leads"
            element={
              <SmartViewsSidebar
                views={[makeSmartView({ name: 'My open leads' })]}
                activeViewId={null}
                onSelect={() => undefined}
                isLoading={false}
                isError={false}
                onRetry={() => undefined}
                {...props}
              />
            }
          />
          <Route path="/views/new" element={<div data-testid="builder" />} />
        </Routes>
      </MemoryRouter>
    </KeyboardProvider>,
  );
}

afterEach(cleanup);

describe('SmartViewsSidebar — New view', () => {
  test('the rail header offers "New view" and it opens the builder', async () => {
    const user = userEvent.setup();
    renderRail();

    await user.click(screen.getByRole('button', { name: 'New view' }));
    expect(await screen.findByTestId('builder')).toBeInTheDocument();
  });

  test('"New view" stays available while the view list is loading', () => {
    renderRail({ isLoading: true });
    expect(screen.getByRole('button', { name: 'New view' })).toBeInTheDocument();
  });

  test('"New view" stays available when the view list failed to load', () => {
    renderRail({ isError: true, errorMessage: 'Couldn’t load views.' });
    expect(screen.getByRole('button', { name: 'New view' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Couldn’t load views.');
  });
});

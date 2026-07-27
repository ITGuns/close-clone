import { afterEach, describe, expect, test, vi } from 'vitest';
import {
  cleanup,
  render,
  screen,
  waitFor,
  waitForElementToBeRemoved,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ReactNode } from 'react';
import { ToastProvider, useToast } from './ToastProvider.tsx';

afterEach(cleanup);

function Trigger({ message }: { message: string }): ReactNode {
  const { toast } = useToast();
  return (
    <button type="button" onClick={() => toast(message)}>
      fire
    </button>
  );
}

describe('ToastProvider', () => {
  test('shows a message in a polite live region', async () => {
    render(
      <ToastProvider>
        <Trigger message="saved to the timeline" />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'fire' }));
    const status = screen.getByRole('status');
    expect(status).toHaveTextContent('saved to the timeline');
  });

  test('can be dismissed manually', async () => {
    render(
      <ToastProvider>
        <Trigger message="dismiss me" />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'fire' }));
    expect(screen.getByText('dismiss me')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Dismiss notification' }));
    expect(screen.queryByText('dismiss me')).not.toBeInTheDocument();
  });

  test('auto-dismisses after its ttl', async () => {
    // A 40ms ttl raced the test itself: under full-suite load the click alone
    // can outlast it, so "it appeared" would fail, or waitForElementToBeRemoved
    // would start against an already-removed node and throw. The ttl only needs
    // to be short relative to the test, not to a busy CPU — and the removal
    // assertion is written to tolerate a toast that vanished early.
    render(
      <ToastProvider ttl={300}>
        <Trigger message="fleeting" />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'fire' }));
    await waitFor(() => expect(screen.queryByText('fleeting')).not.toBeInTheDocument());
  });

  test('a per-toast ttl outlives the provider default (compliance blocks)', async () => {
    function TwoSpeeds(): ReactNode {
      const { toast } = useToast();
      return (
        <button
          type="button"
          onClick={() => {
            toast('quick note');
            toast('dial blocked — read me', { ttl: 60_000 });
          }}
        >
          fire both
        </button>
      );
    }
    render(
      <ToastProvider ttl={40}>
        <TwoSpeeds />
      </ToastProvider>,
    );
    await userEvent.click(screen.getByRole('button', { name: 'fire both' }));
    // The default-ttl toast goes; the long-ttl block explanation stays.
    await waitForElementToBeRemoved(() => screen.queryByText('quick note'));
    expect(screen.getByText('dial blocked — read me')).toBeInTheDocument();
  });

  test('throws when used outside a provider', () => {
    function Bare(): ReactNode {
      useToast();
      return null;
    }
    // Suppress React's error boundary console noise for the expected throw.
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Bare />)).toThrow('useToast must be used within a ToastProvider');
    spy.mockRestore();
  });
});

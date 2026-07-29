import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Coachmark } from './Coachmark.tsx';

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

function renderMark(over: { isLast?: boolean; withBack?: boolean } = {}) {
  const anchor = document.createElement('button');
  anchor.textContent = 'anchor';
  document.body.appendChild(anchor);
  const onNext = vi.fn();
  const onBack = vi.fn();
  const onDismiss = vi.fn();
  render(
    <Coachmark
      anchor={anchor}
      side="right"
      title="Inbox"
      step={2}
      total={6}
      isLast={over.isLast ?? false}
      onBack={over.withBack === false ? undefined : onBack}
      onNext={onNext}
      onDismiss={onDismiss}
    >
      <p>Everything that needs a reply, in one queue.</p>
    </Coachmark>,
  );
  return { anchor, onNext, onBack, onDismiss };
}

describe('Coachmark', () => {
  it('is a labelled non-modal dialog that takes focus and shows its position', () => {
    renderMark();
    const dialog = screen.getByRole('dialog', { name: 'Inbox' });
    expect(dialog).toHaveFocus();
    expect(dialog).not.toHaveAttribute('aria-modal');
    expect(screen.getByText('Step 2 of 6')).toBeInTheDocument();
    expect(screen.getByText('Everything that needs a reply, in one queue.')).toBeInTheDocument();
  });

  it('rings the anchor while mounted and cleans up on unmount', () => {
    const { anchor } = renderMark();
    expect(anchor.classList.contains('sb-tour-anchor')).toBe(true);
    cleanup();
    expect(anchor.classList.contains('sb-tour-anchor')).toBe(false);
  });

  it('advances, retreats, and dismisses from the keyboard', async () => {
    const { onNext, onBack, onDismiss } = renderMark();
    await userEvent.keyboard('{ArrowRight}');
    expect(onNext).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{ArrowLeft}');
    expect(onBack).toHaveBeenCalledTimes(1);
    await userEvent.keyboard('{Escape}');
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('Enter advances from the panel but activates a focused button normally', async () => {
    const { onNext, onDismiss } = renderMark();
    await userEvent.keyboard('{Enter}'); // focus is on the panel
    expect(onNext).toHaveBeenCalledTimes(1);
    screen.getByRole('button', { name: 'Skip' }).focus();
    await userEvent.keyboard('{Enter}');
    expect(onDismiss).toHaveBeenCalledTimes(1);
    expect(onNext).toHaveBeenCalledTimes(1); // no double-advance
  });

  it('renders button controls: Skip / Back / Next, and Finish on the last step', async () => {
    const { onNext, onBack, onDismiss } = renderMark();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onNext).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Back' }));
    expect(onBack).toHaveBeenCalledTimes(1);
    await userEvent.click(screen.getByRole('button', { name: 'Skip' }));
    expect(onDismiss).toHaveBeenCalledTimes(1);
    cleanup();
    renderMark({ isLast: true, withBack: false });
    expect(screen.getByRole('button', { name: 'Finish' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Back' })).toBeNull();
  });
});

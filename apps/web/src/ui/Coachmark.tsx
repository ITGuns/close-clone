import { useEffect, useId, useRef } from 'react';
import type { JSX, ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { cx } from '../lib/cx.ts';
import { useFloatingPosition } from './floating.ts';
import type { FloatingSide } from './floating.ts';
import { Button } from './Button.tsx';

export interface CoachmarkProps {
  /** Element this step points at (must be in the document). */
  anchor: HTMLElement;
  side?: FloatingSide;
  title: string;
  /** 1-based position and total for the "Step n of m" line. */
  step: number;
  total: number;
  isLast: boolean;
  /** Skip the entrance animation — keyboard advances must be 0ms (DESIGN §4). */
  instant?: boolean;
  onNext: () => void;
  onBack?: (() => void) | undefined;
  onDismiss: () => void;
  className?: string;
  children: ReactNode;
}

/**
 * Guided-tour step: a portalled, anchored, NON-modal dialog (no aria-modal, no
 * Tab trap — the page stays operable, spec D-T6). Focuses itself on mount, rings
 * its anchor via `.sb-tour-anchor`, and owns four keys on a capture-phase
 * document listener (the Tooltip.tsx Escape pattern): Escape dismisses without
 * closing anything beneath; ArrowRight/Enter advance; ArrowLeft goes back.
 * Every other key (g-chords, /, mod+k) passes through untouched.
 */
export function Coachmark({
  anchor,
  side = 'bottom',
  title,
  step,
  total,
  isLast,
  instant = false,
  onNext,
  onBack,
  onDismiss,
  className,
  children,
}: CoachmarkProps): JSX.Element {
  const titleId = useId();
  const bodyId = useId();
  const panelRef = useRef<HTMLDivElement | null>(null);
  const anchorRef = useRef<HTMLElement | null>(anchor);
  anchorRef.current = anchor;
  const position = useFloatingPosition(true, anchorRef, panelRef, {
    side,
    align: 'center',
    offset: 12,
  });

  // Latest-handler refs so the once-registered key listener never goes stale.
  const handlers = useRef({ onNext, onBack, onDismiss });
  handlers.current = { onNext, onBack, onDismiss };

  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  useEffect(() => {
    anchor.classList.add('sb-tour-anchor');
    return () => anchor.classList.remove('sb-tour-anchor');
  }, [anchor]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        handlers.current.onDismiss();
        return;
      }
      if (event.key === 'ArrowRight' || event.key === 'Enter') {
        // Let Enter activate a focused button normally (no double-advance).
        if (
          event.key === 'Enter' &&
          event.target instanceof HTMLElement &&
          event.target.closest('button')
        ) {
          return;
        }
        event.stopPropagation();
        event.preventDefault();
        handlers.current.onNext();
        return;
      }
      if (event.key === 'ArrowLeft') {
        event.stopPropagation();
        event.preventDefault();
        handlers.current.onBack?.();
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, []);

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-labelledby={titleId}
      aria-describedby={bodyId}
      tabIndex={-1}
      className={cx('sb-coachmark', className)}
      data-side={position.side}
      data-instant={instant || undefined}
      style={position.style}
    >
      <p className="sb-coachmark__step">
        Step {step} of {total}
      </p>
      <h2 id={titleId} className="sb-coachmark__title">
        {title}
      </h2>
      <div id={bodyId} className="sb-coachmark__body">
        {children}
      </div>
      <div className="sb-coachmark__actions">
        <Button variant="ghost" size="sm" onClick={() => handlers.current.onDismiss()}>
          Skip
        </Button>
        {onBack ? (
          <Button size="sm" onClick={() => handlers.current.onBack?.()}>
            Back
          </Button>
        ) : null}
        <Button variant="primary" size="sm" onClick={() => handlers.current.onNext()}>
          {isLast ? 'Finish' : 'Next'}
        </Button>
      </div>
    </div>,
    document.body,
  );
}

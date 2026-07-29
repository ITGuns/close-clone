import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import type { JSX, ReactNode } from 'react';
import { Button, Coachmark, Modal } from '../../ui/index.ts';
import { KbdCombo } from '../../keyboard/index.ts';
import { useAuth } from '../../auth/AuthProvider.tsx';
import type { TourStep } from './tour.ts';
import { decideAutoOpen, hasSeenTour, isTourSuppressed, markTourSeen, TOUR_STEPS } from './tour.ts';

/*
 * First-run guided tour (spec 2026-07-30-switchboard-self-serve-design.md).
 * Auto-opens once per user (localStorage flag burned at open — D-T3, the
 * useIgnition pattern), replayable on demand via useTour().openTour() (/help).
 * Steps are Modal bookends + Coachmarks anchored to persistent shell chrome.
 */

interface TourContextValue {
  /** Open the tour at step 1. Replay-safe: never rewrites the seen flag. */
  openTour: () => void;
}

const TourContext = createContext<TourContextValue | null>(null);

export function useTour(): TourContextValue {
  const ctx = useContext(TourContext);
  if (!ctx) throw new Error('useTour requires TourProvider');
  return ctx;
}

export function TourProvider({ children }: { children: ReactNode }): JSX.Element {
  const { user } = useAuth();
  const [index, setIndex] = useState<number | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);
  const autoRan = useRef(false);

  const open = useCallback(() => {
    restoreRef.current =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setIndex(0);
  }, []);

  const close = useCallback(() => {
    setIndex(null);
    restoreRef.current?.focus?.();
    restoreRef.current = null;
  }, []);

  // First run: burn the flag the moment the tour auto-opens so a dismissal is
  // never nagged; replay stays available from /help (D-T3).
  useEffect(() => {
    if (autoRan.current || !user) return;
    autoRan.current = true;
    if (decideAutoOpen(hasSeenTour(user.id), isTourSuppressed())) {
      markTourSeen(user.id);
      open();
    }
  }, [user, open]);

  const value = useMemo<TourContextValue>(() => ({ openTour: open }), [open]);

  return (
    <TourContext.Provider value={value}>
      {children}
      {index !== null ? (
        <TourOverlay index={index} onIndexChange={setIndex} onClose={close} />
      ) : null}
    </TourContext.Provider>
  );
}

function StepBody({ step }: { step: TourStep }): JSX.Element {
  return (
    <>
      <p>{step.body}</p>
      {step.combo ? (
        <div className="sb-coachmark__combo">
          <KbdCombo combo={step.combo} />
        </div>
      ) : null}
    </>
  );
}

interface TourOverlayProps {
  index: number;
  onIndexChange: (index: number) => void;
  onClose: () => void;
}

function TourOverlay({ index, onIndexChange, onClose }: TourOverlayProps): JSX.Element | null {
  const step = TOUR_STEPS[index];
  const primaryRef = useRef<HTMLButtonElement | null>(null);
  if (!step) return null;
  const isLast = index === TOUR_STEPS.length - 1;

  const next = (): void => {
    if (isLast) onClose();
    else onIndexChange(index + 1);
  };
  const back = index > 0 ? (): void => onIndexChange(index - 1) : undefined;

  if (step.kind === 'modal') {
    const first = index === 0;
    return (
      <Modal
        open
        onClose={onClose}
        label={step.title}
        initialFocusRef={primaryRef}
        className="sb-tour-modal"
      >
        <p className="sb-coachmark__step">
          Step {index + 1} of {TOUR_STEPS.length}
        </p>
        <h2 className="sb-coachmark__title">{step.title}</h2>
        <div className="sb-coachmark__body">
          <StepBody step={step} />
        </div>
        <div className="sb-coachmark__actions">
          {first ? (
            <>
              <Button variant="ghost" onClick={onClose}>
                Skip
              </Button>
              <button
                ref={primaryRef}
                type="button"
                className="sb-btn sb-btn--primary"
                onClick={next}
              >
                Start tour
              </button>
            </>
          ) : (
            <>
              {back ? (
                <Button variant="ghost" onClick={back}>
                  Back
                </Button>
              ) : null}
              <button
                ref={primaryRef}
                type="button"
                className="sb-btn sb-btn--primary"
                onClick={onClose}
              >
                Done
              </button>
            </>
          )}
        </div>
      </Modal>
    );
  }

  return (
    <AnchoredStep
      key={step.id}
      step={step}
      index={index}
      total={TOUR_STEPS.length}
      isLast={isLast}
      onNext={next}
      onBack={back}
      onDismiss={onClose}
    />
  );
}

interface AnchoredStepProps {
  step: TourStep;
  index: number;
  total: number;
  isLast: boolean;
  onNext: () => void;
  onBack?: (() => void) | undefined;
  onDismiss: () => void;
}

function AnchoredStep({
  step,
  index,
  total,
  isLast,
  onNext,
  onBack,
  onDismiss,
}: AnchoredStepProps): JSX.Element | null {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const skippedRef = useRef(false);

  // Both anchors live in persistent chrome, so this is purely defensive: a
  // missing anchor skips forward instead of stranding the tour.
  useLayoutEffect(() => {
    const el = step.anchor ? document.querySelector<HTMLElement>(step.anchor) : null;
    if (el) {
      setAnchor(el);
      return;
    }
    if (!skippedRef.current) {
      skippedRef.current = true;
      onNext();
    }
  }, [step, onNext]);

  if (!anchor) return null;
  return (
    <Coachmark
      anchor={anchor}
      side={step.side ?? 'bottom'}
      title={step.title}
      step={index + 1}
      total={total}
      isLast={isLast}
      instant
      onNext={onNext}
      onBack={onBack}
      onDismiss={onDismiss}
    >
      <StepBody step={step} />
    </Coachmark>
  );
}

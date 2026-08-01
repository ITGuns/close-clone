import { useEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { prefersReducedMotion } from './useIgnition.ts';

/*
 * Scroll-driven "board build" for the hero status wall: as the wall rises through
 * the viewport, its rows light up one by one — the board coming online under your
 * scroll. Unlike the once-per-session ignition, this is continuous and reversible
 * (scroll back up and the lower rows go quiet again).
 *
 * Returns how many of `count` rows are lit for the current scroll position.
 * Robust by design — the wall must never get stuck dark:
 *   - reduced motion or no window metrics → every row lit from the start;
 *   - progress is measured off the wall's own rect each frame (rAF-throttled),
 *     so it survives the page's inertia smooth-scroll and any resize.
 */
export interface ScrollBuildResult<T extends HTMLElement> {
  ref: RefObject<T | null>;
  lit: number;
}

export function useScrollBuild<T extends HTMLElement = HTMLElement>(
  count: number,
): ScrollBuildResult<T> {
  const ref = useRef<T | null>(null);
  const [lit, setLit] = useState<number>(() => (prefersReducedMotion() ? count : 0));

  useEffect(() => {
    if (prefersReducedMotion()) {
      setLit(count);
      return;
    }
    const node = ref.current;
    if (!node) {
      setLit(count);
      return;
    }

    let raf = 0;
    const measure = (): void => {
      const rect = node.getBoundingClientRect();
      const vh = window.innerHeight || document.documentElement.clientHeight;
      if (vh <= 0) {
        setLit(count);
        return;
      }
      // 0 when the wall's top sits at the viewport bottom (just entering),
      // 1 by the time it has risen to ~18% down — the board is fully online.
      const progress = (vh - rect.top) / (vh * 0.82);
      const clamped = Math.max(0, Math.min(1, progress));
      setLit(Math.max(0, Math.min(count, Math.round(clamped * (count + 0.5)))));
    };
    const onScroll = (): void => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        measure();
      });
    };

    measure();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [count]);

  return { ref, lit };
}

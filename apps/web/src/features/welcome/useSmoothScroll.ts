import { useEffect } from 'react';
import { prefersReducedMotion } from './useIgnition.ts';

/*
 * Inertia (Lenis-style) smooth scroll for the welcome page — the buttery,
 * eased wheel glide from the noir prototype. We intercept wheel deltas and
 * lerp the window toward a target position each frame instead of letting the
 * OS jump it; that easing is the whole effect.
 *
 * Deliberately conservative — it must never trap or fight the user:
 *   - OFF under reduced motion (respects the same law as the ignition/reveals);
 *   - OFF on coarse pointers — native touch scrolling already has momentum and
 *     hijacking it feels worse, not better;
 *   - passes through zoom (ctrl/⌘+wheel) and horizontal/trackpad-pan gestures;
 *   - stays in sync with scrolls it didn't originate (keyboard, anchor jumps,
 *     scrollbar drag) so the next wheel tick eases from the real position.
 * The listener is torn down on unmount, so it only governs /welcome.
 */
export function useSmoothScroll(): void {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (prefersReducedMotion()) return;
    if (window.matchMedia?.('(pointer: coarse)').matches) return;

    const EASE = 0.12; // fraction of remaining distance closed per frame
    const LINE = 16; // px per wheel "line" when deltaMode reports lines
    let target = window.scrollY;
    let current = window.scrollY;
    let raf = 0;
    let running = false;

    const maxScroll = (): number =>
      Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
    const clamp = (v: number): number => Math.max(0, Math.min(v, maxScroll()));

    const tick = (): void => {
      current += (target - current) * EASE;
      if (Math.abs(target - current) < 0.5) {
        current = target;
        running = false;
        window.scrollTo(0, current);
        return;
      }
      window.scrollTo(0, current);
      raf = requestAnimationFrame(tick);
    };

    const onWheel = (e: WheelEvent): void => {
      // Let the browser own zoom, horizontal pans, and anything already handled.
      if (e.ctrlKey || e.metaKey || e.defaultPrevented) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;

      const unit = e.deltaMode === 1 ? LINE : e.deltaMode === 2 ? window.innerHeight : 1;
      target = clamp(target + e.deltaY * unit);
      e.preventDefault();
      if (!running) {
        running = true;
        current = window.scrollY;
        raf = requestAnimationFrame(tick);
      }
    };

    // Scrolls we didn't originate (keys, anchors, scrollbar) reset the target so
    // the animation never yanks the page back to a stale position.
    const onScroll = (): void => {
      if (!running) {
        current = window.scrollY;
        target = window.scrollY;
      }
    };

    window.addEventListener('wheel', onWheel, { passive: false });
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('wheel', onWheel);
      window.removeEventListener('scroll', onScroll);
    };
  }, []);
}

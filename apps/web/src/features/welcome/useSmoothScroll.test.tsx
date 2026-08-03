import { afterEach, describe, expect, test, vi } from 'vitest';
import type { JSX } from 'react';
import { cleanup, render } from '@testing-library/react';
import { useSmoothScroll } from './useSmoothScroll.ts';

function Probe(): JSX.Element {
  useSmoothScroll();
  return <div data-testid="probe" />;
}

function mockMatchMedia(matcher: (query: string) => boolean): void {
  vi.spyOn(window, 'matchMedia').mockImplementation((query: string): MediaQueryList => ({
    matches: matcher(query),
    media: query,
    onchange: null,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
    addListener: () => undefined,
    removeListener: () => undefined,
    dispatchEvent: () => false,
  }));
}

function fireWheel(deltaY: number): WheelEvent {
  const e = new WheelEvent('wheel', { deltaY, cancelable: true });
  window.dispatchEvent(e);
  return e;
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useSmoothScroll — inertia wheel takeover', () => {
  test('hijacks the wheel (prevents default) on a fine pointer', () => {
    vi.stubGlobal('requestAnimationFrame', (): number => 1);
    vi.stubGlobal('cancelAnimationFrame', (): void => undefined);
    mockMatchMedia((q) => !q.includes('prefers-reduced-motion') && !q.includes('coarse'));
    render(<Probe />);
    expect(fireWheel(120).defaultPrevented).toBe(true);
  });

  test('stays out of the way under reduced motion', () => {
    mockMatchMedia((q) => q.includes('prefers-reduced-motion'));
    render(<Probe />);
    expect(fireWheel(120).defaultPrevented).toBe(false);
  });

  test('stays out of the way on a coarse (touch) pointer', () => {
    mockMatchMedia((q) => q.includes('coarse'));
    render(<Probe />);
    expect(fireWheel(120).defaultPrevented).toBe(false);
  });

  test('passes through zoom gestures (ctrl+wheel)', () => {
    vi.stubGlobal('requestAnimationFrame', (): number => 1);
    vi.stubGlobal('cancelAnimationFrame', (): void => undefined);
    mockMatchMedia((q) => !q.includes('prefers-reduced-motion') && !q.includes('coarse'));
    render(<Probe />);
    const e = new WheelEvent('wheel', { deltaY: 120, ctrlKey: true, cancelable: true });
    window.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(false);
  });

  test('removes its listeners on unmount', () => {
    vi.stubGlobal('requestAnimationFrame', (): number => 1);
    vi.stubGlobal('cancelAnimationFrame', (): void => undefined);
    mockMatchMedia((q) => !q.includes('prefers-reduced-motion') && !q.includes('coarse'));
    const { unmount } = render(<Probe />);
    unmount();
    expect(fireWheel(120).defaultPrevented).toBe(false);
  });
});

import { afterEach, describe, expect, test, vi } from 'vitest';
import type { JSX } from 'react';
import { act, cleanup, render } from '@testing-library/react';
import { useScrollBuild } from './useScrollBuild.ts';

/* A probe that surfaces the lit-row count for a wall of `count` rows. */
function Probe({ count }: { count: number }): JSX.Element {
  const { ref, lit } = useScrollBuild<HTMLDivElement>(count);
  return <div ref={ref} data-testid="probe" data-lit={String(lit)} />;
}

function rect(top: number, bottom: number): DOMRect {
  return {
    top,
    bottom,
    left: 0,
    right: 100,
    width: 100,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function spyRect() {
  return vi.spyOn(Element.prototype, 'getBoundingClientRect');
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('useScrollBuild — the wall builds under the scroll', () => {
  test('lights no rows while the wall sits below the fold', () => {
    spyRect().mockReturnValue(rect(5000, 5400)); // far below jsdom's 768px viewport
    const { getByTestId } = render(<Probe count={6} />);
    expect(getByTestId('probe')).toHaveAttribute('data-lit', '0');
  });

  test('lights every row once the wall has fully risen into view', () => {
    // Run the rAF-throttled scroll handler synchronously so the assertion sees it.
    vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback): number => {
      cb(0);
      return 1;
    });
    vi.stubGlobal('cancelAnimationFrame', (): void => undefined);
    const spy = spyRect();
    spy.mockReturnValue(rect(5000, 5400));
    const { getByTestId } = render(<Probe count={6} />);
    expect(getByTestId('probe')).toHaveAttribute('data-lit', '0');

    spy.mockReturnValue(rect(-100, 300)); // risen past the top → fully built
    act(() => {
      window.dispatchEvent(new Event('scroll'));
    });
    expect(getByTestId('probe')).toHaveAttribute('data-lit', '6');
  });

  test('lights every row immediately under reduced motion', () => {
    vi.spyOn(window, 'matchMedia').mockImplementation((query: string): MediaQueryList => ({
      matches: query.includes('prefers-reduced-motion'),
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }));
    const { getByTestId } = render(<Probe count={6} />);
    expect(getByTestId('probe')).toHaveAttribute('data-lit', '6');
  });
});

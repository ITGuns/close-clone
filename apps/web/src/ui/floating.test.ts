import { describe, expect, it } from 'vitest';
import { computeFloatingPosition } from './floating.ts';

/** Minimal element stub — compute only calls getBoundingClientRect. */
function el(rect: { top: number; left: number; width: number; height: number }): HTMLElement {
  const r = {
    ...rect,
    right: rect.left + rect.width,
    bottom: rect.top + rect.height,
    x: rect.left,
    y: rect.top,
    toJSON: () => ({}),
  } as DOMRect;
  return { getBoundingClientRect: () => r } as unknown as HTMLElement;
}

describe('computeFloatingPosition — left/right sides', () => {
  it('places the panel to the right of the anchor, center-aligned vertically', () => {
    const anchor = el({ top: 300, left: 16, width: 48, height: 32 });
    const panel = el({ top: 0, left: 0, width: 280, height: 120 });
    const pos = computeFloatingPosition(anchor, panel, { side: 'right', align: 'center', offset: 12 });
    expect(pos.side).toBe('right');
    expect(pos.style.left).toBe(76); // 16 + 48 + 12
    expect(pos.style.top).toBe(256); // 300 + 32/2 - 120/2
  });

  it('flips right → left when the right edge has no room', () => {
    const anchor = el({ top: 300, left: 964, width: 48, height: 32 });
    const panel = el({ top: 0, left: 0, width: 280, height: 120 });
    const pos = computeFloatingPosition(anchor, panel, { side: 'right', offset: 12 });
    expect(pos.side).toBe('left');
    expect(pos.style.left).toBe(672); // 964 - 12 - 280
  });

  it('flips left → right and clamps to the viewport margin', () => {
    const anchor = el({ top: 4, left: 4, width: 10, height: 10 });
    const panel = el({ top: 0, left: 0, width: 100, height: 50 });
    const pos = computeFloatingPosition(anchor, panel, { side: 'left', offset: 8 });
    expect(pos.side).toBe('right');
    expect(pos.style.left).toBe(22); // 4 + 10 + 8
    expect(pos.style.top).toBe(8); // align start = 4, clamped to margin
  });

  it('keeps the existing bottom-placement contract unchanged', () => {
    const anchor = el({ top: 100, left: 100, width: 200, height: 40 });
    const panel = el({ top: 0, left: 0, width: 160, height: 80 });
    const pos = computeFloatingPosition(anchor, panel, {});
    expect(pos.side).toBe('bottom');
    expect(pos.style.top).toBe(144); // 100 + 40 + 4
    expect(pos.style.left).toBe(100);
  });
});

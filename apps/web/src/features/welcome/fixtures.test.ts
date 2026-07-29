import { describe, expect, test } from 'vitest';
import { HERO_LAMPS, WALL_ROWS } from './fixtures.ts';

describe('WALL_ROWS — the hero status-wall dataset', () => {
  test('twelve deterministic rows with unique ids', () => {
    expect(WALL_ROWS).toHaveLength(12);
    expect(new Set(WALL_ROWS.map((r) => r.id)).size).toBe(12);
  });

  test('covers every one of the six law states (the wall IS the color budget)', () => {
    const states = new Set(WALL_ROWS.map((r) => r.state));
    for (const lamp of HERO_LAMPS) {
      expect(states.has(lamp.key), `wall must show a ${lamp.key} row`).toBe(true);
    }
  });

  test('every row carries the text equivalent of its lamp (color never alone)', () => {
    for (const row of WALL_ROWS) {
      expect(row.stateWord.length).toBeGreaterThan(0);
    }
  });
});

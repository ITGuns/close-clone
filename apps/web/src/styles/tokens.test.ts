import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

/*
 * Law test for the Signal Bloom token additions. Vitest runs with `css: false`,
 * so the stylesheet is asserted as text: the tokens exist, sit in the right
 * layers, and introduce no new hue (the bloom must derive from --state-live).
 *
 * Note: resolved via fileURLToPath(import.meta.url) rather than
 * `new URL('./tokens.css', import.meta.url)` because under the jsdom test
 * environment a bare relative-URL base resolves against the document origin
 * (http://localhost), which readFileSync rejects.
 */
const css = readFileSync(
  path.join(path.dirname(fileURLToPath(import.meta.url)), 'tokens.css'),
  'utf8',
);

describe('tokens.css — Signal Bloom additions', () => {
  test('display scale gains the 56px and 72px steps above the 44px top', () => {
    expect(css).toContain('--fs-display-lg: 44px');
    expect(css).toContain('--fs-display-xl: 56px');
    expect(css).toContain('--fs-display-2xl: 72px');
  });

  test('--dur-ignition is one token inside the 500–800ms law window', () => {
    const m = css.match(/--dur-ignition:\s*(\d+)ms/);
    expect(m).not.toBeNull();
    const ms = Number((m as RegExpMatchArray)[1]);
    expect(ms).toBeGreaterThanOrEqual(500);
    expect(ms).toBeLessThanOrEqual(800);
  });

  test('--glow-hero-alpha is a per-theme LAW value (all four theme blocks)', () => {
    expect(css.match(/--glow-hero-alpha:/g)).toHaveLength(4);
  });

  test('--glow-hero is an ALIAS composed from the live cyan — no new hue', () => {
    expect(css.match(/--glow-hero:/g)).toHaveLength(1);
    expect(css).toMatch(/--glow-hero:[^;]*var\(--state-live\)/);
    expect(css).not.toMatch(/--glow-hero:[^;]*#/); // no hex literal in the alias
  });
});

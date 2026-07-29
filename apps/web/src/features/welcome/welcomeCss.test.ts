import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

/*
 * Guards the welcome-tokens.css merge-dedup (spec goal 5): the landing CSS
 * reads the GLOBAL law tokens only. Legacy short names lived in the deleted
 * per-page token file; if they creep back the page silently loses theming.
 *
 * Note: resolved via fileURLToPath(import.meta.url) rather than
 * `new URL('./welcome.css', import.meta.url)` because Vite rewrites that literal
 * pattern into an asset URL (http://localhost/...), which readFileSync rejects
 * (mirrors the sibling styles/tokens.test.ts adaptation).
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const css = readFileSync(path.join(here, 'welcome.css'), 'utf8');

describe('welcome.css — global law tokens only (merge-dedup)', () => {
  test('welcome-tokens.css is deleted', () => {
    expect(existsSync(path.join(here, 'welcome-tokens.css'))).toBe(false);
  });

  test('no legacy short state/geometry names — law names only', () => {
    const legacy = [
      'var(--reply)',
      'var(--overdue)',
      'var(--seq)',
      'var(--dnc)',
      'var(--live)',
      'var(--idle)',
      'var(--wc-r-control)',
    ];
    for (const name of legacy) {
      expect(css, `legacy token ${name} must not be referenced`).not.toContain(name);
    }
  });

  test('no 6-digit hex literals — every color resolves from a token', () => {
    // 3-digit #000 inside mask-image gradients is a mask stop, not a color choice.
    expect(css).not.toMatch(/#[0-9a-fA-F]{6}\b/);
  });

  test('bloom + ignition are token-driven: --glow-hero paints, --dur-ignition times', () => {
    expect(css).toContain('var(--glow-hero)');
    expect(css).toContain('var(--dur-ignition)');
    // Every choreography delay derives from the one token — no literal-first delays.
    expect(css).not.toMatch(/transition-delay:\s*\d+ms/);
  });

  test('headline reads the new display steps (56/72px used only here)', () => {
    expect(css).toMatch(/__headline[^}]*var\(--fs-display-2xl\)/);
    expect(css).toMatch(/var\(--fs-display-xl\)/);
  });
});

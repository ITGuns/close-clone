import type { CSSProperties, JSX } from 'react';
import { BoardMark } from './icons.tsx';
import { WALL_ROWS } from './fixtures.ts';
import { WALL, WORDMARK } from './copy.ts';

/*
 * The hero status wall (Signal Bloom): twelve live-DOM board rows, full-bleed
 * across the viewport under the headline — the six state lamps ARE the hero's
 * expressive layer. Not a screenshot: no <img>, both themes, crisp at any DPI.
 * Decorative (the feature acts narrate the same rows for AT), so the whole
 * wall is aria-hidden. --row-i drives the CSS ignition stagger only.
 */
export function HeroFrame(): JSX.Element {
  return (
    <div className="sb-welcome__wall-wrap" aria-hidden="true">
      <div className="sb-welcome__wall">
        <div className="sb-welcome__wall-bar">
          <span className="sb-welcome__frame-brand">
            <BoardMark size={13} />
            {WORDMARK}
          </span>
          <span className="sb-welcome__frame-crumb">{WALL.crumb}</span>
          <span className="sb-welcome__frame-kbd">{WALL.kbd}</span>
        </div>
        <ul className="sb-welcome__wall-rows">
          {WALL_ROWS.map((row, i) => (
            <li
              key={row.id}
              className="sb-welcome__wall-row"
              style={{ '--row-i': i } as CSSProperties}
            >
              <span className={`sb-welcome__frame-dot sb-welcome__frame-dot--${row.state}`} />
              <span className="sb-welcome__frame-company">{row.company}</span>
              <span className="sb-welcome__frame-line">
                {row.person} — {row.line}
              </span>
              <span className={`sb-welcome__frame-state sb-welcome__frame-state--${row.state}`}>
                {row.stateWord}
              </span>
              <span className="sb-welcome__frame-time">{row.time}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

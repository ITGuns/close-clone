import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { BoardMark } from './icons.tsx';
import { FOOTER, FOOTER_COLUMNS, LOGIN_PATH, WORDMARK } from './copy.ts';

/* The six lamp states, in board order — the footer's only spot of color. */
const LEGEND_STATES = ['reply', 'live', 'seq', 'overdue', 'dnc', 'idle'] as const;

/** Closing CTA + a full footer: brand blurb, the lamp legend, and columns of
 * real in-page links (Legal entries are the standard placeholders). */
export function FooterCta(): JSX.Element {
  return (
    <footer className="sb-welcome__footer">
      <div className="sb-welcome__footer-main">
        <p className="sb-welcome__footer-kicker">The line’s open.</p>
        <Link to={LOGIN_PATH} className="sb-welcome__cta">
          {FOOTER.cta}
          <span className="sb-welcome__cta-arrow" aria-hidden="true">
            →
          </span>
        </Link>
      </div>

      <div className="sb-welcome__footer-cols">
        <div className="sb-welcome__footer-brandcol">
          <span className="sb-welcome__footer-brand">
            <BoardMark size={16} />
            {WORDMARK}
          </span>
          <p className="sb-welcome__footer-note">{FOOTER.note}</p>
          <span className="sb-welcome__footer-legend" aria-hidden="true">
            {LEGEND_STATES.map((state) => (
              <span
                key={state}
                className={`sb-welcome__frame-dot sb-welcome__frame-dot--${state}`}
              />
            ))}
          </span>
        </div>

        {FOOTER_COLUMNS.map((col) => (
          <nav key={col.title} className="sb-welcome__footer-col" aria-label={col.title}>
            <p className="sb-welcome__footer-coltitle">{col.title}</p>
            <ul className="sb-welcome__footer-collist">
              {col.links.map((link) => (
                <li key={link.name}>
                  {link.href.startsWith('#') ? (
                    <a href={link.href} className="sb-welcome__footer-collink">
                      {link.name}
                    </a>
                  ) : (
                    <Link to={link.href} className="sb-welcome__footer-collink">
                      {link.name}
                    </Link>
                  )}
                </li>
              ))}
            </ul>
          </nav>
        ))}
      </div>

      <div className="sb-welcome__footer-btm">
        <span>{FOOTER.copyright}</span>
        <span>{FOOTER.fine}</span>
      </div>
    </footer>
  );
}

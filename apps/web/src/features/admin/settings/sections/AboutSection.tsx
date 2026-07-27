import type { JSX } from 'react';
import { Link } from 'react-router-dom';
import { ACTIVITY_TYPES } from '@switchboard/shared';
import { BoardMark } from '../../../../ui/BoardMark.tsx';
import { ExternalLinkIcon } from '../../icons.tsx';

/*
 * About — build info + a few honest stats, and a link to the /welcome tour. The
 * data-layer line reflects the runtime API mode so the demo build is legible.
 *
 * Every number here has to be a fact about the PRODUCT a user could go count.
 * Test counts and the placeholder package VERSION ('0.0.0') are not that, so
 * neither is shown: the build line names the build, and the activity-type count
 * is read from the shared taxonomy rather than typed in, so it cannot drift.
 */

const IS_REAL_API = import.meta.env.VITE_API_MODE === 'real';
const API_MODE = IS_REAL_API ? 'Live API' : 'Mock (MSW)';

const STATS: ReadonlyArray<{ value: string; label: string }> = [
  { value: '5', label: 'Settings sections' },
  { value: '5', label: 'Bulk actions' },
  { value: '6', label: 'State lamps' },
  { value: String(ACTIVITY_TYPES.length), label: 'Timeline event types' },
];

const BUILD_INFO: ReadonlyArray<{ term: string; value: string }> = [
  { term: 'Build', value: IS_REAL_API ? 'Internal build' : 'Demo build' },
  { term: 'Design system', value: 'Operator Grid' },
  { term: 'Data layer', value: API_MODE },
  { term: 'Contract', value: 'CONTRACTS 1.3.3' },
];

export function AboutSection(): JSX.Element {
  return (
    <section className="admin-section" aria-labelledby="admin-about-title">
      <header className="admin-section__head">
        <h1 id="admin-about-title" className="admin-section__title">
          About Switchboard
        </h1>
        <p className="admin-section__desc">A communication-first CRM. Keyboard to the metal.</p>
      </header>

      <div className="admin-about">
        <dl className="admin-about__stats">
          {STATS.map((stat) => (
            <div key={stat.label} className="admin-stat">
              <dt className="admin-stat__label">{stat.label}</dt>
              <dd className="admin-stat__value">{stat.value}</dd>
            </div>
          ))}
        </dl>

        <dl className="admin-about__build">
          {BUILD_INFO.map((row) => (
            <div key={row.term} className="admin-about__build-row">
              <dt>{row.term}</dt>
              <dd className="admin-mono">{row.value}</dd>
            </div>
          ))}
        </dl>

        <div className="admin-about__cta">
          <Link to="/welcome" className="admin-about__link">
            <BoardMark size={15} />
            Open the product tour
            <ExternalLinkIcon size={14} />
          </Link>
        </div>
      </div>
    </section>
  );
}

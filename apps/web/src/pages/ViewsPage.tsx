import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { cx } from '../lib/cx.ts';
import { listSmartViews } from '../api/smartViews.ts';
import { useListNav, KbdCombo } from '../keyboard/index.ts';
import { Button, EmptyState, ErrorState, Spinner, StatusPill } from '../ui/index.ts';
import { Page } from './Page.tsx';

/**
 * Views — the saved Smart Views index. Each row is a real saved query: the name
 * plus the DSL it runs. Enter (or a click) opens the view's leads; "New view"
 * goes to the builder at /views/new. j/k movement comes from the shared
 * useListNav hook, the same one the leads table and the rail use.
 */
export function ViewsPage(): JSX.Element {
  const navigate = useNavigate();
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['smart-views'],
    queryFn: () => listSmartViews(),
  });
  const views = data ?? [];

  const nav = useListNav({
    count: views.length,
    group: 'Views',
    onActivate: (index) => {
      const view = views[index];
      if (view) navigate(`/views/${view.id}`);
    },
  });

  return (
    <Page
      title="Views"
      subtitle="Saved queries over your leads. Each one re-runs when you open it."
      actions={
        <Button variant="primary" onClick={() => navigate('/views/new')}>
          New view
        </Button>
      }
    >
      <section className="sb-demo" aria-label="Saved Smart Views">
        <header className="sb-demo__head">
          <h2 className="sb-demo__title">Saved views</h2>
          <span className="sb-demo__hint" aria-hidden="true">
            <KbdCombo combo="j" />
            <KbdCombo combo="k" />
            <span>move</span>
            <KbdCombo combo="enter" />
            <span>open</span>
          </span>
        </header>

        {isLoading ? (
          <div className="sb-demo__loading">
            <Spinner label="Loading views" />
          </div>
        ) : isError ? (
          <ErrorState
            title="Couldn’t load your views"
            description="The server didn’t answer. Your saved views are safe — try again."
            onRetry={() => void refetch()}
          />
        ) : views.length === 0 ? (
          <EmptyState
            title="No saved views yet"
            description="A Smart View saves a query over your leads and re-runs it every time you open it."
            actions={
              <Button variant="primary" onClick={() => navigate('/views/new')}>
                New view
              </Button>
            }
          />
        ) : (
          <ul
            className="sb-demo__list"
            role="listbox"
            aria-label="Saved Smart Views"
            {...nav.containerProps}
          >
            {views.map((view, index) => {
              const itemProps = nav.getItemProps(index);
              return (
                <li
                  key={view.id}
                  aria-label={view.name}
                  className={cx('sb-demo__opt', itemProps['aria-selected'] && 'is-active')}
                  {...itemProps}
                >
                  <span className="sb-demo__opt-main">
                    <span className="sb-demo__opt-name">{view.name}</span>
                    <span className="sb-demo__opt-meta">{view.dsl}</span>
                  </span>
                  {view.shared ? <StatusPill>Shared</StatusPill> : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </Page>
  );
}

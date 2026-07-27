import { afterEach, describe, expect, test } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ACTIVITY_TYPES } from '@switchboard/shared';
import { AboutSection } from './AboutSection.tsx';

/*
 * About is the one screen a user reads for facts about the build, so every value
 * on it has to be one. Previously it showed the placeholder package VERSION
 * ('0.0.0'), a stale contract version, and a TEST COUNT dressed as a product stat.
 */

function renderAbout() {
  return render(
    <MemoryRouter>
      <AboutSection />
    </MemoryRouter>,
  );
}

afterEach(cleanup);

describe('AboutSection — build facts', () => {
  test('names the build instead of the placeholder 0.0.0 version', () => {
    renderAbout();
    expect(screen.getByText('Build')).toBeInTheDocument();
    expect(screen.getByText('Demo build')).toBeInTheDocument();
    expect(screen.queryByText('Version')).toBeNull();
    expect(document.body.textContent).not.toContain('0.0.0');
  });

  test('reports the current contract version', () => {
    renderAbout();
    expect(screen.getByText('CONTRACTS 1.3.3')).toBeInTheDocument();
    expect(screen.queryByText('CONTRACTS 1.2.0')).toBeNull();
  });
});

describe('AboutSection — stats are product facts, not test counts', () => {
  test('the admin test-count stat is gone', () => {
    renderAbout();
    expect(screen.queryByText('Admin surface checks')).toBeNull();
    expect(document.body.textContent).not.toMatch(/checks|tests|coverage/i);
  });

  test('shows the timeline event-type count read from the shared taxonomy', () => {
    renderAbout();
    expect(screen.getByText('Timeline event types')).toBeInTheDocument();
    expect(screen.getByText(String(ACTIVITY_TYPES.length))).toBeInTheDocument();
  });
});

import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { LeftRail } from './LeftRail.tsx';

describe('tour anchors', () => {
  it('LeftRail exposes data-tour anchors for inbox, leads, and pipeline', () => {
    const { container } = render(
      <MemoryRouter>
        <LeftRail collapsed={false} onToggleCollapse={() => {}} />
      </MemoryRouter>,
    );
    for (const id of ['nav-inbox', 'nav-leads', 'nav-pipeline']) {
      expect(container.querySelector(`[data-tour="${id}"]`)).not.toBeNull();
    }
  });

  it('keeps anchors when the rail is collapsed (tooltip-wrapped links)', () => {
    const { container } = render(
      <MemoryRouter>
        <LeftRail collapsed onToggleCollapse={() => {}} />
      </MemoryRouter>,
    );
    expect(container.querySelector('[data-tour="nav-inbox"]')).not.toBeNull();
  });
});

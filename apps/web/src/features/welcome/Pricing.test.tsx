import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Pricing } from './Pricing.tsx';

function renderPricing(): void {
  render(
    <MemoryRouter>
      <Pricing />
    </MemoryRouter>,
  );
}

describe('Pricing — per-seat tiers for a single-tenant tool', () => {
  test('renders the three tiers', () => {
    renderPricing();
    expect(screen.getByText('Team')).toBeInTheDocument();
    expect(screen.getByText('Scale')).toBeInTheDocument();
    expect(screen.getByText('Enterprise')).toBeInTheDocument();
  });

  test('shows monthly prices by default and swaps to the annual-equivalent on toggle', async () => {
    renderPricing();
    expect(screen.getByText('49')).toBeInTheDocument();
    expect(screen.getByText('99')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: /Annual/i }));
    expect(screen.getByText('41')).toBeInTheDocument();
    expect(screen.getByText('82')).toBeInTheDocument();
    expect(screen.queryByText('49')).toBeNull();
  });

  test('Enterprise is contact-only, pointing at the FAQ', () => {
    renderPricing();
    expect(screen.getByText(/Let.s talk/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '#welcome-faq');
  });

  test('both seat plans route to the SSO gate', () => {
    renderPricing();
    const signins = screen.getAllByRole('link', { name: /sign in · sso/i });
    expect(signins).toHaveLength(2); // Team + Scale
    for (const link of signins) {
      expect(link).toHaveAttribute('href', '/login');
    }
  });
});

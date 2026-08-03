import { describe, expect, test } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Faq } from './Faq.tsx';
import { FAQ_ITEMS } from './copy.ts';

describe('Faq — native disclosures with real answers', () => {
  test('renders every question as a <details> group', () => {
    render(<Faq />);
    expect(screen.getByText('What exactly is Switchboard?')).toBeInTheDocument();
    expect(screen.getByText(/Where does my data live/)).toBeInTheDocument();
    expect(screen.getAllByRole('group')).toHaveLength(FAQ_ITEMS.length);
  });

  test('answers describe the real gating (SSO + no compliance bypass)', () => {
    render(<Faq />);
    expect(screen.getByText(/SSO-gated/i)).toBeInTheDocument();
    expect(screen.getByText(/no privileged bypass/i)).toBeInTheDocument();
  });
});

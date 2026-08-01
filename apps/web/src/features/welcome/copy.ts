/*
 * Every word on the landing page, in one place. Copy is design material here:
 * short declaratives, numbers over adjectives, an operator's economy. No lorem,
 * no froth. Kept as data so the page components stay presentational and the
 * voice is auditable in a single file.
 */

export const WORDMARK = 'Switchboard';

export const NAV_SIGN_IN = 'Sign in · SSO';

export interface NavMenuItem {
  name: string;
  /** In-page anchor — every target is a real section below. */
  href: `#${string}`;
}

/** Landing nav menu — anchors into the page, no dead links. */
export const NAV_MENU: readonly NavMenuItem[] = [
  { name: 'Features', href: '#welcome-acts' },
  { name: 'Shortcuts', href: '#welcome-keys' },
  { name: 'Pricing', href: '#welcome-pricing' },
  { name: 'FAQ', href: '#welcome-faq' },
];

/**
 * The accounts band under the hero frame. These are the demo dataset's own
 * companies — accounts being worked in the product, not invented "partners".
 */
export const ACCOUNTS_BAND = {
  title: 'On the board this week',
  names: [
    'Northwind Labs',
    'Harbor Analytics',
    'Vertex Robotics',
    'Iron Cedar Freight',
    'Copper Systems',
    'Nova Capital',
    'Bright Networks',
    'Granite Foods',
    'Quantum Robotics',
  ],
} as const;

export const HERO = {
  headline: ['Pick up the line.', 'The rest is already dialed.'],
  sub: 'Every reply, task, and call lines up in one keyboard-driven queue. Each lead wears a state lamp — REPLY, OVERDUE, DNC — so the board reads at a glance and the next move is always one keystroke away.',
  cta: 'Open Switchboard',
} as const;

/** The floating announcement pill above the hero headline — links to the feature
 * tour, never a dead badge. */
export const ANNOUNCE = {
  text: 'Now in your browser — no dialer, no install',
  href: '#welcome-acts',
} as const;

export interface HeroStat {
  value: string;
  label: string;
}

export const HERO_STATS: readonly HeroStat[] = [
  { value: '0.9s', label: 'to open a lead' },
  { value: '1 key', label: 'to the next call' },
  { value: '100%', label: 'of touches on the timeline' },
];

/** Chrome strings for the hero status wall — 12 fixture rows on deck. */
export const WALL = {
  crumb: 'Live board · 12 on deck',
  kbd: 'J / K',
} as const;

export interface FeatureActCopy {
  id: string;
  label: string;
  title: string;
  body: readonly [string, string];
}

export const FEATURE_ACTS: readonly FeatureActCopy[] = [
  {
    id: 'triage',
    label: 'Inbox triage',
    title: 'One queue, lit by state',
    body: [
      'Replies, overdue tasks, and live sequences surface in a single lamp-lit list.',
      'Answer the one at the top, and the next is already waiting under your cursor.',
    ],
  },
  {
    id: 'calling',
    label: 'One-keystroke calling',
    title: 'Land on a lead. Press the key.',
    body: [
      'One keystroke opens the line straight from the row — no dialer, no lookup.',
      'Consent is announced and the call is on the timeline before it rings.',
    ],
  },
  {
    id: 'sequences',
    label: 'Sequences that stop themselves',
    title: 'A reply ends the cadence',
    body: [
      'The moment someone replies, the sequence pauses — before the next send is even claimed.',
      'Nobody gets a follow-up nudge while they are already talking to you.',
    ],
  },
];

export const KEYBOARD = {
  label: 'Keyboard-first',
  title: 'The whole product, from the home row',
  sub: 'Every combo below is live in the app right now — the same map the ? sheet shows.',
} as const;

export const TRUST_LINE =
  'Consent announced on every recorded call · unsubscribe honored in one click · DNC enforced at the engine';

export const FOOTER = {
  cta: 'Open Switchboard',
  note: 'Switchboard is an internal tool for the revenue team. Access is limited to staff accounts through single sign-on.',
} as const;

/** Both primary CTAs and the nav sign-in route to the dev-login gate. */
export const LOGIN_PATH = '/login';

/* ── Pricing ──────────────────────────────────────────────────────────────────
 * Switchboard is single-tenant and internal, so the model is per-seat + a
 * self-host Enterprise tier — never a consumer freemium. Prices are the demo
 * anchor for the revenue team's own deployment. */
export const PRICING = {
  eyebrow: 'Pricing',
  title: 'Priced per seat. Deployed for your team.',
  sub: 'Switchboard runs single-tenant — one workspace, your identity provider, your data. Pick a plan for the team; talk to us to self-host.',
  monthly: 'Monthly',
  annual: 'Annual',
  annualNote: '2 months free',
} as const;

export interface PricingTier {
  id: string;
  name: string;
  /** Display amount for monthly / annual-equivalent; empty ⇒ "Let's talk". */
  monthly: string;
  annual: string;
  unit: string;
  note: string;
  featured?: boolean;
  cta: string;
  ctaHref: string;
  features: readonly string[];
}

export const PRICING_TIERS: readonly PricingTier[] = [
  {
    id: 'team',
    name: 'Team',
    monthly: '49',
    annual: '41',
    unit: '/ seat / mo',
    note: 'For a team working one board.',
    cta: NAV_SIGN_IN,
    ctaHref: LOGIN_PATH,
    features: [
      'The keyboard-driven board',
      'Sequences & Smart Views',
      'One timeline per lead',
      'Compliance rails on every send',
      'SSO & role-based access',
    ],
  },
  {
    id: 'scale',
    name: 'Scale',
    monthly: '99',
    annual: '82',
    unit: '/ seat / mo',
    note: 'When the board runs the whole floor.',
    featured: true,
    cta: NAV_SIGN_IN,
    ctaHref: LOGIN_PATH,
    features: [
      'Everything in Team',
      'API tokens & webhooks',
      'Advanced Smart View DSL',
      'Priority telephony & transcription',
      'Audit log & data export',
    ],
  },
  {
    id: 'enterprise',
    name: 'Enterprise',
    monthly: '',
    annual: '',
    unit: '',
    note: 'Self-hosted, single-tenant, on your terms.',
    cta: 'Contact us',
    ctaHref: '#welcome-faq',
    features: [
      'Self-host / VPC deploy',
      'Custom identity provider',
      'DPA & security review',
      'Compliance-rail configuration',
      'Dedicated support',
    ],
  },
];

/* ── FAQ ─────────────────────────────────────────────────────────────────────
 * Real answers about what the product is and how it is gated — no marketing
 * froth. Each maps to a fact the operator guide states. */
export const FAQ = {
  eyebrow: 'FAQ',
  title: 'Questions, answered.',
} as const;

export interface FaqItem {
  q: string;
  a: string;
}

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    q: 'What exactly is Switchboard?',
    a: 'A communication-first CRM for your own sales team. The unit of work is the conversation on a per-lead timeline — not the record. Calls, emails, SMS, and notes ingest into one append-only stream, and a keyboard-driven queue drives the day.',
  },
  {
    q: 'Is it internal-only, or a public product?',
    a: "Internal and single-tenant by design. It is SSO-gated — your team signs in with your identity provider, and there is no public sign-up. Scope is deliberately narrow: US and Canada, English, no multi-tenancy.",
  },
  {
    q: 'How does compliance actually work?',
    a: 'Consent, quiet hours, DNC, suppression, and rate caps are enforced in the engine layer on every outbound — re-checked inside the send transaction, never only at scheduling time. The internal API has no privileged bypass. A blocked send simply never leaves.',
  },
  {
    q: 'What can it ingest?',
    a: 'Calls, emails, SMS, and manual notes, all onto one timeline per lead. Telephony, email, and transcription plug in through provider adapters, so the surface stays the same no matter what is wired behind it.',
  },
  {
    q: 'How do I sign in?',
    a: 'Single sign-on with your work account. Your role — admin or member — is resolved from your identity provider, so access follows the same rules as the rest of your stack.',
  },
  {
    q: 'Where does my data live?',
    a: 'In your own single-tenant database. Tokens are hashed or encrypted at rest, logs are redacted, and secrets are excluded from exports. Nothing about a lead leaves the timeline it belongs to.',
  },
];

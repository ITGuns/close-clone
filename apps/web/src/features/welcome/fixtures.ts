/*
 * Fixture data for the live board vignettes. These are real, plausible CRM rows
 * modeled on the @switchboard/shared domain shapes (leads, contacts, sequence
 * enrollments, calls) and named to match the app's own fixtures (Ada Okafor,
 * Ben Reyes, Priya Menon; North/Vertex/Harbor/Cedar companies). Nothing here is
 * fetched or animated — the vignettes are static, all-live-DOM product panels,
 * not screenshots or invented metrics.
 */

/** The law's state vocabulary — the entire color budget of the page. */
export type StateKey = 'reply' | 'overdue' | 'seq' | 'dnc' | 'live' | 'idle';

export interface StateLampMeta {
  key: StateKey;
  /** Wide-caps state word rendered beside the lamp. */
  word: string;
}

/** The six lamps that ignite across the hero board, in ignition order. */
export const HERO_LAMPS: readonly StateLampMeta[] = [
  { key: 'reply', word: 'Reply' },
  { key: 'live', word: 'Live' },
  { key: 'seq', word: 'Sequence' },
  { key: 'overdue', word: 'Overdue' },
  { key: 'dnc', word: 'Do not contact' },
  { key: 'idle', word: 'Idle' },
];

export interface TriageRow {
  id: string;
  company: string;
  person: string;
  line: string;
  state: Extract<StateKey, 'reply' | 'overdue' | 'seq' | 'idle'>;
  stateWord: string;
  time: string;
}

export const TRIAGE_ROWS: readonly TriageRow[] = [
  {
    id: 'northwind',
    company: 'Northwind Labs',
    person: 'Priya Menon',
    line: 'Thursday works — send the order form over.',
    state: 'reply',
    stateWord: 'Reply',
    time: '2m',
  },
  {
    id: 'harbor',
    company: 'Harbor Analytics',
    person: 'Marcus Lund',
    line: 'Follow-up call — due 20 minutes ago.',
    state: 'overdue',
    stateWord: 'Overdue',
    time: 'now',
  },
  {
    id: 'vertex',
    company: 'Vertex Robotics',
    person: 'Ada Okafor',
    line: 'Renewal outreach — step 3 of 5 sent.',
    state: 'seq',
    stateWord: 'Sequence',
    time: '18m',
  },
  {
    id: 'cedar',
    company: 'Iron Cedar Freight',
    person: 'Diego Santos',
    line: 'Looping in our CFO on the numbers.',
    state: 'reply',
    stateWord: 'Reply',
    time: '46m',
  },
  {
    id: 'copper',
    company: 'Copper Systems',
    person: 'Ben Reyes',
    line: 'No touch in 6 days.',
    state: 'idle',
    stateWord: 'Idle',
    time: '6d',
  },
];

export interface WallRow {
  id: string;
  company: string;
  person: string;
  line: string;
  /** Full six-state vocabulary — the wall is the page's color budget on display. */
  state: StateKey;
  stateWord: string;
  time: string;
}

/**
 * The hero status wall (Signal Bloom): twelve board rows, deterministic, all
 * six states represented. The first five mirror TRIAGE_ROWS so the narrated
 * feature-act rows and the wall tell one story.
 */
export const WALL_ROWS: readonly WallRow[] = [
  {
    id: 'northwind',
    company: 'Northwind Labs',
    person: 'Priya Menon',
    line: 'Thursday works — send the order form over.',
    state: 'reply',
    stateWord: 'Reply',
    time: '2m',
  },
  {
    id: 'harbor',
    company: 'Harbor Analytics',
    person: 'Marcus Lund',
    line: 'Follow-up call — due 20 minutes ago.',
    state: 'overdue',
    stateWord: 'Overdue',
    time: 'now',
  },
  {
    id: 'vertex',
    company: 'Vertex Robotics',
    person: 'Ada Okafor',
    line: 'Renewal outreach — step 3 of 5 sent.',
    state: 'seq',
    stateWord: 'Sequence',
    time: '18m',
  },
  {
    id: 'cedar',
    company: 'Iron Cedar Freight',
    person: 'Diego Santos',
    line: 'Looping in our CFO on the numbers.',
    state: 'reply',
    stateWord: 'Reply',
    time: '46m',
  },
  {
    id: 'copper',
    company: 'Copper Systems',
    person: 'Ben Reyes',
    line: 'No touch in 6 days.',
    state: 'idle',
    stateWord: 'Idle',
    time: '6d',
  },
  {
    id: 'nova',
    company: 'Nova Capital',
    person: 'Lena Fischer',
    line: 'On the line now — consent announced.',
    state: 'live',
    stateWord: 'Live',
    time: '00:41',
  },
  {
    id: 'bright',
    company: 'Bright Networks',
    person: 'Sam Whitfield',
    line: 'Unsubscribed — outreach locked by the engine.',
    state: 'dnc',
    stateWord: 'Do not contact',
    time: '3d',
  },
  {
    id: 'granite',
    company: 'Granite Foods',
    person: 'Rosa Delgado',
    line: 'Quote follow-up — due this morning.',
    state: 'overdue',
    stateWord: 'Overdue',
    time: '1h',
  },
  {
    id: 'quantum',
    company: 'Quantum Robotics',
    person: 'Ada Okafor',
    line: 'Intro cadence — step 1 of 4 sent.',
    state: 'seq',
    stateWord: 'Sequence',
    time: '2h',
  },
  {
    id: 'northwind-security',
    company: 'Northwind Labs',
    person: 'Ben Reyes',
    line: 'Asked for the security overview.',
    state: 'reply',
    stateWord: 'Reply',
    time: '1h',
  },
  {
    id: 'copper-renewal',
    company: 'Copper Systems',
    person: 'Priya Menon',
    line: 'Renewal outreach — step 2 of 5 sent.',
    state: 'seq',
    stateWord: 'Sequence',
    time: '4h',
  },
  {
    id: 'cedar-idle',
    company: 'Iron Cedar Freight',
    person: 'Marcus Lund',
    line: 'No touch in 9 days.',
    state: 'idle',
    stateWord: 'Idle',
    time: '9d',
  },
];

export interface CallingFixture {
  company: string;
  contact: string;
  role: string;
  phone: string;
  timer: string;
  consentLine: string;
}

export const CALLING: CallingFixture = {
  company: 'Vertex Robotics',
  contact: 'Ada Okafor',
  role: 'VP Operations',
  phone: '+1 (415) 555-0148',
  timer: '00:12',
  consentLine: 'Consent announced',
};

export interface SequenceFixture {
  contact: string;
  company: string;
  sequence: string;
  step: number;
  steps: number;
  reply: string;
}

export const SEQUENCE: SequenceFixture = {
  contact: 'Marcus Lund',
  company: 'Harbor Analytics',
  sequence: 'Renewal outreach',
  step: 3,
  steps: 5,
  reply: 'Yes — let’s talk Thursday. Can you send a couple of times?',
};

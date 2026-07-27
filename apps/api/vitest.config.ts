import { defineConfig } from 'vitest/config';

/*
 * The api suite had NO vitest config: it ran on the 5s default testTimeout while
 * most of its 155 files spin up an embedded PGlite Postgres per test. That is not
 * a budget those tests can meet on a loaded machine, so failures here have been
 * reporting the runner's CPU rather than the code — including, at one point, an
 * I-REC compliance property test that silently stopped being verified because it
 * timed out instead of running.
 *
 * The individual `}, 120_000)` overrides scattered through the suite were each a
 * local patch for this global defect; they still work and stay authoritative for
 * the genuinely heavy files (the 10k-row import gets 300s of its own).
 *
 * 60s is "a DB-backed test on a busy box", not "a hang" — a wedged test still
 * fails, just not at the four-second mark.
 */
export default defineConfig({
  test: {
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
});

// Feature: kino-game
//
// Vitest configuration for the simulation-core test suite.
//
// The suite targets the PURE, Phaser-independent core (see `src/README.md`), so
// it runs in a plain Node environment — no jsdom/canvas needed. The `test`
// npm script invokes `vitest run`, a single-run (non-watch) command suitable
// for CI and task verification.

import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Pure core logic — no browser/DOM required.
    environment: 'node',
    // Only pick up tests under test/; source stays test-free.
    include: ['test/**/*.test.ts'],
    globals: false,
  },
});

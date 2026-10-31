// Feature: kino-game, Property 11: High score is the monotonic per-world/per-mode maximum
//
// Validates: Requirements 28.1, 28.2, 28.3.
//
// The high-score tracker (src/core/highScoreTracker.ts) persists story and
// endless high scores SEPARATELY per world (Req 28.1, 28.2) and updates a
// stored value ONLY when a run strictly EXCEEDS it (Req 28.3) — so each
// (mode, world) entry is the MONOTONIC MAXIMUM of every score ever recorded for
// that pair, and no other pair is affected.
//
// Property: start from an empty/arbitrary HighScoreState, then fold an ARBITRARY
// SEQUENCE of recordScore calls — each with a random mode ('story'|'endless'), a
// random world (1..5), and a random finite score. After EVERY call we assert the
// invariants against an independent ORACLE (a Map keyed by `${mode}:${world}` →
// running max that we maintain alongside the tracker):
//
//   1. Monotonic max (Req 28.3): for EVERY (mode, world) the tracker's stored
//      high score equals the maximum score ever recorded for that pair so far —
//      it never decreases and always equals the running max.
//   2. `updated` semantics (Req 28.3): true IFF the recorded score strictly
//      exceeded the previous stored value for that (mode, world).
//   3. Independence (Req 28.1, 28.2): recording into one (mode, world) never
//      changes any OTHER (mode, world) entry — story vs endless and world vs
//      world are fully independent.
//   4. Purity: recordScore never mutates the input HighScoreState.
//
// Pure TypeScript, no Phaser — the tracker is a core module, so this property
// runs in plain Node without a browser or canvas.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  recordScore,
  getHighScore,
  type HighScoreMode,
  type HighScoreState,
  type WorldId,
} from '../src/core/index.ts';

/** The two tracked modes and the five world ids — the full (mode, world) space. */
const MODES: readonly HighScoreMode[] = ['story', 'endless'];
const WORLDS: readonly WorldId[] = [1, 2, 3, 4, 5];

/** Oracle key for a (mode, world) pair. */
function key(mode: HighScoreMode, world: WorldId): string {
  return `${mode}:${world}`;
}

/**
 * Finite scores only. A non-finite score (NaN/±Infinity) is explicitly defined
 * by the tracker as "no improvement" (it reads as the existing value); mixing
 * that corner into this property would conflate it with the monotonic-max rule
 * the oracle models, so we keep the core input space FINITE here. We also fold
 * -0 to 0 so the oracle's numeric comparisons match the tracker exactly (−0 and
 * +0 compare equal under `>` anyway, but this keeps the oracle values clean).
 */
const finiteScoreArb = fc
  .double({ noNaN: true, noDefaultInfinity: true })
  .map((n) => (Object.is(n, -0) ? 0 : n));

/** One recordScore call: a random (mode, world, score). */
const callArb = fc.record({
  mode: fc.constantFrom(...MODES),
  world: fc.constantFrom(...WORLDS),
  score: finiteScoreArb,
});

/**
 * An arbitrary STARTING HighScoreState. Each (mode, world) entry is present with
 * probability < 1 (sparse maps are allowed by the schema), seeded with a finite
 * value so we also exercise non-empty baselines, not just the empty map.
 */
const startStateArb: fc.Arbitrary<HighScoreState> = fc
  .record({
    story: fc.dictionary(
      fc.constantFrom(...WORLDS.map((w) => `world${w}`)),
      finiteScoreArb,
      { maxKeys: 5 },
    ),
    endless: fc.dictionary(
      fc.constantFrom(...WORLDS.map((w) => `world${w}`)),
      finiteScoreArb,
      { maxKeys: 5 },
    ),
  });

/** Build the oracle (running max per pair) seeded from a starting state. */
function seedOracle(start: HighScoreState): Map<string, number> {
  const oracle = new Map<string, number>();
  for (const mode of MODES) {
    for (const world of WORLDS) {
      oracle.set(key(mode, world), getHighScore(start, mode, world));
    }
  }
  return oracle;
}

/** Assert the tracker agrees with the oracle for EVERY (mode, world) pair. */
function assertAllPairsMatchOracle(state: HighScoreState, oracle: Map<string, number>): void {
  for (const mode of MODES) {
    for (const world of WORLDS) {
      expect(getHighScore(state, mode, world)).toBe(oracle.get(key(mode, world)));
    }
  }
}

describe('Property 11: high score is the monotonic per-world/per-mode maximum', () => {
  it('folds an arbitrary call sequence and matches an independent running-max oracle (Req 28.1, 28.2, 28.3)', () => {
    fc.assert(
      fc.property(
        startStateArb,
        fc.array(callArb, { maxLength: 60 }),
        (start, calls) => {
          let state = start;
          const oracle = seedOracle(start);

          for (const { mode, world, score } of calls) {
            // Snapshot BEFORE the call for the purity + independence checks.
            const beforeState = state;
            const before = new Map<string, number>();
            for (const m of MODES) {
              for (const w of WORLDS) {
                before.set(key(m, w), getHighScore(beforeState, m, w));
              }
            }
            const prevForTarget = getHighScore(beforeState, mode, world);

            const result = recordScore(beforeState, mode, world, score);

            // (4) Purity: the input state is never mutated.
            for (const m of MODES) {
              for (const w of WORLDS) {
                expect(getHighScore(beforeState, m, w)).toBe(before.get(key(m, w)));
              }
            }

            // (2) `updated` is true IFF the score strictly exceeded the previous
            //     stored value for the target (mode, world).
            const expectedUpdated = score > prevForTarget;
            expect(result.updated).toBe(expectedUpdated);

            // Advance the oracle: the target pair becomes its running max.
            const expectedTarget = Math.max(prevForTarget, score);
            oracle.set(key(mode, world), expectedTarget);

            state = result.highScores;

            // (2b) The returned highScore is the post-record stored value.
            expect(result.highScore).toBe(expectedTarget);
            // Monotonic: the target never decreased.
            expect(expectedTarget).toBeGreaterThanOrEqual(prevForTarget);

            // (1) Monotonic max: EVERY pair equals the oracle's running max.
            assertAllPairsMatchOracle(state, oracle);

            // (3) Independence: every pair OTHER than the target is unchanged
            //     from before the call (confirmed against the before-snapshot,
            //     independent of the oracle).
            for (const m of MODES) {
              for (const w of WORLDS) {
                if (m === mode && w === world) continue;
                expect(getHighScore(state, m, w)).toBe(before.get(key(m, w)));
              }
            }
          }
        },
      ),
      { numRuns: 300 },
    );
  });
});

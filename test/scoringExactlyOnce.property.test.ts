// Feature: kino-game, Property 1: Exactly-once, unit-valued scoring
//
// Validates: Requirements 9.1, 9.6, 2.3, 2.4, 3.3, 3.4, 4.2, 4.3, 5.3, 5.4, 35.4.
//
// The ScoringSystem is the scoring authority for a run. Property 1 asserts the
// two structural guarantees the design builds the one-way latch and unit base
// value for:
//   - Exactly-once (Req 9.1, 9.6, 35.4): each distinct Obstacle_Unit contributes
//     exactly ONE successful ScoringEvent. Every later `credit()` for that same
//     id is rejected (returns null) and leaves the total untouched.
//   - Unit-valued under the default multiplier of 1 (Req 2.4, 3.4, 4.3, 5.4,
//     and the per-mode scoring Reqs 2.3, 3.3, 4.2, 5.3): every successful event
//     carries baseValue === 1 and creditedValue === 1.
//
// Strategy: generate an arbitrary list of credit calls over a small pool of
// obstacle ids (so duplicates are common) paired with random valid modes, then
// replay them in order against a fresh system. We reconstruct the expected set
// of distinct ids and assert the observed events and running totals exactly.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createScoringSystem } from '../src/core/index.ts';
import type { MovementMode } from '../src/core/index.ts';

const MODES: readonly MovementMode[] = ['jumping', 'flight', 'zigzag', 'underwater'];
const modeArb = fc.constantFrom(...MODES);

/**
 * A pool of obstacle ids that duplicates are drawn from. Keeping the pool small
 * relative to the call count guarantees the generator exercises re-credit
 * attempts (the exactly-once latch) on nearly every run.
 */
const idPoolArb = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 6 }), { minLength: 1, maxLength: 8 })
  .map((ids) => ids as readonly string[]);

/** One replayed credit call: an id drawn from the pool and a random valid mode. */
interface Call {
  id: string;
  mode: MovementMode;
}

/** Build the arbitrary list of credit calls from a given id pool. */
const scenarioArb = idPoolArb.chain((pool) =>
  fc
    .array(
      fc.record({ id: fc.constantFrom(...pool), mode: modeArb }),
      { minLength: 0, maxLength: 60 },
    )
    .map((calls) => ({ pool, calls: calls as readonly Call[] })),
);

describe('Property 1: exactly-once, unit-valued scoring', () => {
  it('credits each distinct id exactly once at unit value; rejects all re-credits', () => {
    fc.assert(
      fc.property(scenarioArb, ({ calls }) => {
        const scoring = createScoringSystem(); // default multiplier === 1

        // Track which ids we have already seen a successful credit for, so we
        // know independently whether a given call should succeed or be rejected.
        const creditedSoFar = new Set<string>();

        for (const { id, mode } of calls) {
          const firstTimeForId = !creditedSoFar.has(id);
          const result = scoring.credit(id, mode);

          if (firstTimeForId) {
            // First successful credit for this id: a unit-valued event.
            expect(result).not.toBeNull();
            const event = result!;
            expect(event.obstacleId).toBe(id);
            expect(event.mode).toBe(mode);
            // Unit-valued under multiplier 1 (Req 2.4, 3.4, 4.3, 5.4).
            expect(event.baseValue).toBe(1);
            expect(event.multiplierAtCredit).toBe(1);
            expect(event.creditedValue).toBe(1);
            creditedSoFar.add(id);
          } else {
            // Exactly-once latch: every re-credit is rejected (Req 9.1, 9.6).
            expect(result).toBeNull();
          }

          // The latch is observable immediately after the first credit.
          expect(scoring.hasCredited(id)).toBe(true);
        }

        // After replaying all calls: one unit per distinct id, nothing more.
        const distinct = creditedSoFar.size;
        expect(scoring.creditedCount()).toBe(distinct);
        // current() === number of distinct ids credited (each worth exactly 1).
        expect(scoring.current()).toBe(distinct);
      }),
      { numRuns: 200 },
    );
  });

  it('re-crediting an already-cleared id never changes the running total', () => {
    // A focused companion: drive many repeated credits of the SAME id and assert
    // the total is pinned at 1 regardless of how many times (or with which mode)
    // we retry — the sharpest statement of the one-way latch (Req 9.1, 9.6).
    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 6 }),
        fc.array(modeArb, { minLength: 1, maxLength: 40 }),
        (id, modes) => {
          const scoring = createScoringSystem();
          modes.forEach((mode, i) => {
            const result = scoring.credit(id, mode);
            if (i === 0) {
              expect(result).not.toBeNull();
              expect(result!.creditedValue).toBe(1);
            } else {
              expect(result).toBeNull();
            }
            // Total is unit-valued and pinned from the first credit onward.
            expect(scoring.current()).toBe(1);
            expect(scoring.creditedCount()).toBe(1);
          });
        },
      ),
      { numRuns: 200 },
    );
  });
});

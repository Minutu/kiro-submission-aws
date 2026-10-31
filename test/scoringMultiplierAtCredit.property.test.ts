// Feature: kino-game, Property 3: Multiplier applied at credit time
//
// Validates: Requirements 9.4, 17.1
//
// Property 3 proves that the ScoringSystem snapshots the active score
// multiplier AT THE INSTANT OF CREDIT — not an earlier or later value, and
// never retroactively. The ScoreMultiplier skill (Req 17.1) drives a live
// multiplier through an injected getter; the design (Req 9.4) requires each
// ScoringEvent to carry `multiplierAtCredit` read at that moment and
// `creditedValue = baseValue(=1) * multiplierAtCredit`.
//
// Test strategy (per the task): a mutable multiplier lives in a closure
// variable; `multiplierSource` returns its current value. For an arbitrary
// sequence of credits we CHANGE that variable between credits to random valid
// positive values, then assert, for every emitted event, that
// `multiplierAtCredit` equals the value that was active at the instant of THAT
// credit — and that the running total equals the sum of those per-credit
// multiplier values (base 1). If the system read the multiplier early, late, or
// retroactively, these assertions would break.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createScoringSystem } from '../src/core/index.ts';

// A valid, positive multiplier. We mix integers and doubles so the snapshot is
// exercised across both (e.g. a 2x skill, or any config-driven factor > 0).
const multiplierArb = fc.oneof(
  fc.integer({ min: 1, max: 5 }),
  fc.double({ min: 0.25, max: 5, noNaN: true, minExcluded: false }),
);

// One credit step: the multiplier value to make active just before crediting,
// and the obstacle id to credit. Ids are made unique per-sequence below so the
// exactly-once latch never rejects a credit (that concern belongs to Property
// 1, not this one).
const stepArb = fc.record({
  multiplier: multiplierArb,
  // A suffix to diversify ids; uniqueness is enforced by prefixing the index.
  tag: fc.string({ maxLength: 4 }),
});

const sequenceArb = fc.array(stepArb, { minLength: 1, maxLength: 60 });

describe('Property 3: multiplier applied at credit time', () => {
  it('snapshots the multiplier active at the instant of each credit (base 1) and totals them', () => {
    fc.assert(
      fc.property(sequenceArb, (steps) => {
        // The live multiplier, driven between credits like the ScoreMultiplier
        // skill would. The source reads THIS variable each time it is called.
        let liveMultiplier = 1;
        const scoring = createScoringSystem({
          multiplierSource: () => liveMultiplier,
        });

        let expectedTotal = 0;

        steps.forEach((step, i) => {
          // Change the active multiplier BEFORE this credit. The value active at
          // the instant of the credit is `step.multiplier`.
          liveMultiplier = step.multiplier;

          const obstacleId = `o${i}-${step.tag}`;
          const event = scoring.credit(obstacleId, 'jumping');

          // Every credit here is a fresh id with a valid positive multiplier, so
          // it must succeed (not be rejected).
          expect(event).not.toBeNull();
          if (event === null) return;

          // The snapshot must equal the value active at THIS credit — not the
          // previous one and not a later one.
          expect(event.multiplierAtCredit).toBe(step.multiplier);
          // Base value is always the unit 1; credited value is the product.
          expect(event.baseValue).toBe(1);
          expect(event.creditedValue).toBe(1 * step.multiplier);

          expectedTotal += 1 * step.multiplier;
        });

        // The running total equals the sum of per-credit multipliers at their
        // respective credit times — proving no retroactive re-application when
        // the multiplier later changed.
        expect(scoring.current()).toBeCloseTo(expectedTotal, 9);
      }),
      { numRuns: 200 },
    );
  });

  it('changing the multiplier after a credit never alters already-credited events or the total', () => {
    fc.assert(
      fc.property(
        multiplierArb,
        multiplierArb,
        multiplierArb,
        (firstM, laterM, evenLaterM) => {
          let liveMultiplier = firstM;
          const scoring = createScoringSystem({
            multiplierSource: () => liveMultiplier,
          });

          // Credit one obstacle at the first multiplier.
          const event = scoring.credit('obstacle-1', 'flight');
          expect(event).not.toBeNull();
          if (event === null) return;
          expect(event.multiplierAtCredit).toBe(firstM);

          const totalAfterFirst = scoring.current();
          expect(totalAfterFirst).toBeCloseTo(firstM, 9);

          // Now change the live multiplier repeatedly. Nothing about the
          // already-credited event or the running total may change — the
          // multiplier is applied at credit time, not retroactively (Req 9.4).
          liveMultiplier = laterM;
          expect(scoring.current()).toBeCloseTo(totalAfterFirst, 9);
          expect(event.multiplierAtCredit).toBe(firstM);

          liveMultiplier = evenLaterM;
          expect(scoring.current()).toBeCloseTo(totalAfterFirst, 9);
          expect(event.multiplierAtCredit).toBe(firstM);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Feature: kino-game
//
// Property tests for the pure fixed-timestep driver (design: "The fixed-timestep
// driver"; Req 26.2, 26.9, 9.1, 16.1). The driver is the deterministic clock
// the 11 correctness properties depend on, so its own invariants are proven
// across many random frame sequences here. These are driver-contract
// properties (not the numbered KINO correctness properties, which key on the
// simulation systems added in later tasks).

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createFixedTimestepDriver } from '../src/core/index.ts';

const FIXED = 1 / 120;

/** A frame: real delta seconds in a realistic range (0..~250 ms). */
const frameArb = fc.double({ min: 0, max: 0.25, noNaN: true });
const framesArb = fc.array(frameArb, { minLength: 0, maxLength: 200 });

describe('fixed-timestep driver (driver-contract properties)', () => {
  // The accumulator is always a valid carry: in [0, fixedDeltaS) after any step.
  it('keeps the accumulator within [0, fixedDeltaS) after every frame', () => {
    fc.assert(
      fc.property(framesArb, (frames) => {
        const d = createFixedTimestepDriver<void>();
        for (const dt of frames) {
          d.step(dt, undefined, () => {});
          const acc = d.getAccumulator();
          expect(acc).toBeGreaterThanOrEqual(0);
          expect(acc).toBeLessThan(FIXED + 1e-12);
        }
      }),
      { numRuns: 200 },
    );
  });

  // The callback count always matches the reported tick count, and no step
  // ever exceeds the catch-up cap (spiral-of-death guard, Req 26.9).
  it('invokes advance exactly `ticks` times and never exceeds the cap', () => {
    fc.assert(
      fc.property(
        framesArb,
        fc.integer({ min: 1, max: 8 }),
        (frames, cap) => {
          const d = createFixedTimestepDriver<void>({ maxCatchUpSteps: cap });
          for (const dt of frames) {
            let calls = 0;
            const r = d.step(dt, undefined, () => { calls += 1; });
            expect(calls).toBe(r.ticks);
            expect(r.ticks).toBeLessThanOrEqual(cap);
            expect(r.simulatedS).toBeCloseTo(r.ticks * FIXED, 9);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  // Determinism: the same option set and the same frame sequence always yield
  // the same sequence of tick counts. This is what makes the sim replayable.
  it('is deterministic across identical frame sequences', () => {
    fc.assert(
      fc.property(framesArb, (frames) => {
        const run = (): number[] => {
          const d = createFixedTimestepDriver<void>();
          return frames.map((dt) => d.step(dt, undefined, () => {}).ticks);
        };
        expect(run()).toEqual(run());
      }),
      { numRuns: 200 },
    );
  });

  // While frozen, no ticks run and the accumulator never changes, no matter
  // how large the delta (pause genuinely freezes the sim, Req 7.10 relation).
  it('runs zero ticks and preserves the accumulator while frozen', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 0.25, noNaN: true }), framesArb, (seed, frames) => {
        const d = createFixedTimestepDriver<void>();
        d.step(seed, undefined, () => {}); // seed some carry
        const before = d.getAccumulator();
        d.setFrozen(true);
        for (const dt of frames) {
          let calls = 0;
          const r = d.step(dt, undefined, () => { calls += 1; });
          expect(calls).toBe(0);
          expect(r.ticks).toBe(0);
        }
        expect(d.getAccumulator()).toBeCloseTo(before, 12);
      }),
      { numRuns: 200 },
    );
  });

  // Time Slow is a uniform scale: without a cap-clamp, feeding `dt * s` at
  // scale 1 advances the same total simulated time as feeding `dt` at scale s.
  it('time scale uniformly scales advanced time (Time Slow, Req 16.1)', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 0.1, max: 1, noNaN: true }),
        fc.array(fc.double({ min: 0, max: 0.05, noNaN: true }), { minLength: 1, maxLength: 60 }),
        (scale, frames) => {
          // Use a generous cap so neither run clamps (keeps the equivalence exact
          // up to one fixed step of in-flight accumulator).
          const scaled = createFixedTimestepDriver<void>({ maxCatchUpSteps: 1000, timeScale: scale });
          const prescaled = createFixedTimestepDriver<void>({ maxCatchUpSteps: 1000 });
          let simA = 0;
          let simB = 0;
          for (const dt of frames) {
            simA += scaled.step(dt, undefined, () => {}).simulatedS;
            simB += prescaled.step(dt * scale, undefined, () => {}).simulatedS;
          }
          // Totals match within one fixed step (residue lives in the accumulators).
          expect(Math.abs(simA - simB)).toBeLessThan(FIXED + 1e-9);
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Feature: kino-game
//
// Sample PROPERTY test — proves the fast-check harness runs with the project's
// property-testing library at 100+ iterations. The real 11 correctness
// properties are added against the simulation core in later tasks; this sample
// only demonstrates the harness and the tagging convention.

import { describe, it } from 'vitest';
import fc from 'fast-check';

/** Pure helper under test: clamp a value into an inclusive range. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

// Each property test is tagged per the KINO convention:
//   // Feature: kino-game, Property {n}: {text}
// This sample uses a placeholder index; numbered correctness properties
// (Property 1..11) are introduced in the simulation-core tasks.

describe('test harness (sample property)', () => {
  // Feature: kino-game, Property 0 (sample): clamp result is always within [min, max]
  it('clamp output always lies within the given bounds', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.integer(),
        fc.integer(),
        (a, b, v) => {
          const min = Math.min(a, b);
          const max = Math.max(a, b);
          const r = clamp(v, min, max);
          return r >= min && r <= max;
        },
      ),
      // Minimum of 100 iterations per KINO property-test convention.
      { numRuns: 200 },
    );
  });
});

// Feature: kino-game, Property 10: Zigzag direction alternation
//
// Validates: Requirements 4.1, 4.8.
//
// Req 4.1: WHILE Zigzag is active, each primary action reverses Kino's vertical
// direction between an upward and a downward diagonal of ~30°.
// Req 4.8: zigzag speed/angle come from the BalanceTable, and the diagonal
// velocity magnitude is `zigzagSpeed * sin(angle)` on the vertical axis.
//
// System under test: createMovementStateMachine(balance, { mode: 'zigzag', ... })
// from src/core (barrel). The property proves, across random press counts and
// random positive dt sequences, that:
//   1. Each applyPrimary() flips diagonalDir to the opposite value.
//   2. N presses alternate strictly — after k presses diagonalDir equals the
//      start direction when k is even and the opposite when k is odd.
//   3. After step(dt) the vy sign matches diagonalDir (y-DOWN: 'up' => vy < 0,
//      'down' => vy > 0) and |vy| == zigzagSpeed * sin(angle) within tolerance.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createMovementStateMachine,
  type VerticalDir,
} from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

/** The opposite leg of a zigzag diagonal. */
function opposite(dir: VerticalDir): VerticalDir {
  return dir === 'up' ? 'down' : 'up';
}

describe('Property 10: Zigzag direction alternation', () => {
  it('each primary flips the diagonal, N presses alternate strictly, and vy tracks the leg', () => {
    const startDirArb = fc.constantFrom<VerticalDir>('up', 'down');
    // Random number of primary presses over the run.
    const pressCountArb = fc.integer({ min: 0, max: 60 });
    // Random positive dt sequence (fixed-step-ish range, strictly > 0).
    const dtArb = fc.double({ min: 1e-4, max: 0.25, noNaN: true });

    fc.assert(
      fc.property(
        startDirArb,
        pressCountArb,
        fc.array(dtArb, { minLength: 1, maxLength: 60 }),
        (startDir, pressCount, dts) => {
          // Fresh balance table (defaults) is the single source of zigzag
          // speed/angle (Req 4.8) — no hardcoded constants in the test.
          const balance = createBalanceTable();
          const speed = balance.zigzagSpeed();
          const angleRad = (balance.zigzagAngleDeg() * Math.PI) / 180;
          const expectedMag = speed * Math.sin(angleRad);

          const m = createMovementStateMachine(balance, {
            mode: 'zigzag',
            diagonalDir: startDir,
          });

          // Sanity: starts in zigzag on the requested leg.
          expect(m.active()).toBe('zigzag');
          expect(m.state().diagonalDir).toBe(startDir);

          // Each applyPrimary() flips the leg; strict alternation holds so that
          // after k presses the leg is startDir when k is even, opposite when
          // k is odd (Req 4.1).
          for (let k = 1; k <= pressCount; k += 1) {
            m.applyPrimary();
            const expectedDir =
              k % 2 === 0 ? startDir : opposite(startDir);
            expect(m.state().diagonalDir).toBe(expectedDir);
          }

          const finalDir =
            pressCount % 2 === 0 ? startDir : opposite(startDir);
          expect(m.state().diagonalDir).toBe(finalDir);

          // After each step(dt) the diagonal leg is unchanged (reversal only
          // happens on a primary press), the vy sign matches the leg, and the
          // magnitude equals zigzagSpeed * sin(angle) within tolerance (Req 4.8).
          for (const dt of dts) {
            const s = m.step(dt);
            expect(s.diagonalDir).toBe(finalDir);
            if (finalDir === 'up') {
              expect(s.vy).toBeLessThan(0); // y-DOWN: up is negative
            } else {
              expect(s.vy).toBeGreaterThan(0); // down is positive
            }
            expect(Math.abs(s.vy)).toBeCloseTo(expectedMag, 6);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

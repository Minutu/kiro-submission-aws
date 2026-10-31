// Feature: kino-game, Property 5: Water-surface gating of Underwater↔Flight
//
// Property-based test for the water-surface gating of the Underwater↔Flight
// Movement_Mode pair (design: "Movement & Sequence System > Water-surface
// gating"; Req 5.9, 5.10, 6.9, 6.10, 6.11).
//
// **Validates: Requirements 5.9, 5.10, 6.9, 6.10, 6.11**
//
// The property under test is a strict BICONDITIONAL on the Underwater↔Flight
// pair: a transition between those two modes is permitted/performed IF AND ONLY
// IF the water-surface crossing event fired that step
// (`ctx.waterSurfaceCrossed === true`).
//
//   • When the crossing event fired   → the swap is permitted and performed;
//     the active mode changes to the other side of the pair (Req 5.9, 6.9, 6.10).
//   • When the crossing event did NOT  → the machine keeps the current mode and
//     performs no transition (Req 5.10, 6.11).
//
// For EVERY OTHER (non-water) pair — e.g. flight↔zigzag, jumping↔flight,
// jumping↔zigzag — `canTransition` is NOT gated on the crossing event: it
// returns true regardless of the flag. Scheduling such boundaries is the
// SequenceDirector's job, not the gate's.
//
// We drive the single authority (`MovementStateMachine`) over arbitrary start
// modes, target modes, and a randomly varying `waterSurfaceCrossed` flag, and
// assert the biconditional holds on every single step. We additionally exercise
// the gated `requestTransition` PATH (consult `canTransition`, only swap when it
// permits) and confirm `active()` changed exactly when the flag was true for the
// water pair. Finally we cross-check the SequenceDirector's own water gating:
// its `requestTransition` refuses the Underwater↔Flight swap without the event
// and performs it with the event.
//
// Pure TypeScript, no Phaser. Uses the documented default BalanceTable.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createMovementStateMachine,
  createSequenceDirector,
  type MovementMode,
} from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

const MODES: readonly MovementMode[] = ['jumping', 'flight', 'zigzag', 'underwater'];
const modeArb = fc.constantFrom<MovementMode>(...MODES);

/** The water-gated pair is exactly {underwater, flight} as a transition pair. */
function isWaterPair(from: MovementMode, to: MovementMode): boolean {
  return (
    (from === 'underwater' && to === 'flight') ||
    (from === 'flight' && to === 'underwater')
  );
}

describe('MovementStateMachine — Property 5: water-surface gating of Underwater↔Flight', () => {
  it('canTransition is the exact biconditional with waterSurfaceCrossed for the water pair, and ungated for every other pair', () => {
    fc.assert(
      fc.property(
        modeArb, // start mode (any of the four entry points)
        modeArb, // target mode (any, including no-op same-mode)
        fc.boolean(), // the randomly varying water-surface crossing flag
        (start, to, waterSurfaceCrossed) => {
          const balance = createBalanceTable();
          const m = createMovementStateMachine(balance, { mode: start });

          const permitted = m.canTransition(to, { waterSurfaceCrossed });

          if (to === start) {
            // A no-op transition to the already-active mode is always allowed,
            // regardless of the flag (never gated).
            expect(permitted).toBe(true);
            return;
          }

          if (isWaterPair(start, to)) {
            // THE biconditional: permitted  ⇔  the crossing event fired this
            // step (Req 5.9, 5.10, 6.9, 6.10, 6.11).
            expect(permitted).toBe(waterSurfaceCrossed === true);
          } else {
            // Non-water pair: the gate does NOT depend on the crossing flag.
            // It permits the pair for BOTH flag values (scheduling is the
            // director's concern, not the gate's).
            expect(permitted).toBe(true);
            // And it is genuinely flag-independent: flipping the flag changes
            // nothing for a non-water pair.
            expect(m.canTransition(to, { waterSurfaceCrossed: !waterSurfaceCrossed })).toBe(
              true,
            );
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('the gated requestTransition PATH changes active() for the water pair IF AND ONLY IF the crossing event fired', () => {
    fc.assert(
      fc.property(
        // Start specifically on one side of the water pair so every run
        // exercises a real Underwater↔Flight attempt.
        fc.constantFrom<MovementMode>('flight', 'underwater'),
        fc.boolean(),
        (start, waterSurfaceCrossed) => {
          const balance = createBalanceTable();
          const m = createMovementStateMachine(balance, { mode: start });
          const other: MovementMode = start === 'flight' ? 'underwater' : 'flight';

          // The gated path: only swap when canTransition permits it.
          const ctx = { waterSurfaceCrossed };
          if (m.canTransition(other, ctx)) {
            m.requestTransition(other);
          }

          if (waterSurfaceCrossed) {
            // Event fired → the swap happened; active() is now the other side.
            expect(m.active()).toBe(other);
          } else {
            // Event did not fire → current mode kept, no transition (Req 5.10, 6.11).
            expect(m.active()).toBe(start);
          }
          // Single-active is never violated by the gated path.
          expect(m.activeModes().size).toBe(1);
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a long random sequence of water-pair attempts tracks the flag exactly each step', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<MovementMode>('flight', 'underwater'),
        fc.array(fc.boolean(), { minLength: 0, maxLength: 200 }),
        (start, flags) => {
          const balance = createBalanceTable();
          const m = createMovementStateMachine(balance, { mode: start });

          for (const waterSurfaceCrossed of flags) {
            const current = m.active();
            const other: MovementMode = current === 'flight' ? 'underwater' : 'flight';
            const expected = waterSurfaceCrossed ? other : current;

            const permitted = m.canTransition(other, { waterSurfaceCrossed });
            // Biconditional holds on every step of the sequence.
            expect(permitted).toBe(waterSurfaceCrossed === true);
            if (permitted) m.requestTransition(other);

            // active() ends this step exactly where the flag dictates.
            expect(m.active()).toBe(expected);
            expect(m.activeModes().size).toBe(1);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('SequenceDirector water gating: requestTransition refuses the Underwater↔Flight swap without the event, performs it with it', () => {
    fc.assert(
      fc.property(
        fc.constantFrom<MovementMode>('flight', 'underwater'),
        fc.boolean(),
        (start, waterSurfaceCrossed) => {
          const balance = createBalanceTable();
          const other: MovementMode = start === 'flight' ? 'underwater' : 'flight';
          const machine = createMovementStateMachine(balance, { mode: start });
          // A two-entry water-gated plan so `other` is a reachable boundary.
          const dir = createSequenceDirector(
            [{ mode: start }, { mode: other }],
            balance,
            { machine },
          );

          const performed = dir.requestTransition(other, { waterSurfaceCrossed });

          // Director's gate mirrors the biconditional (Req 6.9-6.11).
          expect(performed).toBe(waterSurfaceCrossed === true);
          if (waterSurfaceCrossed) {
            expect(dir.currentMode()).toBe(other);
            expect(machine.active()).toBe(other);
          } else {
            expect(dir.currentMode()).toBe(start);
            expect(machine.active()).toBe(start);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Feature: kino-game, Property 4: Exactly one active Movement_Mode per Sequence
//
// Property-based test for the MovementStateMachine single-active invariant
// (design: "Movement_Mode state machine"; Req 4.5, 4.6, 5.6, 5.7, 8.4, 8.5).
//
// **Validates: Requirements 4.5, 4.6, 5.6, 5.7, 8.4, 8.5**
//
// The invariant under test: across ANY sequence of operations — random
// `requestTransition` calls to any of the four modes, interleaved with
// `applyPrimary` and `step(dt)` with random positive dt — `activeModes()`
// ALWAYS returns a set of size exactly 1, and `active()` is always a member of
// that set. No sequence of environment-forced transitions can ever produce
// zero or two simultaneously-active modes (Req 4.5-4.6 transition atomicity,
// 5.6-5.7 Underwater/Flight, 8.4-8.5 "exactly one active per Sequence").
//
// Both water-gated paths are exercised: transitions issued directly via
// `requestTransition` (the machine enforces single-active regardless of the
// water gate) and transitions gated through `canTransition` with a random
// `waterSurfaceCrossed` context. The single-active invariant must hold in
// every case.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createMovementStateMachine,
  ALL_MODES,
  type MovementMode,
  type MovementStateMachine,
} from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

const MODES: readonly MovementMode[] = ['jumping', 'flight', 'zigzag', 'underwater'];

/** A mode to target in a transition. */
const modeArb = fc.constantFrom<MovementMode>(...MODES);

/** A positive, finite fixed-step delta in a realistic range. */
const dtArb = fc.double({ min: 1e-4, max: 0.1, noNaN: true });

/**
 * One operation in a random sequence. Covers every mutator on the machine plus
 * both ways of driving a transition:
 *  - requestDirect: call requestTransition(to) unconditionally (machine still
 *    enforces single-active even when the water gate would reject).
 *  - requestGated:  consult canTransition(to, ctx) and only transition when it
 *    permits, with a random waterSurfaceCrossed flag.
 *  - primary:       applyPrimary(ctx) with a random water context.
 *  - step:          step(dt) with a random positive dt.
 */
type Op =
  | { kind: 'requestDirect'; to: MovementMode }
  | { kind: 'requestGated'; to: MovementMode; waterSurfaceCrossed: boolean }
  | { kind: 'primary'; waterSurfaceCrossed: boolean }
  | { kind: 'step'; dt: number };

const opArb: fc.Arbitrary<Op> = fc.oneof(
  modeArb.map((to) => ({ kind: 'requestDirect', to }) as Op),
  fc
    .record({ to: modeArb, waterSurfaceCrossed: fc.boolean() })
    .map((r) => ({ kind: 'requestGated', ...r }) as Op),
  fc.boolean().map((waterSurfaceCrossed) => ({ kind: 'primary', waterSurfaceCrossed }) as Op),
  dtArb.map((dt) => ({ kind: 'step', dt }) as Op),
);

const opsArb = fc.array(opArb, { minLength: 0, maxLength: 200 });

/** Assert the single-active invariant on the current machine state. */
function assertSingleActive(m: MovementStateMachine): void {
  const active = m.activeModes();
  // Exactly one active mode — never zero, never two (Req 8.4-8.5, 4.5-4.6, 5.6-5.7).
  expect(active.size).toBe(1);
  // active() is always a member of the active set.
  expect(active.has(m.active())).toBe(true);
  // And it is one of the four known modes (no phantom/undefined mode).
  expect(ALL_MODES).toContain(m.active());
}

describe('MovementStateMachine — Property 4: exactly one active Movement_Mode per Sequence', () => {
  it('maintains exactly one active mode after every operation in an arbitrary sequence', () => {
    fc.assert(
      fc.property(
        // Start from any of the four modes so the invariant is proven from
        // every entry point, not just the default.
        modeArb,
        opsArb,
        (startMode, ops) => {
          const balance = createBalanceTable();
          const m = createMovementStateMachine(balance, { mode: startMode });

          // Invariant holds at construction (before any operation).
          assertSingleActive(m);

          for (const op of ops) {
            switch (op.kind) {
              case 'requestDirect':
                // Direct transition: machine must enforce single-active even
                // without the water gate (Req 4.5-4.6, 5.6-5.7, 8.4-8.5).
                m.requestTransition(op.to);
                break;
              case 'requestGated':
                // Gated path: only transition when canTransition permits.
                if (m.canTransition(op.to, { waterSurfaceCrossed: op.waterSurfaceCrossed })) {
                  m.requestTransition(op.to);
                }
                break;
              case 'primary':
                m.applyPrimary({ waterSurfaceCrossed: op.waterSurfaceCrossed });
                break;
              case 'step':
                m.step(op.dt);
                break;
            }

            // The invariant must hold after EVERY operation, not just at the end.
            assertSingleActive(m);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

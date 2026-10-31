// Feature: kino-game
//
// Property test for the ScoringSystem's attribution guarantee (design:
// "Collision & Scoring > Scoring_Event mechanism"; Req 9.2, 9.3).
//
// Req 9.2: when an Obstacle/checkpoint is cleared, the Scoring_Event is
//   attributed to the Movement_Mode that was active at the moment of clearing.
// Req 9.3: a Scoring_Event attributed to a Movement_Mode other than the one
//   active at the moment of clearing is an invalid scoring result — the system
//   must reject it (never emit a wrong-mode event).
//
// We model "the active mode at clearing" as the `mode` argument passed to
// credit() for a given obstacle id (the credit call IS the moment of clearing).
// The property then asserts the emitted event's `mode` exactly equals the mode
// supplied, over arbitrary sequences of unique-id/valid-mode pairs; and that an
// invalid mode value is rejected (null) without moving the running total.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { createScoringSystem } from '../src/core/index.ts';
import type { MovementMode } from '../src/core/index.ts';

/** The four valid Movement_Modes (the only modes a real credit carries). */
const VALID_MODES: readonly MovementMode[] = [
  'jumping',
  'flight',
  'zigzag',
  'underwater',
];

const validModeArb = fc.constantFrom(...VALID_MODES);

/** A sequence of (uniqueId, validMode) clearings. Ids unique via fc.uniqueArray. */
const clearingsArb = fc
  .uniqueArray(fc.string({ minLength: 1, maxLength: 12 }), {
    minLength: 0,
    maxLength: 50,
  })
  .chain((ids) =>
    fc.tuple(
      fc.constant(ids),
      fc.array(validModeArb, { minLength: ids.length, maxLength: ids.length }),
    ),
  )
  .map(([ids, modes]) =>
    ids.map((id, i) => ({ id, mode: modes[i] as MovementMode })),
  );

describe('ScoringSystem — attribution at clearing (Property 2)', () => {
  // Feature: kino-game, Property 2: Scoring attributed to the active mode at clearing
  it('attributes every successful event to the exact mode supplied at clearing (Req 9.2)', () => {
    fc.assert(
      fc.property(clearingsArb, (clearings) => {
        const scoring = createScoringSystem();
        for (const { id, mode } of clearings) {
          const event = scoring.credit(id, mode);
          // Each id is unique and each mode is valid, so every credit succeeds.
          expect(event).not.toBeNull();
          // Req 9.2: the event's attributed mode equals the mode active at the
          // moment of clearing (the mode passed to credit).
          expect(event?.mode).toBe(mode);
          expect(event?.obstacleId).toBe(id);
        }
      }),
      { numRuns: 200 },
    );
  });

  // Feature: kino-game, Property 2: Scoring attributed to the active mode at clearing
  it('rejects an invalid mode value and leaves the total unchanged (Req 9.3)', () => {
    // An arbitrary string that is NOT one of the four valid modes.
    const invalidModeArb = fc
      .string({ minLength: 0, maxLength: 16 })
      .filter((s) => !(VALID_MODES as readonly string[]).includes(s));

    fc.assert(
      fc.property(
        fc.string({ minLength: 1, maxLength: 12 }),
        invalidModeArb,
        (id, invalidMode) => {
          const scoring = createScoringSystem();
          const before = scoring.current();
          // Cast through unknown: callers can pass a bad runtime value; the
          // guard (Req 9.3) must reject it rather than emit a wrong-mode event.
          const result = scoring.credit(id, invalidMode as unknown as MovementMode);
          expect(result).toBeNull();
          expect(scoring.current()).toBe(before);
          expect(scoring.hasCredited(id)).toBe(false);
          expect(scoring.creditedCount()).toBe(0);
        },
      ),
      { numRuns: 200 },
    );
  });
});

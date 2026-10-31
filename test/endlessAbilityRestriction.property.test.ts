// Feature: kino-game, Property 9: Endless ability restriction
//
// Property-based test for the Endless_Mode ability allow-list restriction
// (design: "EndlessMode > Endless ability restriction (Req 23.7–23.8)";
// Req 23.7, 23.8).
//
// **Validates: Requirements 23.7, 23.8**
//
// The restriction under test: an Endless_Mode run of a completed world N can
// only ever present the movement abilities learned UP TO AND INCLUDING world N
// in STORY ORDER. An ability from a LATER world is STRUCTURALLY IMPOSSIBLE to
// appear — not merely "shouldn't", but cannot, because the endless sequence
// plan is drawn only from the allow-list and the SequenceDirector built from it
// can only schedule modes contained in that plan.
//
// Four facets of the property are asserted across arbitrary runs:
//
//   1. ALLOW-LIST IS THE STORY-ORDER PREFIX. For every endless-capable world
//      (1-4), `allowedEndlessModes(world)` equals exactly
//      `STORY_ABILITY_ORDER.slice(0, min(world, 4))` — no more, no less, in
//      story order.
//
//   2. PLAN CONTAINS ONLY ALLOWED MODES. `buildEndlessSequencePlan(world)`
//      references only modes in the allow-list, i.e.
//      `validateEndlessPlanModes(world, plan)` returns [] (clean) for every
//      endless-capable world.
//
//   3. THE DIRECTOR NEVER LEAVES THE ALLOW-LIST. A SequenceDirector built from
//      that endless plan, driven through an ARBITRARY sequence of ticks
//      (random positive scroll deltas, random `waterSurfaceCrossed` flags so
//      water-gated Underwater↔Flight boundaries may or may not fire), reports a
//      `currentMode()` inside the allow-list at construction AND after EVERY
//      tick. This is the structural guarantee: no later-world ability can
//      appear no matter how the run is driven.
//
//   4. THE VALIDATOR FLAGS SMUGGLED LATER-WORLD ABILITIES. For any mode NOT in
//      the allow-list (a later-world ability), `isEndlessModeAllowed` reports
//      it forbidden and `validateEndlessPlanModes` flags it when injected into
//      a plan — so a leak could never pass silently.
//
// Pure TypeScript, no Phaser. Uses the documented default BalanceTable and a
// modest `defaultBoundaryPx` so transitions resolve well within the tick budget.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  STORY_ABILITY_ORDER,
  allowedEndlessModes,
  allowedEndlessModeSet,
  isEndlessModeAllowed,
  validateEndlessPlanModes,
  buildEndlessSequencePlan,
  createSequenceDirector,
  type MovementMode,
  type WorldId,
  type SequenceSpec,
} from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

const ALL_MODES: readonly MovementMode[] = ['jumping', 'flight', 'zigzag', 'underwater'];

/** The endless-capable worlds (1-4); World 5 has no endless (Req 23.2). */
const endlessWorldArb = fc.constantFrom<WorldId>(1, 2, 3, 4);

/**
 * One tick's driving inputs: a positive scroll delta (so the director advances
 * toward boundaries within the budget) and a random water-surface crossing flag
 * (so water-gated Underwater↔Flight boundaries sometimes fire, sometimes hold).
 */
const tickArb = fc.record({
  delta: fc.double({ min: 1, max: 600, noNaN: true }),
  waterSurfaceCrossed: fc.boolean(),
});

/** The cumulative story-order prefix a world's allow-list must equal. */
function expectedAllowList(world: WorldId): MovementMode[] {
  return STORY_ABILITY_ORDER.slice(0, Math.min(world, 4));
}

describe('EndlessMode — Property 9: endless ability restriction', () => {
  it('allowedEndlessModes(world) is exactly the cumulative STORY_ABILITY_ORDER prefix', () => {
    fc.assert(
      fc.property(endlessWorldArb, (world) => {
        expect(allowedEndlessModes(world)).toEqual(expectedAllowList(world));
      }),
      { numRuns: 200 },
    );
  });

  it('buildEndlessSequencePlan(world) contains ONLY allow-list modes (validator returns [])', () => {
    fc.assert(
      fc.property(endlessWorldArb, (world) => {
        const plan = buildEndlessSequencePlan(world);
        const allowed = allowedEndlessModeSet(world);

        // No leaked modes per the structural validator.
        expect(validateEndlessPlanModes(world, plan)).toEqual([]);
        // And directly: every spec's mode is in the allow-list.
        for (const spec of plan) {
          expect(allowed.has(spec.mode)).toBe(true);
        }
        // The plan is non-empty and loops (endless).
        expect(plan.length).toBeGreaterThan(0);
        expect(plan.some((s) => s.loops === true)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('a SequenceDirector on the endless plan NEVER reports a mode outside the allow-list, across arbitrary ticks', () => {
    fc.assert(
      fc.property(
        endlessWorldArb,
        fc.array(tickArb, { minLength: 0, maxLength: 300 }),
        (world, ticks) => {
          const balance = createBalanceTable();
          const plan = buildEndlessSequencePlan(world);
          const allowed = allowedEndlessModeSet(world);

          // Modest boundary so transitions resolve within the tick budget
          // (telegraph lead defaults to 500px; 900px segments give clear room
          // for the telegraph + boundary to fire under the random deltas).
          const dir = createSequenceDirector(plan, balance, {
            defaultBoundaryPx: 900,
          });

          // Guarantee holds at construction (before any tick).
          expect(allowed.has(dir.currentMode())).toBe(true);

          // ...and after EVERY tick, regardless of deltas / water flags.
          for (const { delta, waterSurfaceCrossed } of ticks) {
            dir.tick(delta, { waterSurfaceCrossed });
            expect(allowed.has(dir.currentMode())).toBe(true);
          }
        },
      ),
      { numRuns: 200 },
    );
  });

  it('a mode NOT in the allow-list is forbidden and flagged when smuggled into a plan', () => {
    fc.assert(
      fc.property(
        endlessWorldArb,
        fc.constantFrom<MovementMode>(...ALL_MODES),
        (world, smuggled) => {
          const allowed = allowedEndlessModeSet(world);

          if (allowed.has(smuggled)) {
            // An allowed mode is reported allowed and never flagged.
            expect(isEndlessModeAllowed(world, smuggled)).toBe(true);
            const cleanPlan: SequenceSpec[] = [{ mode: smuggled, loops: true }];
            expect(validateEndlessPlanModes(world, cleanPlan)).toEqual([]);
            return;
          }

          // A later-world ability: forbidden, and flagged by the validator when
          // injected into an otherwise-legal plan.
          expect(isEndlessModeAllowed(world, smuggled)).toBe(false);

          const legalPlan = buildEndlessSequencePlan(world);
          const taintedPlan: SequenceSpec[] = [
            ...legalPlan.map((s) => ({ mode: s.mode })),
            { mode: smuggled, loops: true },
          ];
          const offenders = validateEndlessPlanModes(world, taintedPlan);
          expect(offenders).toContain(smuggled);
          // Only the smuggled mode is flagged (the legal prefix stays clean).
          expect(offenders).toEqual([smuggled]);
        },
      ),
      { numRuns: 200 },
    );
  });
});

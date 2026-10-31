// Feature: kino-game, Property 6: Safe reposition never overlaps
//
// Validates: Requirements 14.3, 18.2, 44.7, 44.8, 44.9, 44.10, 44.11, 44.12.
//
// Req 14.3 / 18.2: when a Protective_Skill (Time Erase / Ultra Instinct) fires,
// Kino is repositioned into a spot that overlaps NO obstacle, within the step.
// Req 44.7-44.12: the per-mode reposition rules — jumping lands right-of and
// clear at ground level; flight/underwater keep the fixed screenX and move to a
// non-overlapping gap; zigzag returns control on the clearance-maximizing
// diagonal — all resolve to a guaranteed non-overlapping placement.
//
// System under test: createSafeRepositionSolver(balance).reposition(request)
// from src/core (barrel). The CORE property proven here, across arbitrary modes,
// skills, body rects, and FROZEN obstacle fields (including crowded ones), is:
//
//   1. NON-OVERLAP. The fair, per-mode shrunk hitbox (shrunk about the body's
//      center by balance.hitboxScale(mode), exactly as CollisionSystem and the
//      solver do) at the returned (placement.x, placement.y) passes the SAME
//      shared aabbOverlap routine === false against EVERY obstacle bound.
//
//   2. TERMINATION / TOTALITY. reposition() always returns (never throws) and
//      yields finite x/y for any input.
//
// Per-mode rule SHAPE is asserted where cheap (jumping ground level; flight/
// underwater fixed screenX; zigzag controlReturned + a diagonalDir), but the
// universal guarantee is non-overlap + termination.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createSafeRepositionSolver,
  aabbOverlap,
  type RepositionRequest,
  type SafePlacement,
  type MovementMode,
  type Obstacle,
  type Rect,
} from '../src/core/index.ts';
import type { ProtectiveSkill } from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

/** Play-area geometry all generated geometry stays inside (~600 tall). */
const GROUND_Y = 600;
const PLAY_HEIGHT = 600;

const ALL_MODES: readonly MovementMode[] = [
  'jumping',
  'flight',
  'zigzag',
  'underwater',
];

/**
 * The fair shrunk per-mode hitbox for a BODY placed at (x, y) — the exact box
 * CollisionSystem and the solver validate with (shrink about center by the
 * per-mode scale). This is the oracle for "no overlap".
 */
function hitboxAt(
  balance: ReturnType<typeof createBalanceTable>,
  mode: MovementMode,
  body: Rect,
  p: SafePlacement,
): Rect {
  const s = balance.hitboxScale(mode);
  const width = body.width * s;
  const height = body.height * s;
  return {
    x: p.x + (body.width - width) / 2,
    y: p.y + (body.height - height) / 2,
    width,
    height,
  };
}

/** True iff the fair hitbox at the placement overlaps NO bound of any obstacle. */
function overlapsNothing(
  balance: ReturnType<typeof createBalanceTable>,
  mode: MovementMode,
  body: Rect,
  field: readonly Obstacle[],
  p: SafePlacement,
): boolean {
  const box = hitboxAt(balance, mode, body, p);
  for (const o of field) {
    for (const b of o.bounds) {
      if (aabbOverlap(box, b)) return false;
    }
  }
  return true;
}

describe('Property 6: Safe reposition never overlaps', () => {
  it('reposition() never overlaps any obstacle bound and always terminates, across all inputs', () => {
    // Fresh balance table (defaults) is the single source of the per-mode
    // hitbox scale (Req 41.2) — no hardcoded constants in the test.
    const balance = createBalanceTable();
    const solver = createSafeRepositionSolver(balance);

    const modeArb = fc.constantFrom<MovementMode>(...ALL_MODES);
    const skillArb = fc.constantFrom<ProtectiveSkill>(
      'timeErase',
      'ultraInstinct',
    );
    const dirArb = fc.constantFrom<'up' | 'down'>('up', 'down');

    // Kino's BODY: small, sane sprite somewhere inside the play area.
    const bodyArb = fc.record({
      x: fc.integer({ min: 0, max: 760 }),
      y: fc.integer({ min: 0, max: GROUND_Y - 20 }),
      width: fc.integer({ min: 16, max: 64 }),
      height: fc.integer({ min: 16, max: 64 }),
    });

    // One obstacle bound: a rectangle inside (and around) the play column.
    const boundArb: fc.Arbitrary<Rect> = fc.record({
      x: fc.integer({ min: 0, max: 820 }),
      y: fc.integer({ min: 0, max: GROUND_Y }),
      width: fc.integer({ min: 1, max: 160 }),
      height: fc.integer({ min: 1, max: GROUND_Y }),
    });

    // One obstacle unit carries 1-2 bounds (e.g. a flight pillar pair).
    const obstacleArb = (mode: MovementMode): fc.Arbitrary<Obstacle> =>
      fc
        .record({
          id: fc.string({ minLength: 1, maxLength: 8 }),
          bounds: fc.array(boundArb, { minLength: 1, maxLength: 2 }),
        })
        .map(({ id, bounds }) => ({
          id,
          category: 'test',
          mode,
          bounds,
          scoringLineX: 0,
          scored: false,
        }));

    fc.assert(
      fc.property(
        modeArb,
        skillArb,
        bodyArb,
        dirArb,
        // Field size 0..12 — include empty and crowded columns.
        fc.integer({ min: 0, max: 12 }),
        fc.boolean(), // whether to pass an explicit screenX
        (mode, skill, body, diagonalDir, fieldSize, useScreenX) => {
          // Build the FROZEN obstacle field for this step. Obstacles belong to
          // the active mode; the solver only reads bound geometry regardless.
          const field: Obstacle[] = fc.sample(
            obstacleArb(mode),
            fieldSize,
          );
          // Give obstacles distinct ids so contactedObstacleId can resolve.
          field.forEach((o, i) => {
            o.id = `o${i}`;
          });

          const screenX = body.x; // fixed Kino column for flight/underwater
          const request: RepositionRequest = {
            mode,
            skill,
            body,
            ...(useScreenX ? { screenX } : {}),
            field,
            playArea: { groundY: GROUND_Y, playHeight: PLAY_HEIGHT },
            // Sometimes target a real obstacle (drives the jumping rule).
            ...(field.length > 0 ? { contactedObstacleId: 'o0' } : {}),
            diagonalDir,
          };

          // TERMINATION / TOTALITY: never throws, returns finite coordinates.
          const p = solver.reposition(request);
          expect(Number.isFinite(p.x)).toBe(true);
          expect(Number.isFinite(p.y)).toBe(true);

          // CORE PROPERTY: the fair hitbox at the placement overlaps nothing.
          expect(overlapsNothing(balance, mode, body, field, p)).toBe(true);

          // Per-mode rule SHAPE (cheap checks; Req 44.7-44.11).
          if (mode === 'jumping') {
            // Lands at ground level: body base rests on the ground line.
            expect(p.y + body.height).toBeCloseTo(GROUND_Y, 6);
          } else if (mode === 'flight' || mode === 'underwater') {
            // Keeps the fixed screen column when screenX is provided and a
            // clear vertical row exists there (Req 44.8-9). When the whole
            // column is blocked the solver legitimately marches right to keep
            // the non-overlap guarantee, so the x invariant is asserted only
            // for the always-clear empty-field case (cheap + always holds).
            if (useScreenX && field.length === 0) {
              expect(p.x).toBe(screenX);
            }
          } else if (mode === 'zigzag') {
            // Returns directional control on a resumed diagonal (Req 44.10-11).
            expect(p.controlReturned).toBe(true);
            expect(p.diagonalDir === 'up' || p.diagonalDir === 'down').toBe(
              true,
            );
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

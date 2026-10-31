// Feature: kino-game
//
// Unit tests for the pure SafeRepositionSolver (design: "SAFE-REPOSITION
// ALGORITHM (hardest problem) — Req 14, 18, 44"). These pin the concrete
// per-mode placement rules (Req 44.7-44.11) and the two universal guarantees —
// the result overlaps no obstacle and the solver always terminates — using the
// SAME shared AABB routine the CollisionSystem uses (Req 44.13). The exhaustive
// across-all-inputs guarantee is Property 6 (task 5.7); here we nail examples
// and edge cases.

import { describe, it, expect } from 'vitest';
import {
  createSafeRepositionSolver,
  aabbOverlap,
  type RepositionRequest,
  type SafePlacement,
} from '../src/core/index.ts';
import type { MovementMode, Obstacle, Rect } from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

const balance = createBalanceTable();
const solver = createSafeRepositionSolver(balance);

/** Kino's body rect used across tests. */
const BODY: Rect = { x: 200, y: 260, width: 40, height: 40 };

const PLAY = { groundY: 600, playHeight: 600 };

/** Build an obstacle from bound rectangles. */
function obstacle(id: string, mode: MovementMode, bounds: Rect[]): Obstacle {
  return { id, category: 'test', mode, bounds, scoringLineX: 0, scored: false };
}

/** The fair shrunk hitbox for a placement, mirroring CollisionSystem. */
function hitboxAt(mode: MovementMode, body: Rect, p: SafePlacement): Rect {
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

/** Assert the placement overlaps no obstacle under the shared routine. */
function expectClear(
  mode: MovementMode,
  body: Rect,
  field: readonly Obstacle[],
  p: SafePlacement,
): void {
  const box = hitboxAt(mode, body, p);
  for (const o of field) {
    for (const b of o.bounds) {
      expect(aabbOverlap(box, b)).toBe(false);
    }
  }
}

describe('SafeRepositionSolver — jumping (Req 44.7)', () => {
  it('places the body directly right of and clear of the contacted obstacle, at ground level', () => {
    const wall = obstacle('w', 'jumping', [
      { x: 220, y: 540, width: 48, height: 60 },
    ]);
    const req: RepositionRequest = {
      mode: 'jumping',
      skill: 'timeErase',
      body: BODY,
      field: [wall],
      playArea: PLAY,
      contactedObstacleId: 'w',
    };
    const p = solver.reposition(req);

    // Directly to the RIGHT of the obstacle's right edge (x = 220+48 = 268).
    expect(p.x).toBeGreaterThanOrEqual(268);
    // At ground level: body base sits on the ground line.
    expect(p.y + BODY.height).toBeCloseTo(PLAY.groundY, 10);
    expectClear('jumping', BODY, [wall], p);
  });

  it('scans further right when the spot just past the obstacle is still crowded', () => {
    const field = [
      obstacle('a', 'jumping', [{ x: 220, y: 540, width: 48, height: 60 }]),
      // A second wall crowding immediately to the right of the first.
      obstacle('b', 'jumping', [{ x: 268, y: 540, width: 48, height: 60 }]),
    ];
    const req: RepositionRequest = {
      mode: 'jumping',
      skill: 'timeErase',
      body: BODY,
      field,
      playArea: PLAY,
      contactedObstacleId: 'a',
    };
    const p = solver.reposition(req);
    expect(p.x).toBeGreaterThanOrEqual(268 + 48);
    expectClear('jumping', BODY, field, p);
  });
});

describe('SafeRepositionSolver — flight/underwater nearest gap (Req 44.8-44.9)', () => {
  for (const mode of ['flight', 'underwater'] as const) {
    it(`${mode}: moves to the nearest non-overlapping gap center at fixed screenX`, () => {
      // A pillar pair at the body column: top from 0..260, bottom from 340..600.
      // The gap center is y=300; corridor is [260, 340].
      const pair = obstacle('p', mode, [
        { x: 190, y: 0, width: 64, height: 260 },
        { x: 190, y: 340, width: 64, height: 260 },
      ]);
      const req: RepositionRequest = {
        mode,
        skill: 'timeErase',
        body: BODY,
        screenX: 200,
        field: [pair],
        playArea: PLAY,
      };
      const p = solver.reposition(req);
      // x stays fixed at screenX.
      expect(p.x).toBe(200);
      // Body center lands in the corridor near the gap center (300).
      const centerY = p.y + BODY.height / 2;
      expect(centerY).toBeGreaterThan(260);
      expect(centerY).toBeLessThan(340);
      expectClear(mode, BODY, [pair], p);
    });
  }
});

describe('SafeRepositionSolver — zigzag (Req 44.10-44.11)', () => {
  it('sends Kino down when it nearly hit the top wall, returning control', () => {
    const req: RepositionRequest = {
      mode: 'zigzag',
      skill: 'timeErase',
      body: { ...BODY, y: 20 }, // high up, nearing the top wall
      screenX: 200,
      field: [],
      playArea: PLAY,
      diagonalDir: 'up',
    };
    const p = solver.reposition(req);
    expect(p.diagonalDir).toBe('down');
    expect(p.controlReturned).toBe(true);
    // Placed toward the bottom (away from the contacted top wall).
    expect(p.y).toBeGreaterThan(PLAY.groundY / 2);
    expectClear('zigzag', { ...BODY, y: 20 }, [], p);
  });

  it('sends Kino up when it nearly hit the bottom wall', () => {
    const body = { ...BODY, y: PLAY.groundY - BODY.height - 10 };
    const req: RepositionRequest = {
      mode: 'zigzag',
      skill: 'ultraInstinct',
      body,
      screenX: 200,
      field: [],
      playArea: PLAY,
      diagonalDir: 'down',
    };
    const p = solver.reposition(req);
    expect(p.diagonalDir).toBe('up');
    expect(p.controlReturned).toBe(true);
    expect(p.y).toBeLessThan(PLAY.groundY / 2);
  });
});

describe('SafeRepositionSolver — guarantees (Req 14.3, 18.2)', () => {
  it('never overlaps even in a heavily crowded flight column (fallback scan)', () => {
    // Nearly fill the column, leaving one thin clear band near the top.
    const field: Obstacle[] = [
      obstacle('fill', 'flight', [
        { x: 190, y: 60, width: 64, height: 540 },
      ]),
    ];
    const req: RepositionRequest = {
      mode: 'flight',
      skill: 'timeErase',
      body: BODY,
      screenX: 200,
      field,
      playArea: PLAY,
    };
    const p = solver.reposition(req);
    expectClear('flight', BODY, field, p);
  });

  it('terminates and returns a clear spot when the whole column is blocked (marches right)', () => {
    // A full-height wall across the column forces the horizontal fallback.
    const field: Obstacle[] = [
      obstacle('wall', 'flight', [{ x: 180, y: 0, width: 80, height: 600 }]),
    ];
    const req: RepositionRequest = {
      mode: 'flight',
      skill: 'timeErase',
      body: BODY,
      screenX: 200,
      field,
      playArea: PLAY,
    };
    const p = solver.reposition(req);
    expectClear('flight', BODY, field, p);
  });

  it('is pure: identical inputs yield identical placements', () => {
    const field = [obstacle('w', 'jumping', [{ x: 220, y: 540, width: 48, height: 60 }])];
    const req: RepositionRequest = {
      mode: 'jumping',
      skill: 'timeErase',
      body: BODY,
      field,
      playArea: PLAY,
      contactedObstacleId: 'w',
    };
    expect(solver.reposition(req)).toEqual(solver.reposition(req));
  });

  it('handles an empty field (any placement is trivially clear)', () => {
    const req: RepositionRequest = {
      mode: 'underwater',
      skill: 'timeErase',
      body: BODY,
      screenX: 200,
      field: [],
      playArea: PLAY,
    };
    const p = solver.reposition(req);
    expectClear('underwater', BODY, [], p);
  });
});

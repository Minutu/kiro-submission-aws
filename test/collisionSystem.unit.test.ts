// Feature: kino-game
//
// Unit tests for the pure CollisionSystem (design: "Consistent, fair hitboxes
// (Req 26.7, 41)"). These pin the concrete contract: the shared AABB routine,
// the per-mode center-shrunk body-only hitbox (Req 41.1-41.2), the single
// shared overlap test used in every mode (Req 26.7, 41.3), and structural
// exclusion of cosmetic layers (Req 41.4-41.5, 44.13).

import { describe, it, expect } from 'vitest';
import {
  createCollisionSystem,
  aabbOverlap,
  type KinoBody,
} from '../src/core/index.ts';
import type { MovementMode, Obstacle, Rect } from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

const MODES: MovementMode[] = ['jumping', 'flight', 'zigzag', 'underwater'];

/** Build an obstacle with the given bound rectangles. */
function obstacle(id: string, bounds: Rect[]): Obstacle {
  return {
    id,
    category: 'test',
    mode: 'jumping',
    bounds,
    scoringLineX: 0,
    scored: false,
  };
}

describe('aabbOverlap', () => {
  const base: Rect = { x: 0, y: 0, width: 10, height: 10 };

  it('detects clearly overlapping rectangles', () => {
    expect(aabbOverlap(base, { x: 5, y: 5, width: 10, height: 10 })).toBe(true);
  });

  it('reports no overlap when separated on the x axis', () => {
    expect(aabbOverlap(base, { x: 20, y: 0, width: 10, height: 10 })).toBe(false);
  });

  it('reports no overlap when separated on the y axis', () => {
    expect(aabbOverlap(base, { x: 0, y: 20, width: 10, height: 10 })).toBe(false);
  });

  it('treats edge-touching as non-overlap (strict, fair at the boundary)', () => {
    // Right edge of base (x=10) exactly meets left edge of the other.
    expect(aabbOverlap(base, { x: 10, y: 0, width: 10, height: 10 })).toBe(false);
    // Bottom edge of base (y=10) exactly meets top edge of the other.
    expect(aabbOverlap(base, { x: 0, y: 10, width: 10, height: 10 })).toBe(false);
  });

  it('is symmetric in its arguments', () => {
    const b: Rect = { x: 3, y: 3, width: 4, height: 4 };
    expect(aabbOverlap(base, b)).toBe(aabbOverlap(b, base));
  });

  it('detects containment (one rect fully inside the other)', () => {
    expect(aabbOverlap(base, { x: 2, y: 2, width: 2, height: 2 })).toBe(true);
  });
});

describe('CollisionSystem.hitbox — per-mode fair scaling (Req 41.1-41.2)', () => {
  const body: KinoBody = { x: 100, y: 100, width: 40, height: 60 };

  it('shrinks the body about its center by the configured per-mode scale', () => {
    const balance = createBalanceTable();
    const sys = createCollisionSystem(body, balance);

    for (const mode of MODES) {
      const scale = balance.hitboxScale(mode);
      const box = sys.hitbox(mode);

      // Smaller than the rendered body (fair, scale < 1).
      expect(scale).toBeLessThan(1);
      expect(box.width).toBeCloseTo(body.width * scale, 10);
      expect(box.height).toBeCloseTo(body.height * scale, 10);

      // Centered shrink: same center point as the body, no edge favored.
      const bodyCx = body.x + body.width / 2;
      const bodyCy = body.y + body.height / 2;
      expect(box.x + box.width / 2).toBeCloseTo(bodyCx, 10);
      expect(box.y + box.height / 2).toBeCloseTo(bodyCy, 10);

      // The hitbox sits strictly inside the rendered body bounds.
      expect(box.x).toBeGreaterThan(body.x);
      expect(box.y).toBeGreaterThan(body.y);
      expect(box.x + box.width).toBeLessThan(body.x + body.width);
      expect(box.y + box.height).toBeLessThan(body.y + body.height);
    }
  });

  it('reflects the per-mode scale differences from balance', () => {
    const balance = createBalanceTable();
    const sys = createCollisionSystem(body, balance);
    // flight/underwater default 0.68 < jumping 0.72 < zigzag 0.75.
    expect(sys.hitbox('flight').width).toBeLessThan(sys.hitbox('jumping').width);
    expect(sys.hitbox('jumping').width).toBeLessThan(sys.hitbox('zigzag').width);
  });

  it('is immune to later mutation of the caller body object (pure)', () => {
    const mutable: KinoBody = { x: 0, y: 0, width: 40, height: 40 };
    const sys = createCollisionSystem(mutable, createBalanceTable());
    const before = sys.hitbox('jumping');
    mutable.x = 9999;
    mutable.width = 1;
    const after = sys.hitbox('jumping');
    expect(after).toEqual(before);
  });
});

describe('CollisionSystem.check — shared routine, body-only basis', () => {
  const body: KinoBody = { x: 100, y: 100, width: 40, height: 40 };
  const balance = createBalanceTable();

  it('registers a collision when an obstacle overlaps the body hitbox', () => {
    const sys = createCollisionSystem(body, balance);
    const box = sys.hitbox('jumping');
    // An obstacle sitting right on the hitbox center overlaps.
    const o = obstacle('o1', [
      { x: box.x + 1, y: box.y + 1, width: 5, height: 5 },
    ]);
    const result = sys.check([o], 'jumping');
    expect(result.collided).toBe(true);
    expect(result.obstacleId).toBe('o1');
  });

  it('returns no collision when nothing overlaps', () => {
    const sys = createCollisionSystem(body, balance);
    const o = obstacle('o1', [{ x: 10000, y: 10000, width: 5, height: 5 }]);
    const result = sys.check([o], 'jumping');
    expect(result.collided).toBe(false);
    expect(result.obstacleId).toBeNull();
  });

  it('checks every bound rectangle of a multi-bound obstacle (Req 9.6)', () => {
    const sys = createCollisionSystem(body, balance);
    const box = sys.hitbox('flight');
    const o = obstacle('pillars', [
      { x: 10000, y: 10000, width: 5, height: 5 }, // far away
      { x: box.x + 1, y: box.y + 1, width: 3, height: 3 }, // overlaps
    ]);
    expect(sys.check([o], 'flight').collided).toBe(true);
  });

  it('returns the first overlapping obstacle id', () => {
    const sys = createCollisionSystem(body, balance);
    const box = sys.hitbox('jumping');
    const hit: Rect = { x: box.x + 1, y: box.y + 1, width: 3, height: 3 };
    const first = obstacle('first', [hit]);
    const second = obstacle('second', [hit]);
    expect(sys.check([first, second], 'jumping').obstacleId).toBe('first');
  });

  it('uses the same overlap routine across all modes (Req 26.7, 41.3)', () => {
    // A fixed obstacle placed just outside the LARGEST hitbox (zigzag, 0.75)
    // must not collide in any mode; one inside the SMALLEST (flight, 0.68)
    // must collide in every mode.
    const sys = createCollisionSystem(body, balance);

    const smallest = sys.hitbox('flight');
    const inside: Rect = {
      x: smallest.x + smallest.width / 2 - 1,
      y: smallest.y + smallest.height / 2 - 1,
      width: 2,
      height: 2,
    };
    for (const mode of MODES) {
      expect(sys.check([obstacle('in', [inside])], mode).collided).toBe(true);
    }

    const largest = sys.hitbox('zigzag');
    const outside: Rect = {
      x: largest.x + largest.width + 1,
      y: largest.y,
      width: 2,
      height: 2,
    };
    for (const mode of MODES) {
      expect(sys.check([obstacle('out', [outside])], mode).collided).toBe(false);
    }
  });

  it('does NOT collide when only a cosmetic would overlap (Req 41.4-41.5, 44.13)', () => {
    // KinoBody has no cosmetic field — exclusion is structural. Model a hat
    // that overlaps an obstacle in a region the body hitbox never reaches:
    // the obstacle sits beyond the body's rendered bounds entirely.
    const sys = createCollisionSystem(body, balance);
    const cosmeticOnlyObstacle = obstacle('hat-only', [
      // Above the body (where a hat would render), not overlapping the body.
      { x: body.x, y: body.y - 30, width: body.width, height: 20 },
    ]);
    const result = sys.check([cosmeticOnlyObstacle], 'jumping');
    expect(result.collided).toBe(false);
    expect(result.obstacleId).toBeNull();
  });

  it('does NOT collide in the fair gap between the rendered body and the hitbox (Req 41.5)', () => {
    // An obstacle overlapping the rendered body edge but NOT the shrunk hitbox
    // is a forgiven near-miss.
    const sys = createCollisionSystem(body, balance);
    const box = sys.hitbox('jumping');
    // Sliver hugging the body's left edge, ending before the hitbox starts.
    const nearMiss: Rect = {
      x: body.x,
      y: body.y + body.height / 2,
      width: box.x - body.x - 0.5,
      height: 2,
    };
    expect(nearMiss.width).toBeGreaterThan(0);
    expect(sys.check([obstacle('near', [nearMiss])], 'jumping').collided).toBe(false);
  });

  it('returns no collision for an empty obstacle list', () => {
    const sys = createCollisionSystem(body, balance);
    expect(sys.check([], 'jumping')).toEqual({ collided: false, obstacleId: null });
  });
});

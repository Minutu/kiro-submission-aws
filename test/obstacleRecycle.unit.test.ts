// Feature: kino-game
//
// UNIT tests for the pure Obstacle recycle/reset helpers (task 12.3; design:
// "on release EVERY field is reset — including the `scored` latch — so no stale
// state leaks into the next use and the exactly-once scoring invariant
// (Property 1) is never undermined by reuse"; Req 26.3, 26.5).
//
// The critical guarantee: a recycled `Obstacle` carries NO stale state into a
// new spawn — especially a stale `scored=true` latch, which would otherwise
// make a reused unit un-scoreable and break Property 1.

import { describe, it, expect } from 'vitest';
import {
  createBlankObstacle,
  resetObstacle,
  clearObstacle,
  createObjectPool,
} from '../src/core/index.ts';
import type { Obstacle, Rect } from '../src/core/index.ts';

const rect = (x: number, y: number, w: number, h: number): Rect => ({ x, y, width: w, height: h });

describe('obstacle recycle', () => {
  it('createBlankObstacle starts inert with a cleared scored latch', () => {
    const o = createBlankObstacle();
    expect(o.id).toBe('');
    expect(o.category).toBe('');
    expect(o.bounds).toEqual([]);
    expect(o.scoringLineX).toBe(0);
    expect(o.scored).toBe(false);
  });

  it('resetObstacle overwrites EVERY field including clearing scored by default', () => {
    // A thoroughly "dirty" obstacle from a previous life.
    const dirty: Obstacle = {
      id: 'old-id',
      category: 'flight_obstacle',
      mode: 'flight',
      bounds: [rect(1, 2, 3, 4), rect(5, 6, 7, 8)],
      scoringLineX: 999,
      scored: true, // the dangerous stale latch
    };

    const out = resetObstacle(dirty, {
      id: 'w1-jumping-7',
      category: 'jumping_obstacle',
      mode: 'jumping',
      bounds: [rect(10, 20, 48, 56)],
      scoringLineX: 58,
      // scored omitted => must default to false
    });

    expect(out).toBe(dirty); // mutated in place (no allocation)
    expect(out.id).toBe('w1-jumping-7');
    expect(out.category).toBe('jumping_obstacle');
    expect(out.mode).toBe('jumping');
    expect(out.scoringLineX).toBe(58);
    expect(out.bounds).toEqual([rect(10, 20, 48, 56)]);
    // The all-important latch: a recycled unit must be scoreable again.
    expect(out.scored).toBe(false);
  });

  it('reuses the SAME bounds backing array across recycles (no array churn)', () => {
    const o = createBlankObstacle();
    const boundsRef = o.bounds;
    resetObstacle(o, { id: 'a', category: 'c', mode: 'jumping', bounds: [rect(0, 0, 1, 1), rect(2, 2, 3, 3)], scoringLineX: 1 });
    expect(o.bounds).toBe(boundsRef); // same array instance
    expect(o.bounds.length).toBe(2);
    resetObstacle(o, { id: 'b', category: 'c', mode: 'flight', bounds: [rect(9, 9, 9, 9)], scoringLineX: 5 });
    expect(o.bounds).toBe(boundsRef); // still the same instance
    expect(o.bounds.length).toBe(1); // truncated + refilled in place
  });

  it('honors an explicit scored=true when the caller carries the latch in', () => {
    const o = createBlankObstacle();
    resetObstacle(o, { id: 'x', category: 'c', mode: 'jumping', bounds: [], scoringLineX: 0, scored: true });
    expect(o.scored).toBe(true);
  });

  it('clearObstacle resets every field to the inert blank state', () => {
    const o: Obstacle = {
      id: 'z',
      category: 'underwater_obstacle',
      mode: 'underwater',
      bounds: [rect(1, 1, 1, 1)],
      scoringLineX: 7,
      scored: true,
    };
    clearObstacle(o);
    expect(o.id).toBe('');
    expect(o.category).toBe('');
    expect(o.mode).toBe('jumping');
    expect(o.scoringLineX).toBe(0);
    expect(o.scored).toBe(false);
    expect(o.bounds).toEqual([]);
  });

  it('an Obstacle pool recycling via clearObstacle never hands out a stale scored=true', () => {
    const pool = createObjectPool<Obstacle>({
      capacity: 3,
      factory: createBlankObstacle,
      reset: clearObstacle,
    });

    // Acquire, mark scored (as a credited unit would), release.
    const a = pool.acquire();
    resetObstacle(a, { id: 'u1', category: 'c', mode: 'jumping', bounds: [rect(0, 0, 1, 1)], scoringLineX: 1 });
    a.scored = true; // the unit got credited during its life
    pool.release(a);

    // Re-acquire the SAME instance: the pool reset must have cleared it so it
    // can be initialized fresh for a new spawn (Property 1 safety under reuse).
    const b = pool.acquire();
    expect(b).toBe(a);
    expect(b.scored).toBe(false);
    expect(b.id).toBe('');
  });
});

// Feature: kino-game
//
// Obstacle recycle/reset (task 12.3; design: "Obstacle & particle pooling /
// memory management (Req 26.3, 26.5)": "The simulation core recycles its
// `Obstacle` data objects too ... on release EVERY field is reset — including
// the `scored` latch — so no stale state leaks into the next use and the
// exactly-once scoring invariant (Property 1) is never undermined by reuse").
//
// PURE and Phaser-free. These helpers let an {@link ObjectPool} of `Obstacle`
// data objects be recycled safely: a pooled `Obstacle` carries state from its
// previous life (its old `bounds`, its old `scored=true` latch, etc.), and if
// any of that leaked into a fresh spawn it could corrupt scoring — most
// critically a stale `scored=true` would make a reused unit never score, and a
// stale id could collide with a live unit's exactly-once key. So the reset
// clears/overwrites EVERY field of the `Obstacle` shape (see `core/types.ts`:
// id, category, mode, bounds, scoringLineX, scored).

import type { MovementMode, Obstacle, Rect } from './types.ts';

/** A fresh, inert `Obstacle` suitable as an {@link ObjectPool} factory output. */
export function createBlankObstacle(): Obstacle {
  return {
    id: '',
    category: '',
    mode: 'jumping',
    bounds: [],
    scoringLineX: 0,
    // The exactly-once latch starts CLEARED so a freshly pooled unit can score.
    scored: false,
  };
}

/** The field values a recycled `Obstacle` is re-initialized with on acquire. */
export interface ObstacleInit {
  id: string;
  category: string;
  mode: MovementMode;
  bounds: Rect[];
  scoringLineX: number;
  /** Defaults to `false` — a recycled unit must be scoreable again (Property 1). */
  scored?: boolean;
}

/**
 * Reset EVERY field of a pooled `Obstacle` in place to the given init values,
 * so a recycled instance never leaks stale state (especially the `scored`
 * latch) into a new spawn (design: "on release EVERY field is reset — including
 * the `scored` latch"; Property 1).
 *
 * Mutates and returns `obstacle` (no allocation of a new object — this is the
 * zero-per-frame-allocation recycle path). The `bounds` ARRAY is reused and
 * repopulated in place rather than reassigned, so the Obstacle keeps its own
 * backing array across recycles (no array churn on the hot path).
 *
 * @param obstacle The pooled instance to re-initialize (mutated in place).
 * @param init     The new field values for this use.
 */
export function resetObstacle(obstacle: Obstacle, init: ObstacleInit): Obstacle {
  obstacle.id = init.id;
  obstacle.category = init.category;
  obstacle.mode = init.mode;
  obstacle.scoringLineX = init.scoringLineX;
  // CRITICAL: clear the exactly-once latch unless the caller explicitly carries
  // one in. Defaulting to false guarantees a recycled unit can score again and
  // never inherits a prior life's `scored=true` (Property 1).
  obstacle.scored = init.scored ?? false;

  // Reuse the existing bounds array in place (truncate, then refill) so a
  // recycled Obstacle keeps ONE backing array for its whole pooled lifetime —
  // no new array allocated per recycle (Req 26.3 zero per-frame allocation).
  const bounds = obstacle.bounds;
  bounds.length = 0;
  for (let i = 0; i < init.bounds.length; i++) {
    bounds.push(init.bounds[i]!);
  }
  return obstacle;
}

/**
 * Hard-clear a pooled `Obstacle` to the inert blank state (the default
 * {@link ObjectPool} `reset` for an Obstacle pool when no init is supplied yet).
 * Every field goes to its blank value and `scored` is forced `false`, so an
 * instance sitting on the free list carries no stale state. Mutates in place.
 */
export function clearObstacle(obstacle: Obstacle): Obstacle {
  obstacle.id = '';
  obstacle.category = '';
  obstacle.mode = 'jumping';
  obstacle.scoringLineX = 0;
  obstacle.scored = false;
  obstacle.bounds.length = 0;
  return obstacle;
}

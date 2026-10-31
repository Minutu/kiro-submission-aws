// Feature: kino-game
//
// CollisionSystem — the single, authoritative, body-only collision basis shared
// across all four Movement_Modes (design: "Consistent, fair hitboxes (Req 26.7,
// 41)"; Req 26.7, 41.1-41.5, 44.13).
//
// Two ideas drive this module:
//
//   1. Fair, per-mode hitbox (Req 41.1-41.2). `hitbox(mode)` returns a Rect
//      derived ONLY from Kino's base BODY sprite (position + unscaled body
//      size), shrunk about its own center by `balance.hitbox.scale.<mode>`.
//      Those scales are all < 1 (validated by BalanceTable, Req 47.2), so the
//      collision box is strictly smaller than the rendered body and near-misses
//      forgive the player. The shrink is centered, so a mode cannot bias the
//      hitbox toward one edge and reintroduce unfair collisions.
//
//   2. ONE overlap routine, cosmetics excluded (Req 26.7, 41.3-41.5, 44.13).
//      Every mode runs the exact same `aabbOverlap` test — only the per-mode
//      scale differs — so collision behavior is consistent everywhere (Req 26.7,
//      41.3). The `kino` input carries the body rect ALONE and has no field for
//      cosmetic layers, so cosmetics are *structurally* excluded from collision:
//      there is no code path by which a hat or other render-only layer could
//      participate (Req 41.4). If a cosmetic visually overlaps an obstacle but
//      the body hitbox does not, `check` reports no collision (Req 41.5). This
//      same body-only basis is what every run-ending / Protective_Skill
//      reposition decision reads (Req 44.13).
//
// PURE / deterministic: no Phaser, no DOM, no clock, no randomness. Given the
// same `kino`, `obstacles`, and `mode`, `check` always returns the same result.
// Reads the per-mode scale through the injected BalanceTable (Req 26.8 — no
// hardcoded tunables). Enforced Phaser-free by test/boundary.core-no-phaser.

import type { BalanceTable, HitboxScaleKey } from '../config/index.ts';
import type { MovementMode, Obstacle, Rect } from './types.ts';

/**
 * Kino's collision input: the base BODY sprite ONLY.
 *
 * `x`/`y` is the top-left of the UNSCALED body sprite in world space; `width`/
 * `height` are its unscaled extents. There is deliberately NO field for
 * cosmetic/hat layers — cosmetics are render-only and must never reach the
 * collision test (Req 41.4, 19.6, 44.13). Keeping the shape body-only makes
 * that exclusion structural rather than a runtime check that could regress.
 */
export interface KinoBody {
  /** World-space top-left x of the unscaled body sprite. */
  x: number;
  /** World-space top-left y of the unscaled body sprite. */
  y: number;
  /** Unscaled body sprite width (non-negative). */
  width: number;
  /** Unscaled body sprite height (non-negative). */
  height: number;
}

/** The outcome of a collision check (design: `CollisionResult`). */
export interface CollisionResult {
  /** True iff the body hitbox overlapped at least one obstacle bound. */
  collided: boolean;
  /** Id of the first overlapping obstacle, or null when none overlapped. */
  obstacleId: string | null;
}

/** The CollisionSystem public surface (design: "Components > CollisionSystem"). */
export interface CollisionSystem {
  /**
   * The per-mode, body-only, center-shrunk collision rectangle (Req 41.1-41.2).
   * Derived solely from the configured `kino` body sprite; the scale comes from
   * `balance.hitbox.scale.<mode>` (< 1, fair).
   */
  hitbox(mode: MovementMode): Rect;
  /**
   * Test the body hitbox for `mode` against every rectangle of every obstacle,
   * using the single shared AABB routine (Req 26.7, 41.3). Cosmetic layers are
   * excluded by construction (Req 41.4-41.5, 44.13). Returns the first overlap
   * found, else `{ collided: false, obstacleId: null }`.
   */
  check(obstacles: readonly Obstacle[], mode: MovementMode): CollisionResult;
}

/**
 * The single shared axis-aligned bounding-box overlap test used in EVERY mode
 * (Req 26.7, 41.3). Two rectangles overlap iff they overlap on both axes.
 *
 * Edge-touching is treated as NON-overlapping (strict `<`): when one rect's
 * right edge exactly meets another's left edge they share only a zero-area
 * boundary, which should not end a run. This keeps the "fair collisions" intent
 * (Req 41.1) at the boundary and makes the predicate stable under the floating
 * point positions the simulation produces.
 *
 * Pure: depends only on its two arguments.
 */
export function aabbOverlap(a: Rect, b: Rect): boolean {
  return (
    a.x < b.x + b.width &&
    b.x < a.x + a.width &&
    a.y < b.y + b.height &&
    b.y < a.y + a.height
  );
}

/**
 * Shrink a body rectangle about its own CENTER by `scale` (Req 41.1-41.2). A
 * `scale` of 1 returns the body unchanged; `scale` < 1 (the fair, validated
 * case) yields a smaller box centered on the same point, so no edge is favored.
 * `scale` is clamped to be non-negative for safety; BalanceTable already keeps
 * configured scales inside [0.5, 0.9].
 */
function shrinkCentered(body: KinoBody, scale: number): Rect {
  const s = Math.max(0, scale);
  const width = body.width * s;
  const height = body.height * s;
  return {
    x: body.x + (body.width - width) / 2,
    y: body.y + (body.height - height) / 2,
    width,
    height,
  };
}

/**
 * Create a CollisionSystem bound to a specific `kino` body sprite and the
 * `BalanceTable` that supplies per-mode hitbox scales.
 *
 * The body is captured by value at construction (its four numbers are copied),
 * so callers rebuild the system — or, in the engine, update a mutable body and
 * re-create cheaply — each frame as Kino moves. This keeps the core pure: the
 * system never mutates its inputs and never reaches outside its arguments.
 *
 * @param kino   Kino's base BODY sprite rect (position + unscaled size). No
 *               cosmetic layers — see {@link KinoBody}.
 * @param balance The validated BalanceTable; `hitboxScale(mode)` provides the
 *               fair per-mode scale (Req 41.2, 26.8).
 */
export function createCollisionSystem(
  kino: KinoBody,
  balance: BalanceTable,
): CollisionSystem {
  // Copy the body so the system is immune to later mutation of the caller's
  // object — purity: the result of `hitbox`/`check` depends only on inputs.
  const body: KinoBody = {
    x: kino.x,
    y: kino.y,
    width: Math.max(0, kino.width),
    height: Math.max(0, kino.height),
  };

  function hitbox(mode: MovementMode): Rect {
    // Per-mode scale, with BalanceTable falling back to the documented default
    // for the key when the configured value is invalid (Req 47.2, 41.1).
    const scale = balance.hitboxScale(mode as HitboxScaleKey);
    return shrinkCentered(body, scale);
  }

  function check(
    obstacles: readonly Obstacle[],
    mode: MovementMode,
  ): CollisionResult {
    const box = hitbox(mode);
    for (const obstacle of obstacles) {
      // An Obstacle_Unit may carry several visual rectangles (e.g. a flight
      // pillar pair); a hit on ANY of them is a hit on the unit (Req 9.6).
      for (const bound of obstacle.bounds) {
        if (aabbOverlap(box, bound)) {
          return { collided: true, obstacleId: obstacle.id };
        }
      }
    }
    return { collided: false, obstacleId: null };
  }

  return { hitbox, check };
}

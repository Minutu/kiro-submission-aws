// Feature: kino-game
//
// SafeRepositionSolver — "THE hard problem" (design: "SAFE-REPOSITION ALGORITHM
// (hardest problem) — Req 14, 18, 44"). When a Protective_Skill prevents an
// imminent collision, this solver drops Kino's BODY into a position that
// overlaps NO obstacle, deterministically, within the current step (Req 14.3,
// 18.2, 44.7-44.12).
//
// Two protective skills reposition: Time Erase (Req 14) and Ultra Instinct
// (Req 18). Second Chance phases through (Req 13) and Nuke is unrelated — so
// they never call this solver.
//
// THREE invariants make the output trustworthy and testable (Property 6):
//
//   1. FROZEN SNAPSHOT. The solver works only on the obstacle bounds handed in
//      THIS step (`field`), plus the mode's static walls/surfaces. It never
//      guesses future spawns, so a placement that is clear now stays clear for
//      the decision it informs (design: "Shared look-ahead / scan strategy").
//
//   2. ONE VALIDATION ROUTINE. Every candidate is validated with the SAME
//      `aabbOverlap` test the CollisionSystem uses (Req 44.13 consistency) —
//      body hitbox vs. every obstacle bound. There is no second notion of
//      "clear" that could disagree with what ends a run.
//
//   3. GUARANTEED TERMINATION + NON-OVERLAP. The mode-specific "ideal" spot is
//      tried first; if (and only if) it somehow still overlaps (degenerate
//      crowding), the solver falls back to a MONOTONIC, BOUNDED scan outward
//      along a single axis. The scan visits a finite, precomputed set of
//      offsets, so it always terminates, and it returns only after the shared
//      routine confirms the placement is clear — so the result NEVER overlaps.
//      The final placement is re-validated before return (belt and suspenders).
//
// Mode-specific precedence (Req 44.12): where Req 44 defines a mode-specific
// rule, that rule is the COMPLETE and SOLE placement rule and overrides the
// generic Time Erase reposition (Req 14) and the Ultra Instinct vertical-axis
// teleport (Req 18) ENTIRELY for that mode. Concretely:
//   • jumping    -> right-of-obstacle at ground level (Req 44.7)  [both skills]
//   • flight     -> nearest non-overlapping gap center at screenX (Req 44.8)
//   • underwater -> nearest non-overlapping gap center at screenX (Req 44.9)
//   • zigzag     -> clear interior on the clearance-maximizing diagonal, with
//                   directional control returned to the player (Req 44.10-44.11)
// The Ultra Instinct vertical-axis teleport (Req 18.2) is only the GENERIC
// placement used when no mode-specific Req 44 rule applies; in all four modes a
// Req 44 rule DOES apply, so both Time Erase and Ultra Instinct resolve to the
// per-mode rule above. The generic vertical scan is still exposed so the
// contract is total and future modes (or a skill fired with no obstacles) have
// a defined, clear fallback.
//
// PURE / deterministic: no Phaser, no DOM, no clock, no randomness. Given the
// same inputs, `reposition` always returns the same placement. Reads the fair
// per-mode hitbox through the injected BalanceTable (Req 26.8 — no hardcoded
// tunables), using the SAME scale the CollisionSystem applies. Enforced
// Phaser-free by test/boundary.core-no-phaser.

import type { BalanceTable, HitboxScaleKey } from '../config/index.ts';
import { aabbOverlap } from './collisionSystem.ts';
import type {
  MovementMode,
  Obstacle,
  Rect,
  VerticalDir,
} from './types.ts';

/**
 * Which protective skill is requesting the reposition. Both repositioning
 * skills resolve to the mode-specific Req 44 rule in all four modes (Req 44.12);
 * the distinction only matters for the GENERIC fallback (`ultraInstinct` =>
 * vertical-axis teleport per Req 18.2; `timeErase` => nearest-gap per Req 14.3)
 * which is reached only when no mode-specific rule applies.
 */
export type ProtectiveSkill = 'timeErase' | 'ultraInstinct';

/** Play-area geometry the solver needs, in the core's y-DOWN convention. */
export interface RepositionPlayArea {
  /** Y of the ground line (Kino's body base rests here in Jumping, Req 46.1). */
  groundY: number;
  /** Total play-area height; the vertical span gaps/scans are confined to. */
  playHeight: number;
}

/** Inputs to a single reposition decision (all pure data). */
export interface RepositionRequest {
  /** Active Movement_Mode — selects the mode-specific rule (Req 44.12). */
  mode: MovementMode;
  /** Which protective skill fired (affects only the generic fallback). */
  skill: ProtectiveSkill;
  /**
   * Kino's current BODY rect (unscaled sprite, world space). The returned
   * placement moves THIS body; the solver validates using the fair, shrunk
   * per-mode hitbox derived from it (same basis as CollisionSystem, Req 44.13).
   */
  body: Rect;
  /**
   * Kino's fixed horizontal screen position (Scrolling_Model, Req 45). Flight /
   * Underwater keep Kino at this x and move only vertically (Req 44.8-44.9); if
   * omitted the current body x is used.
   */
  screenX?: number;
  /** The FROZEN obstacle field snapshot for this step (Req 44 look-ahead). */
  field: readonly Obstacle[];
  /** Play-area walls/surfaces the placement must respect. */
  playArea: RepositionPlayArea;
  /**
   * The id of the obstacle Kino would have hit, when known. Jumping places
   * directly to the right of THIS obstacle (Req 44.7). When omitted the solver
   * targets the nearest obstacle ahead of / overlapping the body.
   */
  contactedObstacleId?: string;
  /**
   * Zigzag's current diagonal direction, used to decide which wall was nearly
   * contacted when `contactedObstacleId` is absent (Req 44.10). Defaults to the
   * wall nearest the body.
   */
  diagonalDir?: VerticalDir;
}

/**
 * The validated, non-overlapping result (design: `SafePlacement`). `x`/`y` is
 * the new top-left of Kino's BODY rect. The solver guarantees the body's fair
 * hitbox at this position overlaps no obstacle in `field` (Property 6).
 */
export interface SafePlacement {
  /** New body top-left x (world space). */
  x: number;
  /** New body top-left y (world space). */
  y: number;
  /**
   * Zigzag only: the diagonal direction Kino resumes on — the one that
   * maximizes clearance from the wall nearly contacted (Req 44.10). Undefined
   * for non-zigzag modes.
   */
  diagonalDir?: VerticalDir;
  /**
   * Zigzag only: true, signaling directional control is returned to the player
   * so the next primary action resumes diagonal reversal (Req 44.11). Undefined
   * for non-zigzag modes.
   */
  controlReturned?: boolean;
}

/** The SafeRepositionSolver public surface (design: "Components"). */
export interface SafeRepositionSolver {
  /**
   * Resolve a guaranteed non-overlapping placement for `request`. Tries the
   * mode-specific ideal spot first (Req 44.7-44.11), then a monotonic bounded
   * scan if needed, and re-validates with the shared AABB routine before
   * returning (Req 44.13). ALWAYS terminates; result NEVER overlaps (Property
   * 6, Req 14.3 / 18.2).
   */
  reposition(request: RepositionRequest): SafePlacement;
}

/**
 * Small positive separation (px) kept between a placement and an obstacle edge
 * so the result is strictly clear, not merely edge-touching. `aabbOverlap`
 * treats edge-touching as NON-overlapping, but a hair of slack keeps the body
 * visibly off the obstacle and stable under floating point. Layout geometry,
 * not a balance tunable.
 */
const CLEARANCE_EPSILON_PX = 1;

/**
 * Number of samples in the bounded vertical fallback grid. The scan steps the
 * body center across the whole play height in this many evenly spaced rows,
 * expanding outward from the ideal y, so it ALWAYS terminates (finite set) and,
 * for any feasible field, finds the clear row. 129 samples over a typical ~600
 * px play area is sub-5px resolution — fine enough that a navigable gap is
 * never stepped over.
 */
const VERTICAL_SCAN_SAMPLES = 129;

/** Clamp `v` into the inclusive range `[lo, hi]`. */
function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * Shrink a body rect about its own CENTER by `scale`, exactly as
 * CollisionSystem does (Req 41.1-41.2). The solver validates placements with
 * this fair, shrunk hitbox so "clear" here means precisely what "no collision"
 * means at run time (Req 44.13).
 */
function shrinkCentered(body: Rect, scale: number): Rect {
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
 * Create a SafeRepositionSolver bound to the `BalanceTable` that supplies the
 * fair per-mode hitbox scale (Req 41.2, 26.8). Pure factory: the returned
 * solver reads only its arguments and `balance`, mutating nothing.
 */
export function createSafeRepositionSolver(
  balance: BalanceTable,
): SafeRepositionSolver {
  /** The fair hitbox for a body at (`x`,`y`) in `mode` — the validation box. */
  function hitboxAt(mode: MovementMode, body: Rect, x: number, y: number): Rect {
    const scale = balance.hitboxScale(mode as HitboxScaleKey);
    return shrinkCentered({ ...body, x, y }, scale);
  }

  /** True iff the body's fair hitbox at (`x`,`y`) overlaps NO obstacle bound. */
  function isClear(
    mode: MovementMode,
    body: Rect,
    field: readonly Obstacle[],
    x: number,
    y: number,
  ): boolean {
    const box = hitboxAt(mode, body, x, y);
    for (const obstacle of field) {
      for (const bound of obstacle.bounds) {
        if (aabbOverlap(box, bound)) return false;
      }
    }
    return true;
  }

  /**
   * MONOTONIC, BOUNDED vertical scan fallback (design: "Scan reliability").
   * Keeps `x` fixed and walks a finite grid of body-top-left y values across
   * the whole play height, visited in order of increasing distance from the
   * ideal `y`, returning the FIRST clear row. Finite candidate set => always
   * terminates; validated with the shared routine => never overlaps. Returns
   * null only if the entire (degenerate) field leaves no clear row at this x.
   */
  function scanVerticalForClearY(
    mode: MovementMode,
    body: Rect,
    field: readonly Obstacle[],
    playArea: RepositionPlayArea,
    x: number,
    idealY: number,
  ): number | null {
    // The body top-left y ranges over [0, groundY - height] so the body stays
    // inside the play area (its base never sinks below the ground line).
    const maxY = Math.max(0, playArea.groundY - body.height);
    const minY = 0;
    const idealClamped = clamp(idealY, minY, maxY);

    // Try the ideal row first, then expand symmetrically outward over the grid.
    // Stepping over a bounded number of rows guarantees termination.
    const span = maxY - minY;
    const step = span > 0 ? span / (VERTICAL_SCAN_SAMPLES - 1) : 0;

    if (isClear(mode, body, field, x, idealClamped)) return idealClamped;
    for (let i = 1; i < VERTICAL_SCAN_SAMPLES; i++) {
      const delta = step * i;
      const up = clamp(idealClamped - delta, minY, maxY);
      if (isClear(mode, body, field, x, up)) return up;
      const down = clamp(idealClamped + delta, minY, maxY);
      if (isClear(mode, body, field, x, down)) return down;
    }
    return null;
  }

  /**
   * MONOTONIC, BOUNDED horizontal scan fallback — the Jumping analogue. Keeps
   * `y` fixed at ground level and marches the body RIGHTWARD past every
   * obstacle's right edge (a finite, sorted set of candidate x's), returning
   * the first clear one. Because it only ever moves right past a finite list of
   * edges (plus one final step beyond the rightmost), it always terminates at a
   * clear x (eventually to the right of ALL obstacles).
   */
  function scanRightForClearX(
    mode: MovementMode,
    body: Rect,
    field: readonly Obstacle[],
    startX: number,
    groundTopY: number,
  ): number {
    // Candidate x's: the current start, then just past each obstacle's right
    // edge, sorted ascending. Marching right is monotonic and the final
    // candidate is clear of everything to its left.
    const edges: number[] = [startX];
    let rightmost = startX;
    for (const obstacle of field) {
      for (const bound of obstacle.bounds) {
        const past = bound.x + bound.width + CLEARANCE_EPSILON_PX;
        edges.push(past);
        if (past > rightmost) rightmost = past;
      }
    }
    // One guaranteed-clear sentinel strictly to the right of EVERY bound: the
    // body placed here cannot overlap anything in the finite frozen field.
    const sentinelX = rightmost + body.width + CLEARANCE_EPSILON_PX;
    edges.push(sentinelX);
    edges.sort((a, b) => a - b);

    for (const x of edges) {
      if (x < startX) continue; // never move left — monotonic rightward
      if (isClear(mode, body, field, x, groundTopY)) return x;
    }
    // The sentinel is always clear, so this is unreachable; return it for total.
    return sentinelX;
  }

  // --- Mode-specific ideal placements (Req 44.7-44.11) -------------------

  /**
   * Jumping (Req 44.7): place the body directly to the RIGHT of and clear of
   * the contacted/nearest obstacle, at ground level. The ideal x is just past
   * the obstacle's right edge; the fallback scan guarantees clearance even if a
   * second obstacle crowds that spot.
   */
  function placeJumping(request: RepositionRequest): SafePlacement {
    const { body, field, playArea } = request;
    const groundTopY = Math.max(0, playArea.groundY - body.height);

    const target = pickContactedOrNearest(request);
    // Ideal: just past the target's right edge (clear of THAT obstacle, Req 44.7).
    const idealX = target
      ? rightEdge(target) + CLEARANCE_EPSILON_PX
      : body.x;

    const x = isClear(request.mode, body, field, idealX, groundTopY)
      ? idealX
      : scanRightForClearX(request.mode, body, field, idealX, groundTopY);

    return { x, y: groundTopY };
  }

  /**
   * Flight / Underwater (Req 44.8-44.9, 14.3): keep Kino at the fixed `screenX`
   * and move to the nearest non-overlapping GAP CENTER. Gap centers are derived
   * from the frozen field's bound edges at that x (the navigable corridor
   * centers); the nearest clear one to the body's current center wins. The
   * bounded vertical scan backstops any degenerate crowding.
   */
  function placeVerticalGap(request: RepositionRequest): SafePlacement {
    const { body, field, playArea } = request;
    const x = request.screenX ?? body.x;
    const bodyCenterY = body.y + body.height / 2;

    // Candidate gap centers at this x: midpoints of vertical gaps between the
    // obstacle bounds that span this column, bounded by ceiling/ground.
    const candidates = gapCentersAt(field, playArea, x, body.width);
    // Convert each gap-center (body CENTER y) to a top-left y and pick the
    // nearest clear one to the body's current center.
    let best: number | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const centerY of candidates) {
      const topY = clamp(
        centerY - body.height / 2,
        0,
        Math.max(0, playArea.groundY - body.height),
      );
      if (!isClear(request.mode, body, field, x, topY)) continue;
      const dist = Math.abs(centerY - bodyCenterY);
      if (dist < bestDist) {
        bestDist = dist;
        best = topY;
      }
    }

    if (best !== null) return { x, y: best };

    // Fallback: monotonic bounded vertical scan from the body's current y.
    const idealTopY = clamp(
      bodyCenterY - body.height / 2,
      0,
      Math.max(0, playArea.groundY - body.height),
    );
    const scannedY = scanVerticalForClearY(
      request.mode,
      body,
      field,
      playArea,
      x,
      idealTopY,
    );
    return { x, y: scannedY ?? idealTopY };
  }

  /**
   * Zigzag (Req 44.10-44.11): place the body at a clear interior point on the
   * diagonal that MAXIMIZES clearance from the wall nearly contacted — if Kino
   * nearly hit the TOP wall, resume the DOWNWARD diagonal (and vice versa) —
   * then return directional control to the player. The chosen y is the clear
   * interior position furthest from the contacted wall; the bounded scan
   * guarantees it is non-overlapping.
   */
  function placeZigzag(request: RepositionRequest): SafePlacement {
    const { body, field, playArea } = request;
    const x = request.screenX ?? body.x;
    const bodyCenterY = body.y + body.height / 2;
    const corridorCenter = playArea.groundY / 2;

    // Which wall was nearly contacted? Prefer the explicit diagonal direction
    // (moving 'up' => nearing the TOP wall), else infer from the body's half.
    const nearedTopWall =
      request.diagonalDir === 'up' ||
      (request.diagonalDir === undefined && bodyCenterY < corridorCenter);

    // Resume on the diagonal AWAY from the contacted wall (Req 44.10), and aim
    // the interior target toward the opposite wall to maximize clearance.
    const resumeDir: VerticalDir = nearedTopWall ? 'down' : 'up';
    const maxTopY = Math.max(0, playArea.groundY - body.height);
    // Ideal interior target: near the opposite wall (but strictly interior).
    const idealTopY = nearedTopWall
      ? maxTopY // drop toward the BOTTOM wall (away from top)
      : 0; // rise toward the TOP wall (away from bottom)

    const scannedY = scanVerticalForClearY(
      request.mode,
      body,
      field,
      playArea,
      x,
      idealTopY,
    );
    const y = scannedY ?? clamp(idealTopY, 0, maxTopY);

    // Directional control is returned to the player (Req 44.11): the next
    // primary action resumes diagonal reversal from `resumeDir`.
    return { x, y, diagonalDir: resumeDir, controlReturned: true };
  }

  /**
   * GENERIC vertical-axis teleport (Req 18.2) — used only when NO mode-specific
   * Req 44 rule applies (not reached for the four defined modes, but keeps the
   * contract total). Nearest clear y along the vertical axis at the body's x.
   */
  function placeVerticalAxis(request: RepositionRequest): SafePlacement {
    const { body, field, playArea } = request;
    const x = request.screenX ?? body.x;
    const idealTopY = clamp(
      body.y,
      0,
      Math.max(0, playArea.groundY - body.height),
    );
    const scannedY = scanVerticalForClearY(
      request.mode,
      body,
      field,
      playArea,
      x,
      idealTopY,
    );
    return { x, y: scannedY ?? idealTopY };
  }

  // --- helpers over the frozen field ------------------------------------

  /** Right edge (x + width) of an obstacle's furthest-right bound. */
  function rightEdge(obstacle: Obstacle): number {
    let max = Number.NEGATIVE_INFINITY;
    for (const bound of obstacle.bounds) {
      const r = bound.x + bound.width;
      if (r > max) max = r;
    }
    return max === Number.NEGATIVE_INFINITY ? 0 : max;
  }

  /** Left edge of an obstacle's furthest-left bound. */
  function leftEdge(obstacle: Obstacle): number {
    let min = Number.POSITIVE_INFINITY;
    for (const bound of obstacle.bounds) {
      if (bound.x < min) min = bound.x;
    }
    return min === Number.POSITIVE_INFINITY ? 0 : min;
  }

  /**
   * The contacted obstacle (by id) if given, else the nearest obstacle at/ahead
   * of the body — the one Kino would have hit. "Nearest" is by left edge
   * distance to the body's right side, preferring obstacles not behind Kino.
   */
  function pickContactedOrNearest(
    request: RepositionRequest,
  ): Obstacle | undefined {
    const { field, body, contactedObstacleId } = request;
    if (contactedObstacleId) {
      const found = field.find((o) => o.id === contactedObstacleId);
      if (found) return found;
    }
    const bodyRight = body.x + body.width;
    let best: Obstacle | undefined;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const o of field) {
      const l = leftEdge(o);
      const r = rightEdge(o);
      // Distance from the body to this obstacle along x (0 if overlapping).
      const dist = r < body.x ? body.x - r : l > bodyRight ? l - bodyRight : 0;
      if (dist < bestDist) {
        bestDist = dist;
        best = o;
      }
    }
    return best;
  }

  /**
   * Vertical GAP CENTERS at column `x` (Req 44.8-44.9). Collects the vertical
   * extents of every obstacle bound overlapping the body's x-column, treats the
   * ceiling (y=0) and ground as walls, and returns the midpoint of each clear
   * vertical interval between consecutive occupied spans. These midpoints are
   * the navigable corridor centers the nearest-gap rule chooses among.
   */
  function gapCentersAt(
    field: readonly Obstacle[],
    playArea: RepositionPlayArea,
    x: number,
    bodyWidth: number,
  ): number[] {
    const colLeft = x;
    const colRight = x + bodyWidth;
    // [top, bottom] occupied vertical spans of bounds in this column.
    const spans: Array<[number, number]> = [];
    for (const o of field) {
      for (const b of o.bounds) {
        const bLeft = b.x;
        const bRight = b.x + b.width;
        // Only bounds that horizontally overlap the body's column matter.
        if (bRight <= colLeft || bLeft >= colRight) continue;
        if (b.height <= 0) continue;
        spans.push([b.y, b.y + b.height]);
      }
    }
    // Merge spans so the gaps between them are the true free intervals.
    spans.sort((a, b) => a[0] - b[0]);
    const merged: Array<[number, number]> = [];
    for (const [top, bottom] of spans) {
      const last = merged[merged.length - 1];
      if (last && top <= last[1]) {
        last[1] = Math.max(last[1], bottom);
      } else {
        merged.push([top, bottom]);
      }
    }
    // Free intervals between ceiling (0), the merged spans, and ground.
    const centers: number[] = [];
    let cursor = 0;
    for (const [top, bottom] of merged) {
      if (top > cursor) centers.push((cursor + top) / 2);
      cursor = Math.max(cursor, bottom);
    }
    if (cursor < playArea.groundY) centers.push((cursor + playArea.groundY) / 2);
    // If the column is empty, the single gap is the whole corridor.
    if (centers.length === 0) centers.push(playArea.groundY / 2);
    return centers;
  }

  // --- dispatch ---------------------------------------------------------

  function reposition(request: RepositionRequest): SafePlacement {
    let placement: SafePlacement;
    switch (request.mode) {
      case 'jumping':
        placement = placeJumping(request);
        break;
      case 'flight':
      case 'underwater':
        placement = placeVerticalGap(request);
        break;
      case 'zigzag':
        placement = placeZigzag(request);
        break;
      default:
        // No mode-specific Req 44 rule -> generic placement by skill:
        // Ultra Instinct = vertical axis (Req 18.2); Time Erase = nearest gap.
        placement =
          request.skill === 'ultraInstinct'
            ? placeVerticalAxis(request)
            : placeVerticalGap(request);
    }

    // Belt-and-suspenders re-validation with the SHARED routine (Req 44.13):
    // if the computed placement somehow overlaps, fall back to the bounded
    // vertical scan, which always returns a validated-clear row (or, failing
    // that, a right-of-everything x for jumping). This is the last guard that
    // makes "never overlaps" hold for ANY input (Property 6).
    if (!isClear(request.mode, request.body, request.field, placement.x, placement.y)) {
      const scannedY = scanVerticalForClearY(
        request.mode,
        request.body,
        request.field,
        request.playArea,
        placement.x,
        placement.y,
      );
      if (scannedY !== null) {
        placement = { ...placement, y: scannedY };
      } else {
        // Last resort: march fully right of the frozen field at ground level.
        const groundTopY = Math.max(
          0,
          request.playArea.groundY - request.body.height,
        );
        const x = scanRightForClearX(
          request.mode,
          request.body,
          request.field,
          placement.x,
          groundTopY,
        );
        placement = { ...placement, x, y: groundTopY };
      }
    }

    return placement;
  }

  return { reposition };
}

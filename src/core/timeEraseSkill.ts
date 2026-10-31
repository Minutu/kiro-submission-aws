// Feature: kino-game
//
// Time Erase — the "undo an imminent collision" active-skill EFFECT (design:
// "Skill effects" table + "SAFE-REPOSITION ALGORITHM (hardest problem) — Req
// 14, 18, 44"; Req 14.1, 14.2, 14.4). This is the PURE effect state machine for
// task 6.5; it COMPOSES the SkillSystem lifecycle (task 6.1) with the
// SafeRepositionSolver (task 5.7) rather than rewriting either.
//
// Time Erase IS a Protective_Skill (glossary): unlike Second Chance — which
// phases THROUGH one obstacle (Req 13) — Time Erase PREVENTS the imminent
// collision and REPOSITIONS Kino into a guaranteed non-overlapping spot via the
// SafeRepositionSolver, then the run continues. Its behavior:
//   - Req 14.1: activating opens a 4 s protection WINDOW. The window IS the
//     SkillSystem's `active` phase for `timeErase`, whose length is
//     `balance.timeEraseWindowS()` (default 4 s). This module does not own that
//     timer — it reads the lifecycle, so "armed" is true exactly while the
//     equipped skill is `timeErase` AND `active` (freezing under pause like
//     every other skill timer, since the SkillSystem advances only via `tick`).
//   - Req 14.2: a would-be collision WHILE armed is PREVENTED; Kino is
//     repositioned to a safe position via the SafeRepositionSolver, and the
//     protection window ENDS immediately ("thus ending the protection window").
//     Ending the window collapses the SkillSystem `active` → `cooldown` via
//     `endActiveEarly`, so a SECOND imminent collision in the same run is no
//     longer protected (it resolves normally) — mirroring the one-shot shape of
//     Second Chance, but repositioning instead of phasing.
//   - Req 14.3: the placement never overlaps an obstacle. That GUARANTEE lives
//     in the SafeRepositionSolver (Property 6); this module just forwards the
//     mode/body/field/playArea to it and returns its SafePlacement.
//   - Req 14.4: when Time Erase resolves, the run CONTINUES. The pure core
//     returns the safe placement so GameplayScene moves Kino there and keeps
//     the run going (see the "reposition render seam" note at the bottom).
//
// The per-mode reposition rules (Req 44.7-44.12, incl. the zigzag directional
// control of Req 44.10-44.11) are OWNED by the SafeRepositionSolver; this module
// passes the request straight through, so adding/altering a mode rule never
// touches Time Erase. Time Erase always requests with skill `'timeErase'`.
//
// PURE / deterministic — no Phaser, no randomness, no clock (src/core boundary,
// Req 26.6). The only time source is the SkillSystem it wraps (advanced only via
// `tick`); placement is a pure function of the solver inputs.

import type {
  RepositionPlayArea,
  RepositionRequest,
  SafePlacement,
  SafeRepositionSolver,
} from './safeRepositionSolver.ts';
import type { MovementMode, Obstacle, Rect, VerticalDir } from './types.ts';
import type { SkillSystem } from './skillSystem.ts';

/** The SkillId this effect is bound to. */
const TIME_ERASE: 'timeErase' = 'timeErase';

/**
 * The per-collision context Time Erase needs to ask the solver for a safe
 * placement. It is exactly the SafeRepositionSolver's request MINUS the fixed
 * `skill` field (always `'timeErase'` here) — GameplayScene supplies the live
 * mode, Kino's body, the frozen obstacle field, and the play area each time an
 * imminent collision is detected while armed.
 */
export interface TimeEraseCollision {
  /** Active Movement_Mode — selects the mode-specific rule (Req 44.12). */
  mode: MovementMode;
  /** Kino's current BODY rect (unscaled sprite, world space). */
  body: Rect;
  /** Kino's fixed horizontal screen position (Flight/Underwater/Zigzag). */
  screenX?: number;
  /** The FROZEN obstacle field snapshot for this step (Req 44 look-ahead). */
  field: readonly Obstacle[];
  /** Play-area walls/surfaces the placement must respect. */
  playArea: RepositionPlayArea;
  /** The id of the obstacle Kino would have hit, when known (Req 44.7). */
  contactedObstacleId?: string;
  /** Zigzag's current diagonal direction, for the contacted-wall inference. */
  diagonalDir?: VerticalDir;
}

/** Why an imminent collision was (or was not) erased by Time Erase. */
export type TimeEraseOutcome =
  | 'repositioned' // armed → collision prevented, Kino safely repositioned
  | 'not-armed' // no protection window active (never armed, expired, or used)
  | 'wrong-skill'; // the equipped skill is not Time Erase

/** Result of asking Time Erase to resolve an imminent collision. */
export interface TimeEraseCollisionResult {
  /** True ONLY when the collision was prevented and Kino repositioned. */
  prevented: boolean;
  /** The specific reason, for HUD/telemetry and tests. */
  outcome: TimeEraseOutcome;
  /**
   * The guaranteed non-overlapping placement GameplayScene must move Kino to
   * (Req 14.2, 14.3). Present only when `prevented` is true; `null` otherwise,
   * signaling the caller to resolve the hit normally (Req 14.4 run continues
   * only when repositioned).
   */
  placement: SafePlacement | null;
}

/** Construction options for {@link createTimeEraseSkill}. */
export interface TimeEraseOptions {
  /**
   * Fired when Time Erase RESOLVES — a collision was prevented and the window
   * consumed (Req 14.2, 14.4). The engine layer uses this to kick off any
   * reposition flourish/telegraph. Not fired on a non-armed collision or on
   * plain window expiry (expiry is observable via `isArmed()` flipping false).
   */
  onResolved?: (placement: SafePlacement) => void;
}

/**
 * The pure Time Erase effect, composed over a {@link SkillSystem} and a
 * {@link SafeRepositionSolver}. It holds no timer of its own: "armed" is derived
 * from the wrapped lifecycle, so the single source of truth for the 4 s window
 * is the SkillSystem's `active` phase.
 */
export interface TimeEraseSkill {
  /**
   * True exactly while the protection window is open and UNUSED (Req 14.1): the
   * equipped skill is Time Erase AND it is in its `active` phase. Flips to false
   * the instant the protection is used (Req 14.2) or the window expires.
   */
  isArmed(): boolean;
  /**
   * Resolve an imminent collision against Time Erase (Req 14.2). When armed:
   * PREVENT the collision, compute a guaranteed non-overlapping placement via
   * the SafeRepositionSolver (always requesting skill `'timeErase'`), end the
   * window immediately (SkillSystem active → cooldown) and fire `onResolved`;
   * returns `prevented: true` with the `placement`. When not armed (no window,
   * already used/expired, or a different skill equipped): returns
   * `prevented: false` with `placement: null` so the caller resolves the hit
   * normally.
   */
  onImminentCollision(collision: TimeEraseCollision): TimeEraseCollisionResult;
}

/**
 * Create a Time Erase effect bound to `skills` and `solver`. Pure factory:
 * behavior depends only on the wrapped SkillSystem's observable lifecycle, the
 * solver's placement, and the ordered `onImminentCollision` calls it receives.
 */
export function createTimeEraseSkill(
  skills: SkillSystem,
  solver: SafeRepositionSolver,
  options: TimeEraseOptions = {},
): TimeEraseSkill {
  const { onResolved } = options;

  function isArmed(): boolean {
    // Armed ⇔ Time Erase is the equipped skill AND its window is active. Using
    // the protection calls `endActiveEarly` (→ cooldown) and expiry ends
    // `active` via `tick`; both flip `isActive()` to false, so this needs no
    // separate "used" flag — the lifecycle IS the source of truth (Req 14.1).
    return skills.equipped() === TIME_ERASE && skills.isActive();
  }

  function onImminentCollision(
    collision: TimeEraseCollision,
  ): TimeEraseCollisionResult {
    if (skills.equipped() !== TIME_ERASE) {
      return { prevented: false, outcome: 'wrong-skill', placement: null };
    }
    if (!skills.isActive()) {
      // No protection window: never armed, already used, or expired. The caller
      // must resolve this as a normal hit (Req 14.4 continues only on reposition).
      return { prevented: false, outcome: 'not-armed', placement: null };
    }

    // Armed: PREVENT the collision and reposition Kino to a guaranteed
    // non-overlapping spot via the solver (Req 14.2, 14.3). The solver owns the
    // per-mode rules (Req 44.7-44.12); Time Erase always asks as 'timeErase'.
    // Optional fields are only attached when present so an absent value stays
    // absent (exactOptionalPropertyTypes) rather than becoming an explicit
    // `undefined`, keeping the forwarded request faithful to the caller's input.
    const request: RepositionRequest = {
      mode: collision.mode,
      skill: TIME_ERASE,
      body: collision.body,
      field: collision.field,
      playArea: collision.playArea,
    };
    if (collision.screenX !== undefined) request.screenX = collision.screenX;
    if (collision.contactedObstacleId !== undefined) {
      request.contactedObstacleId = collision.contactedObstacleId;
    }
    if (collision.diagonalDir !== undefined) {
      request.diagonalDir = collision.diagonalDir;
    }
    const placement = solver.reposition(request);

    // End the window immediately (Req 14.2 "thus ending the protection window").
    // Collapsing active → cooldown flips `isArmed()` to false, so the next
    // imminent collision in the same run resolves normally.
    skills.endActiveEarly();
    onResolved?.(placement);
    return { prevented: true, outcome: 'repositioned', placement };
  }

  return { isArmed, onImminentCollision };
}

// ── Reposition render seam for GameplayScene (Req 14.2, 14.4) ──────────────
// The pure core owns only the armed state + the safe placement. GameplayScene
// wires it like:
//
//   const te = createTimeEraseSkill(skillSystem, safeRepositionSolver, {
//     onResolved: (p) => teleportFlourish(p),   // optional reposition VFX
//   });
//   // on an imminent collision, BEFORE ending the run:
//   const r = te.onImminentCollision({
//     mode, body: kinoBody, screenX, field: frozenField, playArea,
//     contactedObstacleId, diagonalDir,
//   });
//   if (r.prevented && r.placement) {
//     kino.setPosition(r.placement.x, r.placement.y);        // Req 14.2 reposition
//     if (r.placement.diagonalDir) resumeZigzag(r.placement); // Req 44.10-44.11
//     // run continues (Req 14.4)
//   } else {
//     // resolve the hit as a normal, fatal collision
//   }
//
// Moving the sprite + any flourish is engine-layer and lives in GameplayScene;
// this module stays Phaser-free.

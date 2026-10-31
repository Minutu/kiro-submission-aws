// Feature: kino-game
//
// MovementStateMachine (design: "Movement & Sequence System > Movement_Mode
// state machine"; Req 2.1, 2.2, 3.1, 3.2, 3.5, 4.1, 4.8, 5.1, 5.2, 6.1, 6.2,
// 6.11, 5.10).
//
// The single authority on Kino's Movement_Mode. The machine guarantees EXACTLY
// ONE active mode per Sequence: `requestTransition(to)` atomically sets the one
// active mode and clears every other mode flag in the same step, so two modes
// are never simultaneously active (Req 4.5-4.6, 5.6-5.7, 8.4-8.5). The player
// never selects a mode — transitions are environment-forced by the
// SequenceDirector or by the water-surface crossing event (Req 6.1-6.2).
//
// Per-mode physics (all tunables read through BalanceTable — no hardcoded
// constants, Req 26.8). This module operates in a y-DOWN world convention to
// match screen space: smaller `y` is higher on screen. "Up" therefore means a
// NEGATIVE velocity/position delta and "down" a POSITIVE one.
//
//   | Mode       | Primary action              | Between actions          | Req      |
//   | Jumping    | upward jump impulse         | downward gravity         | 2.1-2.2  |
//   | Flight     | upward impulse              | continuous down gravity  | 3.1-3.2  |
//   | Underwater | downward impulse (inverted) | continuous up buoyancy   | 5.1-5.2  |
//   | Zigzag     | reverse the diagonal (~±30°)| constant-speed diagonal  | 4.1, 4.8 |
//
// Flight is the base mode other transitions derive from (Req 3.5). Underwater
// reuses Flight's frames because its motion is the inverse (design note).
//
// Determinism/purity: `step(dt)` and `applyPrimary(ctx)` are pure functions of
// `(state, dt, balance, pendingPrimary)` — no Phaser, no randomness, no wall
// clock. Given the same construction and the same call sequence the machine
// produces the same `MovementState`s (enabling the Property 4 / Property 10
// tests in tasks 3.3 / 3.4). No `phaser` import (src/core boundary, Req 26.6).

import type { BalanceTable } from '../config/index.ts';
import type { MovementMode, MovementState, VerticalDir } from './types.ts';

/** The four modes, used to derive the per-step single-active flag set. */
const ALL_MODES: readonly MovementMode[] = [
  'jumping',
  'flight',
  'zigzag',
  'underwater',
] as const;

/**
 * Per-step context the machine reads. `waterSurfaceCrossed` is the physical
 * event that gates Underwater↔Flight transitions (Req 5.9-5.10, 6.9-6.11); it
 * is true only on the step Kino crosses the water surface.
 */
export interface MovementContext {
  /** True on the step Kino crosses the water surface (Req 5.9-5.10, 6.9-6.11). */
  waterSurfaceCrossed?: boolean;
}

/** Optional initial kinematics for {@link createMovementStateMachine}. */
export interface MovementStateMachineOptions {
  /** Starting mode (default `'jumping'`, the W1 entry mode). */
  mode?: MovementMode;
  /** Starting vertical position in the y-DOWN world (default 0). */
  y?: number;
  /** Starting vertical velocity (default 0). */
  vy?: number;
  /** Starting zigzag diagonal direction (default `'down'`). */
  diagonalDir?: VerticalDir;
}

/** The public surface of the movement state machine (design interface). */
export interface MovementStateMachine {
  /** The single currently-active Movement_Mode (Req 2-6). */
  active(): MovementMode;

  /**
   * Apply the mode-specific primary action for the NEXT `step` (Req 1.2, 2.1,
   * 3.1, 4.1, 5.2). Jumping/Flight: upward impulse. Underwater: downward
   * (inverted) impulse. Zigzag: reverse the diagonal direction. Marked as a
   * pending press so physics is resolved deterministically inside `step`.
   */
  applyPrimary(ctx?: MovementContext): void;

  /**
   * Advance the simulation by one fixed tick of `dt` seconds, applying the
   * active mode's physics and consuming any pending primary press. Returns the
   * resulting immutable snapshot (design: `step(dt): KinoKinematics`).
   */
  step(dt: number): MovementState;

  /**
   * ATOMICALLY set the single active mode to `to` and clear every other mode
   * flag in the same step, so no two modes are ever simultaneously active
   * (Req 4.5-4.6, 5.6-5.7, 8.4-8.5). Caller gates with {@link canTransition}
   * first; this does not re-check the water-surface condition.
   */
  requestTransition(to: MovementMode): void;

  /**
   * Whether a transition to `to` is permitted this step. Any transition INTO or
   * OUT OF `underwater` (the Underwater↔Flight pair) is allowed only when
   * `ctx.waterSurfaceCrossed` is set that step; otherwise keep the current mode
   * and perform no transition (Req 5.9-5.10, 6.9-6.11). A no-op transition to
   * the already-active mode is always allowed.
   */
  canTransition(to: MovementMode, ctx?: MovementContext): boolean;

  /**
   * Test hook: the set of active modes. The invariant is that this set ALWAYS
   * has size 1 during a Sequence (design: "a set that must always have size 1").
   */
  activeModes(): Set<MovementMode>;

  /** Read the current immutable kinematic snapshot (Req 2-6). */
  state(): MovementState;
}

/**
 * Create a {@link MovementStateMachine} reading all tunables from `balance`.
 *
 * @param balance The validated BalanceTable (single source of physics
 *   constants, Req 26.8); no constant is hardcoded here.
 * @param options Optional initial kinematics.
 */
export function createMovementStateMachine(
  balance: BalanceTable,
  options: MovementStateMachineOptions = {},
): MovementStateMachine {
  let mode: MovementMode = options.mode ?? 'jumping';
  let y = options.y ?? 0;
  let vy = options.vy ?? 0;
  let diagonalDir: VerticalDir = options.diagonalDir ?? 'down';
  let isTransitioning = false;

  // A pending primary press is consumed by the next `step`. Buffering it keeps
  // `step` the sole place physics mutates, which makes the machine a pure
  // function of (state, dt) + the latched press and keeps determinism simple.
  let pendingPrimary = false;

  /** Is `to` one side of the water-gated Underwater↔Flight pair vs the current mode? */
  function isWaterGated(to: MovementMode): boolean {
    // The only physically-gated transitions are between underwater and flight.
    return (
      (mode === 'underwater' && to === 'flight') ||
      (mode === 'flight' && to === 'underwater')
    );
  }

  function canTransition(to: MovementMode, ctx?: MovementContext): boolean {
    // A no-op transition to the current mode never needs gating.
    if (to === mode) return true;
    // Underwater↔Flight requires the water-surface crossing event this step.
    if (isWaterGated(to)) {
      return ctx?.waterSurfaceCrossed === true;
    }
    // All other environment-forced transitions are permitted by the machine;
    // scheduling is the SequenceDirector's responsibility (Req 6.1-6.2).
    return true;
  }

  function requestTransition(to: MovementMode): void {
    // Atomic single-active enforcement: set the one active mode. Because `mode`
    // is a single scalar (not a set of booleans), assigning it inherently
    // clears every other mode flag in the same step — `activeModes()` can never
    // observe two modes at once (Req 4.5-4.6, 5.6-5.7, 8.4-8.5).
    mode = to;
    // Entering zigzag starts on a defined diagonal so direction alternation is
    // well-defined from the first primary (Req 4.1, 4.8).
    if (to !== 'zigzag') {
      // Leaving zigzag: reset the latch-free diagonal to a canonical value so a
      // later re-entry is deterministic.
      diagonalDir = 'down';
    }
  }

  /** Reverse the zigzag diagonal between the up/down ~30° legs (Req 4.1, 4.8). */
  function reverseDiagonal(): void {
    diagonalDir = diagonalDir === 'up' ? 'down' : 'up';
  }

  function applyPrimary(_ctx?: MovementContext): void {
    if (mode === 'zigzag') {
      // Zigzag's primary reverses the vertical diagonal immediately so the
      // alternation holds per press regardless of `step` timing (Req 4.1, 4.8).
      reverseDiagonal();
      return;
    }
    // Jumping / Flight / Underwater: latch the impulse for the next `step`.
    pendingPrimary = true;
  }

  /** Vertical velocity (y-DOWN) for the current zigzag leg (Req 4.8). */
  function zigzagVelocity(): number {
    const speed = balance.zigzagSpeed();
    const angleRad = (balance.zigzagAngleDeg() * Math.PI) / 180;
    const vertical = speed * Math.sin(angleRad);
    // 'up' => negative (toward smaller y); 'down' => positive.
    return diagonalDir === 'up' ? -vertical : vertical;
  }

  function step(dt: number): MovementState {
    // Non-positive / non-finite dt advances nothing (defensive; the driver only
    // ever passes a fixed positive delta).
    if (!Number.isFinite(dt) || dt <= 0) {
      return snapshot();
    }

    switch (mode) {
      case 'jumping': {
        // Primary: upward jump impulse (Req 2.1). Between: downward gravity
        // (Req 2.2). Up is negative in the y-DOWN world.
        if (pendingPrimary) {
          vy = -balance.jumpImpulse();
        }
        vy += balance.jumpGravity() * dt;
        y += vy * dt;
        break;
      }
      case 'flight': {
        // Primary: upward impulse (Req 3.1). Between: continuous downward
        // gravity (Req 3.2). Flight is the base mode (Req 3.5).
        if (pendingPrimary) {
          vy = -balance.flightImpulse();
        }
        vy += balance.flightGravity() * dt;
        y += vy * dt;
        break;
      }
      case 'underwater': {
        // Inverted flappy: primary is a DOWNWARD impulse (Req 5.2); between
        // actions a continuous UPWARD buoyancy (Req 5.1).
        if (pendingPrimary) {
          vy = balance.underwaterImpulse();
        }
        vy -= balance.underwaterBuoyancy() * dt;
        y += vy * dt;
        break;
      }
      case 'zigzag': {
        // Constant-speed diagonal at ~±angle; direction reversal happens in
        // `applyPrimary` (Req 4.1, 4.8). vy tracks the current leg so the
        // snapshot reports the active diagonal velocity.
        vy = zigzagVelocity();
        y += vy * dt;
        break;
      }
    }

    pendingPrimary = false;
    return snapshot();
  }

  /** Build the immutable per-frame snapshot (never leaks internal mutables). */
  function snapshot(): MovementState {
    return { mode, y, vy, diagonalDir, isTransitioning };
  }

  return {
    active: () => mode,
    applyPrimary,
    step,
    requestTransition,
    canTransition,
    // The invariant set: exactly the single active mode (size always 1).
    activeModes: () => new Set<MovementMode>([mode]),
    state: snapshot,
  };
}

/** Re-exported for callers that want to assert over the mode list in tests. */
export { ALL_MODES };

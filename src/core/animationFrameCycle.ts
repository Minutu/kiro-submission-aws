// Feature: kino-game
//
// Animation_Frame cycle (task 8.3) — the PURE, Phaser-free state machine that
// answers "given the active Movement_Mode and Kino's motion state at time T,
// which Animation_Frame should render?" (Req 30.4-30.5, 30.7-30.15).
//
// It is the SELECTION LOGIC only. It never draws, never touches Phaser, never
// resolves art. The engine consumer (KinoRenderer) calls
// `selectAnimationFrame(...)` each render tick and feeds the result to
// `setPose(mode, frame)`. Keeping the selection here means the whole "which
// frame when" contract is unit-testable in plain Node (boundary:
// test/boundary.core-no-phaser.test.ts).
//
// WHAT DRIVES EACH MODE (Req 30.4-30.15):
//   - Jumping, GROUNDED: alternate the ground WALK cycle run-step-right <->
//     run-step-left over time (Req 30.13).
//   - Jumping, AIRBORNE: pick the JUMP ARC frame by vertical motion —
//     jump-go-up while rising, jump-apex near the top (~level), jump-go-down
//     while falling (Req 30.4 names the flight analogue; the jump arc mirrors
//     it for the airborne jump).
//   - Flight: cycle fly-up / fly-apex / fly-down by pitch/vertical velocity —
//     up while rising, down while falling, apex when ~level (Req 30.4, 30.8).
//   - Underwater_Buoyancy: REUSES the flight frames with the SAME logic (Req
//     30.9) — underwater is the inverse of flight but draws the same frame set.
//   - Zigzag: alternate zigzag-up / zigzag-down with the diagonal leg direction
//     (Req 30.10). The leg direction is the authoritative driver; there is no
//     separate "apex".
//   - Transition spin: while a transition is active, cycle spin-1 <-> spin-2
//     (Req 30.11, 30.15). This OVERRIDES the mode frame — the spin cue owns the
//     silhouette during a transition (cosmetics are hidden then anyway, Req 6.5,
//     handled by KinoRenderer).
//   - Finale (World 5): the scripted finale drives a crawl cycle crawl-step-right
//     <-> crawl-step-left, then a run cycle run-step-right <-> run-step-left,
//     matching the scripted finale phases (Req 30.12, 30.14, 30.15, 8.11-8.12).
//     The finale phase is an explicit input because the scripted finale
//     (task 11.1) owns the phase timeline; this cycle only renders the frame for
//     the phase it is told.
//
// DETERMINISM & CADENCE: the function is a PURE function of its inputs. Step
// timing for the time-driven ALTERNATING cycles (walk, crawl, spin, finale run)
// is derived from an elapsed-time counter divided by a frame duration. There is
// no `frameDurationMs` key in the Config_File today, so a sensible default
// cadence is used and exposed as `DEFAULT_FRAME_DURATION_MS` (overridable per
// call via `frameDurationMs`). Velocity-driven cycles (jump arc, flight,
// underwater, zigzag) do not use the clock — they read motion state directly —
// so they are deterministic regardless of cadence.

import type { MovementMode, VerticalDir } from './types.ts';
import {
  type AnimationFrame,
  defaultFrameForMode,
} from './animationFrames.ts';

export type { AnimationFrame };

/**
 * Default per-frame hold for the TIME-DRIVEN alternating cycles (walk, crawl,
 * spin, finale run), in milliseconds. ~8.3 frames/sec — a lively but readable
 * two-frame cycle (a full right->left->right loop every ~240 ms). There is no
 * Config_File `frameDurationMs` today; when one is added, pass it as
 * `frameDurationMs` to override this constant. Chosen as a sensible constant
 * cadence per the task note.
 */
export const DEFAULT_FRAME_DURATION_MS = 120;

/**
 * A small threshold (world units/sec) around zero vertical velocity that counts
 * as "level" for the velocity-driven apex frames (flight/underwater and the
 * jump apex). Without it, the apex frame would flicker on/off across the exact
 * zero crossing. Treated as `|vy| <= APEX_VELOCITY_EPSILON` => apex.
 */
export const APEX_VELOCITY_EPSILON = 1e-6;

/**
 * The scripted World-5 finale locomotion phase (Req 8.11-8.12, 30.14-30.15).
 * The finale drives crawl first, then run. The scripted finale module (task
 * 11.1) owns WHEN the phase flips; this cycle only renders the frame for the
 * phase it is handed.
 */
export type FinalePhase = 'crawl' | 'run';

/**
 * Inputs to the frame cycle. All fields are optional except `mode`; a caller
 * supplies only what its mode needs, and sensible defaults fill the rest so the
 * function is total (never throws, always returns a legal-looking frame).
 */
export interface FrameCycleInput {
  /** The active Movement_Mode. */
  readonly mode: MovementMode;

  /**
   * Elapsed time (ms) used to phase the TIME-DRIVEN alternating cycles (walk,
   * crawl, spin, finale run). Monotonic, resettable by the caller. Defaults to
   * 0 (first frame of the cycle).
   */
  readonly elapsedMs?: number;

  /**
   * Optional explicit tick counter as an ALTERNATIVE to `elapsedMs` for the
   * time-driven cycles: whole steps already divided by cadence. When provided,
   * it takes precedence over `elapsedMs` (one source of truth per call). A
   * fixed-step driver can feed its integer step index directly.
   */
  readonly frameTick?: number;

  /**
   * Per-frame hold (ms) for the time-driven alternating cycles. Defaults to
   * {@link DEFAULT_FRAME_DURATION_MS}. Ignored when `frameTick` is supplied.
   */
  readonly frameDurationMs?: number;

  /** Jumping only: true while Kino is on the ground (walk cycle); false => jump arc. */
  readonly grounded?: boolean;

  /**
   * Signed vertical velocity for the velocity-driven cycles (jump arc, flight,
   * underwater). Sign convention: NEGATIVE = rising (up), POSITIVE = falling
   * (down), ~0 = level/apex. This matches the Phaser screen convention (+y
   * down) the renderer uses, so the renderer can pass its vy straight through.
   * Defaults to 0 (apex/level).
   */
  readonly verticalVelocity?: number;

  /** Zigzag only: the current diagonal leg direction (Req 30.10). Defaults to 'up'. */
  readonly zigzagDirection?: VerticalDir;

  /**
   * True while a telegraphed Transition is in progress (Req 6.4-6.5). When true,
   * the spin cue OVERRIDES the mode frame and the cycle returns spin-1/spin-2
   * (Req 30.11, 30.15).
   */
  readonly transitionActive?: boolean;

  /**
   * Set ONLY during the World-5 scripted finale restricted locomotion (Req
   * 8.11-8.12). When present, it drives the crawl/run cycle instead of the
   * normal jumping frames. `undefined` => not in the finale locomotion.
   */
  readonly finalePhase?: FinalePhase;
}

/**
 * Index into a two-frame alternating cycle (0 or 1) from the time inputs. Uses
 * `frameTick` when supplied, else floors `elapsedMs / frameDurationMs`. Negative
 * or non-finite inputs are clamped to step 0 so the function stays total.
 */
function alternationIndex(input: FrameCycleInput): 0 | 1 {
  let step: number;
  if (input.frameTick !== undefined && Number.isFinite(input.frameTick)) {
    step = Math.floor(input.frameTick);
  } else {
    const elapsed = Number.isFinite(input.elapsedMs) ? (input.elapsedMs as number) : 0;
    const duration = input.frameDurationMs ?? DEFAULT_FRAME_DURATION_MS;
    const safeDuration = duration > 0 ? duration : DEFAULT_FRAME_DURATION_MS;
    step = Math.floor(elapsed / safeDuration);
  }
  if (!Number.isFinite(step) || step < 0) step = 0;
  // Non-negative modulo 2.
  return (((step % 2) + 2) % 2) as 0 | 1;
}

/**
 * Pick the velocity-driven "arc" frame given a signed vertical velocity and the
 * three frame keys for (rising, level, falling). Shared by flight/underwater
 * (fly-up/apex/down) and the jumping airborne arc (jump-go-up/apex/go-down).
 * Sign convention: negative = up/rising, positive = down/falling, ~0 = level.
 */
function arcFrameFor(
  verticalVelocity: number,
  rising: AnimationFrame,
  level: AnimationFrame,
  falling: AnimationFrame,
): AnimationFrame {
  const vy = Number.isFinite(verticalVelocity) ? verticalVelocity : 0;
  if (vy < -APEX_VELOCITY_EPSILON) return rising;
  if (vy > APEX_VELOCITY_EPSILON) return falling;
  return level;
}

/**
 * THE frame-cycle selector (task 8.3). Pure and total: returns the current
 * {@link AnimationFrame} for the given inputs, applying the per-mode rules and
 * the two overrides (transition spin, finale locomotion) in priority order.
 *
 * Priority:
 *   1. Transition spin (Req 30.11, 30.15) — overrides everything while active.
 *   2. World-5 finale locomotion (Req 30.14-30.15) — crawl then run.
 *   3. The active Movement_Mode's own cycle (Req 30.4-30.5, 30.8-30.13).
 */
export function selectAnimationFrame(input: FrameCycleInput): AnimationFrame {
  // (1) Transition spin cue overrides the mode frame (Req 30.11, 30.15).
  if (input.transitionActive) {
    return alternationIndex(input) === 0 ? 'spin-1' : 'spin-2';
  }

  // (2) World-5 scripted finale restricted locomotion (Req 30.14-30.15).
  if (input.finalePhase !== undefined) {
    if (input.finalePhase === 'crawl') {
      // Crawl cycle: crawl-step-right <-> crawl-step-left (Req 30.14).
      return alternationIndex(input) === 0 ? 'crawl-step-right' : 'crawl-step-left';
    }
    // Run cycle in the finale: run-step-right <-> run-step-left (Req 30.15, 30.13).
    return alternationIndex(input) === 0 ? 'run-step-right' : 'run-step-left';
  }

  // (3) The active Movement_Mode's own cycle.
  switch (input.mode) {
    case 'jumping': {
      // Grounded => walk cycle; airborne => jump arc by vertical velocity.
      const grounded = input.grounded ?? true;
      if (grounded) {
        // Ground walk cycle (Req 30.13).
        return alternationIndex(input) === 0 ? 'run-step-right' : 'run-step-left';
      }
      // Airborne jump arc: up while rising, apex when level, down while falling.
      return arcFrameFor(
        input.verticalVelocity ?? 0,
        'jump-go-up',
        'jump-apex',
        'jump-go-down',
      );
    }

    case 'flight':
    case 'underwater': {
      // Flight frames, reused by underwater (Req 30.8, 30.9): up/apex/down by
      // vertical velocity/pitch.
      return arcFrameFor(
        input.verticalVelocity ?? 0,
        'fly-up',
        'fly-apex',
        'fly-down',
      );
    }

    case 'zigzag': {
      // Diagonal leg direction drives the frame (Req 30.10).
      const dir = input.zigzagDirection ?? 'up';
      return dir === 'up' ? 'zigzag-up' : 'zigzag-down';
    }

    default:
      // Total fallback — unknown mode rests on a safe default frame.
      return defaultFrameForMode(input.mode);
  }
}

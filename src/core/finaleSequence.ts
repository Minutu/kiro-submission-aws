// Feature: kino-game
//
// FinaleSequence — the PURE, Phaser-free STATE MACHINE for the World 5 scripted
// auto-controlled finale (task 11.2; design: "World 5 scripted finale (Req
// 8.7–8.15, 45.5)"; Req 8.7-8.15, 45.5).
//
// PURE simulation logic — no Phaser, no clocks, no ambient randomness, no I/O.
// Enforced Phaser-free by test/boundary.core-no-phaser.test.ts.
//
// WHAT THIS OWNS (and what it does NOT):
//
//   When the SequenceDirector reaches the World-5 FINALE Sequence (the terminal
//   `isFinale` spec from world5Plan.ts, mode Jumping — the ONLY Jumping in World
//   5, Req 8.6), the engine hands control to THIS pure controller. It models the
//   scripted finale as a DETERMINISTIC phase machine over accrued distance (the
//   rightward scripted progress — the sanctioned horizontal-movement exception,
//   Req 45.5). It decides, for a given accrued distance:
//     - the current PHASE (descend → crawl → run → at-barrier → jumped-through),
//     - whether the finale has AUTOMATIC CONTROL of Kino (player locomotion
//       input is ignored; movement is scripted rightward — Req 8.9-8.12),
//     - whether the final JUMP is enabled (false until the barrier — Req 8.13;
//       true at/after it — Req 8.14),
//     - the LOCOMOTION Animation_Frame to render (crawl-step during CRAWL, run-
//       step during RUN) by REUSING the FinalePhase + `selectAnimationFrame`
//       from animationFrameCycle.ts (task 8.3) rather than duplicating frames,
//     - and, once the player performs the final jump at the barrier, that the
//       finale is COMPLETE and the engine should play the FINAL ending cinematic
//       (reusing FINAL_ENDING_CINEMATIC_ID from endingCinematic.ts, task 10.5).
//
//   It does NOT draw, does NOT touch Phaser, does NOT start scenes, and does NOT
//   itself compose the World-5 plan (that is world5Plan.ts). The engine
//   (GameplayScene) reads this controller's pure outputs to disable Flight,
//   descend Kino, script Kino's x + the frames, gate the jump, and on the
//   jump-through start the CinematicScene with FINAL_ENDING_CINEMATIC_ID.
//
// THE PHASE TIMELINE (Req 8.9-8.15), driven by accrued distance:
//
//   DESCEND        At finale start Flight is disabled and Kino descends to the
//                  ground (Req 8.7). Automatic control has begun (Req 8.8) but
//                  the restricted crawl/run locomotion has not — Kino is still
//                  settling onto the ground. Jump unavailable (Req 8.13).
//   CRAWL          Kino has reached the ground; the restricted EXHAUSTED crawl
//                  locomotion plays (Req 8.10), driving rightward automatically
//                  (Req 8.9) with the crawl-step cycle (Req 8.11/30.14). The
//                  rightward move is the sanctioned exception (Req 45.5). Jump
//                  unavailable (Req 8.13).
//   RUN            The finale advances Kino from crawl into running (Req 8.12),
//                  still rightward and automatic, with the run-step cycle
//                  (Req 8.12/30.13). Jump unavailable until the barrier (Req 8.13).
//   AT_BARRIER     Kino has reached the portal barrier. Automatic locomotion
//                  STOPS and the final Jump becomes AVAILABLE — the ONLY player
//                  action in the finale (Req 8.14). Jump ENABLED here (Req 8.13
//                  "until", Req 8.14).
//   JUMPED_THROUGH The player performed the final primary action at the barrier;
//                  Kino Jumps THROUGH into the final cinematic (Req 8.15). The
//                  finale is COMPLETE → the engine plays the ending (Req 21.8).
//
// DETERMINISM: every query is a pure function of the accrued distance (plus the
// one-shot `jump()` latch for the final action). `advance(delta)` adds a
// non-negative delta to the accrued distance and returns the resulting phase, so
// a fixed-step engine feeds `scrollSpeed * dt` (or any monotonic progress) and
// gets a reproducible timeline. No clock, no randomness.

import {
  selectAnimationFrame,
  type AnimationFrame,
  type FinalePhase,
} from './animationFrameCycle.ts';
import { FINAL_ENDING_CINEMATIC_ID } from './endingCinematic.ts';

export type { FinalePhase };
export { FINAL_ENDING_CINEMATIC_ID };

/**
 * The ordered scripted-finale PHASES (Req 8.9-8.15). They advance strictly in
 * this order as accrued distance grows; the terminal {@link FinalePhaseName.JumpedThrough}
 * is reached ONLY via the one-shot player jump at the barrier (never by distance
 * alone — the barrier is where automatic locomotion stops, Req 8.14).
 */
export type FinalePhaseName =
  | 'descend'
  | 'crawl'
  | 'run'
  | 'at-barrier'
  | 'jumped-through';

/** Convenience constants for the phase names (avoids stringly-typed call sites). */
export const FINALE_PHASES = {
  Descend: 'descend',
  Crawl: 'crawl',
  Run: 'run',
  AtBarrier: 'at-barrier',
  JumpedThrough: 'jumped-through',
} as const satisfies Record<string, FinalePhaseName>;

/**
 * Distance thresholds (in the engine's scripted-progress units, e.g. world px)
 * at which each phase BEGINS, measured from finale start (accrued distance 0).
 * The phase for a given accrued distance `d` is the last phase whose threshold
 * `d` has reached. The thresholds are strictly increasing so the mapping is
 * unambiguous:
 *
 *   [0, descendEnd)            -> DESCEND  (Kino settling to the ground, Req 8.7)
 *   [descendEnd, crawlEnd)     -> CRAWL    (restricted crawl locomotion, Req 8.10-8.11)
 *   [crawlEnd, barrierAt)      -> RUN      (running locomotion, Req 8.12)
 *   [barrierAt, +inf)          -> AT_BARRIER (jump enabled, Req 8.14)
 *
 * JUMPED_THROUGH is NOT distance-driven — it is entered by {@link FinaleController.jump}
 * once AT_BARRIER (Req 8.15). The defaults are sensible, config-overridable
 * values; the engine passes its own balance-derived distances when wiring.
 */
export interface FinaleDistanceConfig {
  /** Distance over which Kino descends to the ground before crawling (Req 8.7). */
  readonly descendDistance: number;
  /** Distance of the crawl locomotion segment before running (Req 8.10-8.11). */
  readonly crawlDistance: number;
  /** Distance of the running locomotion segment up to the barrier (Req 8.12). */
  readonly runDistance: number;
}

/**
 * Default finale distances (scripted-progress units). Chosen so each beat reads
 * clearly: a short descent, a longer exhausted crawl, then a running stretch to
 * the barrier. The engine may override any field via {@link createFinaleController}.
 */
export const DEFAULT_FINALE_DISTANCES: FinaleDistanceConfig = {
  descendDistance: 200,
  crawlDistance: 600,
  runDistance: 800,
};

/** Options for {@link createFinaleController}. */
export interface FinaleControllerOptions {
  /**
   * Per-phase distances (Req 8.7-8.12). Partially overridable; omitted fields
   * fall back to {@link DEFAULT_FINALE_DISTANCES}. Negative/non-finite values
   * are clamped to 0 so the machine stays total and the thresholds monotonic.
   */
  readonly distances?: Partial<FinaleDistanceConfig>;
  /**
   * Per-frame hold (ms) for the TIME-driven crawl/run alternation, forwarded to
   * `selectAnimationFrame`. Omitted => the cycle's own default cadence. (The
   * locomotion FRAME alternation is time-driven in animationFrameCycle.ts; the
   * controller forwards an elapsed clock or tick the engine supplies.)
   */
  readonly frameDurationMs?: number;
}

/**
 * The finale controller — the pure scripted-finale driver (Req 8.7-8.15, 45.5).
 * Deterministic: all queries are functions of the accrued distance plus the
 * one-shot jump latch.
 */
export interface FinaleController {
  /**
   * Advance the scripted progress by `delta` (>= 0) scripted-progress units and
   * return the resulting phase. A negative/non-finite delta is treated as 0 (the
   * finale only moves forward). Once {@link jump} has latched JUMPED_THROUGH,
   * further `advance` calls are a no-op that keep returning JUMPED_THROUGH.
   */
  advance(delta: number): FinalePhaseName;

  /** The current phase for the accrued distance (and jump latch). */
  currentPhase(): FinalePhaseName;

  /** The accrued scripted-progress distance since finale start. */
  distance(): number;

  /**
   * Whether the finale currently has AUTOMATIC control of Kino — i.e. the
   * engine should IGNORE player locomotion input and script Kino's rightward
   * movement (Req 8.9-8.12). True through DESCEND, CRAWL, and RUN; false at the
   * barrier (locomotion stops; the only action is the final jump, Req 8.14) and
   * after jumping through.
   */
  isAutoControlled(): boolean;

  /**
   * Whether the final Jump action is available (Req 8.13-8.14). FALSE until the
   * barrier (Jumping is kept unavailable through descend/crawl/run, Req 8.13),
   * TRUE at the barrier for the final action (Req 8.14). After the jump-through
   * it is false again (the action has been consumed).
   */
  jumpEnabled(): boolean;

  /**
   * The locomotion {@link FinalePhase} to feed the Animation_Frame cycle, or
   * `undefined` when no restricted locomotion is active (DESCEND / AT_BARRIER /
   * JUMPED_THROUGH). 'crawl' during CRAWL, 'run' during RUN (Req 8.11-8.12).
   */
  locomotionPhase(): FinalePhase | undefined;

  /**
   * The current locomotion Animation_Frame, selected via the SHARED
   * `selectAnimationFrame` (task 8.3) from {@link locomotionPhase} — a crawl-step
   * during CRAWL and a run-step during RUN (Req 8.11-8.12/30.13-30.14). Returns
   * `undefined` when there is no restricted locomotion (DESCEND / AT_BARRIER /
   * JUMPED_THROUGH), so the engine renders those phases with its own
   * descend/idle/jump visuals. `elapsedMsOrTick` phases the two-frame
   * alternation; pass an elapsed-ms clock (`{ elapsedMs }`) or an integer step
   * (`{ frameTick }`).
   */
  locomotionFrame(clock?: FinaleLocomotionClock): AnimationFrame | undefined;

  /**
   * Perform the final primary action at the barrier (Req 8.15). ONLY valid at
   * AT_BARRIER: latches the terminal JUMPED_THROUGH phase (Kino Jumps through
   * into the final cinematic) and returns true. A jump attempted before the
   * barrier is REJECTED (Jumping is unavailable, Req 8.13) and returns false
   * with no state change. Idempotent once latched (returns false — already
   * jumped).
   */
  jump(): boolean;

  /**
   * Whether the finale is COMPLETE — i.e. the player has Jumped through the
   * barrier and the engine should now play the FINAL ending cinematic (Req 8.15
   * → 21.8). True iff the phase is JUMPED_THROUGH.
   */
  isComplete(): boolean;

  /**
   * The cinematic id the engine starts when the finale completes (Req 8.15 →
   * 21.8): {@link FINAL_ENDING_CINEMATIC_ID}, or `undefined` when the finale is
   * not yet complete. Returning the id (not starting a scene) keeps this pure —
   * the engine starts the CinematicScene with it.
   */
  endingCinematicId(): string | undefined;
}

/**
 * How the caller phases the TIME-driven crawl/run frame alternation. Exactly one
 * of `elapsedMs` (a monotonic ms clock) or `frameTick` (an integer step index)
 * is used; `frameTick` wins when both are present (one source of truth per
 * call), mirroring `selectAnimationFrame`'s own contract.
 */
export interface FinaleLocomotionClock {
  readonly elapsedMs?: number;
  readonly frameTick?: number;
}

/** Clamp a value to a finite, non-negative number (defaulting non-finite to 0). */
function clampNonNegative(value: number, fallback = 0): number {
  if (!Number.isFinite(value)) return fallback;
  return value < 0 ? 0 : value;
}

/**
 * Create a {@link FinaleController} for the World-5 scripted finale (Req
 * 8.7-8.15, 45.5). Deterministic and pure: the phase is a function of accrued
 * distance; the final jump is a one-shot latch. All distances are clamped
 * non-negative so the phase thresholds stay monotonic and the machine total.
 */
export function createFinaleController(
  options: FinaleControllerOptions = {},
): FinaleController {
  const distances: FinaleDistanceConfig = {
    descendDistance: clampNonNegative(
      options.distances?.descendDistance ?? DEFAULT_FINALE_DISTANCES.descendDistance,
      DEFAULT_FINALE_DISTANCES.descendDistance,
    ),
    crawlDistance: clampNonNegative(
      options.distances?.crawlDistance ?? DEFAULT_FINALE_DISTANCES.crawlDistance,
      DEFAULT_FINALE_DISTANCES.crawlDistance,
    ),
    runDistance: clampNonNegative(
      options.distances?.runDistance ?? DEFAULT_FINALE_DISTANCES.runDistance,
      DEFAULT_FINALE_DISTANCES.runDistance,
    ),
  };

  // Cumulative phase-start thresholds (monotonic by construction).
  const descendEnd = distances.descendDistance;
  const crawlEnd = descendEnd + distances.crawlDistance;
  const barrierAt = crawlEnd + distances.runDistance;

  let accrued = 0;
  let jumpedThrough = false;

  /** The DISTANCE-driven phase for the accrued distance (ignores the jump latch). */
  function distancePhase(): Exclude<FinalePhaseName, 'jumped-through'> {
    if (accrued < descendEnd) return 'descend';
    if (accrued < crawlEnd) return 'crawl';
    if (accrued < barrierAt) return 'run';
    return 'at-barrier';
  }

  function currentPhase(): FinalePhaseName {
    return jumpedThrough ? 'jumped-through' : distancePhase();
  }

  function locomotionPhase(): FinalePhase | undefined {
    const phase = currentPhase();
    if (phase === 'crawl') return 'crawl';
    if (phase === 'run') return 'run';
    return undefined;
  }

  return {
    advance(delta: number): FinalePhaseName {
      if (!jumpedThrough) {
        accrued += clampNonNegative(delta);
      }
      return currentPhase();
    },

    currentPhase,

    distance(): number {
      return accrued;
    },

    isAutoControlled(): boolean {
      // Automatic control holds through the scripted locomotion run-up: descend,
      // crawl, and run. At the barrier locomotion stops (the player's only
      // action is the final jump, Req 8.14); after jumping through control is
      // the cinematic's.
      const phase = currentPhase();
      return phase === 'descend' || phase === 'crawl' || phase === 'run';
    },

    jumpEnabled(): boolean {
      // Jump is available ONLY at the barrier (Req 8.13-8.14). Not before, and
      // not after the one-shot final jump has been consumed.
      return currentPhase() === 'at-barrier';
    },

    locomotionPhase,

    locomotionFrame(clock?: FinaleLocomotionClock): AnimationFrame | undefined {
      const phase = locomotionPhase();
      if (phase === undefined) return undefined;
      // Reuse the SHARED frame cycle (task 8.3): finale locomotion drives the
      // crawl-step / run-step alternation. Jumping is the finale's Movement_Mode
      // (world5Plan.WORLD5_FINALE_MODE); `finalePhase` overrides it to produce
      // the crawl/run frames (Req 30.14-30.15).
      return selectAnimationFrame({
        mode: 'jumping',
        finalePhase: phase,
        ...(clock?.frameTick !== undefined ? { frameTick: clock.frameTick } : {}),
        ...(clock?.elapsedMs !== undefined ? { elapsedMs: clock.elapsedMs } : {}),
        ...(options.frameDurationMs !== undefined
          ? { frameDurationMs: options.frameDurationMs }
          : {}),
      });
    },

    jump(): boolean {
      // The final primary action is valid ONLY at the barrier (Req 8.14-8.15).
      // Reject before the barrier (Jumping unavailable, Req 8.13) and reject a
      // second jump once latched.
      if (jumpedThrough) return false;
      if (distancePhase() !== 'at-barrier') return false;
      jumpedThrough = true;
      return true;
    },

    isComplete(): boolean {
      return jumpedThrough;
    },

    endingCinematicId(): string | undefined {
      return jumpedThrough ? FINAL_ENDING_CINEMATIC_ID : undefined;
    },
  };
}

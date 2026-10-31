// Feature: kino-game
//
// The fixed-timestep driver (design: "The fixed-timestep driver"; Req 26.2,
// 26.9, 9.1, 16.1, 7.10 relation).
//
// Rendering runs on the browser's variable-rate frame loop, but the simulation
// must advance in uniform fixed steps so crossing detection, timers, and
// safe-reposition are reproducible and independent of frame rate (Req 9, 26.9).
// This module is the PURE, Phaser-free accumulator that converts a real frame
// delta into a whole number of fixed simulation ticks.
//
// Contract (chosen for clean property-testability):
//   - The driver owns a `fixedDeltaS` (default 1/120 s) and an accumulator.
//   - `step(dt, inputs, advance)` adds `dt * timeScale` to the accumulator and
//     advances the simulation by calling `advance(fixedDeltaS, inputs)` once per
//     whole fixed step the accumulator has earned, up to `maxCatchUpSteps` this
//     frame. Leftover time < fixedDeltaS stays in the accumulator for the next
//     frame (no partial steps — every tick is exactly `fixedDeltaS`).
//   - `maxCatchUpSteps` caps catch-up work per frame to avoid a spiral-of-death
//     where a slow frame schedules ever more sim work (Req 26.9 performance).
//     When the cap is hit, the surplus accumulated time is DROPPED so the
//     accumulator cannot grow without bound across starved frames.
//   - `timeScale` is the uniform Time Slow hook (Req 16.1): a single factor
//     applied to the incoming delta, slowing Kino and obstacles together by the
//     same amount because they both advance off the same fixed ticks.
//   - `frozen` (paused) halts accumulation entirely — `step` runs no ticks and
//     leaves the accumulator untouched (Req 7.10 relation).
//
// Purity/determinism: given the same construction options and the same sequence
// of `(dt, inputs)` calls, the driver produces the same sequence of `advance`
// invocations and the same `StepResult`s. `advance` is injected by the caller
// so the driver carries no simulation state of its own beyond the accumulator.

/** Default fixed step: 120 Hz simulation (design default `1/120 s`). */
export const DEFAULT_FIXED_DELTA_S = 1 / 120;

/** Default per-frame catch-up cap guarding against the spiral-of-death. */
export const DEFAULT_MAX_CATCH_UP_STEPS = 5;

/** A callback that advances the simulation by exactly one fixed tick. */
export type AdvanceFn<I> = (fixedDeltaS: number, inputs: I) => void;

/** Construction options for {@link createFixedTimestepDriver}. */
export interface FixedTimestepOptions {
  /** Fixed step length in seconds (default {@link DEFAULT_FIXED_DELTA_S}). */
  fixedDeltaS?: number;
  /** Max fixed ticks to run in a single `step` (default {@link DEFAULT_MAX_CATCH_UP_STEPS}). */
  maxCatchUpSteps?: number;
  /** Initial uniform time scale (default 1 = real time). */
  timeScale?: number;
  /** Initial frozen/paused state (default false). */
  frozen?: boolean;
}

/** What a single `step` call did, for observation and testing. */
export interface StepResult {
  /** Number of fixed ticks advanced this frame (0..maxCatchUpSteps). */
  ticks: number;
  /** Simulated seconds advanced this frame (`ticks * fixedDeltaS`). */
  simulatedS: number;
  /** Remaining sub-step time carried into the next frame, in [0, fixedDeltaS). */
  accumulator: number;
  /** True when the catch-up cap was hit and surplus time was dropped. */
  clamped: boolean;
}

/** A pure, deterministic fixed-timestep accumulator/driver. */
export interface FixedTimestepDriver<I> {
  /** The fixed step length in seconds. */
  readonly fixedDeltaS: number;
  /** The per-frame catch-up step cap. */
  readonly maxCatchUpSteps: number;
  /**
   * Advance the simulation for one rendered frame of real time `dt` seconds.
   * Calls `advance(fixedDeltaS, inputs)` once per earned fixed tick, capped by
   * `maxCatchUpSteps`. Non-positive `dt` runs no ticks. While frozen, runs no
   * ticks and does not accumulate.
   */
  step(dt: number, inputs: I, advance: AdvanceFn<I>): StepResult;
  /** Current uniform time scale (Time Slow hook, Req 16.1). */
  getTimeScale(): number;
  /** Set the uniform time scale; clamped to be non-negative. */
  setTimeScale(scale: number): void;
  /** Is accumulation currently frozen (paused, Req 7.10 relation)? */
  isFrozen(): boolean;
  /** Freeze/unfreeze accumulation. Freezing preserves the current accumulator. */
  setFrozen(frozen: boolean): void;
  /** The sub-step time currently held in the accumulator (in [0, fixedDeltaS)). */
  getAccumulator(): number;
  /** Reset the accumulator to zero (e.g. on a fresh run). */
  reset(): void;
}

/**
 * Create a fixed-timestep driver. Pure factory: the returned driver's behavior
 * depends only on its options and the arguments passed to `step`.
 */
export function createFixedTimestepDriver<I = void>(
  options: FixedTimestepOptions = {},
): FixedTimestepDriver<I> {
  const fixedDeltaS = options.fixedDeltaS ?? DEFAULT_FIXED_DELTA_S;
  const maxCatchUpSteps = options.maxCatchUpSteps ?? DEFAULT_MAX_CATCH_UP_STEPS;

  if (!(fixedDeltaS > 0)) {
    throw new Error('fixedDeltaS must be a positive number');
  }
  if (!Number.isInteger(maxCatchUpSteps) || maxCatchUpSteps < 1) {
    throw new Error('maxCatchUpSteps must be a positive integer');
  }

  let timeScale = Math.max(0, options.timeScale ?? 1);
  let frozen = options.frozen ?? false;
  let accumulator = 0;

  function step(dt: number, inputs: I, advance: AdvanceFn<I>): StepResult {
    // Frozen (paused): halt accumulation entirely — no ticks, no state change.
    if (frozen) {
      return { ticks: 0, simulatedS: 0, accumulator, clamped: false };
    }

    // Only positive, finite real time contributes. Uniform Time Slow scaling
    // is applied here so Kino and obstacles slow together (Req 16.1).
    if (Number.isFinite(dt) && dt > 0) {
      accumulator += dt * timeScale;
    }

    let ticks = 0;
    while (accumulator >= fixedDeltaS && ticks < maxCatchUpSteps) {
      advance(fixedDeltaS, inputs);
      accumulator -= fixedDeltaS;
      ticks += 1;
    }

    // Spiral-of-death guard: if work remains but the cap was hit, drop the
    // surplus so the accumulator never grows unbounded across starved frames.
    let clamped = false;
    if (ticks === maxCatchUpSteps && accumulator >= fixedDeltaS) {
      clamped = true;
      accumulator = accumulator % fixedDeltaS;
    }

    return {
      ticks,
      simulatedS: ticks * fixedDeltaS,
      accumulator,
      clamped,
    };
  }

  return {
    fixedDeltaS,
    maxCatchUpSteps,
    step,
    getTimeScale: () => timeScale,
    setTimeScale: (scale: number) => {
      timeScale = Math.max(0, scale);
    },
    isFrozen: () => frozen,
    setFrozen: (next: boolean) => {
      frozen = next;
    },
    getAccumulator: () => accumulator,
    reset: () => {
      accumulator = 0;
    },
  };
}

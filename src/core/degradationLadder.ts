// Feature: kino-game
//
// The graceful-degradation ladder (task 12.3; design: "Frame budget / 60 fps
// target (Req 26.9, 26.2)": "a graceful degradation ladder sheds cost in order:
// (1) reduce particle counts, then (2) reduce parallax layer detail, then (3)
// drop non-essential visual effects — and never stalls the simulation or
// reduces input responsiveness. This degradation behavior is scoped to active
// gameplay").
//
// PURE and Phaser-free: a quality-level state machine that is a function of the
// measured frame-time signal and the current level. The engine feeds it per-
// frame timing (ms) and reads back WHICH effects to show; it makes no Phaser
// calls and allocates nothing per step.
//
// The ladder has four levels. Level 0 is FULL quality (everything on). Each
// step DOWN sheds the next cost in the design's order; stepping back UP restores
// it when headroom returns:
//
//   Level 0  FULL        particles + parallax detail + non-essential effects
//   Level 1  ReduceParticles     parallax detail + non-essential effects (fewer particles)
//   Level 2  ReduceParallax      non-essential effects (fewer particles, flatter parallax)
//   Level 3  DropEffects         minimal (fewest particles, flattest parallax, no extras)
//
// Hysteresis (two thresholds + sustain windows) keeps the level from flapping
// frame-to-frame: we only step DOWN after frame time stays OVER the high
// threshold for `downSustainFrames`, and only step UP after it stays UNDER the
// low threshold for `upSustainFrames`. The down threshold is the frame budget
// (default ~16.6 ms for 60 fps); the up threshold is comfortably below it so we
// do not immediately re-upgrade into another overload.

/** The ordered quality levels (0 = full quality, higher = more degraded). */
export enum QualityLevel {
  Full = 0,
  ReduceParticles = 1,
  ReduceParallax = 2,
  DropEffects = 3,
}

/** The MOST degraded level (ladder bottom). */
export const MAX_QUALITY_LEVEL = QualityLevel.DropEffects;

/** Default 60 fps frame budget in milliseconds (~16.67 ms). */
export const DEFAULT_FRAME_BUDGET_MS = 1000 / 60;

/** The concrete render knobs the current level resolves to for the engine. */
export interface QualitySettings {
  /** The active ladder level. */
  level: QualityLevel;
  /**
   * Particle budget as a fraction of full [0..1]: 1 at Full, reduced from
   * ReduceParticles on down. The engine multiplies its particle counts by this.
   */
  particleScale: number;
  /**
   * How many parallax layers of detail to draw as a fraction of full [0..1]:
   * 1 until ReduceParallax, then reduced. The engine drops the least-essential
   * (farthest / most subtle) layers first.
   */
  parallaxScale: number;
  /** Whether non-essential visual effects (extras) render at all. */
  nonEssentialEffects: boolean;
}

/** Construction options for {@link createDegradationLadder}. */
export interface DegradationLadderOptions {
  /**
   * Frame-time (ms) at/above which we consider the frame OVER budget and step
   * DOWN after the sustain window. Default {@link DEFAULT_FRAME_BUDGET_MS}.
   */
  downThresholdMs?: number;
  /**
   * Frame-time (ms) at/below which we consider there is headroom and step UP
   * after the sustain window. Must be < `downThresholdMs` to give hysteresis.
   * Default 90% of the down threshold.
   */
  upThresholdMs?: number;
  /** Consecutive over-budget frames required before stepping down. Default 30. */
  downSustainFrames?: number;
  /** Consecutive under-threshold frames required before stepping up. Default 60. */
  upSustainFrames?: number;
  /** Initial ladder level. Default {@link QualityLevel.Full}. */
  initialLevel?: QualityLevel;
}

/** The public surface of the degradation ladder. */
export interface DegradationLadder {
  /**
   * Feed one rendered frame's measured frame time (ms) WHILE gameplay is
   * active. Updates the sustain counters and may step the level by at most one
   * rung this frame. Returns the (possibly unchanged) current level. Scoped to
   * active gameplay — the engine calls this only during a live run.
   */
  sample(frameTimeMs: number): QualityLevel;
  /** The current ladder level. */
  level(): QualityLevel;
  /** The concrete render knobs for the current level. */
  settings(): QualitySettings;
  /**
   * Reset to a given level (default Full) and clear the sustain counters — e.g.
   * on entering a fresh run so degradation never carries across runs/menus
   * (scoped to active gameplay).
   */
  reset(level?: QualityLevel): void;
}

/** Clamp a level into the valid `[Full, MAX]` range. */
function clampLevel(level: number): QualityLevel {
  if (level < QualityLevel.Full) return QualityLevel.Full;
  if (level > MAX_QUALITY_LEVEL) return MAX_QUALITY_LEVEL;
  return Math.round(level) as QualityLevel;
}

/**
 * Resolve the concrete render knobs for a ladder level. PURE and exported so
 * tests and the engine can map a level to settings without a ladder instance.
 * The order matches the design ladder: particles shed first, then parallax
 * detail, then non-essential effects.
 */
export function qualitySettingsForLevel(level: QualityLevel): QualitySettings {
  switch (clampLevel(level)) {
    case QualityLevel.Full:
      return { level: QualityLevel.Full, particleScale: 1, parallaxScale: 1, nonEssentialEffects: true };
    case QualityLevel.ReduceParticles:
      // (1) reduce particle counts.
      return { level: QualityLevel.ReduceParticles, particleScale: 0.5, parallaxScale: 1, nonEssentialEffects: true };
    case QualityLevel.ReduceParallax:
      // (2) reduce parallax layer detail (particles already reduced).
      return { level: QualityLevel.ReduceParallax, particleScale: 0.25, parallaxScale: 0.5, nonEssentialEffects: true };
    case QualityLevel.DropEffects:
    default:
      // (3) drop non-essential visual effects (particles/parallax at minimum).
      return { level: QualityLevel.DropEffects, particleScale: 0, parallaxScale: 0, nonEssentialEffects: false };
  }
}

/**
 * Create a graceful-degradation ladder (design: "graceful degradation ladder";
 * Req 26.9). See the module header for the level order and hysteresis contract.
 */
export function createDegradationLadder(
  options: DegradationLadderOptions = {},
): DegradationLadder {
  const downThresholdMs =
    options.downThresholdMs !== undefined && options.downThresholdMs > 0
      ? options.downThresholdMs
      : DEFAULT_FRAME_BUDGET_MS;
  // Up threshold defaults below the down threshold for hysteresis; if a bad
  // config puts it at/above the down threshold, pull it to 90% of down.
  const requestedUp = options.upThresholdMs;
  const upThresholdMs =
    requestedUp !== undefined && requestedUp > 0 && requestedUp < downThresholdMs
      ? requestedUp
      : downThresholdMs * 0.9;

  const downSustainFrames = Math.max(1, Math.floor(options.downSustainFrames ?? 30));
  const upSustainFrames = Math.max(1, Math.floor(options.upSustainFrames ?? 60));

  let level = clampLevel(options.initialLevel ?? QualityLevel.Full);
  // Sustain counters: consecutive frames over the down threshold / under the up.
  let overBudgetFrames = 0;
  let underThresholdFrames = 0;

  function sample(frameTimeMs: number): QualityLevel {
    // Guard non-finite/negative input: treat as a neutral frame (no change).
    if (!Number.isFinite(frameTimeMs) || frameTimeMs < 0) {
      return level;
    }

    if (frameTimeMs >= downThresholdMs) {
      // Over budget: accumulate toward a step down, reset the up counter.
      overBudgetFrames++;
      underThresholdFrames = 0;
      if (overBudgetFrames >= downSustainFrames && level < MAX_QUALITY_LEVEL) {
        level = clampLevel(level + 1);
        overBudgetFrames = 0; // require another full window before the next step
      }
    } else if (frameTimeMs <= upThresholdMs) {
      // Headroom: accumulate toward a step up, reset the down counter.
      underThresholdFrames++;
      overBudgetFrames = 0;
      if (underThresholdFrames >= upSustainFrames && level > QualityLevel.Full) {
        level = clampLevel(level - 1);
        underThresholdFrames = 0;
      }
    } else {
      // In the hysteresis band between the two thresholds: hold steady and let
      // both counters decay so a stable mid-band run never drifts.
      overBudgetFrames = 0;
      underThresholdFrames = 0;
    }
    return level;
  }

  function reset(to: QualityLevel = QualityLevel.Full): void {
    level = clampLevel(to);
    overBudgetFrames = 0;
    underThresholdFrames = 0;
  }

  return {
    sample,
    level: () => level,
    settings: () => qualitySettingsForLevel(level),
    reset,
  };
}

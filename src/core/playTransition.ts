// Feature: kino-game
//
// Play-button expand transition MATH — the PURE, Phaser-free helpers behind the
// task-9.8 Play/Continue-Story launch transition (design: "Play-button expand
// transition (Req 20.36–20.38, 20.12)"; Req 20.12, 20.36, 20.37, 20.38).
//
// The engine (MainMenuScene) owns the actual Phaser tweens/particles that:
//   1. expand the Play control as an UPWARD color fill until it covers the
//      screen (Req 20.36),
//   2. THEN fade in the gameplay HUD controls + World background (Req 20.37),
//   3. THEN GLIDE the persistent Kino sprite from its menu position to the fixed
//      run start position on the left where it stabilizes (Req 20.38, 20.12).
//
// This module owns ONLY the reusable, deterministic math behind that choreography
// so it stays unit-testable with no browser, canvas, or Phaser:
//   - `computeGlide(from, to, t)` — the eased point interpolation Kino follows
//     during the glide (and the color-fill height uses the same easing),
//   - `computeRunStartPosition(screen)` — where Kino must land for the run,
//     derived from the SAME fixed-Kino geometry GameplayScene uses (left third,
//     resting on the ground strip), so the glide ends exactly where the run
//     begins (no visual jump at hand-off),
//   - `resolvePlayTransitionTiming(config)` — the three ordered phase durations
//     (expand → fade → glide) resolved from optional config overrides with sane
//     defaults and a total convenience sum.
//
// Purity/determinism: every function is a pure function of its inputs — no
// module state, no Phaser, no DOM. See `src/README.md` for the core↔engine
// boundary (enforced by test/boundary.core-no-phaser.test.ts).

/** A point in pixels (screen/design space; the caller fixes the frame). */
export interface TransitionPoint {
  readonly x: number;
  readonly y: number;
}

/** A width/height screen size in pixels. */
export interface TransitionScreen {
  readonly width: number;
  readonly height: number;
}

/**
 * The fixed-Kino run-start GEOMETRY, mirrored from GameplayScene so the glide
 * lands exactly where the run seeds Kino. Kino is pinned on the LEFT third
 * (Req 45.1) resting on the ground strip at the bottom of the play area.
 */
export interface RunStartGeometry {
  /** Nominal Kino body width (px). Default 48 (GameplayScene `KINO_BODY_WIDTH`). */
  readonly kinoBodyWidth: number;
  /** Nominal Kino body height (px). Default 48 (GameplayScene `KINO_BODY_HEIGHT`). */
  readonly kinoBodyHeight: number;
  /** Ground strip height (px) at the bottom. Default 96 (GameplayScene). */
  readonly groundStripHeight: number;
}

/** The default fixed-Kino geometry, identical to GameplayScene's constants. */
export const DEFAULT_RUN_START_GEOMETRY: RunStartGeometry = {
  kinoBodyWidth: 48,
  kinoBodyHeight: 48,
  groundStripHeight: 96,
};

/** The three ordered phases of the Play expand transition (Req 20.36–20.38). */
export interface PlayTransitionTiming {
  /** ms the Play color fill grows upward to cover the screen (Req 20.36). */
  readonly expandMs: number;
  /** ms the HUD controls + World background fade in afterward (Req 20.37). */
  readonly fadeMs: number;
  /** ms Kino glides from the menu position to the run start (Req 20.38). */
  readonly glideMs: number;
  /** Convenience sum: the full transition duration (expand + fade + glide). */
  readonly totalMs: number;
}

/** Optional per-phase overrides for `resolvePlayTransitionTiming`. */
export interface PlayTransitionTimingConfig {
  readonly expandMs?: number;
  readonly fadeMs?: number;
  readonly glideMs?: number;
}

/** Default phase durations (ms) when config supplies no overrides. */
export const DEFAULT_PLAY_TRANSITION_TIMING = {
  expandMs: 420,
  fadeMs: 260,
  glideMs: 520,
} as const;

/**
 * Smoothstep easing (ease-in-out), clamped to [0,1]: `3t^2 - 2t^3`. Monotonic
 * non-decreasing with `ease(0) === 0` and `ease(1) === 1`, so a glide/fill
 * driven by it starts at `from`, ends at `to`, and never overshoots.
 */
export function easeInOut(t: number): number {
  const c = clamp01(t);
  return c * c * (3 - 2 * c);
}

/**
 * Eased interpolation of a point from `from` (at t=0) to `to` (at t=1) along
 * the smoothstep curve. `t` is clamped to [0,1], so `computeGlide(a, b, 0)` is
 * exactly `a` and `computeGlide(a, b, 1)` is exactly `b`; intermediate `t`
 * values move monotonically between them on each axis (the easing is monotonic).
 * Used for Kino's glide-to-start (Req 20.38) and reused for the color-fill rise.
 */
export function computeGlide(
  from: TransitionPoint,
  to: TransitionPoint,
  t: number,
): TransitionPoint {
  const e = easeInOut(t);
  return {
    x: from.x + (to.x - from.x) * e,
    y: from.y + (to.y - from.y) * e,
  };
}

/**
 * Scalar form of `computeGlide` for a single value (e.g. the color-fill height
 * growing from 0 to the screen height, or an alpha fading 0→1). Same eased,
 * clamped, monotonic contract: `glideScalar(a, b, 0) === a`,
 * `glideScalar(a, b, 1) === b`.
 */
export function glideScalar(from: number, to: number, t: number): number {
  return from + (to - from) * easeInOut(t);
}

/**
 * Compute the CENTER point where Kino must stabilize for the run, from the SAME
 * fixed-Kino geometry GameplayScene uses (Req 45.1, 20.38): horizontally pinned
 * on the LEFT third (`round(width / 3)` plus half the body width to get the
 * sprite center) and vertically resting on the ground strip (body base on the
 * ground line, so the center is half a body above it). Deriving it here keeps
 * the menu's glide target and the run's seed position in lockstep — the glide
 * ends exactly where GameplayScene draws Kino, so there is no jump at hand-off.
 */
export function computeRunStartPosition(
  screen: TransitionScreen,
  geometry: RunStartGeometry = DEFAULT_RUN_START_GEOMETRY,
): TransitionPoint {
  const screenX = Math.round(screen.width / 3);
  const groundY = screen.height - geometry.groundStripHeight;
  return {
    x: screenX + geometry.kinoBodyWidth / 2,
    y: groundY - geometry.kinoBodyHeight / 2,
  };
}

/**
 * Resolve the three ordered phase durations (expand → fade → glide) from
 * optional config overrides, falling back to `DEFAULT_PLAY_TRANSITION_TIMING`.
 * A non-finite or negative override is ignored (uses the default) so a bad
 * config value can never produce a stuck or negative-length tween. `totalMs` is
 * the sum of the resolved phases.
 */
export function resolvePlayTransitionTiming(
  config?: PlayTransitionTimingConfig,
): PlayTransitionTiming {
  const expandMs = resolveDuration(
    config?.expandMs,
    DEFAULT_PLAY_TRANSITION_TIMING.expandMs,
  );
  const fadeMs = resolveDuration(
    config?.fadeMs,
    DEFAULT_PLAY_TRANSITION_TIMING.fadeMs,
  );
  const glideMs = resolveDuration(
    config?.glideMs,
    DEFAULT_PLAY_TRANSITION_TIMING.glideMs,
  );
  return { expandMs, fadeMs, glideMs, totalMs: expandMs + fadeMs + glideMs };
}

/** Clamp a number into [0,1]; non-finite falls to 0. */
function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  if (n < 0) return 0;
  if (n > 1) return 1;
  return n;
}

/** A finite, non-negative duration, else the fallback. */
function resolveDuration(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : fallback;
}

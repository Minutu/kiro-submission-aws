// Feature: kino-game
//
// Menu equip jiggle MATH — the PURE, Phaser-free helpers behind the task-9.5
// "jello bob" equip-feedback animation (design: "Cosmetics & Layered Rendering
// (Req 19, 43)"; Req 43.1, 43.2, 43.3, 43.4, 43.5).
//
// WHAT THIS IS (and is NOT): when the player equips a Cosmetic or a Skill in the
// menu, Kino (and the equipped-item preview) plays a brief jiggle in which it
// bobs up and down like jello as equip feedback (Req 43.1-43.2). This is a
// MENU-ONLY feedback animation, DISTINCT from the gameplay Movement_Mode
// Animation_Frame cycles (Req 43.3) — it does NOT reuse `animationFrameCycle`'s
// per-mode frame selection (task 8.3), which drives GAMEPLAY poses. This module
// owns ONLY the reusable, deterministic jiggle curve + the config/timing
// resolution so it stays unit-testable with no browser, canvas, or Phaser.
//
// The engine (InventoryScene) owns the actual Phaser playback — a tween or an
// update-driven application of `jelloBob(t)` to the preview's (and/or grid
// cell's) scale/offset over `durationMs`. It reads the animation ASSET from the
// resolved `menu-equip-jiggle` config key (Req 43.4) with a placeholder fallback
// when the key is missing or empty (Req 43.5), so the game stays functional with
// placeholder art.
//
// Purity/determinism: every function is a pure function of its inputs — no
// module state, no Phaser, no DOM. See `src/README.md` for the core↔engine
// boundary (enforced by test/boundary.core-no-phaser.test.ts).

/** The Config_File field this module reads (the "menu-equip-jiggle" asset key). */
interface EquipJiggleConfigInput {
  /** The configured "menu-equip-jiggle" asset key; '' / missing => placeholder. */
  readonly menuEquipJiggle?: string;
}

/**
 * The documented PLACEHOLDER asset key used when the Config_File's
 * `menuEquipJiggle` ("menu-equip-jiggle") key is MISSING or EMPTY (Req 43.5).
 * The Asset_Registry already registers the jiggle under the `menuEquipJiggle`
 * registry key and falls back to a tinted placeholder when no real path is
 * configured, so resolving to this key keeps the game functional with
 * placeholder art.
 */
export const EQUIP_JIGGLE_PLACEHOLDER_KEY = 'menuEquipJiggle';

/**
 * Default jiggle DURATION (ms). A brief, non-blocking flourish — long enough to
 * read as a jello bob, short enough not to interfere with further selection.
 * There is no timing key in the Config_File today (the `menuEquipJiggle` key is
 * an ASSET key, Req 43.4); this is the sensible default the engine plays over.
 */
export const DEFAULT_EQUIP_JIGGLE_DURATION_MS = 360;

/**
 * Default number of up/down bob oscillations across the whole animation. Two
 * bobs read clearly as "jello" (a settle-in wobble) without dragging on.
 */
export const DEFAULT_EQUIP_JIGGLE_BOBS = 2;

/**
 * Default peak squash-and-stretch amount (unitless scale delta). At the bob
 * extremes Kino stretches/squashes by up to this fraction (e.g. 0.18 => ±18%);
 * it is always 0 at t=0 and t=1 so the item rests (Req 43.3).
 */
export const DEFAULT_EQUIP_JIGGLE_AMPLITUDE = 0.18;

/** The resolved jiggle configuration the engine plays the tween over. */
export interface EquipJiggleConfig {
  /** The resolved animation asset key (configured value, else the placeholder). */
  readonly assetKey: string;
  /** True when the placeholder fallback was used (config key missing/empty). */
  readonly usedPlaceholder: boolean;
  /** How long the whole jiggle runs (ms). Always positive and finite. */
  readonly durationMs: number;
  /** Number of up/down bob oscillations across the animation. */
  readonly bobs: number;
  /** Peak squash-and-stretch amount (unitless scale delta). */
  readonly amplitude: number;
}

/** A squash-and-stretch transform snapshot for a single instant of the bob. */
export interface JelloTransform {
  /** Horizontal scale multiplier (1 = neutral/rest). */
  readonly scaleX: number;
  /** Vertical scale multiplier (1 = neutral/rest). */
  readonly scaleY: number;
  /** Vertical offset as a fraction of the item's height (0 = rest, up is negative). */
  readonly offsetY: number;
}

/** The neutral/identity transform — the item fully at rest (Req 43.3). */
export const NEUTRAL_JELLO_TRANSFORM: JelloTransform = {
  scaleX: 1,
  scaleY: 1,
  offsetY: 0,
};

/** Optional overrides for {@link resolveEquipJiggleConfig} timing/shape params. */
export interface ResolveEquipJiggleOptions {
  readonly durationMs?: number;
  readonly bobs?: number;
  readonly amplitude?: number;
}

/**
 * Resolve the menu equip jiggle configuration from the Config_File (Req
 * 43.4-43.5). Reads the "menu-equip-jiggle" asset key: when it is present and
 * non-empty the configured value is used; when it is MISSING or EMPTY the
 * documented placeholder key ({@link EQUIP_JIGGLE_PLACEHOLDER_KEY}) is used so
 * the game stays functional (Req 43.5). Timing/shape params come from sensible
 * defaults (no Config_File timing key exists today) and may be overridden.
 *
 * Pure and total: any non-finite/non-positive timing override falls back to the
 * default so `durationMs`/`bobs` are always positive and finite.
 */
export function resolveEquipJiggleConfig(
  config?: EquipJiggleConfigInput,
  options?: ResolveEquipJiggleOptions,
): EquipJiggleConfig {
  const configured = config?.menuEquipJiggle;
  const hasConfigured = typeof configured === 'string' && configured.trim().length > 0;
  const assetKey = hasConfigured ? (configured as string) : EQUIP_JIGGLE_PLACEHOLDER_KEY;

  const durationMs = positiveOr(options?.durationMs, DEFAULT_EQUIP_JIGGLE_DURATION_MS);
  const bobs = positiveOr(options?.bobs, DEFAULT_EQUIP_JIGGLE_BOBS);
  const amplitude = finiteOr(options?.amplitude, DEFAULT_EQUIP_JIGGLE_AMPLITUDE);

  return {
    assetKey,
    usedPlaceholder: !hasConfigured,
    durationMs,
    bobs,
    amplitude,
  };
}

/**
 * THE jello-bob curve. Given normalized time `t` in [0, 1], returns the
 * squash-and-stretch {@link JelloTransform} for that instant of the jiggle
 * (Req 43.1-43.2). The item BOBS up and down like jello: it rises/squashes and
 * falls/stretches through {@link DEFAULT_EQUIP_JIGGLE_BOBS} oscillations, with
 * a settle envelope so the wobble fades toward rest.
 *
 * KEY CONTRACT (Req 43.3): `jelloBob(0)` and `jelloBob(1)` return the NEUTRAL
 * transform (scaleX = scaleY = 1, offsetY = 0) so the item starts and ENDS at
 * rest — the flourish leaves nothing displaced. In the MIDDLE the transform
 * deviates from neutral (a visible bob). Volume-preserving: when it stretches
 * vertically it squashes horizontally and vice-versa.
 *
 * Pure and total: `t` is clamped to [0, 1]; non-finite `t` is treated as 0.
 */
export function jelloBob(
  t: number,
  options?: { bobs?: number; amplitude?: number },
): JelloTransform {
  const clamped = clamp01(Number.isFinite(t) ? t : 0);
  const bobs = positiveOr(options?.bobs, DEFAULT_EQUIP_JIGGLE_BOBS);
  const amplitude = finiteOr(options?.amplitude, DEFAULT_EQUIP_JIGGLE_AMPLITUDE);

  // Settle envelope: sin(pi * t) is 0 at both ends and 1 at the midpoint, so the
  // whole wobble is forced to zero at t=0 and t=1 (the rest contract, Req 43.3)
  // and is strongest in the middle (the visible bob).
  const envelope = Math.sin(Math.PI * clamped);

  // Oscillation: full up/down cycles across the animation. `bobs` full periods
  // means the vertical offset bobs up then down `bobs` times while the envelope
  // tapers it. Negative offsetY = up (screen +y is down).
  const wobble = Math.sin(2 * Math.PI * bobs * clamped);

  const displacement = amplitude * envelope * wobble;

  // Squash-and-stretch: stretch tall (scaleY up) when rising (offset negative),
  // squash flat (scaleY down) when falling, with the inverse on scaleX so the
  // silhouette reads as jello. `displacement` is already enveloped to 0 at ends.
  const stretch = displacement;
  return {
    scaleX: 1 - stretch,
    scaleY: 1 + stretch,
    // offsetY as a fraction of height; up (negative) on the stretch half.
    offsetY: -displacement,
  };
}

// -- small pure helpers ----------------------------------------------------

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Return `value` when it is a positive finite number, else `fallback`. */
function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/** Return `value` when it is a finite number, else `fallback`. */
function finiteOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

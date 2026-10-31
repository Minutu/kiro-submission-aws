// Feature: kino-game
//
// BalanceTable — the single choke point for NUMERIC RANGE validation of the
// tunable `Config_File.balance` block (Req 47.2, 47.4, 26.8).
//
// Contract: `ConfigFile.loadAndValidate` is the STRUCTURAL guard (every key
// exists with the right shape). `BalanceTable` is the complementary NUMERIC
// guard (every value sits inside its documented sensible range). The two run
// in addition to each other (Req 47.4); in every case the game stays startable
// and playable against defaults (Req 47.3).
//
// Behavior (Req 47.2): WHEN a balance value is read, IF it is missing (absent /
// NaN / non-finite) OR outside its documented [min, max] range, the table
// substitutes the documented DEFAULT for that key and emits a single developer
// warning via console.warn. Because gameplay modules read tunables ONLY through
// these typed getters, validated/defaulted values flow everywhere without any
// per-call checks and no gameplay module hardcodes a constant (Req 26.8).
//
// The RANGE table below mirrors the inline unit / default / sensible-range
// comments on `defaultConfig.balance` in config.ts — it is the machine-readable
// twin of those comments. Keep the two in sync when tuning.
//
// PURE TypeScript — no Phaser import (src/config is Phaser-free per
// src/README.md).

import { defaultConfig } from './config.ts';
import type { BalanceConfig } from './config.ts';

/** Prefix for every developer-facing warning this module emits. */
const WARN_PREFIX = '[KINO][BalanceTable]';

/** A single validated scalar: its documented default and inclusive range. */
interface RangeSpec {
  /** Documented default substituted when the configured value is invalid. */
  default: number;
  /** Inclusive lower bound of the sensible range. */
  min: number;
  /** Inclusive upper bound of the sensible range. */
  max: number;
}

/**
 * The RANGE table — documented default + sensible [min, max] for every scalar
 * balance value, keyed by a dotted path into `BalanceConfig`. Mirrors the
 * inline comments in config.ts (Req 47.2 reference data).
 */
const RANGE_TABLE = {
  // --- movement: per-mode physics (Req 2-6) ---
  'movement.jump.impulse': { default: 520, min: 350, max: 700 }, // px/s up (Req 2.1)
  'movement.jump.gravity': { default: 1600, min: 1000, max: 2200 }, // px/s² down (Req 2.2)
  'movement.flight.impulse': { default: 300, min: 180, max: 480 }, // px/s up (Req 3.1)
  'movement.flight.gravity': { default: 900, min: 500, max: 1400 }, // px/s² down (Req 3.2)
  'movement.underwater.impulse': { default: 300, min: 180, max: 480 }, // px/s down inverted (Req 5.2)
  'movement.underwater.buoyancy': { default: 900, min: 500, max: 1400 }, // px/s² up (Req 5.1)
  'movement.zigzag.angleDeg': { default: 30, min: 20, max: 45 }, // degrees (Req 4.1)
  'movement.zigzag.speed': { default: 260, min: 160, max: 380 }, // px/s diagonal (Req 4.8)

  // --- difficulty: scroll speed, density, thresholds (Req 7, 23, 45, 46) ---
  'difficulty.scrollSpeed.base': { default: 220, min: 140, max: 320 }, // px/s (Req 45, 7.6)
  'difficulty.scrollSpeed.rampPerObstacle': { default: 2.5, min: 0, max: 6 }, // px/s per cleared obstacle (Req 7.6, 23.3)
  'difficulty.scrollSpeed.maxMultiplier': { default: 2.2, min: 1.2, max: 3.0 }, // × base (Req 7.6)
  'difficulty.obstacleDensity.baseGapPx': { default: 360, min: 260, max: 520 }, // px (Req 46, 23.3)
  'difficulty.obstacleDensity.minGapPx': { default: 210, min: 150, max: 300 }, // px floor (Req 23.3)
  'difficulty.worldUnlockThreshold': { default: 50, min: 30, max: 100 }, // points (Req 7.1)

  // --- skills: per-skill cooldown / duration / magnitude (Req 12-18, 35) ---
  'skills.secondChance.windowS': { default: 3, min: 1, max: 5 }, // s protective window (Req 13.1)
  'skills.timeErase.windowS': { default: 4, min: 2, max: 6 }, // s armed window (Req 14.1)
  'skills.dash.distancePx': { default: 260, min: 150, max: 420 }, // px burst (Req 15.2)
  'skills.dash.durationS': { default: 0.25, min: 0.1, max: 0.5 }, // s burst (Req 15.2)
  'skills.timeSlow.factor': { default: 0.5, min: 0.3, max: 0.8 }, // × speed (Req 16.2)
  'skills.timeSlow.durationS': { default: 5, min: 2, max: 8 }, // s (Req 16.2)
  'skills.scoreMultiplier.factor': { default: 2, min: 2, max: 5 }, // × credited score (Req 17.1)
  'skills.scoreMultiplier.durationS': { default: 10, min: 5, max: 20 }, // s (Req 17.1)
  'skills.ultraInstinct.durationS': { default: 10, min: 5, max: 20 }, // s auto-evasion (Req 18.1)
  'skills.cooldownS.default': { default: 12, min: 6, max: 30 }, // s default cooldown (Req 12.3)

  // --- perks: boost/cooldown percentages, cosmetic drop (Req 10-11) ---
  'perks.speedBoostPct': { default: 12, min: 5, max: 30 }, // % faster (Req 11.2)
  'perks.cooldownReductionPct': { default: 20, min: 10, max: 50 }, // % shorter cooldown (Req 11.1)
  'perks.cosmeticDropProbability': { default: 0.35, min: 0, max: 1 }, // probability (Req 11.5, 10.8)

  // --- hitboxes: per-mode body-sprite scale, < 1 favors player (Req 41) ---
  'hitboxes.scale.default': { default: 0.7, min: 0.5, max: 0.9 }, // × sprite (Req 41.1)
  'hitboxes.scale.jumping': { default: 0.72, min: 0.5, max: 0.9 }, // × sprite (Req 41.2)
  'hitboxes.scale.flight': { default: 0.68, min: 0.5, max: 0.9 }, // × sprite (Req 41.2)
  'hitboxes.scale.zigzag': { default: 0.75, min: 0.5, max: 0.9 }, // × sprite (Req 41.2)
  'hitboxes.scale.underwater': { default: 0.68, min: 0.5, max: 0.9 }, // × sprite (Req 41.2)

  // --- transitions: telegraph lead (Req 6.3) ---
  'transitions.telegraph.leadPx': { default: 500, min: 300, max: 800 }, // px (Req 6.3)
} as const satisfies Record<string, RangeSpec>;

/** Every validated scalar path. */
export type BalanceKey = keyof typeof RANGE_TABLE;

/**
 * The movement mode keys whose per-mode hitbox scale the collision system reads
 * (Req 41.2). `default` is the fallback scale (Req 41.1).
 */
export type HitboxScaleKey = 'default' | 'jumping' | 'flight' | 'zigzag' | 'underwater';

/** The public, read-only surface gameplay modules consume (Req 26.8). */
export interface BalanceTable {
  // --- movement physics (Req 2-6) ---
  jumpImpulse(): number;
  jumpGravity(): number;
  flightImpulse(): number;
  flightGravity(): number;
  underwaterImpulse(): number;
  underwaterBuoyancy(): number;
  zigzagAngleDeg(): number;
  zigzagSpeed(): number;

  // --- difficulty / scroll / density / thresholds (Req 7, 23, 45, 46) ---
  scrollSpeedBase(): number;
  scrollSpeedRampPerObstacle(): number;
  scrollSpeedMaxMultiplier(): number;
  baseGapPx(): number;
  minGapPx(): number;
  worldUnlockThreshold(): number;
  /** Obstacle counts at which perk choices are offered (Req 10.1-10.2). */
  perkObstacleMilestones(): number[];

  // --- skills (Req 12-18, 35) ---
  secondChanceWindowS(): number;
  timeEraseWindowS(): number;
  dashDistancePx(): number;
  dashDurationS(): number;
  timeSlowFactor(): number;
  timeSlowDurationS(): number;
  scoreMultiplierFactor(): number;
  scoreMultiplierDurationS(): number;
  ultraInstinctDurationS(): number;
  defaultCooldownS(): number;

  // --- perks (Req 10-11) ---
  speedBoostPct(): number;
  cooldownReductionPct(): number;
  cosmeticDropProbability(): number;

  // --- hitboxes (Req 41) ---
  /** Per-mode body-sprite hitbox scale, falling back to `default` (Req 41.1-41.2). */
  hitboxScale(mode: HitboxScaleKey): number;

  // --- transitions (Req 6.3) ---
  telegraphLeadPx(): number;

  /**
   * Low-level escape hatch: validate-and-read any scalar by its dotted path.
   * Every typed getter above delegates here so the range check is centralized
   * (single choke point for Req 47.2).
   */
  get(key: BalanceKey): number;
}

/** Read a dotted path out of an arbitrary object; returns `undefined` if absent. */
function readPath(source: unknown, path: string): unknown {
  let cursor: unknown = source;
  for (const segment of path.split('.')) {
    if (typeof cursor !== 'object' || cursor === null) {
      return undefined;
    }
    cursor = (cursor as Record<string, unknown>)[segment];
  }
  return cursor;
}

/**
 * Build a `BalanceTable` from a (possibly partial / untrusted) balance block.
 *
 * Each read validates against the RANGE table: a missing, non-finite, or
 * out-of-range value is replaced by its documented default and warned about
 * once per offending read (Req 47.2). Falls back to `defaultConfig.balance`
 * values wherever the supplied block omits them.
 *
 * @param balance The `Config_File.balance` block (typically from
 *   `loadAndValidate(...).balance`). Optional/partial input is tolerated.
 * @returns A read-only `BalanceTable` of typed getters.
 */
export function createBalanceTable(balance?: Partial<BalanceConfig>): BalanceTable {
  const source = balance ?? defaultConfig.balance;

  /** Validate-and-read a scalar by key — the single choke point (Req 47.2). */
  function get(key: BalanceKey): number {
    const spec: RangeSpec = RANGE_TABLE[key];
    const raw = readPath(source, key);

    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      console.warn(
        `${WARN_PREFIX} "${key}" is missing or not a finite number; ` +
          `substituting documented default ${spec.default}.`,
      );
      return spec.default;
    }

    if (raw < spec.min || raw > spec.max) {
      console.warn(
        `${WARN_PREFIX} "${key}" = ${raw} is outside the documented range ` +
          `[${spec.min}, ${spec.max}]; substituting documented default ${spec.default}.`,
      );
      return spec.default;
    }

    return raw;
  }

  /**
   * `perkObstacleMilestones` is an array tunable (not a scalar in the range
   * table). Validate it structurally: a non-empty array of finite positive
   * numbers, else fall back to the documented default. Mirrors the inline
   * comment default [20, 40] (Req 10.1-10.2).
   */
  function perkObstacleMilestones(): number[] {
    const fallback: number[] =
      defaultConfig.balance.difficulty.perkObstacleMilestones;
    const raw = readPath(source, 'difficulty.perkObstacleMilestones');

    if (
      !Array.isArray(raw) ||
      raw.length === 0 ||
      !raw.every((n) => typeof n === 'number' && Number.isFinite(n) && n > 0)
    ) {
      console.warn(
        `${WARN_PREFIX} "difficulty.perkObstacleMilestones" is missing or ` +
          `invalid; substituting documented default [${fallback.join(', ')}].`,
      );
      return [...fallback];
    }

    return [...(raw as number[])];
  }

  return {
    // movement
    jumpImpulse: () => get('movement.jump.impulse'),
    jumpGravity: () => get('movement.jump.gravity'),
    flightImpulse: () => get('movement.flight.impulse'),
    flightGravity: () => get('movement.flight.gravity'),
    underwaterImpulse: () => get('movement.underwater.impulse'),
    underwaterBuoyancy: () => get('movement.underwater.buoyancy'),
    zigzagAngleDeg: () => get('movement.zigzag.angleDeg'),
    zigzagSpeed: () => get('movement.zigzag.speed'),

    // difficulty
    scrollSpeedBase: () => get('difficulty.scrollSpeed.base'),
    scrollSpeedRampPerObstacle: () =>
      get('difficulty.scrollSpeed.rampPerObstacle'),
    scrollSpeedMaxMultiplier: () => get('difficulty.scrollSpeed.maxMultiplier'),
    baseGapPx: () => get('difficulty.obstacleDensity.baseGapPx'),
    minGapPx: () => get('difficulty.obstacleDensity.minGapPx'),
    worldUnlockThreshold: () => get('difficulty.worldUnlockThreshold'),
    perkObstacleMilestones,

    // skills
    secondChanceWindowS: () => get('skills.secondChance.windowS'),
    timeEraseWindowS: () => get('skills.timeErase.windowS'),
    dashDistancePx: () => get('skills.dash.distancePx'),
    dashDurationS: () => get('skills.dash.durationS'),
    timeSlowFactor: () => get('skills.timeSlow.factor'),
    timeSlowDurationS: () => get('skills.timeSlow.durationS'),
    scoreMultiplierFactor: () => get('skills.scoreMultiplier.factor'),
    scoreMultiplierDurationS: () => get('skills.scoreMultiplier.durationS'),
    ultraInstinctDurationS: () => get('skills.ultraInstinct.durationS'),
    defaultCooldownS: () => get('skills.cooldownS.default'),

    // perks
    speedBoostPct: () => get('perks.speedBoostPct'),
    cooldownReductionPct: () => get('perks.cooldownReductionPct'),
    cosmeticDropProbability: () => get('perks.cosmeticDropProbability'),

    // hitboxes
    hitboxScale: (mode: HitboxScaleKey) =>
      get(`hitboxes.scale.${mode}` as BalanceKey),

    // transitions
    telegraphLeadPx: () => get('transitions.telegraph.leadPx'),

    get,
  };
}

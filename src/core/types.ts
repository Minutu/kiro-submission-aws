// Feature: kino-game
//
// Core runtime entity types (design: "Data Models > Runtime entities").
//
// PURE contracts only — no Phaser, no behavior. These are the data shapes the
// simulation core (MovementStateMachine, ScoringSystem, SequenceDirector,
// CollisionSystem, …) reads and writes. Keeping them Phaser-free is what lets
// the 11 correctness properties be property-tested without a browser or canvas
// (enforced by test/boundary.core-no-phaser.test.ts; see src/README.md).
//
// The `SkillId` union lives in the config layer (the authoritative single
// source of truth, Req 26.8); we re-export it here so core code has one import
// surface and never diverges from the config definition. src/config is pure
// (Phaser-free), so importing from it keeps the boundary intact.

import type { SkillId } from '../config/index.ts';

export type { SkillId };

/**
 * Axis-aligned rectangle in world space, used for obstacle `bounds` and the
 * per-mode collision hitbox (design: CollisionSystem.hitbox -> Rect). `x`/`y`
 * is the top-left corner; `width`/`height` are non-negative extents.
 */
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * The four Movement_Modes. Exactly one is active per Sequence (Req 2-6). The
 * player never selects a mode — the environment/SequenceDirector drives it
 * (Req 6.1-6.2).
 */
export type MovementMode = 'jumping' | 'flight' | 'zigzag' | 'underwater';

/** Vertical/diagonal direction used by zigzag (Req 4.1, 4.8). */
export type VerticalDir = 'up' | 'down';

/** Kino's per-frame kinematic state for the active mode (Req 2-6). */
export interface MovementState {
  mode: MovementMode;
  /** Vertical position (world space). */
  y: number;
  /** Vertical velocity. */
  vy: number;
  /** Zigzag facing / diagonal direction (Req 4.1, 4.8). */
  diagonalDir: VerticalDir;
  /** True during a telegraphed transition: skills off, cosmetics hidden (Req 6.4-6.5). */
  isTransitioning: boolean;
}

/**
 * One scoring unit (an Obstacle_Unit). `bounds` may hold several visual
 * rectangles (e.g. a flight pillar pair) but the unit scores at most once,
 * keyed on `id` (Req 9.6, 9.1, 35.4).
 */
export interface Obstacle {
  /** Stable unique id -> the exactly-once scoring key (Req 9.1). */
  id: string;
  /** Obstacle_Category asset key (Req 24.11, 38.1). */
  category: string;
  /** Which Movement_Mode this obstacle belongs to. */
  mode: MovementMode;
  /** One or more visual rectangles; one scoring unit regardless of count. */
  bounds: Rect[];
  /** The x at which clearing credits the unit. */
  scoringLineX: number;
  /** Guard against double counting (Req 9.1, 35.4). */
  scored: boolean;
}

/** A single credited scoring increment (Req 9). */
export interface ScoringEvent {
  obstacleId: string;
  /** Always 1 — the base worth of clearing one unit. */
  baseValue: 1;
  /** Mode attributed at the moment of clearing (Req 9.2). */
  mode: MovementMode;
  /** Score multiplier snapshot at credit time (Req 9.4, 17.1). */
  multiplierAtCredit: number;
  /** `baseValue * multiplierAtCredit`. */
  creditedValue: number;
}

/** Lifecycle state of an active Skill (Req 12, 35). */
export type SkillState = 'ready' | 'active' | 'cooldown';

/**
 * An unlocked, usable Skill — separate from Perk (Req 11.3). `rarity` is flavor
 * only (Req 36.4-36.5). Timers are seconds; `*Remaining` count down and freeze
 * on pause (Req 12, 35).
 */
export interface Skill {
  id: SkillId;
  /** Rarity tier string; display/flavor only (Req 36.4-36.5). */
  rarity: string;
  cooldownS: number;
  cooldownRemaining: number;
  effectDurationS: number;
  effectRemaining: number;
  state: SkillState;
}

/** Perk id union — temporary passive run bonuses (Req 10, 11). Extensible. */
export type PerkId = 'speedBoost' | 'cooldownReduction';

/** A temporary passive run bonus, separate from Skill (Req 10, 11). */
export interface Perk {
  id: PerkId;
  /** Configurable magnitude, e.g. a percentage (Req 11.1-11.2, 11.5). */
  magnitude: number;
}

/**
 * One Sequence within a World: a single active mode with optional finale/loop
 * semantics (design: Sequence; Req 4.5-4.7, 8.8).
 */
export interface Sequence {
  mode: MovementMode;
  /** W5 scripted finale (Req 8.8). */
  isFinale: boolean;
  /** W3 alternation / repetition (Req 4.7). */
  loops: boolean;
}

/**
 * The static plan for a Sequence inside a WorldDefinition's `sequencePlan`
 * (Req 4.4, 5.5, 8.2-8.6). A spec is the authored template; a runtime
 * `Sequence` is produced from it. The shape mirrors `Sequence` so a plan entry
 * can be realized directly, with optional fields defaulting sensibly.
 */
export interface SequenceSpec {
  mode: MovementMode;
  /** Defaults to false when omitted (Req 8.8). */
  isFinale?: boolean;
  /** Defaults to false when omitted (Req 4.7). */
  loops?: boolean;
}

/** Valid World ids 1..5 (Req 27). */
export type WorldId = 1 | 2 | 3 | 4 | 5;

/** Static definition of a World (Req 27, 46). */
export interface WorldDefinition {
  id: WorldId;
  theme: string;
  serviceFamily: string;
  mentorKey: string;
  paletteKey: string;
  /** Composition per world (Req 4.4, 5.5, 8.2-8.6). */
  sequencePlan: SequenceSpec[];
  /** False for W5 (Req 23.2). */
  endlessEnabled: boolean;
  /** Abilities learned up to & incl. this world, in story order (Req 23.7-23.8). */
  allowedEndlessModes: MovementMode[];
}

// Feature: kino-game
//
// SkillSystem — active-skill lifecycle, timers, equip, and activation gating
// (design: "Active skill lifecycle (Req 12, 13–18, 35)", "Single equipped
// Skill (Req 12.15)"; Req 12.2, 12.3, 12.4, 12.15, 12.16, 7.10, 7.11, 7.12).
//
// This module owns the PURE lifecycle framework for the one equipped Skill:
//   - Single-equip (Req 12.2, 12.15): at most ONE equipped Skill at any time.
//     Equipping a Skill makes it the sole equipped Skill and unequips any
//     previous one — consistent with the singular `Save_Store.equippedSkill`.
//   - Activation (Req 12.4, 12.16): activating a `ready` Skill enters `active`
//     for its effect duration, then `cooldown` for its cooldown, then back to
//     `ready`. Activating while NOT ready (on cooldown or already active) is
//     SILENTLY DEFERRED — no error, no queue, no feedback (Req 12.16). While a
//     Transition is in progress, activation is DISABLED and silently refused
//     (Req 12.4).
//   - Timers (Req 7.10–7.12): `cooldownRemaining` and `effectRemaining` count
//     DOWN only inside `tick(dt)`, which is driven once per fixed step by the
//     fixed-timestep driver's `advance` callback. There is NO wall clock inside
//     this module, so when the driver is frozen (paused) it simply never calls
//     `advance`, and the timers freeze AT THEIR CURRENT VALUES with no special
//     pause code here. Resume continues from the held values because nothing
//     mutated them while paused. This is the structural guarantee Property 7
//     (task 6.2) verifies by asserting that NOT calling `tick` holds the timers.
//
// The specific skill EFFECTS (Second Chance, Time Erase, Dash, Time Slow, Score
// Multiplier, Ultra Instinct, Nuke) are later tasks (6.4–6.10). This module
// provides the lifecycle/timer/equip framework and the activation-gating seam
// those tasks build on: `onActivate`/`onEffectEnd` hooks fire at the state
// transitions so an effect module can attach without this module importing it.
//
// Per-skill durations come from the BalanceTable (Req 26.8): cooldown defaults
// to `defaultCooldownS()`; effect duration is looked up per SkillId. A later
// perk task applies cooldown reduction via the injectable `cooldownScale`
// source (Req 12.5) without changing this module.
//
// PURE / deterministic — no Phaser, no randomness, no clock (src/core boundary,
// Req 26.6). Given the same construction and the same ordered calls it produces
// the same states and timers.

import type { BalanceTable } from '../config/index.ts';
import type { Skill, SkillId, SkillState } from './types.ts';

/**
 * Per-step context passed to {@link SkillSystem.activate}. `isTransitioning`
 * lets the caller (GameplayScene) signal that a telegraphed Transition is in
 * progress so activation is refused during it (Req 12.4, 35.6).
 */
export interface SkillActivationContext {
  /** True while a telegraphed Transition is in progress (Req 12.4). */
  isTransitioning?: boolean;
}

/** Why an {@link SkillSystem.activate} call did not start the effect. */
export type DeferReason =
  | 'none' // activation succeeded (no defer)
  | 'no-skill' // nothing is equipped
  | 'not-ready' // on cooldown or already active (Req 12.16 silent defer)
  | 'transitioning'; // a Transition is in progress (Req 12.4)

/** Result of an {@link SkillSystem.activate} attempt. */
export interface ActivationResult {
  /** True only when the attempt started the effect (entered `active`). */
  activated: boolean;
  /** `'none'` on success; otherwise why the activation was silently deferred. */
  reason: DeferReason;
}

/** Construction options for {@link createSkillSystem}. */
export interface SkillSystemOptions {
  /** Skill to equip at construction (else the system starts with none). */
  initialSkill?: SkillId;
  /**
   * Live cooldown scale, read AT the moment a skill enters cooldown. The
   * cooldown-reduction perk (task 6.12/6.13, Req 12.5) supplies a getter
   * returning e.g. 0.8 for a 20% reduction. Defaults to a constant 1 (no
   * reduction). A non-finite/non-positive value is ignored (treated as 1).
   */
  cooldownScale?: () => number;
  /** Fired when a skill activates (enters `active`) — effect-module seam. */
  onActivate?: (id: SkillId) => void;
  /** Fired when a skill's active effect ends (enters `cooldown`) — seam. */
  onEffectEnd?: (id: SkillId) => void;
  /** Fired when a skill's cooldown ends (returns to `ready`) — seam. */
  onReady?: (id: SkillId) => void;
}

/**
 * A read-only snapshot of the equipped skill's live lifecycle, for the HUD
 * (Req 12.3, 12.7 — equipped skill icon/availability/cooldown/effect duration,
 * bottom-right). The engine-layer GameplayScene/HUD task (6.2 wiring) reads
 * this each frame and renders it; this is the clean seam between the pure core
 * and the render layer. See {@link SkillSystem.hudSnapshot}.
 */
export interface SkillHudSnapshot {
  id: SkillId;
  state: SkillState;
  /** True when the skill can be activated right now (state === 'ready'). */
  available: boolean;
  /** Seconds of cooldown left (0 unless state === 'cooldown'). */
  cooldownRemaining: number;
  /** Full cooldown length, for a 0..1 progress bar. */
  cooldownS: number;
  /** Seconds of active effect left (0 unless state === 'active'). */
  effectRemaining: number;
  /** Full effect length, for a 0..1 progress bar. */
  effectDurationS: number;
}

/**
 * The active-skill lifecycle authority (design: "Active skill lifecycle").
 * Holds at most one equipped {@link Skill} and drives its ready→active→
 * cooldown→ready lifecycle from `tick(dt)` only.
 */
export interface SkillSystem {
  /**
   * Equip `id` as the SINGLE equipped Skill, unequipping any previous one
   * (Req 12.2, 12.15). The newly equipped skill starts `ready` with full,
   * freshly-read durations. Equipping the already-equipped skill is a no-op
   * reset back to a fresh `ready` state.
   */
  equip(id: SkillId): void;
  /** Unequip the current skill, if any (back to the no-skill state). */
  unequip(): void;
  /** The equipped skill id, or `null` when none is equipped. */
  equipped(): SkillId | null;
  /**
   * Attempt to activate the equipped skill (Req 12.4, 12.16). Succeeds only
   * when a skill is equipped, it is `ready`, and no Transition is in progress;
   * otherwise the activation is silently deferred and `activated` is false.
   */
  activate(ctx?: SkillActivationContext): ActivationResult;
  /**
   * Advance the lifecycle by `dt` seconds. Called ONCE PER FIXED TICK by the
   * fixed-step driver's `advance` callback — never from a wall clock. Because
   * the driver halts under pause, not calling this freezes the timers at their
   * current values (Req 7.10–7.12). Non-positive/non-finite `dt` is ignored.
   */
  tick(dt: number): void;
  /** Current lifecycle state, or `null` when none is equipped. */
  state(): SkillState | null;
  /** Seconds of cooldown remaining (0 when ready/active or none equipped). */
  cooldownRemaining(): number;
  /** Seconds of active effect remaining (0 when not active or none equipped). */
  effectRemaining(): number;
  /** True when a skill is equipped and its effect is currently active. */
  isActive(): boolean;
  /** True when a skill is equipped and it can be activated right now. */
  isReady(): boolean;
  /**
   * End the current `active` effect window IMMEDIATELY, transitioning
   * active → cooldown (applying the live cooldown scale and firing
   * `onEffectEnd`) exactly as if the effect timer had just run out. This is the
   * additive seam an effect module uses to end its active window early when its
   * effect is consumed (e.g. Second Chance phasing through its one collision,
   * Req 13.3). A no-op when nothing is equipped or the skill is NOT `active`,
   * so it can never disturb a `ready` or `cooldown` skill.
   */
  endActiveEarly(): void;
  /** A read-only copy of the equipped {@link Skill}, or `null` when none. */
  skill(): Readonly<Skill> | null;
  /** HUD snapshot for the run HUD (bottom-right), or `null` when none equipped. */
  hudSnapshot(): SkillHudSnapshot | null;
  /** Reset the equipped skill to a fresh `ready` state (no-op if none). */
  reset(): void;
}

/** Default cooldown scale: a constant 1 (no cooldown-reduction perk). */
const DEFAULT_COOLDOWN_SCALE = (): number => 1;

/**
 * Per-skill ACTIVE effect duration, in seconds, read through the BalanceTable
 * (Req 26.8). Skills whose "effect" is modeled elsewhere as an instantaneous or
 * protective action rather than a timed `active` window still get a sensible
 * active duration here so the lifecycle has a concrete `active` phase:
 *   - secondChance / timeErase use their protective WINDOW as the active phase;
 *   - dash uses its short burst duration;
 *   - timeSlow / scoreMultiplier / ultraInstinct use their timed durations;
 *   - nuke is instantaneous → 0 active seconds (goes straight to cooldown).
 * The concrete per-skill EFFECT behavior lands in tasks 6.4–6.10; this only
 * fixes how long the `active` phase lasts.
 */
function effectDurationFor(id: SkillId, balance: BalanceTable): number {
  switch (id) {
    case 'secondChance':
      return balance.secondChanceWindowS();
    case 'timeErase':
      return balance.timeEraseWindowS();
    case 'dash':
      return balance.dashDurationS();
    case 'timeSlow':
      return balance.timeSlowDurationS();
    case 'scoreMultiplier':
      return balance.scoreMultiplierDurationS();
    case 'ultraInstinct':
      return balance.ultraInstinctDurationS();
    case 'nuke':
      return 0; // instantaneous: no timed active phase (Req 35.1, 35.8)
    default: {
      // Exhaustiveness guard: a new SkillId must declare its effect duration.
      const _never: never = id;
      return _never;
    }
  }
}

/** Clamp a duration source to a finite, non-negative number. */
function safeDuration(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/**
 * Create a SkillSystem. Pure factory: the returned system's behavior depends
 * only on its options (and the injected BalanceTable / cooldownScale readings)
 * and the ordered `equip`/`activate`/`tick` calls it receives.
 */
export function createSkillSystem(
  balance: BalanceTable,
  options: SkillSystemOptions = {},
): SkillSystem {
  const cooldownScale = options.cooldownScale ?? DEFAULT_COOLDOWN_SCALE;
  const { onActivate, onEffectEnd, onReady } = options;

  // The single equipped Skill, or null when none is equipped (Req 12.15). This
  // IS the source of truth; there is no second slot, so single-equip is a
  // structural property, not a runtime check.
  let current: Skill | null = null;

  /** Build a fresh `ready` Skill snapshot for `id` from current balance. */
  function makeSkill(id: SkillId): Skill {
    return {
      id,
      rarity: '', // display/flavor only; assigned by ProgressionSystem (Req 36.4)
      cooldownS: safeDuration(balance.defaultCooldownS()),
      cooldownRemaining: 0,
      effectDurationS: safeDuration(effectDurationFor(id, balance)),
      effectRemaining: 0,
      state: 'ready',
    };
  }

  function equip(id: SkillId): void {
    // Equipping sets the single equipped skill and discards any previous one
    // (Req 12.2, 12.15) — assigning over `current` unequips the prior skill.
    current = makeSkill(id);
  }

  function unequip(): void {
    current = null;
  }

  /** Read the cooldown scale defensively (ignore a bad perk source). */
  function readCooldownScale(): number {
    const s = cooldownScale();
    return Number.isFinite(s) && s > 0 ? s : 1;
  }

  function activate(ctx: SkillActivationContext = {}): ActivationResult {
    // Guard 0 — nothing equipped: nothing to activate.
    if (current === null) {
      return { activated: false, reason: 'no-skill' };
    }

    // Guard 1 — activation is DISABLED during a Transition (Req 12.4, 35.6).
    // Refused silently, exactly like the not-ready case.
    if (ctx.isTransitioning === true) {
      return { activated: false, reason: 'transitioning' };
    }

    // Guard 2 — SILENT DEFER when not ready (on cooldown or already active)
    // (Req 12.16): no error, no queue, no feedback. The caller simply learns
    // the activation did not start.
    if (current.state !== 'ready') {
      return { activated: false, reason: 'not-ready' };
    }

    // Enter the `active` phase for the effect duration. A zero-length effect
    // (e.g. Nuke) resolves immediately on this same call into cooldown so the
    // lifecycle never lingers in a 0s `active` state.
    current.state = 'active';
    current.effectRemaining = current.effectDurationS;
    onActivate?.(current.id);

    if (current.effectRemaining <= 0) {
      endEffect();
    }

    return { activated: true, reason: 'none' };
  }

  /** Transition active → cooldown, applying the live cooldown scale. */
  function endEffect(): void {
    if (current === null) return;
    current.effectRemaining = 0;
    const scaled = current.cooldownS * readCooldownScale();
    current.cooldownRemaining = scaled;
    onEffectEnd?.(current.id);

    if (current.cooldownRemaining <= 0) {
      endCooldown();
    } else {
      current.state = 'cooldown';
    }
  }

  /** Transition cooldown → ready. */
  function endCooldown(): void {
    if (current === null) return;
    current.cooldownRemaining = 0;
    current.state = 'ready';
    onReady?.(current.id);
  }

  function tick(dt: number): void {
    // Only positive, finite deltas advance the lifecycle. There is no clock
    // here: the driver calls this once per fixed step, so pause (driver frozen)
    // simply stops these calls and the timers hold (Req 7.10–7.12).
    if (current === null || !Number.isFinite(dt) || dt <= 0) return;

    if (current.state === 'active') {
      current.effectRemaining -= dt;
      if (current.effectRemaining <= 0) {
        endEffect();
      }
    } else if (current.state === 'cooldown') {
      current.cooldownRemaining -= dt;
      if (current.cooldownRemaining <= 0) {
        endCooldown();
      }
    }
    // state === 'ready': nothing ticks; it waits for an activation.
  }

  function hudSnapshot(): SkillHudSnapshot | null {
    if (current === null) return null;
    return {
      id: current.id,
      state: current.state,
      available: current.state === 'ready',
      cooldownRemaining: current.cooldownRemaining,
      cooldownS: current.cooldownS,
      effectRemaining: current.effectRemaining,
      effectDurationS: current.effectDurationS,
    };
  }

  function endActiveEarly(): void {
    // Additive seam (Req 13.3): collapse the active window into cooldown right
    // now. Guard to `active` only so a `ready`/`cooldown` skill is untouched —
    // `endEffect` already handles the active→cooldown→(ready) math and hooks.
    if (current === null || current.state !== 'active') return;
    endEffect();
  }

  function reset(): void {
    if (current === null) return;
    current = makeSkill(current.id);
  }

  if (options.initialSkill !== undefined) {
    equip(options.initialSkill);
  }

  return {
    equip,
    unequip,
    equipped: () => (current === null ? null : current.id),
    activate,
    tick,
    state: () => (current === null ? null : current.state),
    cooldownRemaining: () => (current === null ? 0 : current.cooldownRemaining),
    effectRemaining: () => (current === null ? 0 : current.effectRemaining),
    isActive: () => current !== null && current.state === 'active',
    isReady: () => current !== null && current.state === 'ready',
    endActiveEarly,
    skill: () => (current === null ? null : { ...current }),
    hudSnapshot,
    reset,
  };
}

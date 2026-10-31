// Feature: kino-game
//
// Time Slow skill effect (task 6.7; design: "Skill effects > Time Slow",
// "The fixed-timestep driver"; Req 16.1).
//
// Time Slow slows BOTH Kino and obstacle progression by ONE consistent factor
// for the duration of its active window (Req 16.1). Because everything in the
// run advances off the single fixed-timestep driver — Kino's movement AND the
// leftward scroll that IS obstacle progression — the uniform, consistent slow
// is achieved for free by scaling the driver's time scale: one factor applied
// at one choke point slows the whole simulation together, exactly as required.
//
// This module is the PURE, Phaser-free composition seam between the SkillSystem
// lifecycle and the driver's time-scale hook. It does NOT own the lifecycle
// (that is SkillSystem) and it does NOT reach into the driver's internals: it
// only uses the driver's public `getTimeScale()` / `setTimeScale()` hook
// (fixedTimestep.ts) and the balance `timeSlowFactor()` source (BalanceTable).
//
// Contract:
//   - `onActivate()` sets the driver time scale to `timeSlowFactor()` (the
//     factor is read AT activation so a live-tuned balance value is honored),
//     clamped to a sane positive range so a bad tunable can never freeze or
//     speed up the run. The scale that was in effect just before is captured so
//     it can be restored, rather than blindly forcing 1.0 (keeps the effect
//     composable if some other system also nudged the scale).
//   - `onEffectEnd()` restores the time scale to what it was before activation
//     (normally 1.0 = real time).
//   - Both handlers are idempotent and order-tolerant: a redundant end without a
//     prior activate is a no-op, and a re-activate re-captures cleanly.
//
// These two handlers are exactly the `onActivate` / `onEffectEnd` seam that
// `createSkillSystem` exposes, so GameplayScene can wire Time Slow with no
// changes to either shared module (see the attach seam note at the bottom).

import type { BalanceTable } from '../config/index.ts';

/**
 * The minimal slice of the fixed-timestep driver this effect needs: its public
 * uniform time-scale hook (Req 16.1). Narrowed to a structural type so the
 * effect is trivially unit-testable with a tiny fake and never depends on the
 * rest of the driver surface.
 */
export interface TimeScaleHook {
  /** Current uniform time scale (1 = real time). */
  getTimeScale(): number;
  /** Set the uniform time scale (the driver clamps it non-negative). */
  setTimeScale(scale: number): void;
}

/** The activation hooks a SkillSystem fires, for the Time Slow effect. */
export interface TimeSlowEffect {
  /** Enter the slow: scale the driver by `timeSlowFactor()` (Req 16.1). */
  onActivate(): void;
  /** Exit the slow: restore the pre-activation time scale (normally 1.0). */
  onEffectEnd(): void;
}

/** Minimum accepted Time Slow factor — must stay a genuine (non-zero) slow. */
const MIN_FACTOR = 0.05;
/** Maximum accepted Time Slow factor — a "slow" never speeds the run up. */
const MAX_FACTOR = 1;
/** Fallback factor if the balance source yields a non-finite/out-of-range value. */
const FALLBACK_FACTOR = 0.5;

/**
 * Clamp the balance-sourced factor into a sane Time-Slow range. A non-finite or
 * out-of-range tunable can never freeze the run (factor 0) or accelerate it
 * (factor > 1); it falls back to the documented default or the nearest bound.
 */
function safeFactor(raw: number): number {
  if (!Number.isFinite(raw)) return FALLBACK_FACTOR;
  if (raw < MIN_FACTOR) return MIN_FACTOR;
  if (raw > MAX_FACTOR) return MAX_FACTOR;
  return raw;
}

/**
 * Build the Time Slow effect handlers for a driver + balance (task 6.7,
 * Req 16.1). Pure factory: no Phaser, no clock, no lifecycle state beyond the
 * captured pre-activation scale. Wire the returned handlers into the
 * SkillSystem's `onActivate` / `onEffectEnd` for the `timeSlow` skill.
 *
 * The factor is read from `balance.timeSlowFactor()` at EACH activation, so a
 * live balance edit (or a perk that tunes it later) is honored without
 * rebuilding the effect.
 */
export function createTimeSlowEffect(
  driver: TimeScaleHook,
  balance: BalanceTable,
): TimeSlowEffect {
  // The time scale that was in effect just before Time Slow began, captured so
  // `onEffectEnd` restores it rather than hard-coding 1.0. `null` means "not
  // currently slowing", which makes a stray end a safe no-op.
  let previousScale: number | null = null;

  function onActivate(): void {
    // Capture the current scale ONCE per active window. If activate somehow
    // fires twice without an end in between, keep the original pre-slow scale
    // so the eventual restore is still correct.
    if (previousScale === null) {
      previousScale = driver.getTimeScale();
    }
    driver.setTimeScale(safeFactor(balance.timeSlowFactor()));
  }

  function onEffectEnd(): void {
    // Restore whatever was in effect before the slow (normally 1.0). A redundant
    // end with no prior activate is a no-op.
    if (previousScale !== null) {
      driver.setTimeScale(previousScale);
      previousScale = null;
    }
  }

  return { onActivate, onEffectEnd };
}

// -- GameplayScene attach seam ------------------------------------------------
//
// GameplayScene does not yet build a SkillSystem (that is the later HUD/skills
// wiring task). When it does, Time Slow attaches with no change to the shared
// `skillSystem.ts` / `fixedTimestep.ts`:
//
//   const timeSlow = createTimeSlowEffect(this.driver, this.ctx.balance);
//   this.skills = createSkillSystem(this.ctx.balance, {
//     onActivate: (id) => { if (id === 'timeSlow') timeSlow.onActivate(); },
//     onEffectEnd: (id) => { if (id === 'timeSlow') timeSlow.onEffectEnd(); },
//   });
//
// Because the SkillSystem's effect timer is driven by the (now slowed) driver's
// fixed ticks, the 5 s active window is measured in SIMULATED time; the slow
// lifts exactly when the effect ends and the scale returns to 1.0.

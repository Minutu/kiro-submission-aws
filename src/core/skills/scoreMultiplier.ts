// Feature: kino-game
//
// Score Multiplier skill bridge (design: "Active Skill — Score Multiplier";
// Req 17.1, 17.2).
//
// This is a SMALL, PURE composition module — NOT a rewrite of the SkillSystem
// or ScoringSystem. It bridges two already-existing seams:
//
//   - SkillSystem exposes "is the equipped skill active?" via its lifecycle
//     (equipped() + state() / isActive()). It owns the 10 s active window
//     (balance.scoreMultiplierDurationS()) and the ready→active→cooldown→ready
//     timers (task 6.1). The onActivate/onEffectEnd hooks already mark that
//     window.
//   - ScoringSystem reads an injected `multiplierSource` getter AT CREDIT TIME
//     and sets creditedValue = 1 * multiplierAtCredit (Property 3 already proves
//     the multiplier is snapshotted at credit, not early/late/retroactively).
//
// The bridge is a single getter (a {@link MultiplierSource}) that returns the
// configured Score Multiplier factor (balance.scoreMultiplierFactor(), default
// 2) WHILE the Score Multiplier skill is the equipped skill AND its lifecycle
// is `active`, and 1 otherwise. GameplayScene wires this getter into
// createScoringSystem({ multiplierSource }), so the ScoringSystem reads it each
// credit — giving the double-at-credit-time behavior of Req 17.1 for free, with
// no edit to either shared module.
//
// For the HUD (Req 17.2) the active multiplier is already observable two ways:
// ScoringSystem.activeMultiplier() reads this same source, and the SkillSystem's
// hudSnapshot() reports the active window. This module also exposes a tiny
// {@link scoreMultiplierHudValue} helper returning the exact value the HUD
// should show (the factor while active, else 1) so the render layer has one
// clear, Phaser-free seam to read.
//
// PURE / deterministic — no Phaser, no clock, no randomness (src/core boundary,
// Req 26.6). Behavior depends only on the injected balance getters and the live
// SkillSystem readings.

import type { BalanceTable } from '../../config/index.ts';
import type { MultiplierSource } from '../scoringSystem.ts';
import type { SkillId } from '../types.ts';

/** The SkillId the Score Multiplier bridge watches for. */
export const SCORE_MULTIPLIER_SKILL_ID: SkillId = 'scoreMultiplier';

/**
 * The minimal read-only view of a SkillSystem this bridge needs. Depending on
 * this structural shape (rather than the full `SkillSystem`) keeps the module
 * decoupled and trivially testable with a tiny fake — it never mutates the
 * skill system, it only observes it.
 */
export interface ScoreMultiplierSkillView {
  /** The equipped skill id, or null when none is equipped. */
  equipped(): SkillId | null;
  /** True when a skill is equipped and its effect is currently active. */
  isActive(): boolean;
}

/**
 * Is the Score Multiplier skill the equipped skill AND currently in its active
 * window? This is the single predicate the whole bridge turns on.
 */
export function isScoreMultiplierActive(
  skills: ScoreMultiplierSkillView,
): boolean {
  return skills.equipped() === SCORE_MULTIPLIER_SKILL_ID && skills.isActive();
}

/** Read the configured factor defensively (fall back to 1 on a bad value). */
function readFactor(balance: BalanceTable): number {
  const f = balance.scoreMultiplierFactor();
  return Number.isFinite(f) && f > 0 ? f : 1;
}

/**
 * Build the {@link MultiplierSource} getter to inject into the ScoringSystem.
 *
 * Returns `balance.scoreMultiplierFactor()` (default 2) WHILE the Score
 * Multiplier skill is equipped and active, and `1` otherwise. The getter is
 * read by the ScoringSystem AT CREDIT TIME, so a credit landing inside the
 * active window is worth the factor and a credit before/after is worth 1 —
 * exactly Req 17.1 (the multiplier applied at the moment the score is credited).
 *
 * Wiring (GameplayScene):
 *   const scoring = createScoringSystem({
 *     multiplierSource: createScoreMultiplierSource(skills, balance),
 *   });
 */
export function createScoreMultiplierSource(
  skills: ScoreMultiplierSkillView,
  balance: BalanceTable,
): MultiplierSource {
  return () => (isScoreMultiplierActive(skills) ? readFactor(balance) : 1);
}

/**
 * The exact multiplier value the HUD should display (Req 17.2): the configured
 * factor while Score Multiplier is active, else 1. This mirrors what
 * {@link createScoreMultiplierSource} feeds the ScoringSystem (and what
 * ScoringSystem.activeMultiplier() reports), giving the render layer one clear,
 * Phaser-free value to read when reflecting the active multiplier.
 */
export function scoreMultiplierHudValue(
  skills: ScoreMultiplierSkillView,
  balance: BalanceTable,
): number {
  return isScoreMultiplierActive(skills) ? readFactor(balance) : 1;
}

// Feature: kino-game
//
// Nuke skill effect — "clear the screen, score it all" (design: "Active Skill —
// Nuke"; Req 35.1, 35.2, 35.3, 35.4, 35.5, 35.6, 35.8).
//
// This is a SMALL, PURE composition module — NOT a rewrite of the SkillSystem
// or ScoringSystem. It bridges two already-existing seams, exactly like the
// Score Multiplier bridge (src/core/skills/scoreMultiplier.ts):
//
//   - SkillSystem owns the Nuke LIFECYCLE (task 6.1). Nuke's active effect
//     duration is 0 (effectDurationFor → 0), so a successful activate() resolves
//     straight through active → cooldown on the same call (Req 35.1, 35.5). The
//     cooldown length is `defaultCooldownS()` scaled by the injectable
//     `cooldownScale` perk source (Req 35.5), and activation is already DISABLED
//     during a Transition by the SkillSystem's `isTransitioning` guard
//     (Req 35.6). The HUD reads SkillSystem.hudSnapshot() for Nuke's icon /
//     availability / cooldown / effect duration (Req 35.8). None of that needs
//     touching here.
//   - ScoringSystem owns the EXACTLY-ONCE scoring latch and the AT-credit-time
//     multiplier (task 6.0/6.8). `credit(id, mode)` sets a one-way latch per
//     obstacle id and snapshots `multiplierAtCredit` from the injected source at
//     the moment of the credit — so a credit landing while a Score Multiplier is
//     active is worth the active multiplier (Req 35.2, 35.3), and a second
//     credit of the same id is rejected and changes nothing (Req 35.4). If Kino
//     later passes a position Nuke already cleared, that re-credit is a no-op by
//     the same latch (Req 35.4 "SHALL NOT award it again").
//
// The bridge is a single pure function, {@link detonate}: given the obstacles
// currently on screen, the active Movement_Mode, and the ScoringSystem, it
// credits each on-screen Obstacle_Unit EXACTLY ONCE (delegating the latch +
// multiplier to the ScoringSystem) and returns the ids it destroyed so the
// GameplayScene can remove their views. It does NOT enter cooldown itself — the
// SkillSystem.activate() call that fires the Nuke owns the lifecycle. The
// sanctioned wiring is: on a successful Nuke activation, GameplayScene calls
// `detonate(onScreenObstacles, activeMode, scoring)`, removes the returned ids'
// sprites, and lets the SkillSystem (already in cooldown) drive the HUD.
//
// PURE / deterministic — no Phaser, no clock, no randomness (src/core boundary,
// Req 26.6). Behavior depends only on its arguments and the ScoringSystem's
// prior state; given the same inputs it produces the same destroyed-id list and
// the same credit calls, in obstacle order.

import type { ScoringSystem } from '../scoringSystem.ts';
import type { MovementMode, Obstacle, SkillId } from '../types.ts';

/** The SkillId the Nuke bridge is for. */
export const NUKE_SKILL_ID: SkillId = 'nuke';

/**
 * The minimal read-only shape of an on-screen obstacle this bridge needs to
 * credit and destroy it: a stable `id` (the exactly-once scoring key, Req 9.1 /
 * 35.4) and the Movement_Mode it belongs to for attribution. Depending on this
 * structural subset of {@link Obstacle} (rather than the full entity) keeps the
 * bridge decoupled and trivially testable, and still accepts a real `Obstacle`.
 */
export interface NukeTarget {
  /** Stable unique id — the exactly-once scoring latch key (Req 9.1, 35.4). */
  id: string;
  /** The Movement_Mode this obstacle belongs to (for attribution, Req 9.2). */
  mode: MovementMode;
}

/** Result of a {@link detonate} — what the blast destroyed and what it scored. */
export interface NukeResult {
  /**
   * The ids of the obstacles the blast DESTROYED, in input order. The
   * GameplayScene removes these obstacles' views (Req 35.1). An id appears here
   * exactly once per detonate call even if the same obstacle was passed twice.
   */
  destroyedIds: string[];
  /**
   * The ids the blast newly CREDITED (a subset of `destroyedIds`): those whose
   * exactly-once latch was set by THIS call. An obstacle already credited
   * before the blast (e.g. Kino cleared it a frame earlier) is still destroyed
   * but is NOT re-credited (Req 35.4), so it is omitted here.
   */
  creditedIds: string[];
  /**
   * Total score awarded by this blast = the sum of `creditedValue` across the
   * newly-credited obstacles (each `1 * multiplierAtCredit`, Req 35.2, 35.3).
   */
  awarded: number;
}

/**
 * Attribute a destroyed obstacle's Scoring_Event to the obstacle's OWN mode
 * when present, falling back to the active mode. An on-screen Obstacle_Unit
 * always carries a valid Movement_Mode, so this normally uses `target.mode`;
 * the fallback keeps the function total for a target that omitted it.
 */
function modeFor(target: NukeTarget, activeMode: MovementMode): MovementMode {
  return target.mode ?? activeMode;
}

/**
 * Detonate the Nuke: destroy every on-screen obstacle and credit each one
 * EXACTLY ONCE with the active multiplier (Req 35.1–35.4).
 *
 * For each obstacle in `onScreenObstacles` (in order), this:
 *   1. marks it destroyed (its id joins `destroyedIds`), and
 *   2. attempts `scoring.credit(id, mode)` — the ScoringSystem's one-way latch
 *      credits a fresh id exactly once at the active multiplier (Req 35.2,
 *      35.3) and REJECTS an id already credited (Req 35.4), so neither a
 *      duplicate in the input nor a position Kino already cleared can
 *      double-count. A newly-credited id joins `creditedIds` and its
 *      `creditedValue` adds to `awarded`.
 *
 * The blast does NOT change the skill lifecycle: the caller fires it on a
 * SUCCESSFUL `SkillSystem.activate()` (which, because Nuke's active window is
 * 0s, has already entered cooldown — Req 35.1, 35.5). Because activation is
 * disabled during a Transition (Req 35.6), a detonate only happens off-screen
 * of any transition.
 *
 * Pure: no mutation of the inputs, no Phaser, no clock. An empty field credits
 * and destroys nothing. Returns the ids to remove plus a scoring summary.
 *
 * Wiring (GameplayScene), on a successful Nuke activation:
 *   const res = detonate(onScreenObstacles, movement.mode, scoring);
 *   for (const id of res.destroyedIds) removeObstacleView(id);
 *   // SkillSystem is already in cooldown; HUD reads skills.hudSnapshot().
 */
export function detonate(
  onScreenObstacles: readonly NukeTarget[],
  activeMode: MovementMode,
  scoring: Pick<ScoringSystem, 'credit'>,
): NukeResult {
  const destroyedIds: string[] = [];
  const creditedIds: string[] = [];
  let awarded = 0;

  // Guard against a duplicate id within this single call so an obstacle passed
  // twice is reported destroyed once (the ScoringSystem latch already prevents
  // double-crediting, this just keeps `destroyedIds` clean).
  const seen = new Set<string>();

  for (const target of onScreenObstacles) {
    if (seen.has(target.id)) continue;
    seen.add(target.id);
    destroyedIds.push(target.id);

    // Delegate exactly-once + multiplier-at-credit-time to the ScoringSystem
    // (Req 35.2, 35.3, 35.4). A null result means the id was already credited
    // (latch set) — destroyed but not re-awarded.
    const event = scoring.credit(target.id, modeFor(target, activeMode));
    if (event !== null) {
      creditedIds.push(target.id);
      awarded += event.creditedValue;
    }
  }

  return { destroyedIds, creditedIds, awarded };
}

/**
 * Narrow a full {@link Obstacle} list to the {@link NukeTarget} subset
 * `detonate` needs. A convenience for the GameplayScene when it holds rich
 * `Obstacle` entities; `detonate` already accepts `Obstacle[]` directly (an
 * `Obstacle` IS a `NukeTarget`), so this is only for callers that want the
 * minimal shape explicitly.
 */
export function toNukeTargets(obstacles: readonly Obstacle[]): NukeTarget[] {
  return obstacles.map((o) => ({ id: o.id, mode: o.mode }));
}

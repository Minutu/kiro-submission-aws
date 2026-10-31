// Feature: kino-game
//
// Skill_Unlock_Schedule acquisition + rarity labeling (task 7.5; design:
// "Skill acquisition (Req 36)"; Req 36.1-36.5, 36.7, 12.6, 12.13).
//
// WHY THIS LIVES IN src/core: this is PURE, deterministic, config-driven
// progression logic with NO Phaser dependency — it reads the milestone→SkillId
// mapping (`config.skillUnlockSchedule`) and the SkillId→rarity mapping
// (`config.skillRarity`) and applies milestones to a SaveState's permanent
// `unlockedSkills` list (saveStore.ts). The ProgressionSystem / menu call these
// pure helpers; a brand-new save unit test (task 7.11) exercises them in plain
// Node without a browser.
//
// THE MODEL (Req 36):
//   - Skills unlock via a MILESTONE only (Req 36.1): the FIRST-EVER completion
//     of each world (`world1First`..`world5First`, in a fixed list order that
//     matches world order — Req 36.2) plus `generation1Complete` (6th skill)
//     and `generation2Complete` (7th skill). The mapping is read from
//     `config.skillUnlockSchedule`, which is editable (Req 36.1-36.2).
//   - An unlocked skill is PERSISTED PERMANENTLY in the save's `unlockedSkills`
//     (Req 36.3, 22.1). Applying a milestone is IDEMPOTENT — re-completing a
//     world or generation never double-adds the skill (set-union semantics).
//   - Skills are NEVER unlocked via a perk-choice drop (Req 36.7); this module
//     exposes ONLY milestone entry points, so there is structurally no perk
//     path to `unlockedSkills` here.
//   - Each skill carries a RARITY tier read from `config.skillRarity`, used for
//     DISPLAY / FLAVOR only — resolving it has NO effect on gameplay (Req 36.4,
//     36.5, 12.6, 12.13). `skillRarity` is a pure lookup.

import type { ConfigFileData, SkillId, RarityTier } from '../config/index.ts';
import type { SaveState } from './saveStore.ts';

/**
 * The seven skill-unlock milestones, named exactly as the keys of
 * `config.skillUnlockSchedule`. `world{N}First` fires the first time world N is
 * story-cleared; `generation{N}Complete` fires when generation N is completed.
 */
export type SkillUnlockMilestone =
  | 'world1First'
  | 'world2First'
  | 'world3First'
  | 'world4First'
  | 'world5First'
  | 'generation1Complete'
  | 'generation2Complete';

/**
 * The FIXED world-first milestone order, matched to world order (Req 36.2).
 * Index 0 = world 1's first-completion milestone, …, index 4 = world 5's. A
 * caller that clears world N for the first time maps `worldId → fixed order`
 * through `worldFirstMilestone(worldNumber)` and unlocks the scheduled skill.
 */
export const WORLD_FIRST_MILESTONES: readonly SkillUnlockMilestone[] = [
  'world1First',
  'world2First',
  'world3First',
  'world4First',
  'world5First',
] as const;

/**
 * The complete milestone order (worlds 1-5 first-completions, then
 * generation-1 then generation-2 completion) — the order in which the seven
 * skills are earned across a playthrough (Req 36.2). Useful for display and for
 * tests that assert the fixed acquisition sequence.
 */
export const MILESTONE_ORDER: readonly SkillUnlockMilestone[] = [
  ...WORLD_FIRST_MILESTONES,
  'generation1Complete',
  'generation2Complete',
] as const;

/**
 * Resolve the world-first milestone for a 1-based world number (1..5) in the
 * FIXED world order (Req 36.2). Returns null for any out-of-range world so a
 * caller clearing an unexpected world id never unlocks the wrong skill.
 */
export function worldFirstMilestone(worldNumber: number): SkillUnlockMilestone | null {
  if (!Number.isInteger(worldNumber) || worldNumber < 1 || worldNumber > WORLD_FIRST_MILESTONES.length) {
    return null;
  }
  return WORLD_FIRST_MILESTONES[worldNumber - 1] ?? null;
}

/**
 * The SkillId a milestone unlocks, read from `config.skillUnlockSchedule`
 * (Req 36.1). This is the single place the schedule mapping is consulted, so a
 * config edit re-points a milestone with no logic change (Req 36.2). Pure.
 */
export function skillForMilestone(cfg: ConfigFileData, milestone: SkillUnlockMilestone): SkillId {
  return cfg.skillUnlockSchedule[milestone];
}

/**
 * Resolve a skill's rarity tier from `config.skillRarity` — DISPLAY / FLAVOR
 * ONLY (Req 36.4-36.5, 12.6, 12.13). This lookup is intentionally isolated from
 * every gameplay module so that rarity can never reach a balance decision; it
 * exists purely so the Inventory_Panel can color a skill by tier (Req 36.6,
 * 12.14). Pure.
 */
export function skillRarity(cfg: ConfigFileData, skill: SkillId): RarityTier {
  return cfg.skillRarity[skill];
}

/** The result of applying a milestone to a save's `unlockedSkills`. */
export interface MilestoneUnlockResult {
  /** The SkillId mapped to the milestone (always defined for a valid milestone). */
  skill: SkillId;
  /**
   * The new, permanent `unlockedSkills` list — the previous list plus `skill`
   * when it was newly unlocked, or an unchanged copy when it was already owned.
   * Always a fresh array so callers never alias the save's internal state.
   */
  unlockedSkills: string[];
  /** True only when `skill` was NOT already present (i.e. a real new unlock). */
  newlyUnlocked: boolean;
}

/**
 * Apply a reached milestone to a permanent `unlockedSkills` list (Req 36.3).
 * IDEMPOTENT: if the mapped skill is already present the list is returned
 * unchanged (never double-added), which is why re-clearing a world or
 * re-completing a generation is a no-op (set-union semantics). Pure — it
 * returns a new list and never mutates the input.
 *
 * This is deliberately the ONLY way to add to `unlockedSkills` from a milestone;
 * there is no perk path here, enforcing Req 36.7 ("never via perk drops").
 */
export function applyMilestoneToUnlockedSkills(
  cfg: ConfigFileData,
  unlockedSkills: readonly string[],
  milestone: SkillUnlockMilestone,
): MilestoneUnlockResult {
  const skill = skillForMilestone(cfg, milestone);
  const already = unlockedSkills.includes(skill);
  return {
    skill,
    newlyUnlocked: !already,
    unlockedSkills: already ? [...unlockedSkills] : [...unlockedSkills, skill],
  };
}

/**
 * Apply a reached milestone to a whole SaveState, returning a new SaveState
 * with the mapped skill unlocked permanently (Req 36.3, 22.1). IDEMPOTENT and
 * PURE: the input save is never mutated, and re-applying a milestone yields a
 * deep-equal save (no double-unlock). Only `unlockedSkills` changes; every
 * other permanent field is preserved unchanged.
 */
export function applyMilestoneToSave(cfg: ConfigFileData, save: SaveState, milestone: SkillUnlockMilestone): SaveState {
  const { unlockedSkills } = applyMilestoneToUnlockedSkills(cfg, save.unlockedSkills, milestone);
  return { ...save, unlockedSkills };
}

/**
 * Convenience for the ProgressionSystem: apply a world's FIRST-completion
 * milestone by 1-based world number (Req 36.2-36.3), returning the updated
 * save. For an out-of-range world number the save is returned unchanged (no
 * skill unlocked) so an unexpected world id can never unlock the wrong skill.
 */
export function unlockSkillForWorldFirstCompletion(cfg: ConfigFileData, save: SaveState, worldNumber: number): SaveState {
  const milestone = worldFirstMilestone(worldNumber);
  if (milestone === null) return { ...save, unlockedSkills: [...save.unlockedSkills] };
  return applyMilestoneToSave(cfg, save, milestone);
}

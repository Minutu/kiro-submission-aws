// Feature: kino-game
//
// InfoPanel — the PURE view-model for the menu's Info / run-statistics panel
// (task 9.6; design: "Info panel (31)"; Req 20.10, 31.1, 31.2).
//
// WHY THIS LIVES IN src/core: it is pure, deterministic, Phaser-free assembly
// of already-computed state into a plain serializable object. The engine layer
// (MainMenuScene / a lightweight panel component) only RENDERS this view-model;
// it does no formatting or selection of its own. Keeping the logic here lets the
// Info-panel contract be unit-tested in plain Node, and keeps the core↔engine
// boundary intact (enforced by test/boundary.core-no-phaser.test.ts).
//
// THE CONTRACT (Req 31.1, 31.2):
//   - Opening Info shows CURRENT-RUN statistics (Req 31.1): obstacles cleared,
//     the active Perk effects expressed as ±% strings, the equipped Skill, and
//     the current score.
//   - It ALSO shows per-World High_Scores for the CURRENT generation alongside
//     the BEST per-World High_Scores from PAST generations (Req 31.2).
//
// Perk effect SIGN (Req 31.1 "plus or minus percentages"): each perk's effect
// is expressed as the signed percentage change it makes to the thing it
// touches, consistent with how `perkSystem` applies it:
//   - Speed Boost      → run speed is MULTIPLIED by 1 + pct/100  → "+N%".
//   - Reduced Skill Cooldown → cooldown is SCALED by 1 - pct/100 → "-N%"
//     (a shorter cooldown is a NEGATIVE change to the cooldown duration).
// Any future perk declares its own sign in PERK_EFFECT_SIGN below so the panel
// never has to special-case a perk at the call site.
//
// PURE / Phaser-free. Given the same inputs it returns the same view-model; it
// reads nothing global and mutates none of its inputs.

import type { Perk, PerkId, WorldId } from './types.ts';
import type { SaveState, HighScoreState } from './saveStore.ts';

/**
 * The sign each Perk's effect carries when expressed as a ±% change (Req 31.1).
 * `+1` → the perk INCREASES its target (shown with a leading '+'); `-1` → the
 * perk DECREASES it (shown with a leading '-'). The MAGNITUDE itself is always
 * the perk's configured (non-negative) percentage.
 */
const PERK_EFFECT_SIGN: Record<PerkId, 1 | -1> = {
  // Speed Boost raises run speed (Req 11.2).
  speedBoost: 1,
  // Reduced Skill Cooldown shortens the cooldown duration (Req 11.1, 12.5).
  cooldownReduction: -1,
};

/** Human-readable fallback labels for each Perk id (display/flavor only). */
const PERK_EFFECT_LABEL: Record<PerkId, string> = {
  speedBoost: 'Speed Boost',
  cooldownReduction: 'Reduced Skill Cooldown',
};

/** The five story worlds, in story order, used to lay out the high-score rows. */
const WORLD_IDS: readonly WorldId[] = [1, 2, 3, 4, 5];

/** One Perk effect row in the panel, formatted as a signed percentage (Req 31.1). */
export interface InfoPanelPerkEffect {
  /** The perk id this effect comes from. */
  id: PerkId;
  /** Human-readable label (display/flavor). */
  label: string;
  /** The signed effect as a ±% string, e.g. "+12%" or "-20%". */
  percent: string;
}

/** The equipped-skill summary shown in the panel (Req 31.1). */
export interface InfoPanelEquippedSkill {
  /** The equipped skill id, or null when nothing is equipped. */
  id: string | null;
  /**
   * A display name for the equipped skill. Defaults to the id when no resolver
   * is supplied, and is null when no skill is equipped.
   */
  name: string | null;
}

/** One per-World High_Score row: current generation alongside best past (Req 31.2). */
export interface InfoPanelWorldHighScore {
  /** The world id (1..5). */
  world: WorldId;
  /** This generation's High_Score for the world (story mode), 0 when absent. */
  currentGeneration: number;
  /** Best High_Score for the world across ALL past generations, 0 when none. */
  bestPastGeneration: number;
}

/** The full, plain, serializable Info-panel view-model (Req 31.1, 31.2). */
export interface InfoPanelViewModel {
  /** Obstacles cleared this run (Req 31.1). */
  obstaclesCleared: number;
  /** The current run score (Req 31.1). */
  currentScore: number;
  /** Active Perk effects as ±% strings (Req 31.1). */
  perkEffects: InfoPanelPerkEffect[];
  /** The equipped Skill (Req 31.1). */
  equippedSkill: InfoPanelEquippedSkill;
  /** Per-World this-gen vs best-past-gen High_Scores (Req 31.2). */
  worldHighScores: InfoPanelWorldHighScore[];
}

/** Inputs to {@link buildInfoPanelViewModel}. */
export interface InfoPanelInput {
  /** Obstacles cleared in the current run (Req 31.1). Non-finite reads as 0. */
  obstaclesCleared: number;
  /** The current run score (Req 31.1). Non-finite reads as 0. */
  currentScore: number;
  /**
   * The perks active RIGHT NOW (from `perkSystem.activePerks()`), separate from
   * skills (Req 11.3). Each is rendered as a signed percentage (Req 31.1).
   */
  activePerks: readonly Perk[];
  /** The equipped Skill id, or null (from the Save_Store, Req 31.1). */
  equippedSkill: string | null;
  /**
   * The whole Save_Store, read for the CURRENT-generation per-World high scores
   * (`highScores.story`, Req 28.1) and the cross-generation history
   * (`highScoreHistoryByGeneration`, Req 31.2). Never mutated.
   */
  save: SaveState;
  /**
   * The key under which the CURRENT generation's history lives in
   * `highScoreHistoryByGeneration` (e.g. the composed Generation_Name or its
   * iteration). When supplied, that key is EXCLUDED from the "past generations"
   * roll-up so the current generation is not double-counted as its own past.
   */
  currentGenerationKey?: string;
  /**
   * Optional resolver from a skill id to a display name (Req 31.1). The core
   * stays Phaser-free and config-agnostic; the engine passes a resolver backed
   * by the Config_File's labels. Defaults to the id itself.
   */
  skillName?: (id: string) => string;
}

/** The per-World map key for a world id, e.g. 1 -> "world1" (matches Save_Store). */
function worldKey(world: WorldId): string {
  return `world${world}`;
}

/** Coerce to a finite, non-negative integer-ish count; anything else -> 0. */
function safeCount(value: number): number {
  return Number.isFinite(value) && value > 0 ? value : 0;
}

/** Read a finite number from an unknown value, defaulting to 0. */
function finiteOr0(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Format a perk's effect as a signed percentage string (Req 31.1). The sign is
 * the perk's declared direction (see {@link PERK_EFFECT_SIGN}); the magnitude is
 * the perk's configured, non-negative percentage. A zero magnitude renders as
 * "+0%" so the slot is never blank.
 */
function formatPerkPercent(id: PerkId, magnitude: number): string {
  const mag = Number.isFinite(magnitude) && magnitude > 0 ? magnitude : 0;
  const sign = PERK_EFFECT_SIGN[id] ?? 1;
  const prefix = sign < 0 && mag > 0 ? '-' : '+';
  return `${prefix}${mag}%`;
}

/**
 * Read one world's CURRENT-generation story High_Score from the live per-mode
 * maps (Req 28.1, 31.2). The Info panel reports STORY progression per world,
 * which is the live `highScores.story` map — the generation's own high scores.
 */
function currentGenHighScore(highScores: HighScoreState, world: WorldId): number {
  return finiteOr0(highScores.story[worldKey(world)]);
}

/**
 * Compute the BEST per-World story High_Score across ALL PAST generations from
 * `highScoreHistoryByGeneration` (Req 31.2). The history is schema-typed loosely
 * (`Record<string, unknown>`), so this walks it DEFENSIVELY, tolerating either a
 * `{ story: { worldN: n } }` shape (the design example) or a flat
 * `{ worldN: n }` shape, and ignoring anything that is not a finite number.
 *
 * `currentGenerationKey`, when supplied, is skipped so the current generation is
 * not folded into its own "past" roll-up.
 */
function bestPastHighScores(
  history: Record<string, unknown>,
  currentGenerationKey: string | undefined,
): Record<string, number> {
  const best: Record<string, number> = {};

  const foldWorldMap = (worldMap: Record<string, unknown>): void => {
    for (const [k, v] of Object.entries(worldMap)) {
      const n = finiteOr0(v);
      if (n > (best[k] ?? 0)) best[k] = n;
    }
  };

  for (const [genKey, genEntry] of Object.entries(history)) {
    if (currentGenerationKey !== undefined && genKey === currentGenerationKey) {
      continue; // do not count the current generation as its own past
    }
    if (genEntry === null || typeof genEntry !== 'object' || Array.isArray(genEntry)) {
      continue;
    }
    const entry = genEntry as Record<string, unknown>;
    // Preferred shape: { story: { worldN: n }, endless?: { ... } } — only the
    // STORY slice is relevant to the per-world story high-score comparison.
    const story = entry.story;
    if (story !== null && typeof story === 'object' && !Array.isArray(story)) {
      foldWorldMap(story as Record<string, unknown>);
    } else {
      // Fallback flat shape: { worldN: n }.
      foldWorldMap(entry);
    }
  }

  return best;
}

/**
 * Assemble the Info / run-statistics panel view-model (Req 20.10, 31.1, 31.2).
 *
 * PURE: reads the supplied run counters, active perks, equipped skill, and the
 * Save_Store's high-score state, and returns a plain object the engine renders
 * verbatim. Does NO rendering and mutates none of its inputs. See the module
 * header for the perk-sign contract.
 */
export function buildInfoPanelViewModel(input: InfoPanelInput): InfoPanelViewModel {
  const {
    obstaclesCleared,
    currentScore,
    activePerks,
    equippedSkill,
    save,
    currentGenerationKey,
    skillName,
  } = input;

  // Perk effects as ±% (Req 31.1). Order is preserved from `activePerks` so the
  // panel reflects the system's own active-perk ordering.
  const perkEffects: InfoPanelPerkEffect[] = activePerks.map((perk) => ({
    id: perk.id,
    label: PERK_EFFECT_LABEL[perk.id] ?? perk.id,
    percent: formatPerkPercent(perk.id, perk.magnitude),
  }));

  // Equipped skill (Req 31.1): pass the id through and resolve a display name
  // (defaulting to the id when no resolver is supplied).
  const equipped: InfoPanelEquippedSkill =
    equippedSkill === null || equippedSkill === ''
      ? { id: null, name: null }
      : { id: equippedSkill, name: skillName ? skillName(equippedSkill) : equippedSkill };

  // Per-World high scores: current generation alongside best past (Req 31.2).
  const past = bestPastHighScores(save.highScoreHistoryByGeneration, currentGenerationKey);
  const worldHighScores: InfoPanelWorldHighScore[] = WORLD_IDS.map((world) => ({
    world,
    currentGeneration: currentGenHighScore(save.highScores, world),
    bestPastGeneration: finiteOr0(past[worldKey(world)]),
  }));

  return {
    obstaclesCleared: safeCount(obstaclesCleared),
    currentScore: safeCount(currentScore),
    perkEffects,
    equippedSkill: equipped,
    worldHighScores,
  };
}

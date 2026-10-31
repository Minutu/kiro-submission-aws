// Feature: kino-game
//
// GenerationTransition — the PURE save-side coordination of two generational
// lifecycle events (task 7.4; design: "Left-behind worlds (Req 27.15-27.16)",
// "Generations (Req 22, 29, 32)"; Req 27.15-27.16, 22.3-22.5, 32.1-32.3, 32.5).
//
// WHY THIS LIVES IN src/core: it is pure, deterministic, Phaser-free save-state
// algebra over the `kino.save.v1` schema (saveStore.ts). It owns TWO things:
//
//   1. LEFT-BEHIND MARKING (Req 27.15-27.16). When the player advances PAST a
//      story world, that world is marked `leftBehind = true`. Story-mode access
//      (replay + revisit) is then FULLY blocked for that world; its earned
//      rewards/unlocks stay valid and untouched; Endless_Mode is the only way
//      back in. `markLeftBehind` folds the flag into a fresh save;
//      `isLeftBehind` / `canPlayStory` are the readers that encode the rule
//      (left-behind blocks story but NOT endless).
//
//   2. GENERATION ADVANCE (Req 22.3-22.5, 32.1-32.3, 32.5). On completing a
//      generation (clearing the final world / finishing the story):
//        - Award a UNIQUE per-generation cosmetic (Req 22.4): add it to BOTH
//          `unlockedCosmetics` (permanent, Req 22.2) and
//          `generationCosmeticsAwarded` (the uniqueness ledger), choosing an id
//          not already awarded.
//        - Advance the Generation_Name (Req 22.5, 32.3): Junior→Senior within
//          the SAME iteration, then the NEXT iteration's Junior — i.e. the
//          sequence is (N, Junior) → (N, Senior) → (N+1, Junior) → …
//        - RESET per-generation state (Req 22.3): learned abilities, perks,
//          temporary run bonuses, and current run score/progression. The schema
//          carries NO run fields (Property 8), so the reset here is the SAVE
//          side: clear per-generation STORY state — `storyCleared` and
//          `leftBehind` on every world — so the new generation replays the
//          story from the start. Abilities/perks/run reset live in their own
//          systems (PerkSystem.onNewGeneration, etc.); this module coordinates
//          the save transition only.
//        - KEEP permanent progress (Req 22.5): `unlockedSkills`,
//          `unlockedCosmetics` (incl. the just-awarded one), equipped
//          selections, bindings, settings, high scores + history are all
//          preserved verbatim.
//        - GREY previously discovered worlds (Req 32.5): discovery is PERMANENT
//          — a world once discovered STAYS `discovered: true` across the new
//          generation (the menu renders it GREYED rather than a black
//          silhouette). We therefore keep `discovered` as-is and only reset the
//          per-generation story flags; World 1 becomes the new generation's
//          playable story start (it is always discovered, never left behind).
//
// Determinism: `advanceGeneration` takes the awarded cosmetic id from the
// caller (or picks the first non-awarded id from a supplied pool), so there is
// no hidden randomness — the transition is fully reproducible and testable.
//
// PURE / Phaser-free. Every function returns a NEW SaveState and never mutates
// its input.

import type { ConfigFileData, GenerationalScheme } from '../config/index.ts';
import type { SaveState, GenerationState, WorldProgressState } from './saveStore.ts';

// ---------------------------------------------------------------------------
// Generation_Name composition (Req 32.1-32.2).
//
// The pure name composition (`toRoman` + `formatGenerationName`) lives HERE in
// core so both the core transition logic and the engine's MainMenuScene can
// reuse one implementation without core depending on the Phaser-laden engine
// barrel. `src/engine/generationName.ts` re-exports these, so every existing
// engine import (e.g. MainMenuScene) keeps working unchanged.
// ---------------------------------------------------------------------------

/**
 * Convert a positive integer to a Roman numeral (1 -> "I", 4 -> "IV",
 * 2024 -> "MMXXIV"). Generation iterations are small in practice, but the full
 * subtractive table keeps the helper correct for any reasonable value.
 *
 * Non-positive or non-finite inputs fall back to the Arabic form so the label
 * never renders an empty roman slot (defensive; the Save_Store always starts at
 * `startIteration` >= 1).
 */
export function toRoman(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return String(value);
  }
  let n = Math.floor(value);
  const table: ReadonlyArray<readonly [number, string]> = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let out = '';
  for (const [amount, symbol] of table) {
    while (n >= amount) {
      out += symbol;
      n -= amount;
    }
  }
  return out;
}

/**
 * Compose the Generation_Name from the config scheme and the live generation
 * state (Req 32.1-32.2). Substitutes `{base}`, `{roman}`, and `{suffix}` in the
 * configured `format`; whichever tokens the format omits are simply left out,
 * so a user-edited template stays authoritative (Req 33.5).
 *
 * @param baseName   `names.baseCharacterName` (e.g. 'Kino').
 * @param scheme     `names.generationalScheme` (format + suffixes).
 * @param generation live `{ iteration, suffix }` from the Save_Store.
 */
export function formatGenerationName(
  baseName: string,
  scheme: Pick<GenerationalScheme, 'format'>,
  generation: { iteration: number; suffix: string },
): string {
  const roman = toRoman(generation.iteration);
  return scheme.format
    .replaceAll('{base}', baseName)
    .replaceAll('{roman}', roman)
    .replaceAll('{suffix}', generation.suffix)
    // Collapse any double spaces a dropped token could leave behind, and trim.
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Compose the CURRENT Generation_Name straight from a Config_File and a
 * Save_Store. Convenience over {@link formatGenerationName} so callers holding a
 * whole config + save (the common case) do not re-wire `baseCharacterName` /
 * `generationalScheme` / `generation` by hand.
 */
export function composeGenerationName(cfg: ConfigFileData, save: SaveState): string {
  return formatGenerationName(
    cfg.names.baseCharacterName,
    cfg.names.generationalScheme,
    save.generation,
  );
}

// ---------------------------------------------------------------------------
// The generation-name ADVANCE rule (Req 32.3).
//
// The sequence is: (iteration N, Junior) → (N, Senior) → (N+1, Junior) → (N+1,
// Senior) → … Completing a generation advances ONE step along it: a Junior
// generation becomes the SAME iteration's Senior; a Senior generation rolls
// over to the NEXT iteration's Junior. Any unexpected suffix is treated as
// "not yet Senior" and advances to this iteration's Senior (defensive).
// ---------------------------------------------------------------------------

/**
 * Advance a {@link GenerationState} one step along the generational sequence
 * (Req 32.3), reading the Junior/Senior suffix strings from the config scheme
 * so the names stay config-authoritative (Req 32.2). Pure: returns a new state.
 *
 *   Junior (iteration N) → Senior (iteration N)
 *   Senior (iteration N) → Junior (iteration N + 1)
 */
export function nextGeneration(
  generation: GenerationState,
  scheme: Pick<GenerationalScheme, 'juniorSuffix' | 'seniorSuffix'>,
): GenerationState {
  if (generation.suffix === scheme.seniorSuffix) {
    // Senior rolls over to the next iteration's Junior.
    return { iteration: generation.iteration + 1, suffix: scheme.juniorSuffix };
  }
  // Junior (or any non-Senior value, defensively) advances to Senior, same N.
  return { iteration: generation.iteration, suffix: scheme.seniorSuffix };
}

// ---------------------------------------------------------------------------
// Left-behind worlds (Req 27.15-27.16).
// ---------------------------------------------------------------------------

/**
 * Mark a story world as LEFT BEHIND (Req 27.15). Returns a NEW save with
 * `worlds[world].leftBehind = true`; every other field — including the world's
 * `discovered` / `storyCleared` flags and all earned rewards/unlocks — is
 * preserved untouched (Req 27.16). If the world id is unknown the save is
 * returned as a fresh copy unchanged. Pure.
 */
export function markLeftBehind(save: SaveState, world: string): SaveState {
  const existing = save.worlds[world];
  const worlds: Record<string, WorldProgressState> = { ...save.worlds };
  if (existing !== undefined) {
    worlds[world] = { ...existing, leftBehind: true };
  }
  return { ...save, worlds };
}

/**
 * True when `world` is marked left behind (Req 27.15). An unknown world id is
 * treated as NOT left behind (there is nothing to have advanced past).
 */
export function isLeftBehind(save: SaveState, world: string): boolean {
  return save.worlds[world]?.leftBehind === true;
}

/**
 * Whether STORY mode may enter `world` (Req 27.15-27.16). A left-behind world is
 * fully locked to story (no replay, no revisit); a world that was never
 * discovered is likewise not story-playable. Endless access is a SEPARATE
 * concern — left-behind never blocks endless (that is the only return path,
 * Req 27.15) — so this reader is deliberately story-only.
 */
export function canPlayStory(save: SaveState, world: string): boolean {
  const w = save.worlds[world];
  if (w === undefined) return false;
  return w.discovered && !w.leftBehind;
}

// ---------------------------------------------------------------------------
// Generation advance (Req 22.3-22.5, 32.3, 32.5).
// ---------------------------------------------------------------------------

/** Options for {@link advanceGeneration}. */
export interface AdvanceGenerationOptions {
  /**
   * The unique cosmetic id to award for the COMPLETED generation (Req 22.4).
   * Preferred entry point — the caller (which owns the cosmetic catalog) picks
   * the id. Ignored if it is already in `generationCosmeticsAwarded` (uniqueness
   * is enforced), in which case the award falls through to `cosmeticPool`.
   */
  awardCosmetic?: string;
  /**
   * Fallback pool of candidate cosmetic ids, used when `awardCosmetic` is not
   * supplied or is already awarded. The FIRST id not already in
   * `generationCosmeticsAwarded` is awarded (deterministic). May be empty.
   */
  cosmeticPool?: readonly string[];
}

/** Result of {@link advanceGeneration}. */
export interface AdvanceGenerationResult {
  /** The new save with the generation advanced, cosmetic awarded, story reset. */
  save: SaveState;
  /**
   * The cosmetic id awarded for the completed generation (Req 22.4), or null
   * when no unique id could be resolved (neither `awardCosmetic` nor any
   * `cosmeticPool` entry was both present and not-already-awarded).
   */
  awardedCosmetic: string | null;
}

/**
 * Pick the unique cosmetic to award for the completed generation (Req 22.4).
 * Prefers the caller-supplied `awardCosmetic` when it is not already awarded;
 * otherwise takes the first not-yet-awarded id from `cosmeticPool`. Returns
 * null when nothing unique is available.
 */
function pickUniqueCosmetic(
  alreadyAwarded: ReadonlySet<string>,
  opts: AdvanceGenerationOptions,
): string | null {
  const preferred = opts.awardCosmetic;
  if (preferred !== undefined && preferred !== '' && !alreadyAwarded.has(preferred)) {
    return preferred;
  }
  for (const id of opts.cosmeticPool ?? []) {
    if (id !== '' && !alreadyAwarded.has(id)) return id;
  }
  return null;
}

/**
 * Reset per-generation STORY state on the worlds map (Req 22.3, 32.5). Every
 * world keeps its PERMANENT `discovered` flag (so the menu greys it rather than
 * blacking it out, Req 32.5) and clears its per-generation `storyCleared` /
 * `leftBehind` flags so the new generation replays the story from the start.
 */
function resetWorldsForNewGeneration(
  worlds: Record<string, WorldProgressState>,
): Record<string, WorldProgressState> {
  const out: Record<string, WorldProgressState> = {};
  for (const [id, w] of Object.entries(worlds)) {
    out[id] = {
      discovered: w.discovered, // permanent discovery — greyed, not re-hidden
      storyCleared: false, // story replays from the start next generation
      leftBehind: false, // left-behind is a per-generation story lock
    };
  }
  return out;
}

/**
 * Complete the current generation and advance the save into the next one
 * (Req 22.3-22.5, 32.3, 32.5). Pure — returns a brand-new SaveState plus the
 * awarded cosmetic id; the input is never mutated. Concretely it:
 *
 *   - awards a UNIQUE per-generation cosmetic (Req 22.4), adding it to both
 *     `unlockedCosmetics` (permanent, Req 22.2) and `generationCosmeticsAwarded`
 *     (the uniqueness ledger) — unless no unique id is available, in which case
 *     those lists are unchanged and `awardedCosmetic` is null;
 *   - advances the Generation_Name one step along Junior→Senior→next-Junior
 *     (Req 22.5, 32.3) via {@link nextGeneration};
 *   - resets per-generation STORY state (Req 22.3): clears `storyCleared` /
 *     `leftBehind` on every world while KEEPING permanent discovery greyed
 *     (Req 32.5);
 *   - preserves ALL permanent progress (Req 22.5): skills, cosmetics, equipped
 *     selections, bindings, settings, high scores + history untouched.
 *
 * Abilities / perks / temporary run bonuses live in their own in-memory systems
 * (e.g. PerkSystem.onNewGeneration); since the save schema carries no run
 * fields, resetting them is those systems' job — this function owns the SAVE
 * transition only (Req 22.3, Property 8).
 */
export function advanceGeneration(
  save: SaveState,
  cfg: ConfigFileData,
  opts: AdvanceGenerationOptions = {},
): AdvanceGenerationResult {
  const scheme = cfg.names.generationalScheme;

  const alreadyAwarded = new Set(save.generationCosmeticsAwarded);
  const awarded = pickUniqueCosmetic(alreadyAwarded, opts);

  // Fold the unique cosmetic into BOTH permanent lists (Req 22.2, 22.4). If
  // `unlockedCosmetics` somehow already holds it, set-union keeps it single.
  const unlockedCosmetics = awarded !== null && !save.unlockedCosmetics.includes(awarded)
    ? [...save.unlockedCosmetics, awarded]
    : [...save.unlockedCosmetics];
  const generationCosmeticsAwarded = awarded !== null
    ? [...save.generationCosmeticsAwarded, awarded]
    : [...save.generationCosmeticsAwarded];

  const next: SaveState = {
    ...save,
    // Advance Junior→Senior→next Junior (Req 32.3).
    generation: nextGeneration(save.generation, scheme),
    // Permanent (Req 22.5) — carry skills + cosmetics (+ the new award) forward.
    unlockedSkills: [...save.unlockedSkills],
    unlockedCosmetics,
    generationCosmeticsAwarded,
    // Per-generation story reset + greyed-but-kept discovery (Req 22.3, 32.5).
    worlds: resetWorldsForNewGeneration(save.worlds),
    // Permanent high-score state is untouched (Req 22.5, 28, 31.2).
    highScores: {
      story: { ...save.highScores.story },
      endless: { ...save.highScores.endless },
    },
    highScoreHistoryByGeneration: { ...save.highScoreHistoryByGeneration },
    // Permanent bindings + settings preserved (Req 22.5).
    controlBindings: {
      primary: [...save.controlBindings.primary],
      skill: [...save.controlBindings.skill],
    },
    settings: { ...save.settings },
  };

  return { save: next, awardedCosmetic: awarded };
}

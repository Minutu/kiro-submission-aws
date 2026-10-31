// Feature: kino-game
//
// WorldCompletionCinematic — the PURE, Phaser-free CONTENT for the short
// world-completion cinematic PLUS the silhouette-reveal / cross-generation
// greying STATE (task 10.4; design: "Cinematics System (Req 21, 29, 42)";
// Req 21.6, 21.7, 21.10 (= Req 32.5)).
//
// SCOPE / TASK BOUNDARY (10.4): this module owns two pure things, NO rendering:
//
//   1. The short world-completion Comic_Panel sequence (the `CinematicPanel[]`
//      the pure `createCinematicPlayer` walks) — a brief celebratory beat for
//      the just-cleared world, then (via the scene) a return to the menu
//      (Req 21.6). The Phaser CinematicScene resolves these for the
//      WORLD_COMPLETION cinematic id and hands back to the MENU on completion.
//
//   2. The silhouette-reveal STATE: which world's silhouette just dissolved
//      from black → revealed (the NEWLY UNLOCKED world, Req 21.7), and the
//      cross-generation rule that previously-discovered worlds render GREYED
//      rather than BLACK on a new generation (Req 21.10 / Req 32.5). This
//      REUSES the existing treasure-map display-state model
//      (`computeMapRows` already maps discovered/completed => 'greyed',
//      undiscovered => 'silhouette'/'nextReveal') rather than duplicating it:
//      the dissolve target is reported, and the post-completion map is read
//      straight off `computeMapRows` so the newly revealed world shows as
//      'greyed' (not a black silhouette).
//
// HARD RULE: no module under `src/core/**` may import `phaser` (see
// `src/README.md`). This module imports only the pure CinematicPanel type, the
// pure treasure-map STATE, and the Save_Store schema types; it stays
// unit-testable in plain Node with no browser/canvas/DOM.

import type { CinematicPanel } from './cinematicSequence.ts';
import type { SaveState, WorldProgressState } from './saveStore.ts';
import { computeMapRows, TREASURE_MAP_WORLD_IDS, type MapRow, type WorldKey } from './treasureMap.ts';
import type { WorldId } from './types.ts';

/**
 * The cinematic id for the world-completion sequence — the WORLD_COMPLETION
 * counterpart to BootScene's OPENING_CINEMATIC_ID. Co-located here (and
 * re-exported through the core barrel) so the engine CinematicScene seam and
 * the GameplayScene completion hand-off reference ONE shared string.
 */
export const WORLD_COMPLETION_CINEMATIC_ID = 'world-completion';

/** Stable panel ids for the world-completion beats so the engine/tests can key off them. */
export const WORLD_COMPLETION_PANEL_IDS = {
  cleared: 'world-completion-cleared',
  unlockReveal: 'world-completion-unlock-reveal',
  returnToMenu: 'world-completion-return-to-menu',
} as const;

/** A discriminator the engine can switch rendering on. */
export type WorldCompletionBeatKind =
  | 'world-cleared'
  | 'unlock-reveal'
  | 'return-to-menu';

/**
 * Numeric World id (1..5) for a SaveState world key. Local copy of the
 * treasure-map helper (that one is not exported) — kept trivial and total.
 */
function worldIdForKey(key: WorldKey): WorldId {
  return (TREASURE_MAP_WORLD_IDS.indexOf(key) + 1) as WorldId;
}

/** SaveState world key (`world1`..`world5`) for a numeric World id. */
export function worldKeyForId(worldId: number): WorldKey | null {
  const idx = Math.trunc(worldId) - 1;
  return TREASURE_MAP_WORLD_IDS[idx] ?? null;
}

/** Safe lookup of a world's progress flags; absent => all-false (undiscovered). */
function progressFor(save: SaveState, key: WorldKey): WorldProgressState {
  return (
    save.worlds[key] ?? {
      discovered: false,
      storyCleared: false,
      leftBehind: false,
    }
  );
}

// ---------------------------------------------------------------------------
// World-completion CONTENT — the short Comic_Panel sequence (Req 21.6, 21.7)
// ---------------------------------------------------------------------------

/**
 * The config values the completion content reads. Passed in as plain data so
 * this pure module never imports the config/engine layers; the engine seam
 * (CinematicScene) supplies them from the loaded Config_File.
 *
 * Everything except `clearedWorldId` is optional with sensible fallbacks so a
 * caller can build the sequence from as little as `{ clearedWorldId }`.
 */
export interface WorldCompletionContentInput {
  /** The World the player JUST cleared (1..5) — the subject of the celebration. */
  readonly clearedWorldId: number;
  /**
   * The World this completion NEWLY UNLOCKED (its silhouette dissolves on the
   * menu return, Req 21.7). Omit/undefined when the cleared world unlocked none
   * (e.g. World 5 — the final world has no next world to reveal, Req 23.2); the
   * reveal panel is then skipped.
   */
  readonly unlockedWorldId?: number | undefined;
  /**
   * World display names keyed `world1`..`world5`. When omitted, worlds fall
   * back to `World N`.
   */
  readonly worldNames?: Partial<Record<WorldKey, string>>;
  /**
   * Optional Asset_Registry image keys for the beats (placeholder-friendly: a
   * missing/unknown key renders the comic frame as a placeholder).
   */
  readonly imageKeys?: Partial<Record<WorldCompletionBeatKind, string>>;
}

/** Resolve a world's display name, falling back to `World N`. */
function worldName(
  input: Pick<WorldCompletionContentInput, 'worldNames'>,
  worldId: number,
): string {
  const key = worldKeyForId(worldId);
  return (key && input.worldNames?.[key]) || `World ${worldId}`;
}

/**
 * Build the SHORT, ordered world-completion Comic_Panel sequence (Req 21.6,
 * 21.7).
 *
 * Order (the sequence the pure player walks):
 *   1. "World cleared!" celebration for the just-cleared world (Req 21.6).
 *   2. The newly-unlocked world's silhouette dissolving to reveal it — ONLY
 *      when a world was unlocked (Req 21.7). Carries the dissolve target so the
 *      engine can drive the reveal tween from this PURE state.
 *   3. Returning to the menu (Req 21.6) — the hand-off beat; the scene starts
 *      the MENU on completion.
 *
 * "Short" is a hard contract (this is a brief cinematic, not the opening): the
 * sequence is at most three panels and never fewer than two.
 */
export function buildWorldCompletionCinematicPanels(
  input: WorldCompletionContentInput,
): CinematicPanel[] {
  const img = (kind: WorldCompletionBeatKind): string | undefined =>
    input.imageKeys?.[kind];
  const withImage = (
    panel: CinematicPanel,
    kind: WorldCompletionBeatKind,
  ): CinematicPanel => {
    const key = img(kind);
    return key ? { ...panel, imageKey: key } : panel;
  };

  const clearedName = worldName(input, input.clearedWorldId);
  const panels: CinematicPanel[] = [];

  // 1. Celebrate the cleared world (Req 21.6).
  panels.push(
    withImage(
      {
        id: WORLD_COMPLETION_PANEL_IDS.cleared,
        caption: `${clearedName} cleared! Kino plants a flag on the checkpoint.`,
        data: {
          beat: 'world-cleared' satisfies WorldCompletionBeatKind,
          clearedWorldId: input.clearedWorldId,
        },
      },
      'world-cleared',
    ),
  );

  // 2. Dissolve the newly-unlocked world's silhouette to reveal it (Req 21.7).
  //    Skipped when nothing new was unlocked (e.g. the final world).
  if (input.unlockedWorldId != null) {
    const unlockedName = worldName(input, input.unlockedWorldId);
    panels.push(
      withImage(
        {
          id: WORLD_COMPLETION_PANEL_IDS.unlockReveal,
          caption: `A new path opens — ${unlockedName} rises out of the dark.`,
          data: {
            beat: 'unlock-reveal' satisfies WorldCompletionBeatKind,
            // The dissolve target: black silhouette -> revealed (Req 21.7).
            revealWorldId: input.unlockedWorldId,
          },
        },
        'unlock-reveal',
      ),
    );
  }

  // 3. Return to the menu (Req 21.6) — the completion hand-off beat.
  panels.push(
    withImage(
      {
        id: WORLD_COMPLETION_PANEL_IDS.returnToMenu,
        caption: 'Back to the map…',
        data: { beat: 'return-to-menu' satisfies WorldCompletionBeatKind },
      },
      'return-to-menu',
    ),
  );

  return panels;
}

// ---------------------------------------------------------------------------
// Silhouette-reveal STATE — the dissolve target + post-completion map (21.7)
// ---------------------------------------------------------------------------

/**
 * The PURE silhouette-reveal result for a just-completed world (Req 21.7).
 *
 * This REUSES the treasure-map model: `postCompletionRow` is the `MapRow` the
 * existing `computeMapRows` produces for the newly-unlocked world on the UPDATED
 * save — which, because the world is now discovered, is `displayState:
 * 'greyed'` (NOT a black silhouette). So the dissolve ends on the same greyed
 * treatment the map renders steady-state, with no duplicated display logic.
 */
export interface SilhouetteRevealState {
  /**
   * The World whose silhouette dissolves from black → revealed (the newly
   * unlocked world, Req 21.7), or null when the completion unlocked nothing
   * (e.g. the final world — nothing new to reveal).
   */
  readonly dissolveWorldId: WorldId | null;
  /**
   * The treasure-map row for the revealed world AFTER the completion save
   * update — pulled straight from `computeMapRows`, so its `displayState` is
   * `'greyed'` once the world is discovered (Req 21.7). Null when nothing was
   * unlocked.
   */
  readonly postCompletionRow: MapRow | null;
  /**
   * True iff the reveal ends on the GREYED treatment (the dissolve target is
   * now a discovered/greyed world, not a black silhouette). The confirmation
   * Req 21.7 asks for, derived from the reused map model.
   */
  readonly revealsAsGreyed: boolean;
}

/**
 * Compute the silhouette-reveal state for a just-completed world (Req 21.7).
 *
 * `updatedSave` is the Save_Store AFTER the completion has been folded in (the
 * just-unlocked world marked `discovered`). `unlockedWorldId` is the world the
 * completion unlocked, or null/undefined when none (final world).
 *
 * The post-completion row is read from the EXISTING `computeMapRows` so the
 * reveal target's display state is the single source of truth: a now-discovered
 * world is `'greyed'`, confirming the dissolve reveals it greyed rather than
 * leaving it a black silhouette.
 */
export function computeSilhouetteReveal(
  updatedSave: SaveState,
  unlockedWorldId: number | null | undefined,
): SilhouetteRevealState {
  if (unlockedWorldId == null) {
    return { dissolveWorldId: null, postCompletionRow: null, revealsAsGreyed: false };
  }

  const key = worldKeyForId(unlockedWorldId);
  if (!key) {
    return { dissolveWorldId: null, postCompletionRow: null, revealsAsGreyed: false };
  }

  const worldId = worldIdForKey(key);
  const { rows } = computeMapRows(updatedSave);
  const row = rows.find((r) => r.worldId === worldId) ?? null;

  return {
    dissolveWorldId: worldId,
    postCompletionRow: row,
    // Reveal ends on greyed iff the row the map model computes is 'greyed'.
    revealsAsGreyed: row?.displayState === 'greyed',
  };
}

// ---------------------------------------------------------------------------
// Cross-generation greying — previously discovered worlds greyed, not black
// (Req 21.10 / Req 32.5)
// ---------------------------------------------------------------------------

/** One world's cross-generation display classification on a fresh generation. */
export interface GenerationGreyingRow {
  readonly worldId: WorldId;
  readonly worldKey: WorldKey;
  /** The display state the map model assigns on the new generation's map. */
  readonly displayState: MapRow['displayState'];
  /** True iff this world was discovered in a PRIOR generation (permanent greyed). */
  readonly previouslyDiscovered: boolean;
  /** True iff this world renders GREYED (the Req 21.10 contract for prior worlds). */
  readonly greyed: boolean;
  /** True iff this world renders as a BLACK silhouette. */
  readonly blackSilhouette: boolean;
}

/**
 * Report, for a save at the start of a NEW generation, how each world renders —
 * the cross-generation greying rule (Req 21.10 / Req 32.5): worlds discovered in
 * a prior generation render GREYED rather than a BLACK silhouette.
 *
 * `advanceGeneration` (generationTransition.ts) resets the per-generation STORY
 * flags (`storyCleared`/`leftBehind`) while KEEPING the permanent `discovered`
 * flag (Req 22.3, 32.5). Because `computeMapRows` maps any `discovered` world —
 * cleared THIS gen or merely discovered in a PAST one — to `'greyed'`, this
 * helper just classifies each row against that model and surfaces the
 * greyed-not-black guarantee per world. It adds NO new display logic; it reads
 * the reused map model.
 */
export function computeGenerationGreying(
  newGenerationSave: SaveState,
): GenerationGreyingRow[] {
  const { rows } = computeMapRows(newGenerationSave);
  return rows.map((row) => {
    const discovered = progressFor(newGenerationSave, row.worldKey).discovered;
    const greyed = row.displayState === 'greyed';
    return {
      worldId: row.worldId,
      worldKey: row.worldKey,
      displayState: row.displayState,
      previouslyDiscovered: discovered,
      greyed,
      // 'silhouette' is the black treatment; 'nextReveal' is the fading-in top
      // edge (not a steady black silhouette). Only 'silhouette' is "black".
      blackSilhouette: row.displayState === 'silhouette',
    };
  });
}

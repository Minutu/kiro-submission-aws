// Feature: kino-game
//
// High-score tracking per world and mode (task 7.6; design: "Save round-trip
// (Req 22.6–22.7, 28)" — "High scores update only when exceeded, per world and
// mode separately"; Property 11). PURE and Phaser-free so the monotonic
// per-world/per-mode-maximum property (task 7.7, Property 11) can exercise it
// in plain Node without a browser or canvas.
//
// THE CONTRACT (Req 28):
//   - Story and Endless high scores are persisted SEPARATELY per world
//     (Req 28.1, 28.2): the save carries `highScores.story` and
//     `highScores.endless`, each a `Record<world{N}, number>`.
//   - A high score is updated/persisted ONLY when EXCEEDED (Req 28.3): a run
//     scoring <= the stored high score leaves it unchanged. The stored value is
//     therefore the monotonic per-world/per-mode MAXIMUM (Property 11).
//   - The RELEVANT high score for a (mode, world) pair is exposed for the menu
//     and run-end screen (Req 28.4), defaulting to 0 when absent.
//
// WHY A DEDICATED 'story' | 'endless' MODE DISCRIMINATOR (not MovementMode):
// Req 28 separates STORY high scores from ENDLESS_MODE high scores — this is
// the run's MODE (how it was played/scored), not Kino's current Movement_Mode
// (jumping/flight/zigzag/underwater). The engine seam
// `src/engine/runEndStats.ts#relevantHighScore` currently keys off a
// MovementMode-ish value (`'endless'` reads the endless map, anything else
// reads the story map). `highScoreModeForMovement` below is the single bridge
// that keeps both readers consistent: a 'jumping'|'flight'|'zigzag'|'underwater'
// movement maps to 'story', and the sentinel 'endless' maps to 'endless'. New
// code should prefer the explicit HighScoreMode reader (`getHighScore`).

import type { WorldId, MovementMode } from './types.ts';
import type { HighScoreState, SaveState } from './saveStore.ts';

/**
 * The run MODE a high score is tracked under (Req 28.1-28.2). Deliberately
 * distinct from `MovementMode`: Req 28 separates STORY vs ENDLESS, not the four
 * movement modes.
 */
export type HighScoreMode = 'story' | 'endless';

/** Result of attempting to record a run score against the stored high score. */
export interface RecordScoreResult {
  /** A NEW HighScoreState; the input is never mutated. */
  highScores: HighScoreState;
  /** True ONLY when the stored high score increased (Req 28.3). */
  updated: boolean;
  /** The resulting (post-record) high score for the (mode, world). */
  highScore: number;
}

/** Result of recording a run score folded into a whole SaveState. */
export interface RecordScoreOnSaveResult {
  /** A NEW SaveState with the updated `highScores`; input never mutated. */
  save: SaveState;
  /** True ONLY when the stored high score increased (Req 28.3). */
  updated: boolean;
  /** The resulting (post-record) high score for the (mode, world). */
  highScore: number;
}

/** The per-world map key for a world id, e.g. 1 -> "world1". */
function worldKey(world: WorldId): string {
  return `world${world}`;
}

/**
 * Bridge a run's Movement_Mode (or the 'endless' sentinel used by
 * `runEndStats.relevantHighScore`) to the Req-28 HighScoreMode. Any real
 * movement mode is a STORY run; only the explicit 'endless' sentinel reads the
 * endless map. This keeps the engine seam and this module in lock-step.
 */
export function highScoreModeForMovement(mode: MovementMode | 'endless'): HighScoreMode {
  return mode === 'endless' ? 'endless' : 'story';
}

/**
 * Read the RELEVANT high score for a (mode, world) from the per-mode maps
 * (Req 28.4). A missing or non-finite entry reads as 0. Read-only: never
 * mutates the provided maps.
 */
export function getHighScore(
  highScores: HighScoreState,
  mode: HighScoreMode,
  world: WorldId,
): number {
  const map = mode === 'endless' ? highScores.endless : highScores.story;
  const value = map[worldKey(world)];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Record a run's final `score` against the stored high score for (mode, world).
 *
 * Returns a NEW HighScoreState whose (mode, world) entry is
 * `max(existing, score)` — so the value only ever INCREASES (monotonic max,
 * Req 28.3). `updated` is true ONLY when the stored value strictly increased;
 * an equal or lower score (or a non-finite `score`) leaves the maps untouched
 * and reports `updated: false`. The input `highScores` is never mutated — the
 * other mode's map and the untouched worlds are preserved by value.
 */
export function recordScore(
  highScores: HighScoreState,
  mode: HighScoreMode,
  world: WorldId,
  score: number,
): RecordScoreResult {
  const existing = getHighScore(highScores, mode, world);
  const candidate = Number.isFinite(score) ? score : existing;

  // Only when strictly exceeded (Req 28.3). Clone both maps regardless so the
  // returned state is always a fresh value callers can own, but only the
  // relevant entry changes.
  const updated = candidate > existing;
  const nextValue = updated ? candidate : existing;

  const next: HighScoreState = {
    story: { ...highScores.story },
    endless: { ...highScores.endless },
  };
  if (mode === 'endless') {
    next.endless[worldKey(world)] = nextValue;
  } else {
    next.story[worldKey(world)] = nextValue;
  }

  return { highScores: next, updated, highScore: nextValue };
}

/**
 * Fold a run score into a whole SaveState (Req 28.3). Convenience over
 * `recordScore` that returns a NEW SaveState with only `highScores` replaced;
 * every other permanent field is carried by reference (the caller owns
 * persistence via the Save_Store). The input `save` is never mutated.
 *
 * NOTE: the cross-generation `highScoreHistoryByGeneration` (Req 31.2, the
 * this-gen-vs-past-gen Info panel) is intentionally NOT touched here — that
 * roll-up belongs to the generation-transition flow (task 7.4), which snapshots
 * the current generation's high scores when a generation completes. This module
 * owns only the live per-world/per-mode maxima.
 */
export function recordScoreOnSave(
  save: SaveState,
  mode: HighScoreMode,
  world: WorldId,
  score: number,
): RecordScoreOnSaveResult {
  const { highScores, updated, highScore } = recordScore(save.highScores, mode, world, score);
  return {
    save: { ...save, highScores },
    updated,
    highScore,
  };
}

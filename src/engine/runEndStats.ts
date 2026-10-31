// Feature: kino-game
//
// Pure helpers for the Run_End_Screen (task 4.7). Extracted from RunEndScene so
// the stat logic — which High_Score map to read for a run's mode + world, and
// how to format a run time — stays PHASER-FREE and unit testable in plain Node
// without a browser/canvas. RunEndScene (the Phaser scene) imports these; the
// scene itself stays a thin wiring + drawing layer.
//
// Lives in the engine layer but intentionally imports no Phaser.

import type { MovementMode } from '../core/index.ts';
import type { HighScoreState } from './saveState.ts';

/**
 * Pick the relevant High_Score for a run's mode + world from the save's
 * per-mode high-score maps (Req 39.1). High scores are keyed by `world{N}`
 * (see saveState's First_Launch_State); a missing or non-finite entry reads as
 * 0.
 *
 * @param highScores The save's `{ story, endless }` per-world maps.
 * @param mode       The run's movement mode. The Jumping story slice reads the
 *                   `story` map; `endless` is reserved for endless mode
 *                   (task 7.6 / Req 28).
 * @param world      The run's world id (1..5), mapped to the `world{N}` key.
 */
export function relevantHighScore(
  highScores: HighScoreState,
  mode: MovementMode,
  world: number,
): number {
  // The vertical slice only runs story mode; endless is a task-7.6/Req-28
  // concern. Default any non-'endless' run to the story map so the displayed
  // value matches how the run was scored.
  const map = mode === ('endless' as MovementMode) ? highScores.endless : highScores.story;
  const key = `world${world}`;
  const value = map[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Format a run duration (ms) as a human-readable seconds string, e.g. 4200 →
 * "4.2s" (Req 39.1 "the time spent in the run"). Negative/NaN inputs clamp to
 * "0.0s".
 */
export function formatRunTime(runTimeMs: number): string {
  const ms = Number.isFinite(runTimeMs) && runTimeMs > 0 ? runTimeMs : 0;
  return `${(ms / 1000).toFixed(1)}s`;
}

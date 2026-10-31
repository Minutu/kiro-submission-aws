// Feature: kino-game
//
// MenuControls — the PURE selection logic behind the main menu's BOTTOM PRIMARY
// button (task 9.2; design: "Menu controls (20.23–20.26), bottom primary
// Start/Continue button (label from config by story position, 20.13)"; Req
// 20.13, 20.14, 20.26). Plus a small convenience for the top-center Generation
// pill text (Req 20.11, 20.15, 20.25) that REUSES the existing pure
// Generation_Name composition rather than duplicating it.
//
// WHY THIS LIVES IN src/core: resolving which label the bottom primary button
// shows (Start Story vs Continue Story) and which story step it launches is a
// pure, deterministic function of the Save_Store's story position and the
// Config_File labels — no Phaser, no DOM. Keeping it here makes the exhaustive
// 13a–13d label contract unit-testable in plain Node and the SINGLE SOURCE OF
// TRUTH; the engine MainMenuScene only RENDERS the resolved label and, on press,
// launches `launchWorld` (Req 20.14). Enforced by
// test/boundary.core-no-phaser.test.ts.
//
// STORY POSITION MODEL (Req 20.13):
//   The player's CURRENT story position is the highest-numbered World that is
//   discovered and NOT left behind — i.e. where the story currently stands
//   (same rule the treasure-map Kino marker uses). On a First_Launch_State only
//   World 1 is discovered, so the position is World 1.
//
//   "The story has been started" is derived from permanent save state: the
//   player has begun the story once they have CLEARED at least one World in the
//   current generation (`storyCleared`), OR their position has already advanced
//   beyond World 1. Before any world is cleared and while still on World 1, the
//   story has NOT been started.
//
// THE EXHAUSTIVE, MUTUALLY-EXCLUSIVE 13a–13d CASES (Req 20.13):
//   - 13a WHILE position is World 1 AND the story has NOT been started  => label = config `startStory`.
//   - 13b WHILE position is BEYOND World 1                               => label = config `continueStory`.
//   - 13c WHILE position is World 1 AND the story HAS been started       => label = config `continueStory`.
//   - 13d Both the `startStory` and `continueStory` label values are read from the Config_File.
// These three positional branches (13a/13b/13c) partition every possible story
// position, and both label values always come from the config (13d).
//
// PURE / Phaser-free. Returns the same result for the same inputs, reads nothing
// global, and mutates none of its inputs.

import type { ConfigFileData, GenerationalScheme } from '../config/index.ts';
import type { SaveState } from './saveStore.ts';
import type { WorldId } from './types.ts';
import { formatGenerationName } from './generationTransition.ts';

/** The five story worlds in order; keys match the Save_Store `worlds` map. */
const WORLD_KEYS = ['world1', 'world2', 'world3', 'world4', 'world5'] as const;

/**
 * The action the bottom primary button performs when pressed. Both branches
 * launch the next available story step (Req 20.14); the discriminant records
 * WHICH 13a–13d label case produced it so the engine (and tests) can reason
 * about the resolved state without re-deriving it.
 */
export type PrimaryButtonAction = 'startStory' | 'continueStory';

/** The resolved bottom-primary-button descriptor (Req 20.13, 20.14). */
export interface PrimaryButtonResolution {
  /** The button label, read verbatim from the Config_File (Req 20.13d). */
  label: string;
  /** Start a fresh story vs continue an in-progress one (Req 20.13a–20.13c). */
  action: PrimaryButtonAction;
  /**
   * The World the press launches — the next available story step (Req 20.14).
   * Always the player's current story position (1..5).
   */
  launchWorld: WorldId;
  /**
   * Which exhaustive case fired: '13a' | '13b' | '13c'. (13d is the shared
   * "read both labels from config" rule, not a positional branch.) Exposed for
   * clarity + test assertions; the engine renders `label` and calls
   * `launchWorld` regardless.
   */
  case: '13a' | '13b' | '13c';
}

/** Numeric World id (1..5) for a `worldN` save key. */
function worldIdForIndex(index: number): WorldId {
  return (index + 1) as WorldId;
}

/**
 * The player's CURRENT story position: the highest-numbered World that is
 * discovered and NOT left behind (Req 20.13 "current story position"; same rule
 * as the treasure-map Kino marker). Falls back to World 1 when nothing is
 * discovered (defensive — World 1 is always discovered on a real save), so the
 * resolution is always total.
 */
export function currentStoryPosition(save: SaveState): WorldId {
  let position: WorldId = 1;
  WORLD_KEYS.forEach((key, index) => {
    const w = save.worlds[key];
    if (w !== undefined && w.discovered && !w.leftBehind) {
      position = worldIdForIndex(index);
    }
  });
  return position;
}

/**
 * Whether the current generation's story has BEEN STARTED (Req 20.13a/20.13c).
 * True once the player has cleared at least one World in this generation
 * (`storyCleared`) OR their story position has advanced beyond World 1. A fresh
 * First_Launch_State — World 1 discovered, nothing cleared — reads as NOT
 * started.
 */
export function hasStartedStory(save: SaveState): boolean {
  if (currentStoryPosition(save) > 1) return true;
  return WORLD_KEYS.some((key) => save.worlds[key]?.storyCleared === true);
}

/**
 * Resolve the bottom primary button (Req 20.13, 20.14): pick the label from the
 * Config_File by the player's current story position + whether the story has
 * been started, and report the World a press launches (the next available story
 * step). PURE — a function of the Save_Store story state and the config labels
 * only.
 *
 * The exhaustive, mutually-exclusive cases (Req 20.13a–20.13c) are driven by two
 * reads: {@link currentStoryPosition} and {@link hasStartedStory}. Both label
 * values always come from the Config_File (Req 20.13d).
 */
export function resolvePrimaryButtonLabel(
  save: SaveState,
  config: Pick<ConfigFileData, 'labels'>,
): PrimaryButtonResolution {
  const position = currentStoryPosition(save);
  const started = hasStartedStory(save);
  const { startStory, continueStory } = config.labels;

  // 13b: position beyond World 1 => Continue Story.
  if (position > 1) {
    return { label: continueStory, action: 'continueStory', launchWorld: position, case: '13b' };
  }

  // Position is World 1 from here on (the two remaining exhaustive branches).
  if (!started) {
    // 13a: World 1 and the story has not been started => Start Story.
    return { label: startStory, action: 'startStory', launchWorld: position, case: '13a' };
  }

  // 13c: World 1 and the story has been started => Continue Story.
  return { label: continueStory, action: 'continueStory', launchWorld: position, case: '13c' };
}

/**
 * The top-center Generation pill text (Req 20.11, 20.15, 20.25). A thin
 * convenience that REUSES the existing pure Generation_Name composition
 * (`formatGenerationName`) so the pill, the header, and the run-end/ cinematic
 * title cards all read ONE implementation — no duplicate roman/template logic.
 */
export function generationPillText(
  save: SaveState,
  config: Pick<ConfigFileData, 'names'> & {
    names: { baseCharacterName: string; generationalScheme: Pick<GenerationalScheme, 'format'> };
  },
): string {
  return formatGenerationName(
    config.names.baseCharacterName,
    config.names.generationalScheme,
    save.generation,
  );
}

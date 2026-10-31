// Feature: kino-game
//
// The PURE treasure-map STATE logic (task 9.1; design: "UI / Menu > Treasure
// map (20.2, 20.27–20.28, 34)"; Req 20.2-20.6, 20.18-20.22, 20.27-20.28, 34.1-34.3).
//
// WHY THIS LIVES IN src/core: it is Phaser-free and deterministic, so the menu
// lock-in logic — the single source of truth for which World is selected and
// whether Play may fire — can be unit-tested in plain Node (enforced by
// test/boundary.core-no-phaser.test.ts). The MainMenuScene (engine) only
// renders the rows this module computes and feeds a scroll offset back into
// `lockInWorldForScroll`; it never decides selection or Play-enablement itself.
//
// MODEL (design + Req 20.27-20.28, 34):
//   - The map is a VERTICAL stack of one row per story World. World 1 (Desert)
//     sits at the BOTTOM; higher-numbered worlds stack upward (Req 20.27). We
//     model "bottom" as the LAST element of the ordered row list so a renderer
//     can lay rows out from the bottom of the screen upward by index.
//   - Each row has a DISPLAY STATE derived from the Save_Store world flags:
//       * completed  (storyCleared)          => greyed      (Req 20.3, 20.19)
//       * discovered (discovered, not clear)  => greyed      (Req 20.4?, 20.19)
//       * next-reveal (first undiscovered,
//         fading in at the top edge)          => nextReveal  (Req 20.28)
//       * undiscovered (beyond the next)      => silhouette  (black, Req 20.18)
//     Greyed covers BOTH completed and merely-discovered worlds (Req 20.19:
//     "each completed OR previously discovered World ... in a greyed state").
//     The next World to be revealed is rendered fading in at the top (Req
//     20.28); every other not-yet-discovered World is a black silhouette.
//   - Exactly one checkpoint per World (Req 20.20) — every row carries one.
//   - The Kino location marker (Req 20.5, 20.21) sits on the player's CURRENT
//     story world: the highest-numbered discovered-but-not-left-behind world,
//     i.e. where the story currently stands.
//
// LOCK-IN (Req 20.33-20.34, 34.1-34.3): scrolling snaps the map CENTER to the
// nearest row. If that row is a DISCOVERED world (greyed — completed or
// discovered, i.e. selectable), it becomes the `Locked_In_World` and Play is
// enabled (side glow on, Req 34.1). If the centered row is an UNDISCOVERED
// silhouette (including the next-reveal), nothing locks in, there is no glow,
// the row is flagged unselectable, and Play is disabled (Req 34.3). "Nearest"
// is purely geometric on the scroll position; selectability is a SEPARATE gate
// so a silhouette can be centered (and visibly unselectable) without locking.

import type { SaveState, WorldProgressState } from './saveStore.ts';
import type { WorldId } from './types.ts';

/** The five story worlds, in story order (World 1 first). Keys match SaveState. */
export const TREASURE_MAP_WORLD_IDS = [
  'world1',
  'world2',
  'world3',
  'world4',
  'world5',
] as const;

/** A SaveState world-map key, `world1`..`world5`. */
export type WorldKey = (typeof TREASURE_MAP_WORLD_IDS)[number];

/**
 * Per-row display state (design: "Completed/discovered worlds greyed;
 * undiscovered black silhouettes"; Req 20.3-20.4, 20.18-20.19, 20.28):
 *   - 'greyed'     — completed OR discovered world, SELECTABLE (Req 20.19).
 *   - 'nextReveal' — the first undiscovered world, fading in at the top edge
 *                    (Req 20.28); NOT selectable (still a silhouette).
 *   - 'silhouette' — an undiscovered world beyond the next reveal; a black
 *                    silhouette (Req 20.18); NOT selectable.
 */
export type MapRowDisplayState = 'greyed' | 'nextReveal' | 'silhouette';

/** One treasure-map row — the pure description a renderer draws (Req 20.2). */
export interface MapRow {
  /** Numeric World id 1..5 (matches core `WorldId`). */
  worldId: WorldId;
  /** SaveState map key, `world1`..`world5`. */
  worldKey: WorldKey;
  /** Display treatment (greyed / next-reveal / silhouette). */
  displayState: MapRowDisplayState;
  /**
   * SELECTABLE iff the world is discovered (greyed). A centered selectable row
   * locks in + enables Play; a centered unselectable row disables Play (Req
   * 34.1, 34.3).
   */
  selectable: boolean;
  /** Every World shows exactly one checkpoint (Req 20.20). */
  hasCheckpoint: boolean;
  /** True on the player's current story world — the Kino marker row (Req 20.5, 20.21). */
  hasKinoMarker: boolean;
  /**
   * Is this World's ENDLESS-MODE trigger (the right-side triangle, Req 20.29)
   * ACTIVE? A world's endless mode unlocks once that world's STORY is CLEARED
   * (`storyCleared`): true => the triangle is active/interactive (Req 20.31,
   * 23.4); false => it is greyed/locked and non-interactive (Req 20.30). This
   * is derived PER ROW from the save's world `storyCleared` flag — the single
   * source of truth the MainMenuScene reads to decide whether to draw the
   * triangle greyed-locked vs active.
   */
  endlessUnlocked: boolean;
}

/** The full ordered row set plus the Kino-marker world (Req 20.2, 20.5). */
export interface MapLayout {
  /**
   * Rows in STORY order: `rows[0]` is World 1 (the BOTTOM of the vertical map),
   * ascending to `rows[n-1]` = World 5 at the top (Req 20.27). A renderer lays
   * these out from the bottom of the screen upward.
   */
  rows: MapRow[];
  /** The world carrying the Kino marker, or null if none is discovered. */
  kinoMarkerWorldId: WorldId | null;
}

/** The lock-in decision for a given scroll position (Req 34.1-34.3). */
export interface LockInResult {
  /** The locked-in World, or null when a silhouette/next-reveal is centered. */
  lockedInWorldId: WorldId | null;
  /** The world index currently centered (0 = World 1), always defined. */
  centeredWorldId: WorldId | null;
  /** True iff the centered world may be selected (it is discovered/greyed). */
  centeredSelectable: boolean;
  /** Side glow shows ONLY on a locked-in (selectable) centered world (Req 34.1). */
  showSideGlow: boolean;
  /** Play is enabled ONLY when a discovered world is locked in (Req 34.2-34.3). */
  playEnabled: boolean;
}

/** Numeric World id (1..5) for a SaveState world key. */
function worldIdForKey(key: WorldKey): WorldId {
  return (TREASURE_MAP_WORLD_IDS.indexOf(key) + 1) as WorldId;
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

/**
 * The player's CURRENT story world = the highest-numbered world that is
 * discovered and NOT left behind (Req 20.5, 20.21, 27.15-27.16). This is where
 * the Kino marker sits. Returns null when nothing is discovered (shouldn't
 * happen for a real save — World 1 is always discovered — but kept total).
 */
function currentStoryWorld(save: SaveState): WorldId | null {
  let current: WorldId | null = null;
  for (const key of TREASURE_MAP_WORLD_IDS) {
    const p = progressFor(save, key);
    if (p.discovered && !p.leftBehind) {
      current = worldIdForKey(key);
    }
  }
  return current;
}

/**
 * Compute the ordered treasure-map rows + Kino marker from a Save_Store state
 * (Req 20.2-20.5, 20.18-20.22, 20.27-20.28).
 *
 * Ordering: `rows[0]` = World 1 (bottom), ascending to World 5 (top) — Req
 * 20.27. Display state per row:
 *   - discovered (incl. completed) => 'greyed', selectable (Req 20.19).
 *   - first undiscovered world     => 'nextReveal' (fades in at top, Req 20.28),
 *     NOT selectable.
 *   - any undiscovered world after the first => 'silhouette' (black, Req 20.18),
 *     NOT selectable.
 * Every row has exactly one checkpoint (Req 20.20); the current story world
 * carries the Kino marker (Req 20.5, 20.21).
 */
export function computeMapRows(save: SaveState): MapLayout {
  const kinoWorld = currentStoryWorld(save);

  // The first (lowest-numbered) undiscovered world is the "next reveal" that
  // fades in at the top edge (Req 20.28); every undiscovered world beyond it is
  // a plain black silhouette (Req 20.18). Tracked as we walk story order.
  let nextRevealAssigned = false;

  const rows: MapRow[] = TREASURE_MAP_WORLD_IDS.map((key) => {
    const p = progressFor(save, key);
    const worldId = worldIdForKey(key);
    const discovered = p.discovered;

    let displayState: MapRowDisplayState;
    if (discovered) {
      // Completed OR merely discovered both render greyed (Req 20.19).
      displayState = 'greyed';
    } else if (!nextRevealAssigned) {
      // The first undiscovered world is the next reveal (Req 20.28).
      displayState = 'nextReveal';
      nextRevealAssigned = true;
    } else {
      displayState = 'silhouette';
    }

    return {
      worldId,
      worldKey: key,
      displayState,
      // Only discovered (greyed) worlds are selectable (Req 34.1/34.3).
      selectable: discovered,
      hasCheckpoint: true, // exactly one per world (Req 20.20)
      hasKinoMarker: kinoWorld !== null && worldId === kinoWorld,
      // Endless triangle active once this world's story is cleared (Req
      // 20.30-20.31, 23.4); greyed/locked until then.
      endlessUnlocked: p.storyCleared,
    };
  });

  return { rows, kinoMarkerWorldId: kinoWorld };
}

/**
 * Snap a continuous scroll position to the nearest World row and resolve the
 * lock-in (Req 20.33-20.34, 34.1-34.3).
 *
 * `scrollCenter` is a continuous index into `rows` identifying which world is
 * at the map's vertical CENTER: 0 => `rows[0]` (World 1, bottom), n-1 =>
 * `rows[n-1]` (top). The engine converts its pixel scroll offset into this
 * index before calling. "Nearest" is a pure round-to-nearest-integer snap,
 * clamped to the valid row range.
 *
 * Decision:
 *   - If the snapped (centered) row is SELECTABLE (a discovered/greyed world),
 *     it becomes the `Locked_In_World`: glow on, Play enabled (Req 34.1-34.2).
 *   - If it is an UNDISCOVERED silhouette or the next-reveal, nothing locks in:
 *     no glow, unselectable, Play disabled (Req 34.3).
 */
export function lockInWorldForScroll(
  rows: readonly MapRow[],
  scrollCenter: number,
): LockInResult {
  if (rows.length === 0) {
    return {
      lockedInWorldId: null,
      centeredWorldId: null,
      centeredSelectable: false,
      showSideGlow: false,
      playEnabled: false,
    };
  }

  // Round-to-nearest snap, clamped into range. `Math.round` ties go up, which
  // is a harmless, deterministic choice for the exact-midpoint case.
  const snapped = Math.min(
    rows.length - 1,
    Math.max(0, Math.round(Number.isFinite(scrollCenter) ? scrollCenter : 0)),
  );

  const centered = rows[snapped]!; // snapped is clamped into [0, length-1]
  const selectable = centered.selectable;

  return {
    lockedInWorldId: selectable ? centered.worldId : null,
    centeredWorldId: centered.worldId,
    centeredSelectable: selectable,
    showSideGlow: selectable,
    playEnabled: selectable,
  };
}

/**
 * Convenience: compute rows from a save AND resolve the lock-in for a scroll
 * position in one call. Keeps the engine from having to hold the rows just to
 * re-derive the lock-in every scroll tick.
 */
export function computeTreasureMap(
  save: SaveState,
  scrollCenter: number,
): { layout: MapLayout; lockIn: LockInResult } {
  const layout = computeMapRows(save);
  return { layout, lockIn: lockInWorldForScroll(layout.rows, scrollCenter) };
}

/**
 * Is the ENDLESS-MODE triangle ACTIVE for `worldKey` (Req 20.29-20.31, 23.4)?
 *
 * The right-side triangle on a World panel is greyed/LOCKED until that World's
 * STORY has been CLEARED, and ACTIVE (interactive) once it is (Req 20.30-20.31).
 * The single gate is the save's per-world `storyCleared` flag — the same flag
 * `computeMapRows` folds into each row's {@link MapRow.endlessUnlocked}. This
 * standalone form lets the MainMenuScene (or a test) ask the question for one
 * world without materializing the whole layout. A world absent from the save
 * (never discovered) is treated as not-cleared => inactive.
 *
 * NOTE: this reports ONLY whether the trigger is shown as active. Whether that
 * world actually SUPPORTS an endless run (worlds 1-4, not World 5 — Req 23.2)
 * is a SEPARATE concern owned by `endlessMode.supportsEndless`; a cleared World
 * 5's triangle is still "active" per Req 20.31, but its launch path is gated by
 * endless support at the scene.
 */
export function isEndlessTriangleActive(
  save: SaveState,
  worldKey: WorldKey,
): boolean {
  return progressFor(save, worldKey).storyCleared;
}

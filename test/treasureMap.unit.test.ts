// Feature: kino-game
//
// UNIT tests for the PURE treasure-map STATE logic (task 9.1; src/core/
// treasureMap.ts; design: "UI / Menu > Treasure map (20.2, 20.27–20.28, 34)";
// Req 20.2-20.6, 20.18-20.22, 20.27-20.28, 34.1-34.3).
//
// Covered:
//   - Row ORDERING: `rows[0]` is World 1 (the bottom of the vertical map),
//     ascending to World 5 at the top (Req 20.27).
//   - DISPLAY-STATE mapping: completed/discovered => greyed (Req 20.19); the
//     first undiscovered world => nextReveal (fading in at top, Req 20.28);
//     later undiscovered worlds => black silhouette (Req 20.18).
//   - Exactly one checkpoint per world (Req 20.20) + the Kino location marker on
//     the current story world (Req 20.5, 20.21).
//   - LOCK-IN snapping to the nearest DISCOVERED world = Locked_In_World with a
//     side glow and Play ENABLED (Req 34.1-34.2).
//   - The undiscovered-silhouette-centered case: no glow, nothing locked in,
//     unselectable, Play DISABLED (Req 34.1, 34.3).
//
// Pure TypeScript, no Phaser — core module. A small save-state builder keeps the
// discovery/clear flags explicit per test.

import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/config/index.ts';
import {
  createFirstLaunchState,
  computeMapRows,
  lockInWorldForScroll,
  computeTreasureMap,
  isEndlessTriangleActive,
  TREASURE_MAP_WORLD_IDS,
  type SaveState,
  type WorldKey,
} from '../src/core/index.ts';

/**
 * Build a SaveState from a per-world discovery/clear spec. Any world not listed
 * defaults to fully undiscovered. Keeps each test's progress state obvious.
 */
function saveWith(
  spec: Partial<
    Record<WorldKey, { discovered?: boolean; storyCleared?: boolean; leftBehind?: boolean }>
  >,
): SaveState {
  const base = createFirstLaunchState(defaultConfig);
  for (const key of TREASURE_MAP_WORLD_IDS) {
    const s = spec[key];
    base.worlds[key] = {
      discovered: s?.discovered ?? false,
      storyCleared: s?.storyCleared ?? false,
      leftBehind: s?.leftBehind ?? false,
    };
  }
  return base;
}

describe('computeMapRows — ordering (Req 20.27)', () => {
  it('orders rows World 1 (bottom) first ascending to World 5 (top)', () => {
    const { rows } = computeMapRows(createFirstLaunchState(defaultConfig));
    expect(rows.map((r) => r.worldId)).toEqual([1, 2, 3, 4, 5]);
    expect(rows[0]!.worldKey).toBe('world1');
    expect(rows[4]!.worldKey).toBe('world5');
  });

  it('renders exactly one checkpoint per world (Req 20.20)', () => {
    const { rows } = computeMapRows(createFirstLaunchState(defaultConfig));
    expect(rows).toHaveLength(5);
    expect(rows.every((r) => r.hasCheckpoint)).toBe(true);
  });
});

describe('computeMapRows — display-state mapping (Req 20.18-20.19, 20.28)', () => {
  it('first-launch: W1 greyed, W2 next-reveal, W3-W5 silhouettes', () => {
    const { rows } = computeMapRows(createFirstLaunchState(defaultConfig));
    expect(rows[0]!.displayState).toBe('greyed'); // W1 discovered
    expect(rows[1]!.displayState).toBe('nextReveal'); // W2 first undiscovered
    expect(rows[2]!.displayState).toBe('silhouette');
    expect(rows[3]!.displayState).toBe('silhouette');
    expect(rows[4]!.displayState).toBe('silhouette');
  });

  it('completed AND merely-discovered worlds both render greyed (Req 20.19)', () => {
    const save = saveWith({
      world1: { discovered: true, storyCleared: true }, // completed
      world2: { discovered: true, storyCleared: false }, // discovered only
      // world3 undiscovered -> next-reveal; world4/5 silhouettes
    });
    const { rows } = computeMapRows(save);
    expect(rows[0]!.displayState).toBe('greyed');
    expect(rows[1]!.displayState).toBe('greyed');
    expect(rows[2]!.displayState).toBe('nextReveal');
    expect(rows[3]!.displayState).toBe('silhouette');
    expect(rows[4]!.displayState).toBe('silhouette');
  });

  it('only the FIRST undiscovered world is the next-reveal (Req 20.28)', () => {
    const save = saveWith({
      world1: { discovered: true },
      world2: { discovered: true },
      world3: { discovered: true },
      // world4 first undiscovered => next-reveal; world5 silhouette
    });
    const { rows } = computeMapRows(save);
    const nextReveals = rows.filter((r) => r.displayState === 'nextReveal');
    expect(nextReveals).toHaveLength(1);
    expect(nextReveals[0]!.worldId).toBe(4);
    expect(rows[4]!.displayState).toBe('silhouette');
  });

  it('all worlds discovered: no silhouette, no next-reveal (all greyed)', () => {
    const save = saveWith({
      world1: { discovered: true },
      world2: { discovered: true },
      world3: { discovered: true },
      world4: { discovered: true },
      world5: { discovered: true },
    });
    const { rows } = computeMapRows(save);
    expect(rows.every((r) => r.displayState === 'greyed')).toBe(true);
    expect(rows.every((r) => r.selectable)).toBe(true);
  });

  it('selectable iff discovered (greyed); silhouettes/next-reveal unselectable', () => {
    const { rows } = computeMapRows(createFirstLaunchState(defaultConfig));
    expect(rows[0]!.selectable).toBe(true); // greyed
    expect(rows[1]!.selectable).toBe(false); // next-reveal
    expect(rows[2]!.selectable).toBe(false); // silhouette
  });
});

describe('computeMapRows — Kino location marker (Req 20.5, 20.21)', () => {
  it('marks the highest discovered, not-left-behind world as current', () => {
    const save = saveWith({
      world1: { discovered: true, storyCleared: true },
      world2: { discovered: true },
    });
    const { rows, kinoMarkerWorldId } = computeMapRows(save);
    expect(kinoMarkerWorldId).toBe(2);
    expect(rows.filter((r) => r.hasKinoMarker).map((r) => r.worldId)).toEqual([2]);
  });

  it('a left-behind world does not carry the marker (Req 27.15-27.16)', () => {
    // W1-W2 discovered but left behind; W3 is the live story world.
    const save = saveWith({
      world1: { discovered: true, storyCleared: true, leftBehind: true },
      world2: { discovered: true, storyCleared: true, leftBehind: true },
      world3: { discovered: true },
    });
    const { kinoMarkerWorldId } = computeMapRows(save);
    expect(kinoMarkerWorldId).toBe(3);
  });

  it('first launch places the marker on World 1', () => {
    const { kinoMarkerWorldId } = computeMapRows(createFirstLaunchState(defaultConfig));
    expect(kinoMarkerWorldId).toBe(1);
  });
});

describe('lockInWorldForScroll — snap to nearest discovered world (Req 34.1-34.2)', () => {
  it('centering a discovered world locks it in with glow + Play enabled', () => {
    // W1-W3 discovered.
    const save = saveWith({
      world1: { discovered: true },
      world2: { discovered: true },
      world3: { discovered: true },
    });
    const { rows } = computeMapRows(save);

    // scrollCenter 0 => World 1 centered (discovered).
    const r0 = lockInWorldForScroll(rows, 0);
    expect(r0.lockedInWorldId).toBe(1);
    expect(r0.showSideGlow).toBe(true);
    expect(r0.playEnabled).toBe(true);
    expect(r0.centeredSelectable).toBe(true);

    // scrollCenter 1.9 snaps to index 2 => World 3 (discovered).
    const r2 = lockInWorldForScroll(rows, 1.9);
    expect(r2.centeredWorldId).toBe(3);
    expect(r2.lockedInWorldId).toBe(3);
    expect(r2.playEnabled).toBe(true);
  });

  it('snaps to the nearest integer row index (round-to-nearest)', () => {
    const save = saveWith({
      world1: { discovered: true },
      world2: { discovered: true },
    });
    const { rows } = computeMapRows(save);
    // 0.4 rounds to 0 => World 1.
    expect(lockInWorldForScroll(rows, 0.4).centeredWorldId).toBe(1);
    // 0.6 rounds to 1 => World 2.
    expect(lockInWorldForScroll(rows, 0.6).centeredWorldId).toBe(2);
  });

  it('clamps out-of-range scroll positions into the row range', () => {
    const save = saveWith({ world1: { discovered: true } });
    const { rows } = computeMapRows(save);
    expect(lockInWorldForScroll(rows, -5).centeredWorldId).toBe(1);
    expect(lockInWorldForScroll(rows, 99).centeredWorldId).toBe(5);
  });
});

describe('lockInWorldForScroll — undiscovered silhouette centered (Req 34.1, 34.3)', () => {
  it('centering an undiscovered silhouette locks nothing + disables Play', () => {
    // Only W1 discovered; W2 = next-reveal, W3+ silhouettes.
    const { rows } = computeMapRows(createFirstLaunchState(defaultConfig));

    // Center World 3 (index 2) — an undiscovered silhouette.
    const r = lockInWorldForScroll(rows, 2);
    expect(r.centeredWorldId).toBe(3);
    expect(r.centeredSelectable).toBe(false);
    expect(r.lockedInWorldId).toBeNull(); // nothing locks in (Req 34.3)
    expect(r.showSideGlow).toBe(false); // no glow (Req 34.1/34.3)
    expect(r.playEnabled).toBe(false); // Play disabled (Req 34.3)
  });

  it('centering the next-reveal world also disables Play (still a silhouette)', () => {
    const { rows } = computeMapRows(createFirstLaunchState(defaultConfig));
    // World 2 (index 1) is the next-reveal — not yet discovered.
    const r = lockInWorldForScroll(rows, 1);
    expect(r.centeredWorldId).toBe(2);
    expect(r.lockedInWorldId).toBeNull();
    expect(r.playEnabled).toBe(false);
    expect(r.showSideGlow).toBe(false);
  });

  it('empty row set resolves to a safe no-lock, Play-disabled result', () => {
    const r = lockInWorldForScroll([], 0);
    expect(r.lockedInWorldId).toBeNull();
    expect(r.centeredWorldId).toBeNull();
    expect(r.playEnabled).toBe(false);
    expect(r.showSideGlow).toBe(false);
  });

  it('non-finite scroll center is treated as 0 (defensive)', () => {
    const save = saveWith({ world1: { discovered: true } });
    const { rows } = computeMapRows(save);
    expect(lockInWorldForScroll(rows, Number.NaN).centeredWorldId).toBe(1);
  });
});

describe('computeTreasureMap — convenience composition', () => {
  it('returns both the layout and the lock-in for one scroll position', () => {
    const save = saveWith({
      world1: { discovered: true },
      world2: { discovered: true },
    });
    const { layout, lockIn } = computeTreasureMap(save, 1);
    expect(layout.rows.map((r) => r.worldId)).toEqual([1, 2, 3, 4, 5]);
    expect(lockIn.lockedInWorldId).toBe(2); // World 2 discovered + centered
    expect(lockIn.playEnabled).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Endless-mode TRIANGLE-TRIGGER activation (task 9.3; Req 20.29-20.31, 23.4).
// A world's right-side endless triangle is LOCKED/greyed until that world's
// story is CLEARED, and ACTIVE once it is. `computeMapRows` folds the same
// gate into each row's `endlessUnlocked`; `isEndlessTriangleActive` is the
// standalone per-world read.
// ---------------------------------------------------------------------------

describe('endless triangle active — isEndlessTriangleActive (Req 20.30-20.31, 23.4)', () => {
  it('a world that is NOT cleared => triangle locked/inactive', () => {
    // Discovered but not cleared still locks the endless trigger (Req 20.30).
    const save = saveWith({ world1: { discovered: true, storyCleared: false } });

    expect(isEndlessTriangleActive(save, 'world1')).toBe(false);
  });

  it('a CLEARED world => triangle active (Req 20.31, 23.4)', () => {
    const save = saveWith({
      world1: { discovered: true, storyCleared: true },
    });

    expect(isEndlessTriangleActive(save, 'world1')).toBe(true);
  });

  it('an undiscovered world (absent progress) => triangle inactive', () => {
    // First launch: only World 1 discovered, none cleared.
    const save = createFirstLaunchState(defaultConfig);

    for (const key of TREASURE_MAP_WORLD_IDS) {
      expect(isEndlessTriangleActive(save, key)).toBe(false);
    }
  });

  it('across a realistic save (W1 cleared, W2 discovered-not-cleared) only cleared worlds are active', () => {
    const save = saveWith({
      world1: { discovered: true, storyCleared: true },
      world2: { discovered: true, storyCleared: false },
    });

    expect(isEndlessTriangleActive(save, 'world1')).toBe(true); // cleared => active
    expect(isEndlessTriangleActive(save, 'world2')).toBe(false); // not cleared => locked
    expect(isEndlessTriangleActive(save, 'world3')).toBe(false); // undiscovered => locked
  });
});

describe('computeMapRows — endlessUnlocked per row (Req 20.30-20.31, 23.4)', () => {
  it('sets endlessUnlocked from each world storyCleared flag', () => {
    const save = saveWith({
      world1: { discovered: true, storyCleared: true },
      world2: { discovered: true, storyCleared: false },
      world3: { discovered: true, storyCleared: true },
    });
    const { rows } = computeMapRows(save);

    // rows[0]=W1 cleared, rows[1]=W2 not cleared, rows[2]=W3 cleared.
    expect(rows.map((r) => r.endlessUnlocked)).toEqual([
      true,
      false,
      true,
      false,
      false,
    ]);
  });

  it('first launch: no world cleared => every triangle locked', () => {
    const { rows } = computeMapRows(createFirstLaunchState(defaultConfig));

    expect(rows.every((r) => r.endlessUnlocked === false)).toBe(true);
  });

  it('endlessUnlocked agrees with isEndlessTriangleActive per world', () => {
    const save = saveWith({
      world1: { discovered: true, storyCleared: true },
      world2: { discovered: true, storyCleared: false },
      world5: { discovered: true, storyCleared: true },
    });
    const { rows } = computeMapRows(save);

    for (const row of rows) {
      expect(row.endlessUnlocked).toBe(
        isEndlessTriangleActive(save, row.worldKey),
      );
    }
  });
});

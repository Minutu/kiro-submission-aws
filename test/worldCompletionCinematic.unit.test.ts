// Feature: kino-game
//
// UNIT tests for task 10.4 — the PURE world-completion cinematic CONTENT + the
// silhouette-reveal / cross-generation greying STATE
// (`src/core/worldCompletionCinematic.ts`; design: "Cinematics System (Req 21,
// 29, 42)"; Req 21.6, 21.7, 21.10 (= Req 32.5)).
//
// Pins:
//   1. `buildWorldCompletionCinematicPanels` emits a SHORT, well-formed
//      sequence — celebrate the cleared world → dissolve the newly-unlocked
//      world's silhouette (only when one was unlocked) → return to the menu
//      (Req 21.6, 21.7).
//   2. `computeSilhouetteReveal` reports the dissolve target as the NEWLY
//      UNLOCKED world, and — via the EXISTING `computeMapRows` on the updated
//      save — confirms the revealed world renders GREYED (not a black
//      silhouette) once discovered (Req 21.7).
//   3. `computeGenerationGreying` (driven by the real `advanceGeneration` state)
//      renders previously-discovered worlds GREYED rather than BLACK on a NEW
//      generation (Req 21.10 / Req 32.5). The map-state assertions reuse
//      `computeMapRows`.
//
// Pure TypeScript, no Phaser — core module, testable in plain Node.

import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/config/index.ts';
import {
  buildWorldCompletionCinematicPanels,
  computeSilhouetteReveal,
  computeGenerationGreying,
  worldKeyForId,
  WORLD_COMPLETION_CINEMATIC_ID,
  WORLD_COMPLETION_PANEL_IDS,
  computeMapRows,
  createFirstLaunchState,
  advanceGeneration,
  TREASURE_MAP_WORLD_IDS,
  type SaveState,
  type WorldKey,
  type CinematicPanel,
  type WorldCompletionBeatKind,
} from '../src/core/index.ts';

/** Build a SaveState from a per-world discovery/clear spec (undiscovered default). */
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

/** Read a panel beat from its opaque `data` bag. */
function beat(panel: CinematicPanel): WorldCompletionBeatKind | undefined {
  return panel.data?.['beat'] as WorldCompletionBeatKind | undefined;
}

const worldNames = {
  world1: defaultConfig.names.worlds.world1,
  world2: defaultConfig.names.worlds.world2,
  world3: defaultConfig.names.worlds.world3,
  world4: defaultConfig.names.worlds.world4,
  world5: defaultConfig.names.worlds.world5,
};

// ---------------------------------------------------------------------------
// 1. Content sequence (Req 21.6, 21.7)
// ---------------------------------------------------------------------------

describe('buildWorldCompletionCinematicPanels — short, well-formed sequence (Req 21.6, 21.7)', () => {
  it('emits cleared → unlock-reveal → return-to-menu when a world is unlocked', () => {
    const panels = buildWorldCompletionCinematicPanels({
      clearedWorldId: 1,
      unlockedWorldId: 2,
      worldNames,
    });

    expect(panels.map(beat)).toEqual(['world-cleared', 'unlock-reveal', 'return-to-menu']);
    expect(panels.map((p) => p.id)).toEqual([
      WORLD_COMPLETION_PANEL_IDS.cleared,
      WORLD_COMPLETION_PANEL_IDS.unlockReveal,
      WORLD_COMPLETION_PANEL_IDS.returnToMenu,
    ]);
    // Every panel carries a caption (well-formed).
    expect(panels.every((p) => typeof p.caption === 'string' && p.caption.length > 0)).toBe(true);
  });

  it('is SHORT — at most three panels, at least two', () => {
    const withUnlock = buildWorldCompletionCinematicPanels({ clearedWorldId: 2, unlockedWorldId: 3 });
    const withoutUnlock = buildWorldCompletionCinematicPanels({ clearedWorldId: 5 });
    expect(withUnlock.length).toBeLessThanOrEqual(3);
    expect(withUnlock.length).toBeGreaterThanOrEqual(2);
    expect(withoutUnlock.length).toBeGreaterThanOrEqual(2);
  });

  it('skips the reveal beat when NOTHING was unlocked (e.g. the final world)', () => {
    const panels = buildWorldCompletionCinematicPanels({ clearedWorldId: 5, worldNames });
    expect(panels.map(beat)).toEqual(['world-cleared', 'return-to-menu']);
    expect(panels.some((p) => beat(p) === 'unlock-reveal')).toBe(false);
  });

  it('carries the reveal (dissolve) target world id on the unlock-reveal panel (Req 21.7)', () => {
    const panels = buildWorldCompletionCinematicPanels({ clearedWorldId: 3, unlockedWorldId: 4 });
    const reveal = panels.find((p) => beat(p) === 'unlock-reveal');
    expect(reveal?.data?.['revealWorldId']).toBe(4);
  });

  it('uses the config world name in the cleared caption', () => {
    const panels = buildWorldCompletionCinematicPanels({ clearedWorldId: 1, unlockedWorldId: 2, worldNames });
    expect(panels[0]!.caption).toContain(worldNames.world1);
  });

  it('threads placeholder-friendly image keys onto the beats they name', () => {
    const panels = buildWorldCompletionCinematicPanels({
      clearedWorldId: 1,
      unlockedWorldId: 2,
      imageKeys: { 'world-cleared': 'img-cleared', 'unlock-reveal': 'img-reveal' },
    });
    expect(panels.find((p) => beat(p) === 'world-cleared')?.imageKey).toBe('img-cleared');
    expect(panels.find((p) => beat(p) === 'unlock-reveal')?.imageKey).toBe('img-reveal');
    // Un-keyed beat has no imageKey.
    expect(panels.find((p) => beat(p) === 'return-to-menu')?.imageKey).toBeUndefined();
  });

  it('exposes the world-completion cinematic id constant', () => {
    expect(WORLD_COMPLETION_CINEMATIC_ID).toBe('world-completion');
  });
});

// ---------------------------------------------------------------------------
// 2. Silhouette reveal state (Req 21.7)
// ---------------------------------------------------------------------------

describe('computeSilhouetteReveal — dissolve target reveals greyed, not black (Req 21.7)', () => {
  it('reports the newly-unlocked world as the dissolve target', () => {
    // After clearing World 1, World 2 is newly discovered (unlocked).
    const updated = saveWith({
      world1: { discovered: true, storyCleared: true },
      world2: { discovered: true },
    });
    const reveal = computeSilhouetteReveal(updated, 2);
    expect(reveal.dissolveWorldId).toBe(2);
  });

  it('the revealed world renders GREYED (not a black silhouette) on the updated map', () => {
    const updated = saveWith({
      world1: { discovered: true, storyCleared: true },
      world2: { discovered: true },
    });
    const reveal = computeSilhouetteReveal(updated, 2);

    // Assert via computeMapRows on the updated save (reused map model).
    const { rows } = computeMapRows(updated);
    const row2 = rows.find((r) => r.worldId === 2)!;
    expect(row2.displayState).toBe('greyed');
    expect(row2.displayState).not.toBe('silhouette');

    // And the reveal state mirrors that confirmation.
    expect(reveal.revealsAsGreyed).toBe(true);
    expect(reveal.postCompletionRow?.displayState).toBe('greyed');
  });

  it('reports no dissolve target when nothing was unlocked (final world)', () => {
    const updated = saveWith({ world1: { discovered: true }, world5: { discovered: true, storyCleared: true } });
    const reveal = computeSilhouetteReveal(updated, null);
    expect(reveal.dissolveWorldId).toBeNull();
    expect(reveal.postCompletionRow).toBeNull();
    expect(reveal.revealsAsGreyed).toBe(false);
  });

  it('worldKeyForId maps numeric ids to save keys and rejects out-of-range', () => {
    expect(worldKeyForId(1)).toBe('world1');
    expect(worldKeyForId(5)).toBe('world5');
    expect(worldKeyForId(0)).toBeNull();
    expect(worldKeyForId(6)).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Cross-generation greying (Req 21.10 / Req 32.5)
// ---------------------------------------------------------------------------

describe('computeGenerationGreying — prior worlds greyed, not black, on a new generation (Req 21.10)', () => {
  it('previously-discovered worlds render GREYED rather than BLACK after advanceGeneration', () => {
    // A save partway through the story: Worlds 1-3 discovered (1 & 2 cleared).
    const beforeAdvance = saveWith({
      world1: { discovered: true, storyCleared: true },
      world2: { discovered: true, storyCleared: true },
      world3: { discovered: true },
      // world4, world5 undiscovered
    });

    // Begin a NEW generation — per-gen story flags reset, discovery KEPT (32.5).
    const { save: newGen } = advanceGeneration(beforeAdvance, defaultConfig);

    const greying = computeGenerationGreying(newGen);

    // Worlds 1-3 were discovered in the prior generation → greyed, not black.
    for (const worldId of [1, 2, 3] as const) {
      const row = greying.find((r) => r.worldId === worldId)!;
      expect(row.previouslyDiscovered).toBe(true);
      expect(row.greyed).toBe(true);
      expect(row.blackSilhouette).toBe(false);
      expect(row.displayState).toBe('greyed');
    }

    // And the map model agrees (assert via computeMapRows on the new-gen save).
    const { rows } = computeMapRows(newGen);
    for (const worldId of [1, 2, 3] as const) {
      expect(rows.find((r) => r.worldId === worldId)!.displayState).toBe('greyed');
    }
  });

  it('undiscovered worlds stay non-greyed (next-reveal / black silhouette)', () => {
    const beforeAdvance = saveWith({
      world1: { discovered: true, storyCleared: true },
      world2: { discovered: true, storyCleared: true },
      // worlds 3-5 never discovered
    });
    const { save: newGen } = advanceGeneration(beforeAdvance, defaultConfig);
    const greying = computeGenerationGreying(newGen);

    // World 3 is the first undiscovered -> nextReveal (not greyed, not black).
    const w3 = greying.find((r) => r.worldId === 3)!;
    expect(w3.previouslyDiscovered).toBe(false);
    expect(w3.greyed).toBe(false);
    expect(w3.displayState).toBe('nextReveal');

    // World 4/5 are black silhouettes.
    for (const worldId of [4, 5] as const) {
      const row = greying.find((r) => r.worldId === worldId)!;
      expect(row.greyed).toBe(false);
      expect(row.blackSilhouette).toBe(true);
      expect(row.displayState).toBe('silhouette');
    }
  });

  it('advanceGeneration clears per-gen storyCleared while keeping discovery greyed (32.5)', () => {
    const before = saveWith({ world1: { discovered: true, storyCleared: true } });
    const { save: newGen } = advanceGeneration(before, defaultConfig);
    // storyCleared reset...
    expect(newGen.worlds['world1']!.storyCleared).toBe(false);
    // ...but discovery kept, so it still renders greyed.
    expect(newGen.worlds['world1']!.discovered).toBe(true);
    const greying = computeGenerationGreying(newGen);
    expect(greying.find((r) => r.worldId === 1)!.greyed).toBe(true);
  });
});

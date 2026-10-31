// Feature: kino-game
//
// UNIT tests for task 7.10 — First_Launch_State initialization and the
// opening-cinematic TRIGGER decision (Req 40.1, 40.2).
//
// The trigger decision itself is the PURE helper `shouldPlayOpeningCinematic`
// in src/core/saveStore.ts: it keys on the save-load SOURCE so BootScene and the
// later cinematic task (10.1/10.2) share one source of truth. These tests pin:
//   - shouldPlayOpeningCinematic is true for a first launch and false for a
//     loaded save (Req 40.2).
//   - The decision tracks the actual load SOURCE end-to-end: no usable save
//     (empty/corrupt/unrecognized storage) → play the opening cinematic; a
//     usable stored blob (returning player) → do NOT (Req 40.2).
//   - First_Launch_State matches Req 40.1 (Gen 1 Junior, no skills/cosmetics,
//     only World 1 available, default control bindings) — the state the opening
//     cinematic plays off.
//
// Pure TypeScript, no Phaser — the trigger decision lives in core precisely so
// it is testable in plain Node. The scene-routing seam (start CinematicScene if
// registered, else fall through to Preload) lives in BootScene and is a thin
// Phaser wiring layer over this decision.

import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/config/index.ts';
import {
  shouldPlayOpeningCinematic,
  loadSaveOrFirstLaunch,
  createFirstLaunchState,
  serialize,
  SAVE_STORAGE_KEY,
  SAVE_SCHEMA_VERSION,
  DEFAULT_CONTROL_BINDINGS,
  type SaveSource,
} from '../src/engine/saveState.ts';

/** Minimal read-only Storage backed by a Map (the loader only calls getItem). */
function fakeStorage(initial?: string) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(SAVE_STORAGE_KEY, initial);
  return {
    getItem: (key: string): string | null => map.get(key) ?? null,
  };
}

describe('shouldPlayOpeningCinematic (Req 40.2)', () => {
  it('is true for a first launch', () => {
    expect(shouldPlayOpeningCinematic('first-launch')).toBe(true);
  });

  it('is false for a loaded (returning-player) save', () => {
    expect(shouldPlayOpeningCinematic('loaded')).toBe(false);
  });

  it('is true for first-launch and false for loaded — exhaustively over the source union', () => {
    const sources: SaveSource[] = ['first-launch', 'loaded'];
    for (const source of sources) {
      expect(shouldPlayOpeningCinematic(source)).toBe(source === 'first-launch');
    }
  });
});

describe('opening-cinematic trigger tracks the real load source end-to-end (Req 40.1, 40.2)', () => {
  it('no usable save (no storage) → first launch → play the opening cinematic', () => {
    const { source } = loadSaveOrFirstLaunch(defaultConfig);
    expect(source).toBe('first-launch');
    expect(shouldPlayOpeningCinematic(source)).toBe(true);
  });

  it('empty storage → first launch → play the opening cinematic', () => {
    const { source } = loadSaveOrFirstLaunch(defaultConfig, fakeStorage());
    expect(source).toBe('first-launch');
    expect(shouldPlayOpeningCinematic(source)).toBe(true);
  });

  it('corrupt stored blob → first launch (no usable save) → play the opening cinematic', () => {
    const { source } = loadSaveOrFirstLaunch(defaultConfig, fakeStorage('{ not valid json ]'));
    expect(source).toBe('first-launch');
    expect(shouldPlayOpeningCinematic(source)).toBe(true);
  });

  it('usable stored blob (returning player) → loaded → do NOT play the opening cinematic', () => {
    const existing = createFirstLaunchState(defaultConfig);
    existing.unlockedSkills = ['secondChance'];
    existing.worlds.world2 = { discovered: true, storyCleared: true, leftBehind: false };
    const { source } = loadSaveOrFirstLaunch(defaultConfig, fakeStorage(serialize(existing)));
    expect(source).toBe('loaded');
    expect(shouldPlayOpeningCinematic(source)).toBe(false);
  });
});

describe('First_Launch_State the opening cinematic plays off matches Req 40.1', () => {
  it('is Generation 1 Junior, no skills/cosmetics, only World 1 available, default bindings', () => {
    const s = createFirstLaunchState(defaultConfig);

    expect(s.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(s.generation).toEqual({ iteration: 1, suffix: 'Junior' });
    expect(s.unlockedSkills).toEqual([]);
    expect(s.unlockedCosmetics).toEqual([]);
    expect(s.equippedSkill).toBeNull();
    expect(s.equippedCosmetic).toBeNull();

    // Only World 1 is discovered/available on a brand-new save.
    expect(s.worlds.world1?.discovered).toBe(true);
    for (const id of ['world2', 'world3', 'world4', 'world5'] as const) {
      expect(s.worlds[id]?.discovered).toBe(false);
    }

    expect(s.controlBindings).toEqual(DEFAULT_CONTROL_BINDINGS);
  });
});

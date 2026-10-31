// Feature: kino-game
//
// UNIT tests for the task-4.1 minimal save-load + First_Launch_State seam
// (Req 40.1). Covers:
//   - A fresh/empty storage yields the First_Launch_State defaults.
//   - First_Launch_State matches Req 40.1 (Gen 1 Junior, no skills/cosmetics,
//     only World 1 available, default control bindings).
//   - An unreadable/unrecognized stored blob falls back WITHOUT clobbering it.
//   - A usable stored blob is loaded (source = 'loaded').
//
// Pure TypeScript, no Phaser — the save seam is intentionally framework-free so
// task 7.1's full SaveStore (and its property test) can reuse it. A tiny fake
// Storage lets us exercise read behavior deterministically.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { defaultConfig } from '../src/config/index.ts';
import {
  createFirstLaunchState,
  loadSaveOrFirstLaunch,
  SAVE_STORAGE_KEY,
  SAVE_SCHEMA_VERSION,
  DEFAULT_CONTROL_BINDINGS,
} from '../src/engine/saveState.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Minimal read-only Storage backed by a Map, tracking writes so a test can
 *  assert the loader never clobbers the stored blob. */
function fakeStorage(initial?: string) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(SAVE_STORAGE_KEY, initial);
  let setCalls = 0;
  let removeCalls = 0;
  return {
    getItem: (key: string): string | null => map.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      setCalls += 1;
      map.set(key, value);
    },
    removeItem: (key: string): void => {
      removeCalls += 1;
      map.delete(key);
    },
    raw: (): string | undefined => map.get(SAVE_STORAGE_KEY),
    writes: (): number => setCalls + removeCalls,
  };
}

describe('createFirstLaunchState (Req 40.1)', () => {
  it('starts Generation 1 Junior with no skills/cosmetics and only World 1 available', () => {
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
      expect(s.worlds[id]?.storyCleared).toBe(false);
      expect(s.worlds[id]?.leftBehind).toBe(false);
    }

    // Default control bindings (Req 1.6-1.9, 40.1).
    expect(s.controlBindings).toEqual(DEFAULT_CONTROL_BINDINGS);
  });

  it('reads the generation suffix from the config generational scheme', () => {
    const cfg = structuredClone(defaultConfig);
    cfg.names.generationalScheme.juniorSuffix = 'Rookie';
    cfg.names.generationalScheme.startIteration = 1;

    expect(createFirstLaunchState(cfg).generation).toEqual({
      iteration: 1,
      suffix: 'Rookie',
    });
  });

  it('produces independent control-binding arrays per call (no shared mutation)', () => {
    const a = createFirstLaunchState(defaultConfig);
    a.controlBindings.primary.push('TAMPERED');
    const b = createFirstLaunchState(defaultConfig);
    expect(b.controlBindings.primary).toEqual(DEFAULT_CONTROL_BINDINGS.primary);
  });
});

describe('loadSaveOrFirstLaunch (Req 40.1)', () => {
  it('returns First_Launch_State when no storage is provided', () => {
    const { state, source } = loadSaveOrFirstLaunch(defaultConfig);
    expect(source).toBe('first-launch');
    expect(state).toEqual(createFirstLaunchState(defaultConfig));
  });

  it('returns First_Launch_State for empty storage without writing anything', () => {
    const storage = fakeStorage();
    const { source } = loadSaveOrFirstLaunch(defaultConfig, storage);
    expect(source).toBe('first-launch');
    expect(storage.writes()).toBe(0);
  });

  it('does NOT clobber an unreadable stored blob, falling back to first launch', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const corrupt = '{ not valid json ]';
    const storage = fakeStorage(corrupt);

    const { source } = loadSaveOrFirstLaunch(defaultConfig, storage);

    expect(source).toBe('first-launch');
    // The recoverable/legacy blob must survive untouched (task 7.1 owns writes).
    expect(storage.raw()).toBe(corrupt);
    expect(storage.writes()).toBe(0);
  });

  it('does NOT clobber a structurally-unrecognized blob', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const unrecognized = JSON.stringify({ hello: 'world' });
    const storage = fakeStorage(unrecognized);

    const { source } = loadSaveOrFirstLaunch(defaultConfig, storage);

    expect(source).toBe('first-launch');
    expect(storage.raw()).toBe(unrecognized);
    expect(storage.writes()).toBe(0);
  });

  it('loads a usable stored blob (source = loaded)', () => {
    const existing = createFirstLaunchState(defaultConfig);
    existing.unlockedSkills = ['secondChance'];
    existing.generation = { iteration: 2, suffix: 'Senior' };
    const storage = fakeStorage(JSON.stringify(existing));

    const { state, source } = loadSaveOrFirstLaunch(defaultConfig, storage);

    expect(source).toBe('loaded');
    expect(state.unlockedSkills).toEqual(['secondChance']);
    expect(state.generation).toEqual({ iteration: 2, suffix: 'Senior' });
    expect(storage.writes()).toBe(0);
  });
});

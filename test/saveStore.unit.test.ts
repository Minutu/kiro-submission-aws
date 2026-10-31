// Feature: kino-game
//
// UNIT (example) tests for the FULL Save_Store (task 7.1) in src/core/saveStore.ts.
// These cover the deterministic examples/edge cases; the universal round-trip
// PROPERTY (Property 8) is owned by task 7.2 and intentionally NOT written here.
//
// Covered:
//   - serialize/deserialize round-trip equality for a POPULATED valid state
//     (Req 22.6, 22.7, 28.1, 28.2).
//   - corrupt / non-JSON / structurally-invalid / unknown-(newer)-version blobs
//     all yield First_Launch_State WITHOUT clobbering the stored blob
//     (Req 22.6-22.7, 40.1). deserialize performs no writes; SaveStore.load only
//     reads.
//   - only PERMANENT fields are persisted; per-generation RUN fields planted on
//     a blob are stripped by deserialize (never resurrected — Req 22.7).
//   - SaveStore.save is the only write path; a successful write replaces a
//     previously-unreadable blob (design error handling).
//
// Pure TypeScript, no Phaser — core module. A tiny fake Storage exercises the
// read/write behavior deterministically.

import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/config/index.ts';
import {
  createFirstLaunchState,
  createSaveStore,
  serialize,
  deserialize,
  isValidSaveState,
  SAVE_STORAGE_KEY,
  SAVE_SCHEMA_VERSION,
  type SaveState,
} from '../src/core/saveStore.ts';

/** Minimal Storage backed by a Map, tracking writes so a test can assert the
 *  no-clobber rule (load never writes). */
function fakeStorage(initial?: string) {
  const map = new Map<string, string>();
  if (initial !== undefined) map.set(SAVE_STORAGE_KEY, initial);
  let setCalls = 0;
  return {
    getItem: (key: string): string | null => map.get(key) ?? null,
    setItem: (key: string, value: string): void => {
      setCalls += 1;
      map.set(key, value);
    },
    raw: (): string | undefined => map.get(SAVE_STORAGE_KEY),
    writes: (): number => setCalls,
  };
}

/** A populated, VALID save state exercising every permanent field. */
function populatedState(): SaveState {
  const s = createFirstLaunchState(defaultConfig);
  s.generation = { iteration: 3, suffix: 'Senior' };
  s.unlockedSkills = ['secondChance', 'dash', 'nuke'];
  s.unlockedCosmetics = ['tophat', 'crown'];
  s.equippedSkill = 'dash';
  s.equippedCosmetic = 'crown';
  s.controlBindings = { primary: ['SPACE', 'W'], skill: ['Q', 'MOUSE_RIGHT'] };
  s.settings = { volume: 0.5, muted: true };
  s.worlds.world1 = { discovered: true, storyCleared: true, leftBehind: false };
  s.worlds.world2 = { discovered: true, storyCleared: false, leftBehind: true };
  s.highScores.story.world1 = 1200;
  s.highScores.endless.world2 = 999;
  s.highScoreHistoryByGeneration = { '1': { story: { world1: 800 } } };
  s.generationCosmeticsAwarded = ['crown'];
  return s;
}

describe('serialize/deserialize round-trip (Req 22.6, 22.7, 28.1, 28.2)', () => {
  it('round-trips a populated valid state to deep equality (no fallback)', () => {
    const original = populatedState();
    const { state, usedFallback } = deserialize(serialize(original), defaultConfig);
    expect(usedFallback).toBe(false);
    expect(state).toEqual(original);
  });

  it('round-trips the First_Launch_State unchanged', () => {
    const original = createFirstLaunchState(defaultConfig);
    const { state, usedFallback } = deserialize(serialize(original), defaultConfig);
    expect(usedFallback).toBe(false);
    expect(state).toEqual(original);
  });

  it('a serialized valid state re-validates (serialize output is schema-valid)', () => {
    const json = serialize(populatedState());
    expect(isValidSaveState(JSON.parse(json))).toBe(true);
  });
});

describe('deserialize error handling → First_Launch_State, no clobber (Req 22.6-22.7, 40.1)', () => {
  const firstLaunch = createFirstLaunchState(defaultConfig);

  it('missing/empty raw yields First_Launch_State', () => {
    for (const raw of [null, undefined, ''] as const) {
      const { state, usedFallback } = deserialize(raw, defaultConfig);
      expect(usedFallback).toBe(true);
      expect(state).toEqual(firstLaunch);
    }
  });

  it('non-JSON / corrupt raw yields First_Launch_State', () => {
    const { state, usedFallback } = deserialize('{ not valid json ]', defaultConfig);
    expect(usedFallback).toBe(true);
    expect(state).toEqual(firstLaunch);
  });

  it('structurally-invalid blob yields First_Launch_State', () => {
    const { state, usedFallback } = deserialize(
      JSON.stringify({ hello: 'world' }),
      defaultConfig,
    );
    expect(usedFallback).toBe(true);
    expect(state).toEqual(firstLaunch);
  });

  it('unknown (newer) schemaVersion with no migration path yields First_Launch_State', () => {
    const future = { ...populatedState(), schemaVersion: SAVE_SCHEMA_VERSION + 1 };
    const { state, usedFallback } = deserialize(JSON.stringify(future), defaultConfig);
    expect(usedFallback).toBe(true);
    expect(state).toEqual(firstLaunch);
  });

  it('a valid-but-wrong-typed field (e.g. volume as string) is rejected', () => {
    const bad = populatedState() as unknown as Record<string, unknown>;
    (bad.settings as Record<string, unknown>).volume = 'loud';
    const { usedFallback } = deserialize(JSON.stringify(bad), defaultConfig);
    expect(usedFallback).toBe(true);
  });
});

describe('persistence model: permanent fields only, run fields never resurrected (Req 22.1-22.2, 22.7)', () => {
  it('serialize carries every permanent field', () => {
    const json = JSON.parse(serialize(populatedState())) as Record<string, unknown>;
    for (const key of [
      'schemaVersion',
      'generation',
      'unlockedSkills',
      'unlockedCosmetics',
      'equippedSkill',
      'equippedCosmetic',
      'controlBindings',
      'settings',
      'worlds',
      'highScores',
      'highScoreHistoryByGeneration',
      'generationCosmeticsAwarded',
    ]) {
      expect(json).toHaveProperty(key);
    }
  });

  it('per-generation RUN fields planted on a blob are NOT resurrected', () => {
    // A tampered/legacy blob that smuggles run-scoped fields alongside valid
    // permanent ones. deserialize validates then returns the schema shape only;
    // the extra run fields must not survive onto the returned state.
    const smuggled = {
      ...populatedState(),
      // Per-generation run state that must NEVER persist (Req 22.3, 22.7):
      perks: ['speedBoost', 'reducedCooldown'],
      learnedAbilities: ['flight'],
      currentScore: 4242,
      currentRunProgression: { sequenceIndex: 7 },
    };
    const { state, usedFallback } = deserialize(JSON.stringify(smuggled), defaultConfig);

    expect(usedFallback).toBe(false);
    expect(state).not.toHaveProperty('perks');
    expect(state).not.toHaveProperty('learnedAbilities');
    expect(state).not.toHaveProperty('currentScore');
    expect(state).not.toHaveProperty('currentRunProgression');
    // The permanent fields still round-trip.
    expect(state).toEqual(populatedState());
  });
});

describe('SaveStore wrapper: load (no clobber) + save (only write path)', () => {
  it('load returns First_Launch_State for empty storage without writing', () => {
    const storage = fakeStorage();
    const { source } = createSaveStore(defaultConfig).load(storage);
    expect(source).toBe('first-launch');
    expect(storage.writes()).toBe(0);
  });

  it('load does NOT clobber a corrupt stored blob', () => {
    const corrupt = '{ not valid json ]';
    const storage = fakeStorage(corrupt);
    const { source } = createSaveStore(defaultConfig).load(storage);
    expect(source).toBe('first-launch');
    expect(storage.raw()).toBe(corrupt);
    expect(storage.writes()).toBe(0);
  });

  it('load reads a usable stored blob (source = loaded)', () => {
    const storage = fakeStorage(serialize(populatedState()));
    const { state, source } = createSaveStore(defaultConfig).load(storage);
    expect(source).toBe('loaded');
    expect(state).toEqual(populatedState());
    expect(storage.writes()).toBe(0);
  });

  it('save is the only write path; a successful write replaces an unreadable blob', () => {
    const corrupt = '{ not valid json ]';
    const storage = fakeStorage(corrupt);
    const store = createSaveStore(defaultConfig);

    // Load leaves the corrupt blob untouched...
    store.load(storage);
    expect(storage.raw()).toBe(corrupt);

    // ...the next successful save replaces it (design error handling).
    const next = populatedState();
    expect(store.save(storage, next)).toBe(true);
    expect(storage.writes()).toBe(1);

    // And re-loading now yields the written state.
    const { state, source } = store.load(storage);
    expect(source).toBe('loaded');
    expect(state).toEqual(next);
  });

  it('load survives a throwing Storage (access denied) via First_Launch_State', () => {
    const throwing = {
      getItem: (): string | null => {
        throw new Error('access denied');
      },
    };
    const { source } = createSaveStore(defaultConfig).load(throwing);
    expect(source).toBe('first-launch');
  });

  it('save returns false when Storage.setItem throws (e.g. quota)', () => {
    const throwing = {
      setItem: (): void => {
        throw new Error('quota exceeded');
      },
    };
    expect(createSaveStore(defaultConfig).save(throwing, populatedState())).toBe(false);
  });
});

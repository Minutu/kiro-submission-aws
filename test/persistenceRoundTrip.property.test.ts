// Feature: kino-game, Property 8: Persistence round-trip
//
// Validates: Requirements 22.6, 22.7, 28.1, 28.2.
//
// The Save_Store is the persistence authority. Property 8 asserts that
// serialize/deserialize is a TRUE INVERSE over the full `kino.save.v1` schema:
// for any schema-valid SaveState `s`,
//   deserialize(serialize(s), cfg).state  deep-equals  s
// and `usedFallback` is false (the valid blob is accepted, never replaced by
// First_Launch_State — the no-clobber round-trip, Req 22.6, 22.7). High-score
// maps keyed by world/mode survive the round-trip exactly (Req 28.1, 28.2).
//
// Because the schema carries ONLY permanent fields, the round-tripped state can
// never resurrect per-generation RUN state. We assert the result has none of
// the run-scoped keys ('perks' / 'currentScore' / 'learnedAbilities') — Req 22.7.
//
// Strategy: build an ARBITRARY VALID SaveState from scratch, matching the schema
// exactly so `deserialize` accepts it without falling back. Every field is
// generated with schema-valid values:
//   - generation {iteration: finite number, suffix: string}
//   - unlockedSkills / unlockedCosmetics / generationCosmeticsAwarded: string[]
//   - equippedSkill / equippedCosmetic: string | null
//   - controlBindings {primary: string[], skill: string[]}
//   - settings {volume: finite number, muted: boolean}
//   - worlds: map keyed by worldN -> {discovered, storyCleared, leftBehind}
//   - highScores {story: {worldN: finite number}, endless: {worldN: finite number}}
//   - highScoreHistoryByGeneration: a plain, JSON-round-trippable object
//   - schemaVersion = SAVE_SCHEMA_VERSION (current)
// Numbers are kept FINITE (no NaN/±Infinity): JSON turns those into `null`, which
// would break the inverse — so a finite generator keeps the property about the
// serializer, not about JSON's handling of non-finite numbers.
//
// Pure TypeScript, no Phaser — the Save_Store is a core module, so this property
// runs in plain Node without a browser or canvas.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import { defaultConfig } from '../src/config/index.ts';
import {
  serialize,
  deserialize,
  isValidSaveState,
  SAVE_SCHEMA_VERSION,
  type SaveState,
} from '../src/core/index.ts';

/**
 * Finite numbers only. NaN/±Infinity are excluded because JSON.stringify turns
 * them into `null` — that is a property of JSON, not of the Save_Store, so
 * feeding them in would test the wrong thing. We also normalize -0 to 0: JSON
 * has no signed zero (JSON.stringify(-0) === "0"), so a generated -0 could never
 * survive ANY JSON round-trip. Negative zero is outside the representable input
 * space for a persisted save (scores, volume, and iteration are never -0), so
 * folding it to +0 keeps the generator inside the real input space rather than
 * weakening the inverse the property asserts.
 */
const finiteNumberArb = fc
  .double({ noNaN: true, noDefaultInfinity: true })
  .map((n) => (Object.is(n, -0) ? 0 : n));

/** Arbitrary strings for ids / suffixes / binding keys. */
const strArb = fc.string({ maxLength: 12 });

/** A string | null field (equipped selections). */
const stringOrNullArb: fc.Arbitrary<string | null> = fc.option(strArb, { nil: null });

/** The world ids the schema's maps are keyed by (worldN). */
const WORLD_IDS = ['world1', 'world2', 'world3', 'world4', 'world5'] as const;

/** A per-world discovery/clear/left-behind record (Req 20.3-20.4, 27.15-27.16). */
const worldProgressArb = fc.record({
  discovered: fc.boolean(),
  storyCleared: fc.boolean(),
  leftBehind: fc.boolean(),
});

/**
 * A map keyed by a random non-empty subset of the five world ids. Using a
 * subset (not always all five) exercises sparse maps, which the schema allows
 * (the validator only checks the VALUES, not which keys are present).
 */
function worldKeyedMapArb<T>(valueArb: fc.Arbitrary<T>): fc.Arbitrary<Record<string, T>> {
  return fc
    .subarray(WORLD_IDS as unknown as string[], { minLength: 0, maxLength: WORLD_IDS.length })
    .chain((ids) =>
      fc
        .tuple(...ids.map(() => valueArb))
        .map(
          (values) =>
            Object.fromEntries(ids.map((id, i) => [id, values[i] as T])) as Record<string, T>,
        ),
    );
}

/**
 * A plain, JSON-round-trippable object for highScoreHistoryByGeneration. The
 * schema types this as Record<string, unknown> and the validator only requires
 * it to be a (non-array) object, so we build arbitrary nested JSON-safe values
 * keyed by generation iteration. JSON-safe = no undefined / functions / NaN /
 * ±Infinity, so the serialized form round-trips to the identical structure.
 */
const jsonSafeLeafArb: fc.Arbitrary<unknown> = fc.oneof(
  finiteNumberArb,
  strArb,
  fc.boolean(),
  fc.constant(null),
);

const historyArb: fc.Arbitrary<Record<string, unknown>> = fc.dictionary(
  // Generation-iteration-like keys ("1", "2", ...).
  fc.integer({ min: 1, max: 20 }).map(String),
  // A shallow per-generation history object of world -> mode -> score, plus the
  // occasional scalar leaf, all JSON-safe.
  fc.oneof(
    jsonSafeLeafArb,
    fc.record({
      story: worldKeyedMapArb(finiteNumberArb),
      endless: worldKeyedMapArb(finiteNumberArb),
    }),
  ),
  { maxKeys: 5 },
);

/**
 * The full arbitrary VALID SaveState. Built field-by-field to match the
 * `kino.save.v1` schema so `deserialize` accepts it (usedFallback === false).
 */
const saveStateArb: fc.Arbitrary<SaveState> = fc.record({
  schemaVersion: fc.constant(SAVE_SCHEMA_VERSION),
  generation: fc.record({ iteration: finiteNumberArb, suffix: strArb }),
  unlockedSkills: fc.array(strArb, { maxLength: 8 }),
  unlockedCosmetics: fc.array(strArb, { maxLength: 8 }),
  equippedSkill: stringOrNullArb,
  equippedCosmetic: stringOrNullArb,
  controlBindings: fc.record({
    primary: fc.array(strArb, { maxLength: 4 }),
    skill: fc.array(strArb, { maxLength: 4 }),
  }),
  settings: fc.record({ volume: finiteNumberArb, muted: fc.boolean() }),
  worlds: worldKeyedMapArb(worldProgressArb),
  highScores: fc.record({
    story: worldKeyedMapArb(finiteNumberArb),
    endless: worldKeyedMapArb(finiteNumberArb),
  }),
  highScoreHistoryByGeneration: historyArb,
  generationCosmeticsAwarded: fc.array(strArb, { maxLength: 8 }),
});

describe('Property 8: persistence round-trip', () => {
  it('deserialize(serialize(s)) deep-equals s with no fallback (Req 22.6, 22.7, 28.1, 28.2)', () => {
    fc.assert(
      fc.property(saveStateArb, (s) => {
        // Sanity: every generated state is schema-valid, so deserialize must
        // accept it rather than fall back to First_Launch_State.
        expect(isValidSaveState(s)).toBe(true);

        const { state, usedFallback } = deserialize(serialize(s), defaultConfig);

        // The valid blob is accepted — never clobbered by First_Launch_State.
        expect(usedFallback).toBe(false);
        // Serialize/deserialize is a true inverse over every permanent field,
        // including the world/mode-keyed high-score maps (Req 28.1, 28.2).
        expect(state).toEqual(s);
      }),
      { numRuns: 200 },
    );
  });

  it('the round-tripped state carries NO per-generation run fields (Req 22.7)', () => {
    fc.assert(
      fc.property(saveStateArb, (s) => {
        const { state } = deserialize(serialize(s), defaultConfig);
        // The schema has no run-scoped fields, so the round-trip can never
        // resurrect them (Req 22.7).
        expect(state).not.toHaveProperty('perks');
        expect(state).not.toHaveProperty('currentScore');
        expect(state).not.toHaveProperty('learnedAbilities');
      }),
      { numRuns: 200 },
    );
  });

  it('serialize output re-validates after JSON.parse (schema-valid blob)', () => {
    fc.assert(
      fc.property(saveStateArb, (s) => {
        expect(isValidSaveState(JSON.parse(serialize(s)))).toBe(true);
      }),
      { numRuns: 200 },
    );
  });

  it('round-tripping twice equals the state round-tripped once (idempotence)', () => {
    fc.assert(
      fc.property(saveStateArb, (s) => {
        const once = deserialize(serialize(s), defaultConfig).state;
        const twice = deserialize(serialize(once), defaultConfig).state;
        expect(twice).toEqual(once);
        // And both equal the original — the inverse is stable under repetition.
        expect(once).toEqual(s);
      }),
      { numRuns: 200 },
    );
  });
});

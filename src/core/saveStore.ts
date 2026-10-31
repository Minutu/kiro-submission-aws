// Feature: kino-game
//
// The FULL Save_Store (task 7.1) — the authoritative, versioned `kino.save.v1`
// schema, a PURE inverse serialize/deserialize pair, schema validation,
// version migration, and the no-clobber error-handling rule
// (design: "Save_Store schema (Req 22, 28, 40)", "Unreadable or invalid
// Save_Store (Req 22, 40)"; Property 8).
//
// WHY THIS LIVES IN src/core: the serialization + schema must be Phaser-free so
// the persistence round-trip property test (task 7.2, Property 8) can exercise
// it in plain Node without a browser or canvas. The localStorage read/write
// WRAPPER is also Phaser-free (it depends only on the standard `Storage`
// interface, which tests fake), so the whole Save_Store sits in core. The
// engine seam (`src/engine/saveState.ts`) re-exports this and keeps BootScene's
// existing import surface working.
//
// PERSISTENCE MODEL (Req 22.1-22.7):
//   - PERMANENT fields are the ONLY fields in the schema: unlocked skills,
//     unlocked cosmetics, equipped selections, control bindings, settings,
//     generation name, world discovery/clear/left-behind, per-world/per-mode
//     high scores, and cross-generation high-score history.
//   - Per-generation RUN fields (learned abilities, perks, temporary bonuses,
//     current score, current run progression) are NOT in the schema, so the
//     round-trip can never resurrect them (Req 22.3, 22.7, Property 8).

import type { ConfigFileData } from '../config/index.ts';

/** The single localStorage key the save blob lives under (design: Req 22, 40). */
export const SAVE_STORAGE_KEY = 'kino.save.v1';

/** Current schema version. Older known versions are migrated on read. */
export const SAVE_SCHEMA_VERSION = 1;

// ---------------------------------------------------------------------------
// `kino.save.v1` schema types (design: "Save_Store schema (Req 22, 28, 40)").
// ---------------------------------------------------------------------------

/** Generation identity — Generation 1 Junior at first launch (Req 32, 40.1). */
export interface GenerationState {
  iteration: number;
  /** "Junior" | "Senior" (string here so the config scheme stays authoritative). */
  suffix: string;
}

/** Per-world discovery/clear/left-behind flags (Req 20.3-20.4, 27.15-27.16). */
export interface WorldProgressState {
  discovered: boolean;
  storyCleared: boolean;
  leftBehind: boolean;
}

/** Primary / skill control bindings (Req 1.6-1.9, 22.7). */
export interface ControlBindings {
  primary: string[];
  skill: string[];
}

/** Audio / display settings (Req 25.8, 20.49). */
export interface SettingsState {
  volume: number;
  muted: boolean;
}

/** Per-mode high-score maps, keyed by world id (Req 28.1-28.2). */
export interface HighScoreState {
  story: Record<string, number>;
  endless: Record<string, number>;
}

/**
 * The persisted save shape. Named `SaveState` rather than `FirstLaunchState`
 * because the same shape describes both a loaded save and a fresh first launch;
 * `createFirstLaunchState` produces the Req 40.1 defaults.
 *
 * Every field here is PERMANENT (Req 22.1-22.2). There is deliberately NO field
 * for per-generation run state (abilities, perks, current score) — the schema
 * simply does not carry them, which is how the round-trip (Property 8) is
 * guaranteed never to resurrect run fields (Req 22.7).
 */
export interface SaveState {
  schemaVersion: number;
  generation: GenerationState;
  /** Permanent (Req 22.1): no skills unlocked at first launch (Req 40.1). */
  unlockedSkills: string[];
  /** Permanent (Req 22.2): no cosmetics at first launch (Req 40.1). */
  unlockedCosmetics: string[];
  equippedSkill: string | null;
  equippedCosmetic: string | null;
  controlBindings: ControlBindings;
  settings: SettingsState;
  /** Only World 1 available at first launch (Req 40.1). */
  worlds: Record<string, WorldProgressState>;
  highScores: HighScoreState;
  /** this-gen vs past-gen history (Req 31.2). */
  highScoreHistoryByGeneration: Record<string, unknown>;
  /** Unique per-generation cosmetics awarded (Req 22.4). */
  generationCosmeticsAwarded: string[];
}

/** Default control bindings (Req 1.6-1.9, 40.1). */
export const DEFAULT_CONTROL_BINDINGS: ControlBindings = {
  primary: ['SPACE', 'MOUSE_LEFT'],
  skill: ['Q', 'MOUSE_RIGHT'],
};

/** The five story worlds, in story order (World 1 is the only one available). */
const WORLD_IDS = ['world1', 'world2', 'world3', 'world4', 'world5'] as const;

/**
 * Build the First_Launch_State (Req 40.1): Generation 1 Junior, no unlocked
 * skills, no unlocked cosmetics, only World 1 available (discovered), default
 * control bindings. The generation suffix is read from the Config_File's
 * generational scheme so the naming stays config-driven (Req 32.1-32.2).
 */
export function createFirstLaunchState(cfg: ConfigFileData): SaveState {
  const scheme = cfg.names.generationalScheme;

  const worlds: Record<string, WorldProgressState> = {};
  for (const id of WORLD_IDS) {
    worlds[id] = {
      // Only World 1 is available/discovered on a brand-new save (Req 40.1).
      discovered: id === 'world1',
      storyCleared: false,
      leftBehind: false,
    };
  }

  const zeroedPerWorld = (): Record<string, number> =>
    Object.fromEntries(WORLD_IDS.map((id) => [id, 0]));

  return {
    schemaVersion: SAVE_SCHEMA_VERSION,
    generation: { iteration: scheme.startIteration, suffix: scheme.juniorSuffix },
    unlockedSkills: [],
    unlockedCosmetics: [],
    equippedSkill: null,
    equippedCosmetic: null,
    // Clone so callers can mutate run-time copies without touching the default.
    controlBindings: {
      primary: [...DEFAULT_CONTROL_BINDINGS.primary],
      skill: [...DEFAULT_CONTROL_BINDINGS.skill],
    },
    settings: { volume: 0.8, muted: false },
    worlds,
    highScores: { story: zeroedPerWorld(), endless: zeroedPerWorld() },
    highScoreHistoryByGeneration: {},
    generationCosmeticsAwarded: [],
  };
}

// ---------------------------------------------------------------------------
// Validation — a full structural schema check for `kino.save.v1`.
//
// `deserialize` only accepts a blob that validates; anything else falls through
// to First_Launch_State (error handling below). The check is strict enough that
// a round-tripped valid state is guaranteed to re-validate, which keeps
// serialize/deserialize a true inverse (Property 8).
// ---------------------------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isStringArray(v: unknown): v is string[] {
  return Array.isArray(v) && v.every((x) => typeof x === 'string');
}

function isGeneration(v: unknown): v is GenerationState {
  return isObject(v) && typeof v.iteration === 'number' && typeof v.suffix === 'string';
}

function isControlBindings(v: unknown): v is ControlBindings {
  return isObject(v) && isStringArray(v.primary) && isStringArray(v.skill);
}

function isSettings(v: unknown): v is SettingsState {
  return isObject(v) && typeof v.volume === 'number' && typeof v.muted === 'boolean';
}

function isWorldProgress(v: unknown): v is WorldProgressState {
  return (
    isObject(v) &&
    typeof v.discovered === 'boolean' &&
    typeof v.storyCleared === 'boolean' &&
    typeof v.leftBehind === 'boolean'
  );
}

function isWorldMap(v: unknown): v is Record<string, WorldProgressState> {
  return isObject(v) && Object.values(v).every(isWorldProgress);
}

function isNumberMap(v: unknown): v is Record<string, number> {
  return isObject(v) && Object.values(v).every((n) => typeof n === 'number');
}

function isHighScores(v: unknown): v is HighScoreState {
  return isObject(v) && isNumberMap(v.story) && isNumberMap(v.endless);
}

/**
 * Full structural validation of a parsed blob against the `kino.save.v1` schema.
 * This is the gate `deserialize` uses: a blob either validates completely (and
 * is used as-is) or it is rejected (and First_Launch_State is returned).
 */
export function isValidSaveState(value: unknown): value is SaveState {
  if (!isObject(value)) return false;
  return (
    value.schemaVersion === SAVE_SCHEMA_VERSION &&
    isGeneration(value.generation) &&
    isStringArray(value.unlockedSkills) &&
    isStringArray(value.unlockedCosmetics) &&
    (value.equippedSkill === null || typeof value.equippedSkill === 'string') &&
    (value.equippedCosmetic === null || typeof value.equippedCosmetic === 'string') &&
    isControlBindings(value.controlBindings) &&
    isSettings(value.settings) &&
    isWorldMap(value.worlds) &&
    isHighScores(value.highScores) &&
    isObject(value.highScoreHistoryByGeneration) &&
    isStringArray(value.generationCosmeticsAwarded)
  );
}

// ---------------------------------------------------------------------------
// Migration — upgrade a known older-version blob to the current schema.
//
// Only v1 exists today, so this is a pass-through, but the structure is the
// real seam: when a v2 ships, add a step keyed on the stored `schemaVersion`
// that transforms the blob forward. `migrate` returns the upgraded object (for
// further validation) or null when the version is unknown / unmigratable.
// ---------------------------------------------------------------------------

/** A single forward migration step (vN -> vN+1), keyed by the FROM version. */
type MigrationStep = (blob: Record<string, unknown>) => Record<string, unknown>;

/**
 * Registered migrations keyed by the version they migrate FROM. Empty today
 * because v1 is the only schema; a future v2 adds `{ 1: (v1) => v2Blob }`.
 */
const MIGRATIONS: Record<number, MigrationStep> = {};

/**
 * Attempt to migrate a parsed blob up to `SAVE_SCHEMA_VERSION`. Returns the
 * migrated object (not yet validated) or null when the version is unknown or a
 * step is missing (no migration path — caller falls back to First_Launch_State).
 */
function migrate(blob: Record<string, unknown>): Record<string, unknown> | null {
  const version = blob.schemaVersion;
  if (typeof version !== 'number' || !Number.isInteger(version)) return null;

  // Already current: nothing to do.
  if (version === SAVE_SCHEMA_VERSION) return blob;

  // Newer-than-known, or older with no registered path forward: unmigratable.
  if (version > SAVE_SCHEMA_VERSION) return null;

  let current = blob;
  let v = version;
  while (v < SAVE_SCHEMA_VERSION) {
    const step = MIGRATIONS[v];
    if (!step) return null; // no path from this version forward
    current = step(current);
    v += 1;
  }
  return current;
}

// ---------------------------------------------------------------------------
// Pure serialize / deserialize (design: Property 8; Req 22.6, 22.7, 28.1, 28.2).
//
// `serialize` is deterministic JSON; `deserialize` is its inverse for any valid
// state: deserialize(serialize(s)) deep-equals s for every persisted field, and
// because the schema carries NO run fields, nothing run-scoped is resurrected.
// On any failure (missing, non-JSON, invalid, unmigratable), `deserialize`
// returns First_Launch_State IN MEMORY — it never writes.
// ---------------------------------------------------------------------------

/** Serialize a Save_Store state to its canonical `kino.save.v1` JSON string. */
export function serialize(state: SaveState): string {
  return JSON.stringify(state);
}

/**
 * Deserialize a raw stored string into a SaveState.
 *
 * Returns the validated state when `raw` parses, (optionally migrates,) and
 * validates. Otherwise returns a fresh First_Launch_State (Req 40.1) and sets
 * `usedFallback` so the caller knows NOT to treat it as an authoritative load
 * — crucially, deserialize performs NO writes, so the raw stored blob is left
 * untouched until the next successful save (no-clobber rule, Req 22.6-22.7).
 */
export function deserialize(
  raw: string | null | undefined,
  cfg: ConfigFileData,
): { state: SaveState; usedFallback: boolean } {
  const fallback = (): { state: SaveState; usedFallback: boolean } => ({
    state: createFirstLaunchState(cfg),
    usedFallback: true,
  });

  if (raw === null || raw === undefined || raw === '') {
    return fallback();
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Non-JSON / corrupt: recoverable blob stays untouched.
    return fallback();
  }

  if (!isObject(parsed)) {
    return fallback();
  }

  // Attempt migration for known older versions before validating.
  const migrated = migrate(parsed);
  if (migrated === null) {
    return fallback();
  }

  if (!isValidSaveState(migrated)) {
    return fallback();
  }

  // Project onto the schema shape so ONLY permanent fields survive. A tampered
  // or legacy blob that smuggles per-generation run fields (perks, learned
  // abilities, current score, run progression) alongside valid permanent ones
  // cannot resurrect them — they are simply dropped here (Req 22.3, 22.7,
  // Property 8). For a state produced by `serialize`, this projection is the
  // identity, so serialize/deserialize stays a true inverse.
  return { state: normalize(migrated), usedFallback: false };
}

/**
 * Re-build a SaveState carrying ONLY the schema's permanent fields, dropping any
 * extra keys present on the input. Called after validation, so every field read
 * here is known to be present and well-typed.
 */
function normalize(v: SaveState): SaveState {
  const worlds: Record<string, WorldProgressState> = {};
  for (const [id, w] of Object.entries(v.worlds)) {
    worlds[id] = {
      discovered: w.discovered,
      storyCleared: w.storyCleared,
      leftBehind: w.leftBehind,
    };
  }
  return {
    schemaVersion: v.schemaVersion,
    generation: { iteration: v.generation.iteration, suffix: v.generation.suffix },
    unlockedSkills: [...v.unlockedSkills],
    unlockedCosmetics: [...v.unlockedCosmetics],
    equippedSkill: v.equippedSkill,
    equippedCosmetic: v.equippedCosmetic,
    controlBindings: {
      primary: [...v.controlBindings.primary],
      skill: [...v.controlBindings.skill],
    },
    settings: { volume: v.settings.volume, muted: v.settings.muted },
    worlds,
    highScores: {
      story: { ...v.highScores.story },
      endless: { ...v.highScores.endless },
    },
    highScoreHistoryByGeneration: { ...v.highScoreHistoryByGeneration },
    generationCosmeticsAwarded: [...v.generationCosmeticsAwarded],
  };
}

// ---------------------------------------------------------------------------
// SaveStore wrapper — the localStorage read/write surface.
//
// Depends only on the standard `Storage` interface (what the browser exposes as
// `window.localStorage`), so it is Phaser-free and fully fakeable in tests.
// `load` applies the no-clobber rule; `save` is the ONLY path that writes, and a
// successful write is what finally replaces a previously-unreadable blob
// (design error handling).
// ---------------------------------------------------------------------------

/** Where a loaded state came from, so callers can branch (e.g. first-launch). */
export type SaveSource = 'loaded' | 'first-launch';

export interface SaveStoreLoadResult {
  state: SaveState;
  source: SaveSource;
}

/**
 * The opening-cinematic trigger DECISION (Req 40.2), kept PURE and Phaser-free
 * so it is unit-testable in plain Node and so the engine (BootScene) and any
 * later cinematic task (10.1/10.2) share one source of truth.
 *
 * Req 40.2: WHEN the game starts with no existing save (a fresh First_Launch_
 * State), play the opening cinematic rather than going straight to the menu. A
 * returning player (a successfully `loaded` save) skips it and takes the normal
 * Preload → Menu flow. So the cinematic plays for — and ONLY for — `source ===
 * 'first-launch'`.
 *
 * Note this keys on the load SOURCE, not merely on the state shape: the error-
 * handling rule hands back a First_Launch_State IN MEMORY (with
 * `source: 'first-launch'`) on an unreadable/invalid blob too, which is exactly
 * the "no usable existing save" case Req 40.2 means by first launch.
 */
export function shouldPlayOpeningCinematic(source: SaveSource): boolean {
  return source === 'first-launch';
}

/** Minimal read surface a SaveStore needs (BootScene passes window.localStorage). */
export type SaveReadStorage = Pick<Storage, 'getItem'>;
/** Minimal write surface the save path needs. */
export type SaveWriteStorage = Pick<Storage, 'setItem'>;

export interface SaveStore {
  /**
   * Read + deserialize the save, or hand back First_Launch_State in memory
   * WITHOUT clobbering an unreadable/legacy/unknown-version blob (Req 22.6-22.7,
   * 40.1). Any thrown Storage error also falls through to First_Launch_State
   * rather than crashing boot.
   */
  load(storage?: SaveReadStorage): SaveStoreLoadResult;
  /**
   * Serialize + persist the state under `kino.save.v1`. This is the only write
   * path; a successful write is what finally replaces a previously-unreadable
   * blob. Returns whether the write succeeded.
   */
  save(storage: SaveWriteStorage, state: SaveState): boolean;
}

/**
 * Create a SaveStore bound to a Config_File (used for config-driven generation
 * naming when producing First_Launch_State).
 */
export function createSaveStore(cfg: ConfigFileData): SaveStore {
  return {
    load(storage?: SaveReadStorage): SaveStoreLoadResult {
      if (!storage) {
        return { state: createFirstLaunchState(cfg), source: 'first-launch' };
      }
      let raw: string | null;
      try {
        raw = storage.getItem(SAVE_STORAGE_KEY);
      } catch {
        // Storage access denied / unavailable: behave as a clean first launch
        // without ever touching the stored blob.
        return { state: createFirstLaunchState(cfg), source: 'first-launch' };
      }
      const { state, usedFallback } = deserialize(raw, cfg);
      return { state, source: usedFallback ? 'first-launch' : 'loaded' };
    },

    save(storage: SaveWriteStorage, state: SaveState): boolean {
      try {
        storage.setItem(SAVE_STORAGE_KEY, serialize(state));
        return true;
      } catch {
        return false;
      }
    },
  };
}

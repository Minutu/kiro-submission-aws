// Feature: kino-game
//
// Asset_Registry — the single internal mapping that gameplay consumes, built
// from the user-editable Config_File (Req 24.4, 24.8, 33.8). This module is the
// ONE choke point for placeholder fallback: `resolve(key)` returns the real,
// loaded asset when available, otherwise a geometric placeholder descriptor
// tinted from the world palette (Req 24.1, 24.2, 24.10, 33.7, 33.16, 43.5).
//
// PURE — no Phaser import. Placeholder factories here return *descriptors*
// (`{ kind, tint, ... }`) rather than Phaser display objects; the engine layer
// realizes a descriptor into a real GameObject (Boot/Preload). This keeps
// src/assets Phaser-free and unit-testable from plain Node, matching the
// core↔engine boundary documented in src/README.md.
//
// Because gameplay only ever calls `resolve(key)`, collision / physics /
// scoring behave identically whether placeholder or final art is loaded
// (Req 24.3, 24.6).

import type {
  ConfigFileData,
  ColorPalette,
  PerWorld,
} from '../config/config.ts';

// ---------------------------------------------------------------------------
// Asset categories & keys
// ---------------------------------------------------------------------------

/**
 * Modular asset groups (Req 24.5). Every registered key belongs to exactly one
 * category; the category drives the shape/tone of its geometric placeholder and
 * which palette element tints it.
 */
export type AssetCategory =
  | 'characterFrame' // Kino animation frames (jumping/flight/zigzag/spin/crawl)
  | 'menuAnimation' // menu-equip-jiggle (Req 33.15-33.16, 43.4-43.5)
  | 'obstacle' // per-category obstacle art (Req 24.11, 38.1-38.2)
  | 'mentorImage' // per-world mentor portrait (Req 29)
  | 'background' // per-world background (Req 33.1, 38.3)
  | 'music' // per-world background music (Req 25.5)
  | 'audio' // sfx cues (Req 25.1-25.6)
  | 'ui'; // UI / starter art (Req 24.7)

/** The five story worlds, used to pick a distinguishing palette (Req 24.2). */
export type WorldId = 'world1' | 'world2' | 'world3' | 'world4' | 'world5';

/**
 * The geometric-shape vocabulary a placeholder may request. The engine maps
 * each `kind` onto a real Phaser primitive (rectangle, circle, ...). Kept small
 * and renderer-agnostic on purpose.
 */
export type PlaceholderKind = 'rect' | 'circle' | 'triangle' | 'tone';

/**
 * A renderer-agnostic description of a geometric placeholder (Req 24.1). The
 * engine realizes this into an actual display object; nothing here touches
 * Phaser. `tint` is a hex color string pulled from the world Color_Palette so
 * each world's placeholders are visually distinguishable (Req 24.2).
 */
export interface PlaceholderDescriptor {
  kind: PlaceholderKind;
  /** Hex color (e.g. "#C77D2E") sourced from the world palette element. */
  tint: string;
  /** Nominal width in px (engine may scale to fit). */
  width: number;
  /** Nominal height in px. */
  height: number;
  /** Optional label aiding debugging / dev-time identification. */
  label: string;
  /** Which world palette this placeholder was tinted from, when applicable. */
  world?: WorldId;
  /** The asset category this placeholder stands in for. */
  category: AssetCategory;
}

/** A factory that builds a placeholder descriptor on demand (Req 24.10). */
export type PlaceholderFactory = () => PlaceholderDescriptor;

/** Load state of a registered key, driven by the PreloadScene loader. */
export type AssetState = 'pending' | 'real' | 'placeholder';

/**
 * One record per asset-bearing config key (Req 33.8). `configuredPath` is the
 * raw string from the Config_File; an empty/whitespace path means "no real
 * art" and resolves straight to the placeholder (Req 24.10, 33.7).
 */
export interface AssetRecord {
  key: string;
  category: AssetCategory;
  configuredPath: string;
  placeholderFactory: PlaceholderFactory;
  state: AssetState;
  /** World association for palette tinting, when the key is world-scoped. */
  world?: WorldId;
}

/**
 * What `resolve(key)` hands back. Exactly one of `real` / `placeholder` is
 * meaningful per `source`. Gameplay treats both uniformly.
 */
export interface ResolvedAsset {
  key: string;
  category: AssetCategory;
  source: 'real' | 'placeholder';
  /** The loader key / path for real art (present only when source==='real'). */
  real?: string;
  /** Geometric fallback (present only when source==='placeholder'). */
  placeholder?: PlaceholderDescriptor;
}

// ---------------------------------------------------------------------------
// Placeholder geometry per category — simple shapes & nominal sizes (Req 24.1)
// ---------------------------------------------------------------------------

interface PlaceholderShapeSpec {
  kind: PlaceholderKind;
  width: number;
  height: number;
}

/**
 * Nominal shape/size per category. The engine may rescale to fit a slot; these
 * are sensible defaults so a placeholder reads as "the right sort of thing"
 * (a tall pillar vs a squat ground obstacle vs a round character blob).
 */
const CATEGORY_SHAPE: Record<AssetCategory, PlaceholderShapeSpec> = {
  characterFrame: { kind: 'circle', width: 48, height: 48 },
  menuAnimation: { kind: 'circle', width: 48, height: 48 },
  obstacle: { kind: 'rect', width: 64, height: 128 },
  mentorImage: { kind: 'rect', width: 96, height: 128 },
  background: { kind: 'tone', width: 1, height: 1 },
  music: { kind: 'tone', width: 1, height: 1 },
  audio: { kind: 'tone', width: 1, height: 1 },
  ui: { kind: 'rect', width: 64, height: 32 },
};

/** Neutral tints for non-world-scoped categories (Kino / UI / audio tones). */
const NEUTRAL_TINT = '#B0B0B0';
const AUDIO_TONE_TINT = '#808080';
const KINO_DEFAULT_TINT = '#F5E6C8';

/**
 * Pick the palette element a category should borrow its tint from so a world's
 * placeholders stay internally coherent and cross-world distinguishable
 * (Req 24.2, 27.13-27.14, 38.3): environments use `background`, obstacles use
 * `obstacles`, character frames use `kino`.
 */
function tintForCategory(category: AssetCategory, palette: ColorPalette): string {
  switch (category) {
    case 'obstacle':
      return palette.obstacles;
    case 'background':
      return palette.background;
    case 'characterFrame':
    case 'menuAnimation':
    case 'mentorImage':
      return palette.kino;
    default:
      return NEUTRAL_TINT;
  }
}

// ---------------------------------------------------------------------------
// AssetRegistry
// ---------------------------------------------------------------------------

/**
 * Internal mapping consumed by gameplay (Req 24.4, 24.8). Build it once at boot
 * with `fromConfig`; the PreloadScene later drives `markLoaded` / `markFailed`
 * as the Phaser loader reports success or error for each non-empty path.
 */
export class AssetRegistry {
  private readonly records = new Map<string, AssetRecord>();

  /** Prefer `AssetRegistry.fromConfig`. */
  private constructor() {}

  /**
   * Walk every asset-bearing key in the Config_File and register a record with
   * its configured path and a palette-tinted placeholder factory (Req 33.8).
   * World-scoped keys (backgrounds, music, obstacles, mentors) are tinted from
   * the matching world palette so each world is visually distinct (Req 24.2).
   */
  static fromConfig(cfg: ConfigFileData): AssetRegistry {
    const registry = new AssetRegistry();
    registry.populate(cfg);
    return registry;
  }

  private populate(cfg: ConfigFileData): void {
    const palettes = cfg.colorPalettes;

    // --- character animation frames (Req 30.7-30.14, 33.9-33.14) ---------
    // Every mode/frame key is registered; Kino tint comes from world1's
    // palette as a stable default (the character is world-agnostic art).
    const kinoTint = palettes.world1.kino || KINO_DEFAULT_TINT;
    for (const [mode, frames] of Object.entries(cfg.animationFrames)) {
      for (const [frameName, path] of Object.entries(frames as Record<string, string>)) {
        this.register({
          key: `frame:${mode}:${frameName}`,
          category: 'characterFrame',
          configuredPath: path,
          tint: kinoTint,
        });
      }
    }

    // --- menu-equip-jiggle (Req 33.15-33.16, 43.4-43.5) ------------------
    this.register({
      key: 'menuEquipJiggle',
      category: 'menuAnimation',
      configuredPath: cfg.menuEquipJiggle,
      tint: kinoTint,
    });

    // --- obstacle categories (Req 24.11, 38.1-38.2) ----------------------
    // Tint each obstacle placeholder from the world whose name it carries so
    // world1 ground vs world2 pillar vs world5 barrier read differently; the
    // context-named underwater obstacles borrow world4's palette (Req 5.11).
    for (const [catKey, path] of Object.entries(cfg.obstacleCategories)) {
      const world = obstacleWorld(catKey);
      this.register({
        key: `obstacle:${catKey}`,
        category: 'obstacle',
        configuredPath: path as string,
        tint: tintForCategory('obstacle', palettes[world]),
        world,
      });
    }

    // --- per-world keyed groups ------------------------------------------
    this.registerPerWorld(cfg.mentorImages, 'mentorImage', 'mentor', palettes);
    this.registerPerWorld(cfg.worldBackgrounds, 'background', 'background', palettes);
    this.registerPerWorld(cfg.worldMusic, 'music', 'music', palettes);

    // --- audio sfx cues (Req 25.1-25.6, 24.7) ----------------------------
    for (const [cue, path] of Object.entries(cfg.audio)) {
      this.register({
        key: `audio:${cue}`,
        category: 'audio',
        configuredPath: path as string,
        tint: AUDIO_TONE_TINT,
      });
    }

    // --- starter assets (Req 24.7) ---------------------------------------
    for (const [name, path] of Object.entries(cfg.starterAssets)) {
      this.register({
        key: `starter:${name}`,
        category: name === 'kinoSprite' ? 'characterFrame' : 'ui',
        configuredPath: path as string,
        tint: name === 'kinoSprite' ? kinoTint : NEUTRAL_TINT,
      });
    }
  }

  /** Register all five world entries of a `PerWorld<string>` asset map. */
  private registerPerWorld(
    map: PerWorld<string>,
    category: AssetCategory,
    keyPrefix: string,
    palettes: PerWorld<ColorPalette>,
  ): void {
    for (const world of WORLD_IDS) {
      this.register({
        key: `${keyPrefix}:${world}`,
        category,
        configuredPath: map[world],
        tint: tintForCategory(category, palettes[world]),
        world,
      });
    }
  }

  /** Create and store a single record plus its placeholder factory. */
  private register(args: {
    key: string;
    category: AssetCategory;
    configuredPath: string;
    tint: string;
    world?: WorldId;
  }): void {
    const { key, category, configuredPath, tint, world } = args;
    const placeholderFactory = makePlaceholderFactory(key, category, tint, world);
    const record: AssetRecord = {
      key,
      category,
      // Normalize to a trimmed string; treat null/undefined defensively.
      configuredPath: typeof configuredPath === 'string' ? configuredPath : '',
      placeholderFactory,
      // A missing/empty path can never load, so it starts already resolved to
      // its placeholder (Req 24.10, 33.7). A real path starts pending until the
      // loader reports back.
      state: isBlank(configuredPath) ? 'placeholder' : 'pending',
      ...(world !== undefined ? { world } : {}),
    };
    this.records.set(key, record);
  }

  // -- loader-driven state (called by PreloadScene) ------------------------

  /** Mark a key's real art as successfully loaded. */
  markLoaded(key: string): void {
    const record = this.records.get(key);
    if (record === undefined) return;
    if (isBlank(record.configuredPath)) {
      // Nothing was queued for a blank path; keep it on the placeholder.
      record.state = 'placeholder';
      return;
    }
    record.state = 'real';
  }

  /** Mark a key as failed to load, falling back to its placeholder (Req 24.10). */
  markFailed(key: string): void {
    const record = this.records.get(key);
    if (record === undefined) return;
    record.state = 'placeholder';
  }

  // -- read surface (gameplay) --------------------------------------------

  /** Every record with a non-empty configured path that still needs loading. */
  pendingLoads(): ReadonlyArray<{ key: string; configuredPath: string; category: AssetCategory }> {
    const out: Array<{ key: string; configuredPath: string; category: AssetCategory }> = [];
    for (const record of this.records.values()) {
      if (record.state === 'pending' && !isBlank(record.configuredPath)) {
        out.push({ key: record.key, configuredPath: record.configuredPath, category: record.category });
      }
    }
    return out;
  }

  /** True when a key has real, loaded art (never true for a blank path). */
  hasReal(key: string): boolean {
    const record = this.records.get(key);
    return record !== undefined && record.state === 'real';
  }

  /** True when the key exists in the registry. */
  has(key: string): boolean {
    return this.records.has(key);
  }

  /** All registered keys (stable insertion order). */
  keys(): string[] {
    return [...this.records.keys()];
  }

  /**
   * The single choke point for gameplay (Req 24.4, 24.10, 33.7). Returns real
   * art when loaded, otherwise a geometric placeholder descriptor tinted from
   * the world palette. An unknown key throws, since gameplay should only ever
   * resolve keys the config registered.
   */
  resolve(key: string): ResolvedAsset {
    const record = this.records.get(key);
    if (record === undefined) {
      throw new Error(`AssetRegistry.resolve: unknown asset key "${key}"`);
    }
    if (record.state === 'real') {
      return {
        key: record.key,
        category: record.category,
        source: 'real',
        real: record.configuredPath,
      };
    }
    return {
      key: record.key,
      category: record.category,
      source: 'placeholder',
      placeholder: record.placeholderFactory(),
    };
  }
}

// ---------------------------------------------------------------------------
// Helpers (module-private)
// ---------------------------------------------------------------------------

const WORLD_IDS: readonly WorldId[] = ['world1', 'world2', 'world3', 'world4', 'world5'];

/** True for null/undefined/empty/whitespace-only paths. */
function isBlank(path: string): boolean {
  return typeof path !== 'string' || path.trim().length === 0;
}

/**
 * Map an obstacle-category key to the world whose palette should tint it. Keys
 * follow the `<world|context>_...` convention; context-named underwater
 * obstacles belong to the Ice & Underwater world (world4, Req 5.11, 38.2).
 */
function obstacleWorld(catKey: string): WorldId {
  if (catKey.startsWith('world1')) return 'world1';
  if (catKey.startsWith('world2')) return 'world2';
  if (catKey.startsWith('world3')) return 'world3';
  if (catKey.startsWith('world5')) return 'world5';
  // ceiling_underwater_obstacle / floor_underwater_obstacle and any world4 key.
  return 'world4';
}

/**
 * Build a placeholder factory for a key. The factory returns a fresh descriptor
 * each call so the engine can realize independent display objects, but the
 * descriptor is fully determined by category + tint + world (deterministic,
 * Req 24.3 — identical gameplay-relevant behavior regardless of art).
 */
function makePlaceholderFactory(
  key: string,
  category: AssetCategory,
  tint: string,
  world: WorldId | undefined,
): PlaceholderFactory {
  const shape = CATEGORY_SHAPE[category];
  return () => ({
    kind: shape.kind,
    tint,
    width: shape.width,
    height: shape.height,
    label: key,
    category,
    ...(world !== undefined ? { world } : {}),
  });
}

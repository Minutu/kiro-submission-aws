// Feature: kino-game
//
// Shared boot context — the typed handles BootScene stashes on the Phaser game
// registry so every later scene (Preload, MainMenu, Gameplay, RunEnd, ...) can
// read the loaded Config_File, BalanceTable, Asset_Registry, and Save_Store
// without rebuilding them (design: BootScene "Read Config_File, build
// Asset_Registry, load Save_Store").
//
// Phaser's `game.registry` is an untyped key/value `DataManager`. To keep reads
// type-safe we funnel every access through the helpers here and a single set of
// string keys, rather than scattering stringly-typed `registry.get('...')`
// calls across scenes.

import type Phaser from 'phaser';
import type { ConfigFileData } from '../config/index.ts';
import type { BalanceTable } from '../config/index.ts';
import type { AssetRegistry } from '../assets/index.ts';
import type { SaveState } from './saveState.ts';

/**
 * The registry keys BootScene writes and later scenes read. Exported so tests
 * and scenes reference the constants instead of raw string literals.
 */
export const SHARED_CONTEXT_KEYS = {
  config: 'kino.config',
  balance: 'kino.balance',
  assets: 'kino.assets',
  save: 'kino.save',
  playOpeningCinematic: 'kino.playOpeningCinematic',
  /** The game-global AudioManager (task 12.1), stashed by BootScene. */
  audio: 'kino.audio',
  /**
   * The per-generation set of worlds Kino has ALREADY EVOLVED in this
   * generation (task 10.3; Req 21.2/21.4/21.5/39.4). RUN STATE only — NOT part
   * of the persisted Save_Store (per-generation state never persists, Req
   * 22.3/22.7). Reset when a new generation begins so every world's mentor
   * cutscene plays again on first entry (Req 21.5).
   */
  evolvedWorldsThisGeneration: 'kino.evolvedWorldsThisGeneration',
} as const;

/** The value bundle available to every scene after BootScene runs. */
export interface KinoBootContext {
  config: ConfigFileData;
  balance: BalanceTable;
  assets: AssetRegistry;
  save: SaveState;
  /**
   * Whether this launch should play the OPENING CINEMATIC (Req 40.2) — true on
   * a fresh First_Launch_State, false for a returning player. BootScene sets it
   * from `shouldPlayOpeningCinematic(source)`; the opening-cinematic task
   * (10.1/10.2) reads it here (and off scene-start data) to decide whether to
   * play before the menu. Defaults to false if unset.
   */
  playOpeningCinematic: boolean;
}

/** Stash the boot context on the game registry (called once by BootScene). */
export function setBootContext(
  game: Phaser.Game,
  ctx: KinoBootContext,
): void {
  game.registry.set(SHARED_CONTEXT_KEYS.config, ctx.config);
  game.registry.set(SHARED_CONTEXT_KEYS.balance, ctx.balance);
  game.registry.set(SHARED_CONTEXT_KEYS.assets, ctx.assets);
  game.registry.set(SHARED_CONTEXT_KEYS.save, ctx.save);
  game.registry.set(SHARED_CONTEXT_KEYS.playOpeningCinematic, ctx.playOpeningCinematic);
}

/**
 * Read the boot context back from a scene. Throws if BootScene has not run yet,
 * which surfaces mis-ordered scene starts as a loud error instead of silent
 * `undefined`s deep in gameplay.
 */
export function getBootContext(scene: Phaser.Scene): KinoBootContext {
  const r = scene.game.registry;
  const config = r.get(SHARED_CONTEXT_KEYS.config) as ConfigFileData | undefined;
  const balance = r.get(SHARED_CONTEXT_KEYS.balance) as BalanceTable | undefined;
  const assets = r.get(SHARED_CONTEXT_KEYS.assets) as AssetRegistry | undefined;
  const save = r.get(SHARED_CONTEXT_KEYS.save) as SaveState | undefined;
  // Boolean flag; absence is treated as false (returning player / no cinematic).
  const playOpeningCinematic = r.get(SHARED_CONTEXT_KEYS.playOpeningCinematic) === true;

  if (!config || !balance || !assets || !save) {
    throw new Error(
      '[KINO] Boot context missing from the game registry; BootScene must run first.',
    );
  }
  return { config, balance, assets, save, playOpeningCinematic };
}

// ---------------------------------------------------------------------------
// AudioManager handle (task 12.1)
// ---------------------------------------------------------------------------
//
// The AudioManager (src/engine/audio/AudioManager.ts) is game-global and owns
// real Sound objects, so BootScene constructs ONE and stashes it here for every
// later scene (MainMenu/Gameplay/Settings/...) to raise events through. It is
// kept SEPARATE from the required KinoBootContext so the existing
// setBootContext/getBootContext shape is untouched; a scene reads it with
// `getAudioManager(scene)` and tolerates its absence (e.g. headless tests where
// audio was never wired) by getting `null`.

/** Minimal structural handle so this module needs no AudioManager import. */
export interface AudioManagerHandle {
  play(event: unknown): void;
  refreshSettings(settings: unknown): void;
  stopMusic(): void;
}

/** Stash the game-global AudioManager on the registry (called once by Boot). */
export function setAudioManager(game: Phaser.Game, audio: AudioManagerHandle): void {
  game.registry.set(SHARED_CONTEXT_KEYS.audio, audio);
}

/** Read the AudioManager back from a scene; `null` if it was never wired. */
export function getAudioManager(scene: Phaser.Scene): AudioManagerHandle | null {
  const audio = scene.game.registry.get(SHARED_CONTEXT_KEYS.audio) as
    | AudioManagerHandle
    | undefined;
  return audio ?? null;
}

// ---------------------------------------------------------------------------
// Per-generation evolved-worlds RUN STATE (task 10.3; Req 21.2/21.4/21.5/39.4)
// ---------------------------------------------------------------------------
//
// "Kino remains evolved for that World for the remainder of the Generation"
// (Req 21.2) is per-generation RUN state the engine tracks for the current
// run/generation — deliberately NOT in the persisted Save_Store schema (Req
// 22.3/22.7). The mentor cutscene seam (CinematicScene) reads the flag for the
// world being entered and feeds it into the PURE
// `core.shouldPlayMentorCutscene(world, alreadyEvolved)` predicate to decide
// whether to PLAY the cutscene or SKIP straight into the run; it marks a world
// evolved once its cutscene completes. The set is CLEARED when a new generation
// begins so every world's cutscene plays again on first entry (Req 21.5).

/** Read the mutable set of worlds evolved this generation (created on first read). */
function evolvedWorldsSet(game: Phaser.Game): Set<number> {
  const existing = game.registry.get(SHARED_CONTEXT_KEYS.evolvedWorldsThisGeneration) as
    | Set<number>
    | undefined;
  if (existing instanceof Set) return existing;
  const fresh = new Set<number>();
  game.registry.set(SHARED_CONTEXT_KEYS.evolvedWorldsThisGeneration, fresh);
  return fresh;
}

/**
 * Whether Kino is ALREADY EVOLVED for `world` in the CURRENT generation — the
 * per-generation run-state bit the mentor-cutscene skip rule consumes (Req
 * 21.4/39.4). False for a world never evolved this generation.
 */
export function isWorldEvolvedThisGeneration(scene: Phaser.Scene, world: number): boolean {
  return evolvedWorldsSet(scene.game).has(Math.trunc(world));
}

/**
 * Mark Kino as EVOLVED for `world` in the current generation — called once the
 * world's mentor cutscene completes, so a same-generation retry (restart / menu
 * Continue/Play / Run_End retry) SKIPS the cutscene (Req 21.2/21.4/39.4).
 */
export function markWorldEvolvedThisGeneration(scene: Phaser.Scene, world: number): void {
  evolvedWorldsSet(scene.game).add(Math.trunc(world));
}

/**
 * Reset the per-generation evolved-worlds set — called when a NEW generation
 * begins so every world's mentor cutscene plays again on first entry (Req 21.5).
 */
export function resetEvolvedWorldsThisGeneration(game: Phaser.Game): void {
  game.registry.set(SHARED_CONTEXT_KEYS.evolvedWorldsThisGeneration, new Set<number>());
}

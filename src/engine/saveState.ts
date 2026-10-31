// Feature: kino-game
//
// ENGINE SEAM over the FULL Save_Store (task 7.1 lives in `src/core/saveStore.ts`).
//
// Task 4.1 originally shipped a minimal read-only save-load seam HERE so
// BootScene had *something* that produced a First_Launch_State (Req 40.1).
// Task 7.1 SUPERSEDES that: the authoritative versioned `kino.save.v1` schema,
// the PURE inverse serialize/deserialize (Property 8), schema validation,
// version migration, and the write path now live in the Phaser-free simulation
// core (`src/core/saveStore.ts`) so the persistence round-trip property test
// (task 7.2) can exercise them in plain Node.
//
// This module is now a thin COMPAT SHIM: it re-exports the core schema/types
// and keeps the BootScene-facing `loadSaveOrFirstLaunch` / `SaveLoadResult`
// surface working by delegating to `createSaveStore(...).load(...)`. Nothing
// about BootScene's imports had to change.

import type { ConfigFileData } from '../config/index.ts';
import { createSaveStore, type SaveSource } from '../core/saveStore.ts';

// ---------------------------------------------------------------------------
// Re-export the authoritative Save_Store schema + API from core so existing
// engine-side imports (`from '../saveState.ts'` / the engine barrel) keep
// resolving to the same symbols.
// ---------------------------------------------------------------------------
export {
  SAVE_STORAGE_KEY,
  SAVE_SCHEMA_VERSION,
  DEFAULT_CONTROL_BINDINGS,
  createFirstLaunchState,
  isValidSaveState,
  serialize,
  deserialize,
  createSaveStore,
  shouldPlayOpeningCinematic,
} from '../core/saveStore.ts';

export type {
  SaveState,
  GenerationState,
  WorldProgressState,
  ControlBindings,
  SettingsState,
  HighScoreState,
  SaveStore,
  SaveStoreLoadResult,
  SaveSource,
  SaveReadStorage,
  SaveWriteStorage,
} from '../core/saveStore.ts';

/**
 * Outcome of a save-load attempt (BootScene reads `.source` to detect a fresh
 * first launch). Kept as a named export for the existing engine barrel surface;
 * identical in shape to the core `SaveStoreLoadResult`.
 */
export interface SaveLoadResult {
  state: import('../core/saveStore.ts').SaveState;
  /** 'loaded' = a usable save blob was read; 'first-launch' = defaults created. */
  source: SaveSource;
}

/**
 * Load the Save_Store from storage, or create a First_Launch_State (Req 40.1).
 *
 * Delegates to the core SaveStore, which reads `kino.save.v1`, deserializes +
 * validates + migrates known older versions, and on any unreadable/invalid/
 * unknown-version data returns a fresh First_Launch_State IN MEMORY without
 * clobbering the stored blob (the write path only replaces it on the next
 * successful save). This preserves BootScene's original read-only contract.
 *
 * @param cfg     Loaded Config_File (for config-driven generation naming).
 * @param storage Optional Storage (BootScene passes `window.localStorage`). When
 *                omitted, behaves as a clean first launch.
 */
export function loadSaveOrFirstLaunch(
  cfg: ConfigFileData,
  storage?: Pick<Storage, 'getItem'>,
): SaveLoadResult {
  return createSaveStore(cfg).load(storage);
}

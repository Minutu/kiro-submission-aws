// Feature: kino-game
//
// Render / engine layer — barrel / public surface.
//
// This folder holds everything that depends on Phaser: scenes (Boot, Preload,
// MainMenu, Gameplay, Cinematic, RunEnd, overlays), renderers (KinoRenderer,
// ParallaxBackground, ObstacleView, HUD, TransitionOverlay), input mapping, and
// audio. Scenes drive the simulation core (`src/core`) each fixed step and
// render an interpolated frame.
//
// Engine modules MAY import from `src/core`, `src/config`, and `src/assets`.
// Core modules must NEVER import from here. See `src/README.md`.
//
// Re-export engine modules from this barrel as they are implemented.

// Scenes.
export {
  BootScene,
  BOOT_SCENE_KEY,
  PRELOAD_SCENE_KEY,
  DESIGN_WIDTH,
  DESIGN_HEIGHT,
  CINEMATIC_SCENE_KEY,
  OPENING_CINEMATIC_ID,
} from './scenes/BootScene.ts';
// Note: PRELOAD_SCENE_KEY is already exported above (BootScene.ts); both files
// declare the same 'Preload' constant, so we re-export only the new symbols.
export { PreloadScene, MAIN_MENU_SCENE_KEY } from './scenes/PreloadScene.ts';
export { loaderKindForCategory } from './scenes/preloadPlan.ts';
export type { LoaderKind } from './scenes/preloadPlan.ts';

// MainMenuScene (task 4.4): minimal Start/Play entry to World 1. Note:
// MAIN_MENU_SCENE_KEY is already re-exported above (PreloadScene.ts); both
// files declare the same 'MainMenu' constant, so we re-export only the new
// symbols here. GAMEPLAY_SCENE_KEY is the 'Gameplay' key task 4.6 registers.
export { MainMenuScene, GAMEPLAY_SCENE_KEY } from './scenes/MainMenuScene.ts';

// GameplayScene (task 4.6): the Run scene — fixed-step Jumping slice with HUD
// and death flow. GAMEPLAY_SCENE_KEY is re-exported above (MainMenuScene.ts);
// both files declare the same 'Gameplay' constant, so we re-export only the new
// symbols here. RUN_END_SCENE_KEY is the 'RunEnd' key task 4.7 registers; the
// RunEndData shape is the run-stats contract GameplayScene hands to it.
export { GameplayScene, RUN_END_SCENE_KEY } from './scenes/GameplayScene.ts';
export type { GameplaySceneData, RunEndData } from './scenes/GameplayScene.ts';

// RunEndScene (task 4.7): the Run_End_Screen shown when a run ends by collision
// — final score, relevant High_Score, obstacles cleared, run time, plus Retry
// (restart same world/mode) and Menu (return to main menu). RUN_END_SCENE_KEY
// is the 'RunEnd' key re-exported above (GameplayScene.ts); both files declare
// the same constant, so we re-export only the new scene symbol here.
export { RunEndScene } from './scenes/RunEndScene.ts';
// Pure Run_End_Screen stat helpers (Phaser-free; unit testable).
export { relevantHighScore, formatRunTime } from './runEndStats.ts';

// PauseScene (task 6.3): the pause overlay launched over a running GameplayScene
// (scene.launch) while the run freezes beneath it (Req 7.9-7.13). PAUSE_SCENE_KEY
// is the 'Pause' key main.ts registers; PauseSceneData is the launch contract.
export { PauseScene, PAUSE_SCENE_KEY } from './scenes/PauseScene.ts';
export type { PauseSceneData } from './scenes/PauseScene.ts';

// Pure run-pause controller (task 6.3; Phaser-free, unit testable): freezes the
// fixed-timestep driver so the run halts everything together (Req 7.10-7.12) and
// resumes from the held values (Req 7.12-7.13).
export { createRunPauseController } from './runPause.ts';
export type { RunPauseController, Freezable } from './runPause.ts';

// Generation_Name composition (Phaser-free; Req 32.1-32.2).
export { toRoman, formatGenerationName } from './generationName.ts';

// Input mapping: primary-action / skill-activation intents (task 4.3).
export { InputManager } from './input/index.ts';
export type { InputBindingsSource } from './input/index.ts';
export {
  parseBinding,
  parseBindings,
  parseControlBindings,
  emptyIntents,
  MOUSE_BUTTON_INDEX,
} from './input/index.ts';
export type {
  BindingKind,
  MouseButton,
  ParsedBinding,
  ParsedControlBindings,
  ControlBindingsInput,
  InputAction,
  InputIntents,
} from './input/index.ts';

// Shared boot context (Config_File, BalanceTable, Asset_Registry, Save_Store).
export { SHARED_CONTEXT_KEYS, setBootContext, getBootContext } from './sharedContext.ts';
export type { KinoBootContext } from './sharedContext.ts';

// Save_Store (task 7.1): the full versioned `kino.save.v1` schema + pure
// serialize/deserialize now live in `src/core/saveStore.ts`; this engine seam
// re-exports them and keeps BootScene's `loadSaveOrFirstLaunch` surface.
export {
  SAVE_STORAGE_KEY,
  SAVE_SCHEMA_VERSION,
  DEFAULT_CONTROL_BINDINGS,
  createFirstLaunchState,
  isValidSaveState,
  serialize,
  deserialize,
  createSaveStore,
  loadSaveOrFirstLaunch,
  shouldPlayOpeningCinematic,
} from './saveState.ts';
export type {
  SaveState,
  SaveLoadResult,
  SaveStore,
  SaveStoreLoadResult,
  SaveSource,
  SaveReadStorage,
  SaveWriteStorage,
  GenerationState,
  WorldProgressState,
  ControlBindings,
  SettingsState,
  HighScoreState,
} from './saveState.ts';

// Render components (task 8.1): KinoRenderer draws base Kino independently and
// overlays each equipped Cosmetic as a render-only transparent layer positioned
// by the pure `cosmeticAnchors` table (Req 19.1-19.4, 19.6, 6.5). Cosmetic
// layers never reach collision — the CollisionSystem reads KinoBody alone.
export {
  KinoRenderer,
  KINO_BODY_WIDTH,
  KINO_BODY_HEIGHT,
  cosmeticAnchor,
  isFrameForMode,
  defaultFrameForMode,
  MODE_FRAMES,
  DEFAULT_ANCHOR,
} from './render/index.ts';
export type {
  KinoRendererOptions,
  BodyRect,
  AnimationFrame,
  AnchorOffset,
} from './render/index.ts';

// Adaptive_Layout wiring (task 9.9; design: "Adaptive scaling (26.10–26.12)";
// Req 26.10, 26.11, 26.12). The THIN Phaser seam over the pure
// `core.computeLayout` math: `installAdaptiveLayout` subscribes a scene to the
// Scale Manager `resize` event and, on every screen-size change, recomputes the
// aspect-preserving centered "contain" fit of the fixed squarish DESIGN surface
// into the actual desktop/tablet viewport and pushes it to the scene's `apply`
// callback so UI + gameplay elements reposition AND rescale proportionally with
// no stretch (auto-detaches on scene shutdown). `layoutForScale` exposes the
// same computation for a one-off query; `DESIGN_SIZE` is the design surface.
export {
  DESIGN_SIZE,
  layoutForScale,
  installAdaptiveLayout,
} from './adaptiveLayout.ts';
export type {
  ApplyLayoutFn,
  AdaptiveLayoutController,
} from './adaptiveLayout.ts';

// SettingsScene (task 9.7): the Settings_Screen overlay launched over the menu
// (scene.launch) from the top-right Settings control (Req 20.24, 20.48). A THIN
// shell over the PURE `core.settingsScreen` logic: a volume control (Req 20.49,
// 25.7), control rebinding with the primary<->skill conflict naming message
// (Req 1.7) and persist-with-rollback (Req 1.8-1.9), and a reset-save option
// gated behind a confirmation (Req 20.50) that resets the Save_Store to the
// First_Launch_State on confirm (Req 20.51). SETTINGS_SCENE_KEY is the
// 'Settings' key main.ts registers; SettingsSceneData is the launch contract.
export { SettingsScene, SETTINGS_SCENE_KEY } from './scenes/SettingsScene.ts';
export type { SettingsSceneData } from './scenes/SettingsScene.ts';

// AudioManager (task 12.1): the THIN Phaser/WebAudio playback layer behind the
// audio system (design: "Audio"; Req 25.1-25.9). It owns the reusable Sound
// objects (decode-once / replay-many, Req 25.9), wires the autoplay unlock to
// the first real pointer/key gesture then flushes the queued events (Req 25.9),
// applies the effective gain from the persisted Save_Store settings (Req
// 25.7-25.8), resolves every cue through the Asset_Registry (placeholder cues
// no-op gracefully), and plays the mapped sound. ALL gating/policy decisions
// come from the pure `core.createAudioPolicy`; this class makes none itself.
export { AudioManager } from './audio/AudioManager.ts';
export type { AudioManagerOptions } from './audio/AudioManager.ts';

// InfoScene (task 9.2 + 9.6): the run-statistics Info panel overlay launched
// over the menu (scene.launch) from the top-left Stats control (Req 20.10,
// 20.23). A THIN shell over the PURE `core.buildInfoPanelViewModel` (task 9.6):
// it renders obstacles cleared, current score, active Perk effects as ±%, the
// equipped Skill, and per-World this-gen vs best-past-gen High_Scores (Req 31.1,
// 31.2) — no logic of its own. INFO_SCENE_KEY is the 'Info' key main.ts
// registers; InfoSceneData is the launch contract (run counters default to 0 on
// the menu, where no run is active).
export { InfoScene, INFO_SCENE_KEY } from './scenes/InfoScene.ts';
export type { InfoSceneData } from './scenes/InfoScene.ts';

// InventoryScene (task 9.4): the Inventory_Panel overlay launched over the menu
// (scene.launch) from the Cosmetics control (left of Kino) or Skills control
// (right of Kino) on the correct tab (Req 20.26, 20.42-20.44). A THIN shell over
// the PURE `core.inventoryPanel` view-model + `equipItem` selection algebra: it
// keeps Kino fixed in the upper area (Req 20.8, 20.43), previews the equipped
// item above Kino with a highlight (Req 20.9, 20.17), renders the lower-half
// tabbed Cosmetics/Skills view with the active tab indicated (Req 20.44), draws
// a scrollable rarity-colored grid (Req 20.45, 12.14, 36.6) with locked skills +
// unowned cosmetics greyed non-selectable (Req 12.11, 20.46), and on selecting
// an owned item equips it single-select (Req 12.15, 19.7), persists through the
// Save_Store, and refreshes the preview (Req 12.12, 20.47). Its dimmed backdrop
// fades the other menu elements so equip/customize happens in place (Req 20.8,
// 20.17, 20.42). INVENTORY_SCENE_KEY is the 'Inventory' key main.ts registers;
// InventorySceneData is the launch contract (the tab + an onClose seam).
export { InventoryScene, INVENTORY_SCENE_KEY } from './scenes/InventoryScene.ts';
export type { InventorySceneData } from './scenes/InventoryScene.ts';

// CinematicScene (task 10.1): the generic, reusable, SKIPPABLE cinematic shell
// (design: "Cinematics System (Req 21, 29, 42)"; Req 21.3, 21.18, 21.21). A
// THIN Phaser shell over the PURE `core.createCinematicPlayer` panel player: it
// renders the current Comic_Panel comic-book style (paneled frame, caption, art
// via the Asset_Registry placeholder-friendly), advances panel-by-panel on
// tap/click/key (Req 21.21), offers an always-visible SKIP control + ESC that
// ends the sequence (Req 21.3, 21.18), and on completion runs the onComplete /
// next-scene hand-off — deferring ALL sequencing to core. It registers under
// the SAME CINEMATIC_SCENE_KEY ('Cinematic') BootScene routes a first boot to,
// so that routing resolves even before the specific cinematic CONTENT (tasks
// 10.2–10.5): with no panels the pure player is immediately complete and the
// scene hands straight back to its nextSceneKey (default Preload). CinematicScene
// is registered in main.ts under 'Cinematic'. CINEMATIC_SCENE_KEY is already
// re-exported above (BootScene.ts); both declare the same 'Cinematic' constant,
// so only the new scene + data symbols are re-exported here.
export { CinematicScene } from './scenes/CinematicScene.ts';
export type { CinematicSceneData } from './scenes/CinematicScene.ts';

// World-completion cinematic id (task 10.4; design: "Cinematics System (Req 21,
// 29, 42)"; Req 21.6, 21.7, 21.10). The CinematicScene adds a WORLD_COMPLETION
// branch to its per-cinematic panel seam that resolves the PURE
// `core.buildWorldCompletionCinematicPanels` (short celebration → newly-unlocked
// silhouette dissolve → return-to-menu) and, on completion, hands back to the
// MENU (MAIN_MENU_SCENE_KEY) by default (Req 21.6). The silhouette dissolve +
// cross-generation greying stay driven by the pure reveal state
// (core.computeSilhouetteReveal / core.computeGenerationGreying). The id is the
// core constant re-exported through CinematicScene; both declare the same
// 'world-completion' string, so only the re-export surfaces here.
export { WORLD_COMPLETION_CINEMATIC_ID } from './scenes/CinematicScene.ts';

// Mentor cutscene id (task 10.3; design: "Cinematics System (Req 21, 29, 42)";
// Req 21.2, 21.4, 21.5, 29.1-29.12, 42.1-42.6, 39.4). The CinematicScene adds a
// MENTOR branch to its per-cinematic panel seam that resolves the PURE
// `core.buildMentorCutscenePanels` for the requested world (speaker-swap
// dialogue over the animated world background → the Evolution beat) and, on
// completion, hands INTO the run (GameplayScene) with that world (Req 21.2). It
// wires the skip-on-retry via the PURE `core.shouldPlayMentorCutscene` against
// the engine's per-generation evolved-world RUN STATE: an already-evolved world
// resolves to EMPTY panels so the scene hands straight into the run with Kino
// already evolved (Req 21.4/39.4); a world's first entry plays the cutscene and
// marks it evolved for the generation (Req 21.2), reset per generation so each
// world's cutscene plays again on first entry (Req 21.5). The id is the core
// constant re-exported through CinematicScene; both declare the same 'mentor'
// string, so only the re-export surfaces here.
export { MENTOR_CUTSCENE_ID } from './scenes/CinematicScene.ts';

// Per-generation evolved-worlds RUN STATE (task 10.3; Req 21.2/21.4/21.5/39.4).
// The mentor-cutscene skip rule's evolved flag lives here as engine run state —
// NOT in the persisted Save_Store (per-generation state never persists, Req
// 22.3/22.7). `isWorldEvolvedThisGeneration` reads it, `markWorldEvolvedThisGeneration`
// sets it when a world's cutscene completes, and `resetEvolvedWorldsThisGeneration`
// clears it when a new generation begins.
export {
  isWorldEvolvedThisGeneration,
  markWorldEvolvedThisGeneration,
  resetEvolvedWorldsThisGeneration,
} from './sharedContext.ts';

// Final-ending cinematic id (task 10.5; design: "Cinematics System (Req 21, 29,
// 42)"; Req 21.8, 21.9, 21.19, 21.20, 32.3, 32.4). The CinematicScene adds a
// FINAL_ENDING branch to its per-cinematic panel seam that resolves the PURE
// `core.buildEndingCinematicPanels` (reunion → start a family → knock the next
// egg to loop the story → credits → blooper outtakes referencing the
// creator/inspiration) for the current generation and, on completion, hands
// back to the MENU (MAIN_MENU_SCENE_KEY) by default — the generational loop (Req
// 21.8). The World-5 finale (task 11.2), when Kino Jumps through the portal
// barrier (Req 8.15), starts the CinematicScene with this id. The same-iteration
// Junior→Senior advance (Req 21.19/32.3) and the next egg's next-iteration +
// Junior label (Req 21.20/32.4) stay driven by the pure ending generation-advance
// helpers (reusing core.formatGenerationName / core.nextGeneration). The id is
// the core constant re-exported through CinematicScene; both declare the same
// 'final-ending' string, so only the re-export surfaces here.
export { FINAL_ENDING_CINEMATIC_ID } from './scenes/CinematicScene.ts';

// Performance / optimization wiring (task 12.3; design: "Performance &
// Optimization Guidelines"; Req 26.3, 26.4, 26.5, 26.9). The pure pieces —
// the generic `createObjectPool`, the `Obstacle` recycle helpers, the
// `createDegradationLadder` quality state machine, the off-screen culling
// predicates, and the bounded history buffer — live in `src/core` and are
// re-exported from `src/core/index.ts`. The engine WIRING is internal to
// GameplayScene (already exported above): it backs the obstacle Rectangle
// views with a pre-allocated pool sized via `core.worstCaseOnScreenCount`
// (acquire on spawn / release off-screen, no per-frame allocation on the render
// hot path), samples the degradation ladder each frame with the real frame
// delta while gameplay is active, and applies the resolved quality knobs to the
// effects that exist today (the later particle/parallax renderers read the same
// ladder). No new engine symbol is introduced by this pass — the reusable,
// testable surface is the core one.

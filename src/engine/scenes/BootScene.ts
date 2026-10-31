// Feature: kino-game
//
// BootScene — the first scene in the graph (design: Scene table). Its job is
// one-time boot wiring, then an immediate hand-off to PreloadScene:
//
//   1. Read the Config_File via `loadAndValidate` (Req 33.6).
//   2. Build the BalanceTable and the Asset_Registry from it (Req 24.8).
//   3. Load the Save_Store, or create a First_Launch_State (Req 40.1).
//   4. Confirm/centralize the Scale Manager (FIT, squarish, CENTER_BOTH) and
//      enable the input manager (keyboard + mouse) with a seam for task 4.3's
//      primary/skill mapping (Req 26.10).
//   5. Stash config/balance/registry/save on the game registry so later scenes
//      can read them, then start PreloadScene.
//
// This is an ENGINE-layer scene, so importing Phaser here is allowed
// (src/README.md). Config/assets/core stay Phaser-free; this scene is the seam
// that brings their pure outputs into the Phaser world.

import Phaser from 'phaser';
import { loadAndValidate, createBalanceTable } from '../../config/index.ts';
import { AssetRegistry } from '../../assets/index.ts';
import { loadSaveOrFirstLaunch, shouldPlayOpeningCinematic } from '../saveState.ts';
import { setBootContext, setAudioManager } from '../sharedContext.ts';
import { AudioManager } from '../audio/AudioManager.ts';

/** Scene keys, shared with main.ts's scene registration. */
export const BOOT_SCENE_KEY = 'Boot';
export const PRELOAD_SCENE_KEY = 'Preload';

/**
 * Scene key the CinematicScene framework (task 10.1) registers under, and the
 * id of the OPENING cinematic sequence (task 10.2). BootScene routes toward
 * these on a first launch (Req 40.2) but does not own them: it starts the
 * Cinematic scene ONLY if it is registered, else falls through to the normal
 * Preload → Menu flow (see `routeFirstBoot`). Defined here as the single shared
 * contract so tasks 10.1/10.2 register against the same strings.
 */
export const CINEMATIC_SCENE_KEY = 'Cinematic';
export const OPENING_CINEMATIC_ID = 'opening';

/**
 * The squarish desktop-style target (Req 26.10). This matches the game-level
 * config in main.ts; BootScene re-asserts it so the canonical dimensions live
 * next to the scale wiring and survive any future game-config refactor.
 */
export const DESIGN_WIDTH = 960;
export const DESIGN_HEIGHT = 960;

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: BOOT_SCENE_KEY });
  }

  /**
   * Everything BootScene does is synchronous one-time setup, so it all happens
   * in `create()`. There are no assets to queue here — PreloadScene (task 4.2)
   * owns the Phaser loader; BootScene only builds the registry that tells
   * Preload what to load.
   */
  create(): void {
    // 1. Config — guarded load, never throws, falls back to defaults (Req 33.6).
    const config = loadAndValidate();

    // 2. BalanceTable + Asset_Registry from the loaded config (Req 24.8).
    const balance = createBalanceTable(config.balance);
    const assets = AssetRegistry.fromConfig(config);

    // 3. Save_Store or First_Launch_State (Req 40.1). Read-only for now: the
    //    full SaveStore (task 7.1) owns the write path and version migration.
    //    On no usable save the loader returns a fresh First_Launch_State
    //    (Generation 1 Junior, no skills/cosmetics, only World 1, default
    //    bindings) with `source: 'first-launch'` (Req 40.1).
    const storage = resolveLocalStorage();
    const { state: save, source } = loadSaveOrFirstLaunch(config, storage);

    // 4. Opening-cinematic TRIGGER decision (Req 40.2). The pure helper lives in
    //    core so it is the single source of truth shared with tasks 10.1/10.2;
    //    it is true for — and only for — a first launch. This boolean rides the
    //    boot context (and scene-start data below) so the later cinematic task
    //    can consume it without re-deriving the decision.
    const playOpeningCinematic = shouldPlayOpeningCinematic(source);
    if (playOpeningCinematic) {
      console.info('[KINO][Boot] First launch detected; using First_Launch_State.');
    }

    // 5. Scale + input managers (Req 26.10). The FIT/CENTER_BOTH squarish target
    //    is set in the game config (main.ts); re-assert it so the canonical
    //    values are centralized with the boot wiring and resize is handled.
    this.configureScaleManager();
    this.configureInputManager();

    // 6. Publish the boot context for every later scene, then hand off.
    setBootContext(this.game, { config, balance, assets, save, playOpeningCinematic });

    // 6b. Audio system (task 12.1, Req 25.1-25.9). Construct the game-global
    //     AudioManager once (pure policy starts the autoplay gate LOCKED) and
    //     stash it for every later scene to raise events through. BootScene
    //     hands off immediately, so a later long-lived scene re-attaches the
    //     unlock to the first real gesture via `attachUnlock` / getAudioManager.
    const audio = new AudioManager(this, { assets, save });
    setAudioManager(this.game, audio);

    this.routeFirstBoot(playOpeningCinematic);
  }

  /**
   * Route the first scene hand-off (Req 40.2).
   *
   * On a first launch we should play the OPENING CINEMATIC before the menu; a
   * returning player takes the normal Preload → Menu flow. The opening cinematic
   * itself is task 10.2 and the `CinematicScene` framework is task 10.1 —
   * neither exists yet — so we route DEFENSIVELY (mirroring PreloadScene's
   * MainMenu seam):
   *
   *   - If a `Cinematic` scene is registered, start it and pass the
   *     opening-cinematic request through scene-start data so it knows which
   *     sequence to play and that it must return to the Preload → Menu flow when
   *     done/skipped.
   *   - Otherwise fall through to PreloadScene and log a clear seam noting that
   *     tasks 10.1/10.2 will register the opening cinematic. The boot context's
   *     `playOpeningCinematic` flag remains set either way, so once 10.1/10.2
   *     land they can honor it even from the Preload path.
   */
  private routeFirstBoot(playOpeningCinematic: boolean): void {
    if (playOpeningCinematic && this.scene.get(CINEMATIC_SCENE_KEY)) {
      this.scene.start(CINEMATIC_SCENE_KEY, {
        cinematicId: OPENING_CINEMATIC_ID,
        // Where the cinematic hands off once it finishes / is skipped (Req 21.18).
        nextSceneKey: PRELOAD_SCENE_KEY,
      });
      return;
    }

    if (playOpeningCinematic) {
      // Seam for tasks 10.1/10.2: no CinematicScene registered yet. First launch
      // wants the opening cinematic, but we have nowhere to play it, so we fall
      // through to the normal flow. The `playOpeningCinematic` flag stays on the
      // boot context for whoever wires the cinematic to consume.
      console.info(
        `[KINO][Boot] First launch wants the opening cinematic; '${CINEMATIC_SCENE_KEY}' scene not registered yet (tasks 10.1/10.2). Falling through to '${PRELOAD_SCENE_KEY}'.`,
      );
    }

    this.scene.start(PRELOAD_SCENE_KEY);
  }

  /**
   * Confirm/centralize the Scale Manager: FIT scaling, centered both axes, at
   * the squarish desktop target (Req 26.10, 26.11). The game config already
   * sets these; calling the setters here keeps the authoritative values beside
   * the boot logic and makes a later resize pass (task 9.9) easy to hang off.
   */
  private configureScaleManager(): void {
    const scale = this.scale;
    scale.setGameSize(DESIGN_WIDTH, DESIGN_HEIGHT);
    scale.scaleMode = Phaser.Scale.FIT;
    scale.autoCenter = Phaser.Scale.CENTER_BOTH;
    // Re-fit once now so the canvas is correct before the first rendered frame.
    scale.refresh();
  }

  /**
   * Enable the input manager so keyboard + mouse are live for the whole game
   * (Req 1.1-1.4 inputs, confirmed here at boot). BootScene only guarantees the
   * devices are enabled; the primary/skill *binding* and the one-frame response
   * path are the `InputManager` (task 4.3), which a run scene instantiates from
   * the Save_Store for the lifetime of a run:
   *
   *   import { InputManager } from '../input/index.ts';
   *   const input = new InputManager(this, getBootContext(this).save.controlBindings);
   *   // per frame: const { primaryPressed, skillPressed } = input.snapshot();
   *
   * It is scoped per gameplay scene (not boot) because its edge-triggered
   * intents are read by GameplayScene's fixed-step loop (task 4.6) and it cleans
   * itself up on that scene's shutdown.
   */
  private configureInputManager(): void {
    // Mouse/pointer is enabled by default; make the intent explicit and allow
    // the right mouse button (used for skill activation by InputManager).
    this.input.mouse?.disableContextMenu();

    // Keyboard plugin exists when the environment supports it (guards headless
    // test contexts). InputManager (task 4.3) registers SPACE / Q (and any
    // rebound keys from save.controlBindings) against this plugin.
    void this.input.keyboard;
  }
}

/**
 * Resolve `window.localStorage` when running in a browser, else `undefined` so
 * the save loader treats it as a clean first launch (headless/test contexts).
 */
function resolveLocalStorage(): Pick<Storage, 'getItem'> | undefined {
  try {
    if (typeof window !== 'undefined' && window.localStorage) {
      return window.localStorage;
    }
  } catch {
    // Access to localStorage can throw (privacy mode); treat as unavailable.
  }
  return undefined;
}

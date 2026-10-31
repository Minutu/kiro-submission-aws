// Feature: kino-game
//
// PreloadScene — the Loading_Screen (Req 37.1-37.5). Its job:
//
//   1. preload(): queue every non-empty configured path the Asset_Registry
//      still needs (`ctx.assets.pendingLoads()`) into the Phaser loader, using
//      the loader method appropriate to each asset category (image vs audio).
//      The registry key is used as the Phaser loader key so later scenes look
//      assets up by the same key gameplay resolves (Req 37.1).
//   2. Wire per-file loader events: on `filecomplete` mark the key real
//      (`markLoaded`), on `loaderror` mark it failed so it falls back to its
//      geometric placeholder (`markFailed`, Req 37.5 / Req 24.10 / Req 33.7).
//   3. Draw a geometric loading progress bar + text driven by the loader
//      `progress` event (Req 37.2).
//   4. On loader `complete`, every required asset now resolves to real art or
//      placeholder — placeholder counts as loaded — so entry to the main menu
//      is enabled: start MainMenuScene (Req 37.3, 37.4). With ZERO pending
//      loads (all placeholders) the loader fires `complete` immediately; we
//      still show a brief loading screen and then proceed rather than hang.
//
// ENGINE-layer scene, so importing Phaser here is allowed (src/README.md). The
// pure category→loader-kind decision lives in `preloadPlan.ts` so it stays
// unit-testable without a browser/canvas; this scene only does Phaser wiring.

import Phaser from 'phaser';
import { getBootContext } from '../sharedContext.ts';
import { loaderKindForCategory } from './preloadPlan.ts';

/** Scene key, shared with BootScene / main.ts registration. */
export const PRELOAD_SCENE_KEY = 'Preload';

/**
 * Key of the scene to enter once preloading finishes. MainMenuScene (task 4.4)
 * registers under this key in main.ts; until then this scene transitions
 * defensively (see `enterMainMenu`).
 */
export const MAIN_MENU_SCENE_KEY = 'MainMenu';

/** Minimum time (ms) the Loading_Screen stays visible, even with no real loads
 * to perform, so the screen never flashes by (Req 37.1). */
const MIN_VISIBLE_MS = 400;

export class PreloadScene extends Phaser.Scene {
  /** Progress bar geometry, created in `create` before loading starts. */
  private progressBar?: Phaser.GameObjects.Graphics;
  private percentText?: Phaser.GameObjects.Text;

  /** Set once the loader reports `complete`, gating the menu hand-off. */
  private loadComplete = false;
  /** Timestamp (ms) create() ran, to enforce the minimum visible duration. */
  private shownAt = 0;

  constructor() {
    super({ key: PRELOAD_SCENE_KEY });
  }

  /**
   * Queue every pending real asset into the Phaser loader and wire the per-file
   * success/error events. This runs before Phaser automatically kicks off the
   * load between `preload()` and `create()`.
   */
  preload(): void {
    // Confirms BootScene published config/balance/assets/save before us; throws
    // loudly if the boot order is ever broken.
    const ctx = getBootContext(this);

    // Queue each non-empty configured path under its registry key. Blank paths
    // already resolve to placeholder and are NOT returned by pendingLoads().
    for (const { key, configuredPath, category } of ctx.assets.pendingLoads()) {
      const kind = loaderKindForCategory(category);
      if (kind === 'image') {
        this.load.image(key, configuredPath);
      } else {
        // 'audio' — Phaser accepts a single URL or an array of fallbacks.
        this.load.audio(key, configuredPath);
      }
    }

    // Per-file success: the registry key doubles as the loader key, so the
    // emitted `key` maps straight back to the record (Req 37.1).
    this.load.on(Phaser.Loader.Events.FILE_COMPLETE, (key: string) => {
      ctx.assets.markLoaded(key);
    });

    // Per-file error: fall back to the key's placeholder and keep going rather
    // than blocking the game (Req 37.5, Req 24.10, Req 33.7).
    this.load.on(
      Phaser.Loader.Events.FILE_LOAD_ERROR,
      (file: Phaser.Loader.File) => {
        ctx.assets.markFailed(file.key);
      },
    );

    // Progress + completion UI/wiring. `progress` fires 0..1 as files resolve;
    // `complete` fires once all queued files finish (immediately if none were
    // queued).
    this.load.on(Phaser.Loader.Events.PROGRESS, (value: number) => {
      this.drawProgress(value);
    });
    this.load.on(Phaser.Loader.Events.COMPLETE, () => {
      this.loadComplete = true;
      this.drawProgress(1);
    });
  }

  /**
   * Build the Loading_Screen graphics. `create()` runs after Phaser has started
   * the queued load, so we draw the initial (empty) bar here and let the
   * `progress`/`complete` handlers fill it. The menu hand-off is gated in
   * `update()` so the minimum-visible delay applies even when there is nothing
   * to load (zero pending → `complete` already fired by now).
   */
  create(): void {
    this.shownAt = this.time.now;
    this.buildProgressUi();
    // Reflect whatever progress already occurred (e.g. complete with 0 loads).
    this.drawProgress(this.loadComplete ? 1 : 0);
  }

  /**
   * Gate the main-menu hand-off: only once the loader has completed AND the
   * Loading_Screen has been visible for at least the minimum duration. Enabling
   * menu entry here (rather than directly in the `complete` handler) keeps the
   * zero-pending-loads case from flashing past the screen (Req 37.1, 37.3).
   */
  update(): void {
    if (!this.loadComplete) return;
    if (this.time.now - this.shownAt < MIN_VISIBLE_MS) return;
    this.enterMainMenu();
  }

  // -- UI ------------------------------------------------------------------

  /** Construct the static progress-bar frame, text labels, and the fill bar. */
  private buildProgressUi(): void {
    const { width, height } = this.scale.gameSize;
    const cx = width / 2;
    const cy = height / 2;
    const barWidth = Math.min(480, width * 0.6);
    const barHeight = 40;

    // Outline box behind the fill bar (static, drawn once).
    const progressBox = this.add.graphics();
    progressBox.fillStyle(0x222222, 0.8);
    progressBox.fillRect(cx - barWidth / 2, cy - barHeight / 2, barWidth, barHeight);

    // The fill bar, redrawn each progress tick.
    this.progressBar = this.add.graphics();

    // "Loading..." label above the bar (Req 37.2). Static, so no field kept.
    this.add
      .text(cx, cy - barHeight, 'Loading...', {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0.5);

    this.percentText = this.add
      .text(cx, cy, '0%', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0.5);
  }

  /** Redraw the fill bar and percent label for a 0..1 progress value (Req 37.2). */
  private drawProgress(value: number): void {
    const clamped = Phaser.Math.Clamp(value, 0, 1);
    if (this.percentText) {
      this.percentText.setText(`${Math.round(clamped * 100)}%`);
    }
    if (!this.progressBar) return;

    const { width, height } = this.scale.gameSize;
    const cx = width / 2;
    const cy = height / 2;
    const barWidth = Math.min(480, width * 0.6);
    const barHeight = 40;
    const pad = 4;

    this.progressBar.clear();
    this.progressBar.fillStyle(0xffffff, 1);
    this.progressBar.fillRect(
      cx - barWidth / 2 + pad,
      cy - barHeight / 2 + pad,
      (barWidth - pad * 2) * clamped,
      barHeight - pad * 2,
    );
  }

  // -- hand-off ------------------------------------------------------------

  /**
   * Enter the main menu now that every required asset is loaded or on its
   * placeholder (Req 37.3, 37.4). MainMenuScene (task 4.4) registers under
   * `MAIN_MENU_SCENE_KEY` in main.ts. Until it is registered we transition
   * defensively: start it only if present, otherwise log a clear seam so the
   * boot chain is visibly "waiting" for task 4.4 rather than crashing.
   */
  private enterMainMenu(): void {
    // Guard against re-entry: update() could fire again before the scene stops.
    this.loadComplete = false;

    if (this.scene.get(MAIN_MENU_SCENE_KEY)) {
      this.scene.start(MAIN_MENU_SCENE_KEY);
      return;
    }

    // Seam for task 4.4: MainMenuScene not registered yet. Loading finished and
    // menu entry is "enabled"; we simply have nowhere to go until 4.4 wires it.
    console.info(
      `[KINO][Preload] Assets resolved; menu entry enabled. '${MAIN_MENU_SCENE_KEY}' scene not registered yet (task 4.4).`,
    );
  }
}

// Feature: kino-game
//
// PauseScene — the pause overlay (task 6.3; design: Scene table "PauseScene
// (overlay) | Freezes run & all timers; resume continues | 7.9-7.13"). It is
// launched OVER a running GameplayScene with Phaser's parallel-scene mechanism
// (`scene.launch`) while the gameplay scene is paused beneath, so the run
// genuinely freezes — the critical mechanism behind the pause-freezes-timers
// invariant (Req 7.10-7.12; design: "Overlays are launched with scene.launch
// and pause the scene beneath").
//
// RESPONSIBILITY (and only this): render a "Paused" state + a Resume control
// (Req 7.13), and on Resume tell GameplayScene to unfreeze and continue, then
// stop this overlay. It owns NO simulation state — the freeze/unfreeze is the
// gameplay scene's job via its RunPauseController (src/engine/runPause.ts). The
// gameplay scene passes a `resume` callback in the launch data; this scene calls
// it on the Resume control (or the pause/resume key) and then stops itself.
//
// ENGINE layer, so importing Phaser is allowed (src/README.md).

import Phaser from 'phaser';
import { getBootContext, type KinoBootContext } from '../sharedContext.ts';

/** Scene key, shared with GameplayScene + main.ts. */
export const PAUSE_SCENE_KEY = 'Pause';

/**
 * Launch data GameplayScene passes when it launches the overlay. The `resume`
 * callback is how the overlay hands control back: calling it unfreezes the run
 * (continuing from the held values, Req 7.12-7.13) and stops this overlay. Kept
 * as a callback (rather than this scene reaching into the gameplay scene) so the
 * overlay stays decoupled from the gameplay scene's internals.
 */
export interface PauseSceneData {
  /** Invoked on Resume: unfreeze the run and dismiss this overlay. */
  resume: () => void;
}

export class PauseScene extends Phaser.Scene {
  /** The resume callback captured from the launch data (Req 7.13). */
  private resumeRun: () => void = () => {};

  /** Cached boot context (config/labels/palette). */
  private ctx!: KinoBootContext;

  constructor() {
    super({ key: PAUSE_SCENE_KEY });
  }

  /** Capture the resume callback before `create` runs. */
  init(data: PauseSceneData): void {
    this.resumeRun = typeof data?.resume === 'function' ? data.resume : () => {};
  }

  create(): void {
    this.ctx = getBootContext(this);
    const { width, height } = this.scale.gameSize;
    const cx = width / 2;

    // Dimmed backdrop so the paused run reads behind the overlay (the gameplay
    // scene is frozen beneath, still visible). Semi-transparent so the player
    // sees the run is held, not gone.
    this.add
      .rectangle(cx, height / 2, width, height, 0x0b0f16, 0.72)
      .setOrigin(0.5, 0.5)
      .setDepth(0);

    this.buildTitle(cx, height * 0.34);
    this.buildResumeControl(cx, height * 0.56);

    // A pause/resume key also resumes (Req 7.13): pressing ESC or P while the
    // overlay is up continues the run, mirroring the Resume control. Guarded for
    // headless contexts where the keyboard plugin is absent.
    const keyboard = this.input.keyboard;
    if (keyboard) {
      keyboard.on('keydown-ESC', this.onResume, this);
      keyboard.on('keydown-P', this.onResume, this);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        keyboard.off('keydown-ESC', this.onResume, this);
        keyboard.off('keydown-P', this.onResume, this);
      });
    }
  }

  /** "Paused" heading (Req 7.9 pause state is visible). */
  private buildTitle(cx: number, y: number): void {
    this.add
      .text(cx, y, this.ctx.config.labels.paused, {
        fontFamily: 'monospace',
        fontSize: '48px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(1);
  }

  /** Resume control (Req 7.13) — continues the run from the held state. */
  private buildResumeControl(cx: number, y: number): void {
    const label = this.ctx.config.labels.resume;
    const paddingX = 32;
    const paddingY = 16;

    const text = this.add
      .text(cx, y, label, {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#0b0f16',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(2);

    const bg = this.add
      .rectangle(cx, y, text.width + paddingX * 2, text.height + paddingY * 2, 0xf5e6c8)
      .setOrigin(0.5, 0.5)
      .setDepth(1)
      .setInteractive({ useHandCursor: true });

    bg.on('pointerover', () => bg.setFillStyle(0xffffff));
    bg.on('pointerout', () => bg.setFillStyle(0xf5e6c8));
    bg.on('pointerdown', () => bg.setFillStyle(0xd9c9a8));
    bg.on('pointerup', () => {
      bg.setFillStyle(0xffffff);
      this.onResume();
    });
  }

  /**
   * Resume the run: invoke the gameplay scene's `resume` callback (which
   * unfreezes the driver so the run continues from the held values, Req 7.12-
   * 7.13) and stop this overlay. Guarded so a doubled key + pointer event cannot
   * resume twice.
   */
  private onResume(): void {
    const resume = this.resumeRun;
    this.resumeRun = () => {};
    resume();
    this.scene.stop(PAUSE_SCENE_KEY);
  }
}

// Pause controller — a pause button + overlay shared by all gameplay scenes.
//
// Shows a small Pause button top-right. When paused, the scene freezes (it
// checks isPaused() in update and skips simulation) and an overlay appears with
// the run stats so far: current score and time spent playing. Resume continues
// the run; a Menu button returns to the menu.
//
// Elapsed time is accumulated from real frame deltas while the run is running
// (not paused, not dead, started), so the displayed time excludes paused time.

import Phaser from 'phaser';

export class PauseController {
  private paused = false;
  private elapsedMs = 0;

  private button!: Phaser.GameObjects.Rectangle;
  private overlay: Phaser.GameObjects.Container | null = null;

  /**
   * @param scene owning scene
   * @param getScore returns the current score for the stats panel
   * @param isRunning returns true while the run is actively simulating
   *   (started, not dead) — used to accumulate play time only while running
   */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly getScore: () => number,
    private readonly isRunning: () => boolean,
    // Whether the run may be paused right now (true unless on the game-over
    // screen). Defaults to always-pausable so you can pause immediately after
    // entering a world, before the first flap.
    private readonly canPause: () => boolean = () => true,
  ) {
    this.buildButton();
    // Esc and P both toggle the pause menu.
    scene.input.keyboard?.on('keydown-P', () => this.toggle());
    scene.input.keyboard?.on('keydown-ESC', () => this.toggle());
  }

  /** Screen-space bounds of the pause button (for click-swallowing). */
  private btnX = 0;
  private btnY = 0;
  private btnW = 90;
  private btnH = 56;

  /** True if a pointer is over the pause button, so the scene can skip its
   * flap/jump on that same click. Also true while paused (clicks go to the
   * overlay, not the game). */
  hitsButton(p: Phaser.Input.Pointer): boolean {
    if (this.paused) return true;
    return (
      Math.abs(p.x - this.btnX) <= this.btnW / 2 &&
      Math.abs(p.y - this.btnY) <= this.btnH / 2
    );
  }

  private buildButton(): void {
    const cam = this.scene.cameras.main;
    const x = cam.width - 70;
    const y = 50;
    this.btnX = x;
    this.btnY = y;
    this.button = this.scene.add
      .rectangle(x, y, this.btnW, this.btnH, 0x2c3e66)
      .setStrokeStyle(3, 0xffffff)
      .setDepth(45)
      .setInteractive({ useHandCursor: true });
    this.scene.add
      .text(x, y, 'II', {
        fontFamily: 'sans-serif', fontSize: '28px', color: '#ffffff', fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(46);

    this.button.on('pointerup', () => this.toggle());
  }

  /** Accumulate play time; call every frame with the REAL delta (ms). */
  tick(deltaMs: number): void {
    if (!this.paused && this.isRunning()) {
      this.elapsedMs += deltaMs;
    }
  }

  isPaused(): boolean {
    return this.paused;
  }

  private toggle(): void {
    if (this.paused) this.resume();
    else this.pause();
  }

  private pause(): void {
    // Pausable anytime except on the game-over screen.
    if (!this.canPause()) return;
    this.paused = true;
    this.buildOverlay();
  }

  private resume(): void {
    this.paused = false;
    this.overlay?.destroy();
    this.overlay = null;
  }

  private buildOverlay(): void {
    const cam = this.scene.cameras.main;
    const cx = cam.width / 2;
    const cy = cam.height / 2;
    const c = this.scene.add.container(0, 0).setDepth(60);

    c.add(
      this.scene.add
        .rectangle(cx, cy, cam.width, cam.height, 0x000000, 0.7),
    );
    c.add(
      this.scene.add
        .rectangle(cx, cy, 520, 420, 0x16213e, 0.98)
        .setStrokeStyle(4, 0xffffff),
    );
    c.add(
      this.scene.add
        .text(cx, cy - 150, 'Paused', {
          fontFamily: 'sans-serif', fontSize: '56px', color: '#ffffff', fontStyle: 'bold',
        })
        .setOrigin(0.5),
    );

    c.add(
      this.scene.add
        .text(cx, cy - 50, 'Score: ' + this.getScore(), {
          fontFamily: 'sans-serif', fontSize: '40px', color: '#ffd166',
        })
        .setOrigin(0.5),
    );
    c.add(
      this.scene.add
        .text(cx, cy + 10, 'Time: ' + this.formatTime(this.elapsedMs), {
          fontFamily: 'sans-serif', fontSize: '40px', color: '#9fe0ff',
        })
        .setOrigin(0.5),
    );

    // Resume button.
    const resumeBtn = this.scene.add
      .rectangle(cx, cy + 110, 260, 70, 0x2ecc71)
      .setStrokeStyle(3, 0xffffff)
      .setInteractive({ useHandCursor: true });
    c.add(resumeBtn);
    c.add(
      this.scene.add
        .text(cx, cy + 110, 'Resume', {
          fontFamily: 'sans-serif', fontSize: '30px', color: '#ffffff', fontStyle: 'bold',
        })
        .setOrigin(0.5),
    );
    resumeBtn.on('pointerup', () => this.resume());

    // Menu button.
    const menuBtn = this.scene.add
      .rectangle(cx, cy + 190, 260, 60, 0x555f7a)
      .setStrokeStyle(3, 0xffffff)
      .setInteractive({ useHandCursor: true });
    c.add(menuBtn);
    c.add(
      this.scene.add
        .text(cx, cy + 190, 'Menu', {
          fontFamily: 'sans-serif', fontSize: '26px', color: '#ffffff',
        })
        .setOrigin(0.5),
    );
    menuBtn.on('pointerup', () => this.scene.scene.start('Menu'));

    this.overlay = c;
  }

  private formatTime(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }
}

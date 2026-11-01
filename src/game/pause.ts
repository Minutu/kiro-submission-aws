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
import { addText } from './ui.ts';
import { doodleButton, type UIPalette } from './uiTheme.ts';

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
    // Current world's UI palette (drives the pause button + overlay colors).
    private readonly pal?: UIPalette,
    // True when the run is over (death) — the overlay then offers Restart +
    // Menu instead of Resume + Menu.
    private readonly isDead: () => boolean = () => false,
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
    const fill = this.pal?.secondary ?? 0x2c3e66;
    const border = this.pal?.panelBorder ?? 0xffffff;
    // Rounded doodle pause button.
    const g = this.scene.add.graphics().setDepth(45);
    g.fillStyle(fill, 1);
    g.fillRoundedRect(x - this.btnW / 2, y - this.btnH / 2, this.btnW, this.btnH, 16);
    g.lineStyle(4, border, 1);
    g.strokeRoundedRect(x - this.btnW / 2, y - this.btnH / 2, this.btnW, this.btnH, 16);
    this.button = this.scene.add
      .rectangle(x, y, this.btnW, this.btnH, 0x000000, 0)
      .setDepth(46)
      .setInteractive({ useHandCursor: true });
    addText(this.scene, x, y, 'II', { fontSize: 28 }).setDepth(46);
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
    // Pausable anytime: during a run (via canPause) or on the game-over screen
    // (where the overlay offers Restart + Menu instead of Resume + Menu).
    if (!this.canPause() && !this.isDead()) return;
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
    const panel = this.pal?.panel ?? 0x16213e;
    const border = this.pal?.panelBorder ?? 0xffffff;
    const textCol = this.pal?.text ?? '#ffffff';

    // Dim backdrop.
    c.add(this.scene.add.rectangle(cx, cy, cam.width, cam.height, 0x000000, 0.72));

    // Rounded themed panel.
    const pw = 540, ph = 440;
    const pg = this.scene.add.graphics();
    pg.fillStyle(panel, 0.98);
    pg.fillRoundedRect(cx - pw / 2, cy - ph / 2, pw, ph, 28);
    pg.lineStyle(5, border, 1);
    pg.strokeRoundedRect(cx - pw / 2, cy - ph / 2, pw, ph, 28);
    c.add(pg);

    const dead = this.isDead();
    c.add(addText(this.scene, cx, cy - 140, dead ? 'Game Over' : 'Paused', { fontSize: 56, color: textCol }));
    c.add(addText(this.scene, cx, cy - 45, 'Score: ' + this.getScore(), { fontSize: 38, color: textCol }));
    c.add(addText(this.scene, cx, cy + 15, 'Time: ' + this.formatTime(this.elapsedMs), { fontSize: 38, color: textCol }));

    // When dead: Restart + Menu. Otherwise: Resume + Menu.
    const left = dead
      ? doodleButton(
          this.scene, cx - 115, cy + 140, 210, 72, 'Restart',
          this.pal?.primary ?? 0x2ecc71, this.pal?.primaryHover ?? 0x3fe086, border,
          () => this.scene.scene.restart(), 28,
        )
      : doodleButton(
          this.scene, cx - 115, cy + 140, 210, 72, 'Resume',
          this.pal?.primary ?? 0x2ecc71, this.pal?.primaryHover ?? 0x3fe086, border,
          () => this.resume(), 28,
        );
    c.add(left.container);

    const menu = doodleButton(
      this.scene, cx + 115, cy + 140, 210, 72, 'Menu',
      this.pal?.secondary ?? 0x555f7a, this.pal?.secondaryHover ?? 0x6a7490, border,
      () => this.scene.scene.start('Menu'), 28,
    );
    c.add(menu.container);

    this.overlay = c;
  }

  private formatTime(ms: number): string {
    const totalSec = Math.floor(ms / 1000);
    const m = Math.floor(totalSec / 60);
    const s = totalSec % 60;
    return m + ':' + String(s).padStart(2, '0');
  }
}

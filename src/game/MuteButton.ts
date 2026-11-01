// Mute/unmute overlay — a small button pinned to the TOP-LEFT of the screen,
// present on every scene.
//
// It runs as its own always-on scene kept on top of everything, so a single
// button controls the whole game's audio (music + SFX) via the game-level
// sound manager. The state is persisted so it survives reloads.

import Phaser from 'phaser';
import { isMuted, setMuted, toggleMuted } from './music.ts';

export const MUTE_BUTTON_SCENE_KEY = 'MuteButton';

export class MuteButtonScene extends Phaser.Scene {
  private icon!: Phaser.GameObjects.Text;

  constructor() {
    super({ key: MUTE_BUTTON_SCENE_KEY, active: true });
  }

  create(): void {
    // Apply the persisted mute state to the whole game on boot.
    setMuted(this, isMuted());

    const x = 44;
    const y = 44;
    const w = 56;
    const h = 56;

    // Bright, high-contrast chip so it reads on top of dark panels (e.g. the
    // menu's Kiro preview panel, which spans this corner).
    const g = this.add.graphics();
    g.fillStyle(0xffffff, 0.95);
    g.fillRoundedRect(x - w / 2, y - h / 2, w, h, 14);
    g.lineStyle(3, 0x1b2340, 1);
    g.strokeRoundedRect(x - w / 2, y - h / 2, w, h, 14);

    this.icon = this.add
      .text(x, y, this.glyph(), { fontSize: '28px', padding: { x: 6, y: 8 } })
      .setOrigin(0.5);

    const hit = this.add
      .rectangle(x, y, w, h, 0x000000, 0)
      .setInteractive({ useHandCursor: true });
    hit.on('pointerup', () => {
      toggleMuted(this);
      this.icon.setText(this.glyph());
    });

    // Keep this overlay above every other scene from the start.
    this.scene.bringToTop();
  }

  update(): void {
    // Other scenes start/stop throughout the game (menu, worlds, overlays),
    // which can re-order the render stack. Re-assert top every frame so the
    // button is never hidden behind a later scene (e.g. the menu panel).
    this.scene.bringToTop();
  }

  private glyph(): string {
    // Speaker with sound vs muted speaker.
    return isMuted() ? '\u{1F507}' : '\u{1F50A}';
  }
}

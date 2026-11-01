// End cinematic — played after the World 5 finale walk-off.
//
// Shows the end-cinematic panels in order. A Continue button (bottom-right)
// advances; between panels the current one fades out to black, then the next
// fades in. After the last panel, Continue returns to the menu.

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './config.ts';
import { completeGeneration } from './progression.ts';
import { GENERIC_PALETTE, doodleButton } from './uiTheme.ts';

const PANELS = [
  'assets/Cinematics/End-Game/end-cinematic-0.png',
  'assets/Cinematics/End-Game/end-cinematic-1.png',
  'assets/Cinematics/End-Game/end-cinematic-2.png',
  'assets/Cinematics/End-Game/end-cinematic-3.png',
];

const FADE_MS = 450;

const END_TEXT =
  'The capacity to not repeat the mistakes of the past generations is, as you ' +
  'noticed, absent in the Kiro lineage.\n\n' +
  "Help this descendant work his way through as it'd be a pity for him not to " +
  'experience life too :((.';

export class EndCinematicScene extends Phaser.Scene {
  private index = 0;
  private panel!: Phaser.GameObjects.Image;
  private transitioning = false;
  private finished = false;
  private continueDoodle!: import('./uiTheme.ts').DoodleButton;
  private typing?: Phaser.Time.TimerEvent;

  constructor() {
    super('EndCinematic');
  }

  preload(): void {
    PANELS.forEach((p, i) => this.load.image(`end-${i}`, p));
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#000000');
    this.index = 0;
    this.transitioning = false;
    this.finished = false;

    this.panel = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'end-0').setDepth(0);
    this.showPanel(0);
    this.panel.setAlpha(0);
    this.tweens.add({ targets: this.panel, alpha: 1, duration: FADE_MS });

    this.input.keyboard?.on('keydown-SPACE', () => this.advance());

    // Continue button, bottom-right.
    this.continueDoodle = doodleButton(
      this, GAME_WIDTH - 120, GAME_HEIGHT - 50, 200, 64, 'Continue',
      GENERIC_PALETTE.primary, GENERIC_PALETTE.primaryHover, GENERIC_PALETTE.panelBorder,
      () => this.advance(), 24,
    );
    this.continueDoodle.container.setDepth(30);
  }

  private showPanel(i: number): void {
    this.panel.setTexture(`end-${i}`);
    const src = this.textures.get(`end-${i}`).getSourceImage();
    // Contain: show the whole panel, letterboxed if needed.
    const scale = Math.min(GAME_WIDTH / src.width, GAME_HEIGHT / src.height);
    this.panel.setScale(scale);
  }

  private advance(): void {
    if (this.transitioning || this.finished) return;
    if (this.index >= PANELS.length - 1) {
      // Past the last panel: show the closing dialogue box.
      this.showFinalDialogue();
      return;
    }
    // Fade out to black, swap panel, fade in.
    this.transitioning = true;
    this.tweens.add({
      targets: this.panel, alpha: 0, duration: FADE_MS,
      onComplete: () => {
        this.index += 1;
        this.showPanel(this.index);
        this.tweens.add({
          targets: this.panel, alpha: 1, duration: FADE_MS,
          onComplete: () => { this.transitioning = false; },
        });
      },
    });
  }

  /** Closing dialogue: dark overlay (last panel faintly visible), typed text,
   * then Continue ends the generation and returns to the menu. */
  private showFinalDialogue(): void {
    if (this.finished) return;
    this.finished = true;
    this.continueDoodle.container.setVisible(false);

    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;

    this.add.rectangle(cx, cy, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.82).setDepth(10);

    const boxW = 740;
    const boxH = 470;
    const dg = this.add.graphics().setDepth(11);
    dg.fillStyle(GENERIC_PALETTE.panel, 0.98);
    dg.fillRoundedRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, 26);
    dg.lineStyle(5, GENERIC_PALETTE.panelBorder, 1);
    dg.strokeRoundedRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, 26);

    const body = this.add
      .text(cx, cy - boxH / 2 + 40, '', {
        fontFamily: 'sans-serif', fontSize: '28px', color: '#ffffff', align: 'center',
        wordWrap: { width: boxW - 80 },
        stroke: '#000000', strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
      .setDepth(12);

    let shown = 0;
    this.typing = this.time.addEvent({
      delay: 28,
      loop: true,
      callback: () => {
        shown += 1;
        body.setText(END_TEXT.slice(0, shown));
        if (shown >= END_TEXT.length) this.typing?.remove();
      },
    });

    const by = cy + boxH / 2 - 44;
    const btn = doodleButton(
      this, cx, by, 240, 64, 'Continue',
      GENERIC_PALETTE.primary, GENERIC_PALETTE.primaryHover, GENERIC_PALETTE.panelBorder,
      () => {
        if (shown < END_TEXT.length) {
          this.typing?.remove();
          body.setText(END_TEXT);
          shown = END_TEXT.length;
        } else {
          this.typing?.remove();
          completeGeneration();
          this.scene.start('Menu');
        }
      },
      28,
    );
    btn.container.setDepth(13);
  }
}

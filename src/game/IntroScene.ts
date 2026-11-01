// Opening cinematic — shown once on first boot.
//
// Plays the start-cinematic panels in order (click/tap to advance; a Skip
// button bottom-right jumps to the end). On the LAST panel, a dark overlay
// dims everything (the panel stays faintly visible behind it) and a centered
// dialogue box types out the intro text letter-by-letter. A Continue button
// then goes to the menu, where only World 1 is unlocked.

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './config.ts';
import { markIntroSeen, hasSeenIntro } from './progression.ts';
import { GENERIC_PALETTE, doodleButton } from './uiTheme.ts';

const PANELS = [
  'assets/Cinematics/Start/start-cinematic-0.png',
  'assets/Cinematics/Start/start-cinematic-1.png',
  'assets/Cinematics/Start/start-cinematic-2.png',
];

const FADE_MS = 450;

const INTRO_TEXT =
  'Kiro Junior fell through worlds and is now lost. He gets out of his egg ' +
  'and steels his resolve to find his way back to his family. As he advances ' +
  'through worlds, he will learn more ways to travel.\n\n' +
  'Help him get back to his hometown!\n\n' +
  'Every world he crosses hides a little something from a place far beyond ' +
  'the clouds \u2014 the realm the builders call home.\n\n' +
  'P.S. : Can you find all the AWS services references?';

export class IntroScene extends Phaser.Scene {
  private index = 0;
  private panel!: Phaser.GameObjects.Image;
  private continueDoodle!: import('./uiTheme.ts').DoodleButton;
  private finished = false;
  private transitioning = false;
  private typing?: Phaser.Time.TimerEvent;

  constructor() {
    super('Intro');
  }

  preload(): void {
    if (hasSeenIntro()) return; // nothing to load; create() redirects to Menu
    PANELS.forEach((p, i) => this.load.image(`intro-${i}`, p));
  }

  create(): void {
    // Already seen on a previous boot -> skip straight to the menu.
    if (hasSeenIntro()) {
      this.scene.start('Menu');
      return;
    }

    this.cameras.main.setBackgroundColor('#000000');
    this.index = 0;
    this.finished = false;
    this.transitioning = false;

    // The current panel; fades in from black.
    this.panel = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'intro-0').setDepth(0);
    this.showPanel(0);
    this.panel.setAlpha(0);
    this.tweens.add({ targets: this.panel, alpha: 1, duration: FADE_MS });

    this.input.keyboard?.on('keydown-SPACE', () => this.advance());

    // Continue button, bottom-right — advances through the panels (no floating
    // center hint, so nothing covers the cinematic art).
    // Same doodle button as the menu (shadow + hover lift). Hidden when the
    // final dialogue appears.
    this.continueDoodle = doodleButton(
      this, GAME_WIDTH - 120, GAME_HEIGHT - 50, 200, 64, 'Continue',
      GENERIC_PALETTE.primary, GENERIC_PALETTE.primaryHover, GENERIC_PALETTE.panelBorder,
      () => this.advance(), 24,
    );
    this.continueDoodle.container.setDepth(30);
  }

  private showPanel(i: number): void {
    this.panel.setTexture(`intro-${i}`);
    const src = this.textures.get(`intro-${i}`).getSourceImage();
    // CONTAIN: fit the whole panel within the screen (letterboxed) so nothing
    // is cropped, rather than cover which fills but crops.
    const scale = Math.min(GAME_WIDTH / src.width, GAME_HEIGHT / src.height);
    this.panel.setScale(scale);
  }

  private advance(): void {
    if (this.finished || this.transitioning) return;
    if (this.index < PANELS.length - 1) {
      // Fade out to black, swap to the next panel, fade in. The last panel is
      // displayed first (the dialogue only shows on a further Continue).
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
    } else {
      // Already on the last panel; the next Continue shows the dialogue.
      this.showFinalDialogue();
    }
  }

  /** On the last panel: dark overlay + typed dialogue box + Continue. */
  private showFinalDialogue(): void {
    if (this.finished) return;
    this.finished = true;

    // Hide the panel-advance Continue button; the dialogue has its own.
    this.continueDoodle.container.setVisible(false);

    // Dark overlay — the last panel stays a tiny bit visible behind it.
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.82)
      .setDepth(10);

    // Centered rounded dialogue box (generic modern palette).
    const boxW = 740;
    const boxH = 560;
    const cx = GAME_WIDTH / 2;
    const cy = GAME_HEIGHT / 2;
    const dg = this.add.graphics().setDepth(11);
    dg.fillStyle(GENERIC_PALETTE.panel, 0.98);
    dg.fillRoundedRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, 26);
    dg.lineStyle(5, GENERIC_PALETTE.panelBorder, 1);
    dg.strokeRoundedRect(cx - boxW / 2, cy - boxH / 2, boxW, boxH, 26);

    // Typed text, wrapped within the box, anchored toward the top of the box.
    const body = this.add
      .text(cx, cy - boxH / 2 + 40, '', {
        fontFamily: 'sans-serif', fontSize: '28px', color: '#ffffff', align: 'center',
        wordWrap: { width: boxW - 80 },
        stroke: '#000000', strokeThickness: 3,
      })
      .setOrigin(0.5, 0)
      .setDepth(12);

    // Letter-by-letter reveal.
    let shown = 0;
    this.typing = this.time.addEvent({
      delay: 28,
      loop: true,
      callback: () => {
        shown += 1;
        body.setText(INTRO_TEXT.slice(0, shown));
        if (shown >= INTRO_TEXT.length) this.typing?.remove();
      },
    });

    // Continue button (same doodle look as the menu). First click finishes the
    // typing; next click goes to the menu.
    const by = cy + boxH / 2 - 44;
    const btn = doodleButton(
      this, cx, by, 240, 64, 'Continue',
      GENERIC_PALETTE.primary, GENERIC_PALETTE.primaryHover, GENERIC_PALETTE.panelBorder,
      () => {
        if (shown < INTRO_TEXT.length) {
          this.typing?.remove();
          body.setText(INTRO_TEXT);
          shown = INTRO_TEXT.length;
        } else {
          this.goToMenu();
        }
      },
      28,
    );
    btn.container.setDepth(13);
  }

  private goToMenu(): void {
    this.typing?.remove();
    markIntroSeen();
    this.scene.start('Menu');
  }
}

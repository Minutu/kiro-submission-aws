// Start screen — the very first thing shown when the game loads.
//
// Shows the title logo over a light-sky gradient with World 1 clouds drifting
// across in parallax. A pulsing "Click to start" prompt sits below the logo.
// On click (or Space): if the opening cinematic was already seen, go straight
// to the Menu; otherwise play the Intro cinematic first.

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './config.ts';
import { hasSeenIntro } from './progression.ts';
import { loadMusic, startMusic } from './music.ts';

/** One drifting cloud in the parallax layer. */
interface Cloud {
  img: Phaser.GameObjects.Image;
  speed: number; // px/s
}

export class StartScreen extends Phaser.Scene {
  private clouds: Cloud[] = [];

  constructor() {
    super('Start');
  }

  preload(): void {
    this.load.image('start-logo', 'assets/Start-Menu/start-screen.png');
    this.load.image('start-cloud-1', 'assets/world 1/cloud-1.png');
    this.load.image('start-cloud-2', 'assets/world 1/cloud-2.png');
    loadMusic(this);
  }

  create(): void {
    this.clouds = [];

    // Light-sky gradient: soft blue at the top easing to a pale near-white at
    // the bottom.
    const sky = this.add.graphics().setDepth(0);
    const top = 0x6fb7ec;    // light sky blue
    const bottom = 0xdff0fb; // pale, almost white
    sky.fillGradientStyle(top, top, bottom, bottom, 1);
    sky.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Drifting parallax clouds (World 1 art), a mix of sizes and speeds.
    const keys = ['start-cloud-1', 'start-cloud-2'];
    for (let i = 0; i < 7; i++) {
      const key = keys[i % 2]!;
      const x = Phaser.Math.Between(0, GAME_WIDTH);
      const y = Phaser.Math.Between(40, GAME_HEIGHT * 0.65);
      const scale = Phaser.Math.FloatBetween(0.18, 0.5);
      const img = this.add
        .image(x, y, key)
        .setDepth(1)
        .setScale(scale)
        .setAlpha(0.9);
      img.setFlipX(Math.random() < 0.5);
      this.clouds.push({ img, speed: Phaser.Math.FloatBetween(10, 30) });
    }

    // Title logo. The 1080x1080 art has its content in the upper-center, so
    // scale it to fit comfortably and sit it slightly above the vertical
    // middle, leaving room for the prompt below.
    const logo = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT * 0.42, 'start-logo').setDepth(5);
    const scale = (GAME_WIDTH * 0.92) / logo.width;
    logo.setScale(scale);

    // "Click to start" prompt below the logo artwork. It pulses (grows then
    // shrinks) on a loop to draw attention.
    const prompt = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT * 0.72, 'Click to start', {
        fontFamily: 'sans-serif',
        fontSize: '52px',
        color: '#ffffff',
        fontStyle: 'bold',
        stroke: '#1d2b4a',
        strokeThickness: 8,
      })
      .setOrigin(0.5)
      .setDepth(6);
    this.tweens.add({
      targets: prompt,
      scale: { from: 1, to: 1.22 },
      duration: 650,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.inOut',
    });

    // Start the looping music right away. Browsers block audio autoplay until a
    // user gesture, so if the audio context is still locked we also start it
    // the moment it unlocks (first interaction anywhere).
    startMusic(this);
    if (this.sound.locked) {
      this.sound.once(Phaser.Sound.Events.UNLOCKED, () => startMusic(this));
    }

    // Start on click or Space.
    const go = () => this.begin();
    this.input.once('pointerdown', go);
    this.input.keyboard?.once('keydown-SPACE', go);
  }

  private begin(): void {
    // Music was started on load; ensure it's going in case autoplay was blocked
    // until this gesture.
    startMusic(this);
    // Already saw the opening cinematic -> straight to the menu. Otherwise play
    // the intro, which marks itself seen and then goes to the menu.
    this.scene.start(hasSeenIntro() ? 'Menu' : 'Intro');
  }

  update(_time: number, delta: number): void {
    const dt = delta / 1000;
    for (const c of this.clouds) {
      c.img.x -= c.speed * dt;
      const w = c.img.displayWidth;
      if (c.img.x < -w) {
        c.img.x = GAME_WIDTH + w;
        c.img.y = Phaser.Math.Between(40, GAME_HEIGHT * 0.65);
      }
    }
  }
}

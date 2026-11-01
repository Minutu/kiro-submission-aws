// Blurred parallax backdrop for the Main Menu.
//
// Reproduces the "flight" look of the LATEST unlocked world (the same world the
// menu's palette already follows): a vertical sky gradient, a few scrolling
// parallax dune layers (far -> near), and an optional static moon.
//
// PERFORMANCE: the blur is applied ONCE to the whole backdrop, not per object.
// This runs as its own Scene (MenuBgScene) launched *under* the menu, and a
// single camera-level postFX blur blurs the entire composited frame in one
// pass. (The earlier version added a multi-pass blur shader to every dune
// panel + the sky + the moon, which tanked the frame rate.)

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, GROUND_Y } from './config.ts';

/** A description of one world's flight backdrop, used to build the menu bg. */
interface MenuBgSpec {
  /** Sky gradient top + bottom colors. */
  skyTop: number;
  skyBottom: number;
  /** Dune image file paths, far -> near. */
  duneFiles: string[];
  /** Optional static moon image file path. */
  moonFile?: string;
  /** Moon horizontal center as a fraction of width (default 0.72). */
  moonXFrac?: number;
}

// Per-world flight backdrops. World 1 is the desert ground runner (its own
// gradient + dunes); worlds 2-5 mirror each theme's flight sky + dunes + moon.
const SPECS: Record<number, MenuBgSpec> = {
  1: {
    skyTop: 0x5aa9e6,
    skyBottom: 0xf4c87a,
    duneFiles: [
      'assets/world 1/bg-layer-2.png',
      'assets/world 1/bg-layer-1.png',
      'assets/world 1/bg-layer-0.png',
    ],
  },
  2: {
    skyTop: 0x1a0505,
    skyBottom: 0xd8663a,
    duneFiles: [
      'assets/world 2/bg-2.png',
      'assets/world 2/bg-1.png',
      'assets/world 2/bg-0.png',
    ],
    moonFile: 'assets/world 2/bg-moon.png',
    moonXFrac: 0.72,
  },
  3: {
    skyTop: 0x0b1030,
    skyBottom: 0xe6803a,
    duneFiles: [
      'assets/world 3/bg-2.png',
      'assets/world 3/bg-1.png',
      'assets/world 3/bg-0.png',
    ],
    moonFile: 'assets/world 3/bg-moon-jungle.png',
    moonXFrac: 0.25,
  },
  4: {
    skyTop: 0x4a90d9,
    skyBottom: 0xbfe3f7,
    duneFiles: [
      'assets/world 4/bg-2.png',
      'assets/world 4/bg-1.png',
      'assets/world 4/bg-0.png',
    ],
    moonFile: 'assets/world 4/bg-moon-ice.png',
    moonXFrac: 0.8,
  },
  5: {
    skyTop: 0x3a0808,
    skyBottom: 0xe85a7a,
    duneFiles: [
      'assets/world 5/bg-3.png',
      'assets/world 5/bg-2.png',
      'assets/world 5/bg-1.png',
      'assets/world 5/bg-0.png',
    ],
    moonFile: 'assets/world 5/bg-4.png',
    moonXFrac: 0.5,
  },
};

interface MenuLayer {
  panels: Phaser.GameObjects.Image[];
  panelWidth: number;
  speed: number;
}

/** Blur amount; one shader pass over the whole scene. */
const BLUR_STRENGTH = 2;
/** Black dimming overlay alpha, to push the backdrop back behind the UI. */
const DIM_ALPHA = 0.45;
/** World-scroll speed (px/s) the auto-scrolling backdrop drifts at. */
const SCROLL_SPEED = 42;

/** Scene key for the shared menu backdrop scene. */
export const MENU_BG_SCENE_KEY = 'MenuBg';

/**
 * A lightweight background scene: builds + scrolls the parallax, and blurs its
 * own camera once. Launched under the Menu scene, which controls which world's
 * backdrop to show via init({ worldNum }).
 */
export class MenuBgScene extends Phaser.Scene {
  private layers: MenuLayer[] = [];
  private worldNum = 1;
  private keyPrefix = 'menu-bg-w1';

  constructor() {
    super(MENU_BG_SCENE_KEY);
  }

  init(data: { worldNum?: number }): void {
    this.worldNum = data.worldNum ?? 1;
    this.keyPrefix = `menu-bg-w${this.worldNum}`;
    this.layers = [];
  }

  preload(): void {
    const spec = SPECS[this.worldNum] ?? SPECS[1]!;
    spec.duneFiles.forEach((file, i) => {
      this.load.image(`${this.keyPrefix}-dune${i}`, file);
    });
    if (spec.moonFile) {
      this.load.image(`${this.keyPrefix}-moon`, spec.moonFile);
    }
  }

  create(): void {
    const spec = SPECS[this.worldNum] ?? SPECS[1]!;

    // Sky gradient, filling the whole screen.
    const sky = this.add.graphics();
    sky.fillGradientStyle(spec.skyTop, spec.skyTop, spec.skyBottom, spec.skyBottom, 1);
    sky.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Static moon (if any): top touching the ceiling, offset horizontally.
    if (spec.moonFile) {
      const moon = this.add
        .image(GAME_WIDTH * (spec.moonXFrac ?? 0.72), 0, `${this.keyPrefix}-moon`)
        .setOrigin(0.5, 0);
      moon.setScale(Math.min(1, (GAME_WIDTH * 0.3) / moon.width));
    }

    // Parallax dune layers, matching the in-game sizing: the NEAREST layer
    // (bg-0, last in the far->near list) is the SHORTEST, and layers get
    // progressively taller the FARTHER back they are. Nearer layers also
    // scroll faster.
    const farFrac = 0.62;  // tallest (farthest layer)
    const nearFrac = 0.22; // shortest (nearest layer, bg-0)
    const n = spec.duneFiles.length;
    spec.duneFiles.forEach((_file, i) => {
      // t: 0 at the farthest layer -> 1 at the nearest.
      const t = n === 1 ? 1 : i / (n - 1);
      const heightFrac = farFrac + t * (nearFrac - farFrac);
      const speed = 0.2 + t * 0.6;
      this.layers.push(this.buildLayer(`${this.keyPrefix}-dune${i}`, speed, heightFrac));
    });

    // Dark semi-transparent overlay so the backdrop sits quietly behind the
    // menu UI rather than competing with it. Drawn over the parallax but still
    // within this (below-menu) scene.
    this.add.rectangle(
      GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x000000, DIM_ALPHA,
    );

    // Single blur over the whole backdrop camera (one pass per frame), instead
    // of one blur per object. postFX exists on WebGL; on Canvas it's a no-op.
    this.cameras.main.postFX?.addBlur(0, 2, 2, BLUR_STRENGTH, 0xffffff, 4);
  }

  private buildLayer(key: string, speed: number, heightFrac: number): MenuLayer {
    const src = this.textures.get(key).getSourceImage();
    const targetH = GROUND_Y * heightFrac;
    const scale = targetH / src.height;
    const panelWidth = src.width * scale;
    const count = Math.ceil(GAME_WIDTH / panelWidth) + 2;

    const panels: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < count; i++) {
      // Anchor at the very bottom of the screen (menu only) so the dune art
      // touches the bottom edge, with no sky gap beneath it.
      const img = this.add
        .image(i * panelWidth, GAME_HEIGHT, key)
        .setOrigin(0, 1)
        .setScale(scale);
      img.setFlipX(i % 2 === 1);
      img.setData('col', i);
      panels.push(img);
    }
    return { panels, panelWidth, speed };
  }

  update(_time: number, delta: number): void {
    const dx = SCROLL_SPEED * (delta / 1000);
    for (const layer of this.layers) {
      const pw = layer.panelWidth;
      for (const p of layer.panels) {
        p.x -= dx * layer.speed;
        if (p.x <= -pw) {
          p.x += pw * layer.panels.length;
          const col = (p.getData('col') as number) + layer.panels.length;
          p.setData('col', col);
          p.setFlipX(col % 2 === 1);
        }
      }
    }
  }
}

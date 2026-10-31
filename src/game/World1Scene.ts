// Minimal rebuild — World 1 gameplay (Chrome-dino style ground runner).
//
// Kino runs at a fixed x on the ground. Obstacles slide in from the right along
// the ground; jump over them. Rules, matching the request:
//   1. Start standing on the ground.
//   2. A click/tap/Space makes Kino jump up; gravity brings it back down.
//   3. You can ONLY jump while grounded. Must land before jumping again
//      (no double/triple jump), enforced by an `onGround` flag.
//   4. Obstacles are ground-based, varied in size and spacing (not regular).
//   5. Tuned speed/physics come from config.

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, GROUND_Y, WORLD1 } from './config.ts';
import { HatSprite, loadHatAssets } from './cosmetics.ts';
import { SkillRuntime } from './skills.ts';
import { PauseController } from './pause.ts';

interface Obstacle {
  /** Image sprite (collision uses its display width/height). */
  spr: Phaser.GameObjects.Image;
  scored: boolean;
}

/** One parallax layer: a strip of panels scrolled and wrapped horizontally. */
interface ParallaxLayer {
  panels: Phaser.GameObjects.Image[];
  panelWidth: number;
  speed: number; // px of background travel per px of world scroll
  offset: number;
}

const ASSET_DIR = 'assets/world 1';

export class World1Scene extends Phaser.Scene {
  private bird!: Phaser.GameObjects.Image;
  private birdScale = 1;
  private runFrameTimer = 0;
  private runFrame = 0;
  private hat!: HatSprite;
  private skill!: SkillRuntime;
  private pauseCtl!: PauseController;
  private get paused(): boolean { return this.pauseCtl?.isPaused() ?? false; }
  private vy = 0;
  private onGround = true;
  private obstacles: Obstacle[] = [];
  private distanceToNextSpawn = 0;
  private score = 0;
  private scoreText!: Phaser.GameObjects.Text;
  private started = false;
  private dead = false;

  private layers: ParallaxLayer[] = [];
  private clouds: { img: Phaser.GameObjects.Image; speed: number }[] = [];

  constructor() {
    super('World1');
  }

  preload(): void {
    this.load.image('w1-bg0', `${ASSET_DIR}/bg-layer-0.png`);
    this.load.image('w1-bg1', `${ASSET_DIR}/bg-layer-1.png`);
    this.load.image('w1-bg2', `${ASSET_DIR}/bg-layer-2.png`);
    this.load.image('w1-cloud1', `${ASSET_DIR}/cloud-1.png`);
    this.load.image('w1-cloud2', `${ASSET_DIR}/cloud-2.png`);
    this.load.image('w1-obstacle', `${ASSET_DIR}/obstacle-1.png`);
    // Kino run/jump/death frames.
    this.load.image('kino-run-0', 'assets/animation/run-0.png');
    this.load.image('kino-run-1', 'assets/animation/run-1.png');
    this.load.image('kino-midair', 'assets/animation/mid-air-0.png');
    this.load.image('kino-dead', 'assets/kino-dead.png');
    loadHatAssets(this);
  }

  create(): void {
    // Reset per-run state (scene.start reuses the instance).
    this.vy = 0;
    this.onGround = true;
    this.obstacles = [];
    this.distanceToNextSpawn = WORLD1.spawnSpacing;
    this.score = 0;
    this.started = false;
    this.dead = false;
    this.layers = [];
    this.clouds = [];

    // Desert background: gradient sky, clouds, and parallax dune layers.
    this.buildBackground();

    // Ground strip (dark orange/brown). GROUND_Y is its top edge. Above all
    // background layers (sky 0, clouds 1, dunes 2-4).
    const groundHeight = GAME_HEIGHT - GROUND_Y;
    this.add.rectangle(GAME_WIDTH / 2, GROUND_Y + groundHeight / 2, GAME_WIDTH, groundHeight, 0x6b3410)
      .setDepth(6);
    this.add.rectangle(GAME_WIDTH / 2, GROUND_Y, GAME_WIDTH, 5, 0x3a1c08).setDepth(6);

    // Kino — a sprite resting with its bottom on the ground line. Scaled so its
    // height roughly matches the collision box; collision still uses the fixed
    // config box centered on the sprite, so the hitbox is unaffected by art.
    this.runFrameTimer = 0;
    this.runFrame = 0;
    const kinoSrc = this.textures.get('kino-run-0').getSourceImage();
    this.birdScale = (WORLD1.birdHeight * 1.4) / kinoSrc.height;
    this.bird = this.add
      .image(WORLD1.birdX, GROUND_Y - WORLD1.birdHeight / 2, 'kino-run-0')
      .setScale(this.birdScale)
      .setDepth(8);

    // Equipped cosmetic hat (purely visual; never affects collision).
    this.hat = new HatSprite(this, 74, 9, 30);
    this.updateHat();

    // Equipped super power — usable only while the run is active (started,
    // not dead, not paused).
    this.skill = new SkillRuntime(this, () => this.started && !this.dead && !this.paused);

    // Pause button + overlay (freezes the run; shows score + time).
    this.pauseCtl = new PauseController(
      this,
      () => this.score,
      () => this.started && !this.dead,
      () => !this.dead,
    );

    // Score.
    this.scoreText = this.add
      .text(GAME_WIDTH - 40, 50, '0', {
        fontFamily: 'monospace',
        fontSize: '56px',
        color: '#333333',
        fontStyle: 'bold',
      })
      .setOrigin(1, 0.5)
      .setDepth(10);

    const hint = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT * 0.35, 'Click or Space to jump', {
        fontFamily: 'sans-serif',
        fontSize: '40px',
        color: '#333333',
      })
      .setOrigin(0.5)
      .setDepth(10);

    // --- Input: reliable, scene-wide -------------------------------------
    const jump = () => {
      if (hint.active) hint.setVisible(false);
      this.jump();
    };
    // Only the LEFT mouse button jumps; right-click is reserved for skills.
    // Skip the jump when the click lands on the pause button (or while paused).
    const onPointer = (p: Phaser.Input.Pointer) => {
      if (this.pauseCtl.hitsButton(p)) return;
      if (p.leftButtonDown()) jump();
    };
    this.input.on('pointerdown', onPointer);
    this.input.keyboard?.on('keydown-SPACE', jump);
    this.input.keyboard?.on('keydown-UP', jump);
    // Esc is handled by the PauseController (opens the pause menu).

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off('pointerdown', onPointer);
      this.input.keyboard?.off('keydown-SPACE', jump);
      this.input.keyboard?.off('keydown-UP', jump);
    });
  }

  // -- background -----------------------------------------------------------

  private buildBackground(): void {
    // Sky: vertical gradient from golden yellow (bottom) to clear blue (top).
    const sky = this.add.graphics().setDepth(0);
    const top = 0x5aa9e6;   // clear blue
    const bottom = 0xf4c87a; // golden yellow
    sky.fillGradientStyle(top, top, bottom, bottom, 1);
    sky.fillRect(0, 0, GAME_WIDTH, GROUND_Y + 40);

    // Clouds (depth 1): a handful, each randomly mirrored on X and/or Y so the
    // two source images read as many. Slow parallax.
    const cloudKeys = ['w1-cloud1', 'w1-cloud2'];
    for (let i = 0; i < 6; i++) {
      const key = cloudKeys[i % 2]!;
      const x = Phaser.Math.Between(0, GAME_WIDTH);
      const y = Phaser.Math.Between(40, GROUND_Y * 0.5);
      // Mostly small clouds, with an occasional big one.
      const cloudScale = Math.random() < 0.2
        ? Phaser.Math.FloatBetween(0.35, 0.55) // ~20% big
        : Phaser.Math.FloatBetween(0.12, 0.25); // small (majority)
      const img = this.add
        .image(x, y, key)
        .setDepth(1)
        .setScale(cloudScale)
        .setAlpha(0.9);
      img.setFlipX(Math.random() < 0.5);
      img.setFlipY(Math.random() < 0.5);
      this.clouds.push({ img, speed: Phaser.Math.FloatBetween(0.05, 0.12) });
    }

    // Parallax dune layers. Farthest/largest (bg-layer-2) scrolls slowest and
    // sits lowest in the depth order; nearest/smallest (bg-layer-0) scrolls
    // fastest. Each layer is a strip of panels placed A, A-mirrored, A, ...
    // using setFlipX on alternate panels (no texture generation needed).
    // bg-0 is the nearest (fastest, in front) but now the SHORTEST; bg-1 and
    // bg-2 are progressively taller behind it, so tall far dunes rise behind
    // the short near ridge.
    this.layers.push(this.buildLayer('w1-bg2', 2, 0.15, GROUND_Y, 0.62));
    this.layers.push(this.buildLayer('w1-bg1', 3, 0.30, GROUND_Y, 0.42));
    this.layers.push(this.buildLayer('w1-bg0', 4, 0.55, GROUND_Y, 0.22));
  }

  /**
   * Build one parallax layer: enough panels to cover the screen plus one, each
   * anchored at the bottom (so dunes sit on the horizon), with alternating
   * horizontal mirroring for the A / A-mirrored / A pattern.
   */
  private buildLayer(
    key: string, depth: number, speed: number, bottomY: number, heightFrac: number,
  ): ParallaxLayer {
    const src = this.textures.get(key).getSourceImage();
    const srcW = src.width;
    const srcH = src.height;
    const targetH = GROUND_Y * heightFrac;
    const scale = targetH / srcH;
    const panelWidth = srcW * scale;

    const count = Math.ceil(GAME_WIDTH / panelWidth) + 2;
    const panels: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < count; i++) {
      const img = this.add
        .image(i * panelWidth, bottomY, key)
        .setOrigin(0, 1) // bottom-left anchor so dunes meet the ground line
        .setScale(scale)
        .setDepth(depth);
      // Flip is tied to the VIRTUAL COLUMN index (i here), and stays tied to it
      // as the panel recycles — so a given stretch of terrain never changes
      // orientation while scrolling (the A, A-mirrored, A pattern is stable).
      img.setFlipX(i % 2 === 1);
      img.setData('col', i);
      panels.push(img);
    }
    return { panels, panelWidth, speed, offset: 0 };
  }

  /** Scroll parallax layers + clouds by a world-scroll amount dx. */
  private scrollBackground(dx: number): void {
    for (const layer of this.layers) {
      const pw = layer.panelWidth;
      for (const p of layer.panels) {
        p.x -= dx * layer.speed;
        // Recycle: when a panel is fully off the left, move it to the right end
        // and advance its virtual column by the panel count, preserving the
        // alternating flip parity for that column.
        if (p.x <= -pw) {
          p.x += pw * layer.panels.length;
          const col = (p.getData('col') as number) + layer.panels.length;
          p.setData('col', col);
          p.setFlipX(col % 2 === 1);
        }
      }
    }
    for (const cloud of this.clouds) {
      cloud.img.x -= dx * cloud.speed;
      const w = cloud.img.displayWidth;
      if (cloud.img.x < -w) {
        cloud.img.x = GAME_WIDTH + w;
        cloud.img.y = Phaser.Math.Between(40, GROUND_Y * 0.5);
      }
    }
  }

  /** Jump only when grounded. This is the no-double-jump rule. */
  private jump(): void {
    if (this.dead) {
      this.scene.restart();
      return;
    }
    this.started = true;
    if (this.onGround) {
      this.vy = WORLD1.jumpVelocity;
      this.onGround = false;
    }
  }

  private updateHat(): void {
    // Top of Kino's head; hat is visual only, no collision impact.
    this.hat.update(this.bird.x, this.bird.y - WORLD1.birdHeight / 2);
  }

  update(_time: number, delta: number): void {
    if (this.dead) { this.updateHat(); return; }
    this.pauseCtl.tick(delta);
    // Frozen while paused: no simulation, no skill timers.
    if (this.paused) return;
    const timeScale = this.skill.tick(delta);
    const dt = (delta / 1000) * timeScale;

    // Vertical motion: integrate gravity, then clamp to the ground.
    if (!this.onGround) {
      this.vy += WORLD1.gravity * dt;
      this.bird.y += this.vy * dt;

      const restY = GROUND_Y - WORLD1.birdHeight / 2;
      if (this.bird.y >= restY) {
        this.bird.y = restY;
        this.vy = 0;
        this.onGround = true;
      }
    }

    // Scroll + spawn obstacles only once the run has started.
    if (this.started) {
      const dx = WORLD1.scrollSpeed * dt;
      this.scrollBackground(dx);
      this.distanceToNextSpawn -= dx;
      if (this.distanceToNextSpawn <= 0) {
        this.spawnObstacle();
        const jitter = Phaser.Math.Between(
          -WORLD1.spawnSpacingJitter,
          WORLD1.spawnSpacingJitter,
        );
        this.distanceToNextSpawn = WORLD1.spawnSpacing + jitter;
      }
      this.moveObstacles(dx);
    }

    this.updateKinoAnimation(dt);
    this.updateHat();
    this.checkCollisions();
  }

  /** Swap Kino's frame: mid-air while jumping, alternating run frames while
   * grounded and running. (Death frame is set in die().) */
  private updateKinoAnimation(dt: number): void {
    if (!this.onGround) {
      this.setKinoFrame('kino-midair');
      return;
    }
    if (this.started) {
      this.runFrameTimer += dt;
      if (this.runFrameTimer >= 0.15) {
        this.runFrameTimer = 0;
        this.runFrame = this.runFrame === 0 ? 1 : 0;
      }
      this.setKinoFrame(this.runFrame === 0 ? 'kino-run-0' : 'kino-run-1');
    } else {
      this.setKinoFrame('kino-run-0');
    }
  }

  private setKinoFrame(key: string): void {
    if (this.bird.texture.key !== key) {
      this.bird.setTexture(key).setScale(this.birdScale);
    }
  }

  private spawnObstacle(): void {
    // Variant of obstacle-1: random size within the config range, and a random
    // mirror along the Y AXIS (a horizontal left/right flip = setFlipX). No
    // vertical flip, so the obstacle always stands upright on the ground.
    const h = Phaser.Math.Between(WORLD1.obstacleMinHeight, WORLD1.obstacleMaxHeight);
    const src = this.textures.get('w1-obstacle').getSourceImage();
    const scale = h / src.height;
    const w = src.width * scale;
    const x = GAME_WIDTH + w;

    const spr = this.add
      .image(x, GROUND_Y, 'w1-obstacle')
      .setOrigin(0.5, 1) // bottom sits on the ground line
      .setScale(scale)
      .setDepth(7);
    spr.setFlipX(Math.random() < 0.5); // mirror along the y axis only

    this.obstacles.push({ spr, scored: false });
  }

  private moveObstacles(dx: number): void {
    for (const ob of this.obstacles) {
      ob.spr.x -= dx;
      const halfW = ob.spr.displayWidth / 2;
      if (!ob.scored && ob.spr.x + halfW < WORLD1.birdX - WORLD1.birdWidth / 2) {
        ob.scored = true;
        this.score += 1;
        this.scoreText.setText(String(this.score));
        this.skill.notifyObstacleCleared();
      }
    }

    const alive: Obstacle[] = [];
    for (const ob of this.obstacles) {
      if (ob.spr.x < -ob.spr.displayWidth) {
        ob.spr.destroy();
      } else {
        alive.push(ob);
      }
    }
    this.obstacles = alive;
  }

  private checkCollisions(): void {
    const bl = this.bird.x - WORLD1.birdWidth / 2;
    const br = this.bird.x + WORLD1.birdWidth / 2;
    const bt = this.bird.y - WORLD1.birdHeight / 2;
    const bb = this.bird.y + WORLD1.birdHeight / 2;

    let hitObstacle: Obstacle | null = null;
    for (const ob of this.obstacles) {
      const halfW = ob.spr.displayWidth / 2;
      const ol = ob.spr.x - halfW;
      const or = ob.spr.x + halfW;
      // Sprite origin is (0.5, 1): y is the bottom, top is y - displayHeight.
      const obt = ob.spr.y;                       // bottom
      const ot = ob.spr.y - ob.spr.displayHeight; // top
      // A forgiving hitbox: shrink the sprite box slightly so near-misses pass.
      const pad = 6;
      if (bl < or - pad && br > ol + pad && bt < obt - pad && bb > ot + pad) {
        hitObstacle = ob;
        break;
      }
    }

    if (hitObstacle === null) {
      // No overlap: if we were phasing through an object, it's now cleared.
      if (this.skill.isPhaseActive()) this.skill.notifyPhasedObjectCleared();
      return;
    }

    // Second Chance: phase through (stays phasing until the object clears).
    if (this.skill.tryPhase()) return;
    // Ultra Instinct: teleport Kino UP along the y axis to clear the obstacle.
    if (this.skill.isUltraActive()) {
      const obstacleTop = hitObstacle.spr.y - hitObstacle.spr.displayHeight;
      this.bird.y = obstacleTop - WORLD1.birdHeight / 2 - 8;
      this.vy = 0;
      this.onGround = false;
      return;
    }
    this.die();
  }

  private die(): void {
    if (this.dead) return;
    this.dead = true;
    this.bird.setTexture('kino-dead').setScale(this.birdScale);

    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Game Over\nScore: ' + this.score + '\nClick to retry  -  Esc for menu', {
        fontFamily: 'sans-serif',
        fontSize: '56px',
        color: '#333333',
        align: 'center',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(20);
  }
}

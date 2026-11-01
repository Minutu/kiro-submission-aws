// Minimal rebuild — World 2 gameplay (classic Flappy Bird).
//
// Gravity constantly pulls the bird down. Every click/tap/Space applies a fixed
// upward flap (this is real Flappy — you may flap repeatedly mid-air). Fly
// through the gaps in pairs of pipes. Hitting a pipe, the ground, or the
// ceiling ends the run.

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, WORLD2 } from './config.ts';
import { HatSprite, loadHatAssets } from './cosmetics.ts';
import { SkillRuntime } from './skills.ts';
import { PauseController } from './pause.ts';
import { maybeUnlockAndToast, worldNumberFromKey } from './progression.ts';
import { paletteForWorld } from './uiTheme.ts';
import { addText } from './ui.ts';
import { loadJumpSfx, playJumpSfx } from './music.ts';

interface Pipe {
  top: Phaser.GameObjects.Image;    // ceiling pillar (pillar-up)
  bottom: Phaser.GameObjects.Image; // ground pillar (pillar-ground)
  scored: boolean;
}

/** One parallax layer: a strip of panels scrolled and wrapped horizontally. */
interface ParallaxLayer {
  panels: Phaser.GameObjects.Image[];
  panelWidth: number;
  speed: number;
}

const GROUND_H = 40;
const W2_DIR = 'assets/world 2';

export class World2Scene extends Phaser.Scene {
  private bird!: Phaser.GameObjects.Image;
  private birdScale = 1;
  private hat!: HatSprite;
  private skill!: SkillRuntime;
  private pauseCtl!: PauseController;
  private get paused(): boolean { return this.pauseCtl?.isPaused() ?? false; }
  private vy = 0;
  private pipes: Pipe[] = [];
  private distanceToNextSpawn = 0;
  private score = 0;
  private scoreText!: Phaser.GameObjects.Text;
  private started = false;
  private dead = false;

  private layers: ParallaxLayer[] = [];
  private clouds: { img: Phaser.GameObjects.Image; speed: number }[] = [];

  constructor() {
    super('World2');
  }

  preload(): void {
    loadHatAssets(this);
    this.load.image('w2-bg0', `${W2_DIR}/bg-0.png`);
    this.load.image('w2-bg1', `${W2_DIR}/bg-1.png`);
    this.load.image('w2-bg2', `${W2_DIR}/bg-2.png`);
    this.load.image('w2-cloud0', `${W2_DIR}/cloud-0.png`);
    this.load.image('w2-cloud2', `${W2_DIR}/cloud-2.png`);
    this.load.image('w2-moon', `${W2_DIR}/bg-moon.png`);
    this.load.image('kino-fly', 'assets/animation/fly-0.png');
    this.load.image('kino-fall', 'assets/animation/fall-0.png');
    this.load.image('kino-dead', 'assets/kino-dead.png');
    this.load.image('w2-pillar-ground', `${W2_DIR}/pillar-ground.png`);
    this.load.image('w2-pillar-up', `${W2_DIR}/pillar-up.png`);
    loadJumpSfx(this);
  }

  create(): void {
    this.vy = 0;
    this.pipes = [];
    this.distanceToNextSpawn = WORLD2.spawnSpacing;
    this.score = 0;
    this.started = false;
    this.dead = false;
    this.layers = [];
    this.clouds = [];

    // Foundry background: fiery gradient sky, clouds, and parallax layers.
    this.buildBackground();

    // Ground strip (dark red). Above the background layers.
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - GROUND_H / 2, GAME_WIDTH, GROUND_H, 0x5a1010)
      .setDepth(6);
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - GROUND_H, GAME_WIDTH, 4, 0x2a0606).setDepth(6);

    // Kino — flight sprite. Collision still uses the config circle radius
    // centered on the sprite, so the hitbox is unaffected by the art.
    const flySrc = this.textures.get('kino-fly').getSourceImage();
    this.birdScale = (WORLD2.birdRadius * 2 * 1.5) / flySrc.height;
    this.bird = this.add
      .image(WORLD2.birdX, GAME_HEIGHT / 2, 'kino-fly')
      .setScale(this.birdScale)
      .setDepth(8);

    // Equipped cosmetic hat (visual only; never affects collision).
    this.hat = new HatSprite(this, 74, 9, 30);
    this.updateHat();

    // Equipped super power — usable only while the run is active.
    this.skill = new SkillRuntime(this, () => this.started && !this.dead && !this.paused);

    // Pause button + overlay.
    this.pauseCtl = new PauseController(
      this,
      () => this.score,
      () => this.started && !this.dead,
      () => !this.dead,
      paletteForWorld(2),
      () => this.dead,
    );

    this.scoreText = addText(this, GAME_WIDTH / 2, 70, '0', { fontSize: 64 }).setDepth(12);

    // Movement-mode label (World 2 is always Flight).
    addText(this, GAME_WIDTH / 2, 128, 'FLIGHT', { fontSize: 28 }).setDepth(12);

    const hint = addText(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.4, 'Click or Space to flap', {
      fontSize: 36,
    }).setDepth(12);

    const flap = () => {
      if (hint.active) hint.setVisible(false);
      this.flap();
    };
    // Only the LEFT mouse button flaps; right-click is reserved for skills.
    // Skip the flap when the click lands on the pause button (or while paused).
    const onPointer = (p: Phaser.Input.Pointer) => {
      if (this.pauseCtl.hitsButton(p)) return;
      if (p.leftButtonDown()) flap();
    };
    this.input.on('pointerdown', onPointer);
    this.input.keyboard?.on('keydown-SPACE', flap);
    this.input.keyboard?.on('keydown-UP', flap);
    // Esc is handled by the PauseController (opens the pause menu).

    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off('pointerdown', onPointer);
      this.input.keyboard?.off('keydown-SPACE', flap);
      this.input.keyboard?.off('keydown-UP', flap);
    });
  }

  // -- background -----------------------------------------------------------

  private buildBackground(): void {
    const groundY = GAME_HEIGHT - GROUND_H;

    // Sky: gradient from pale orange-red (bottom) to dark red/black (top).
    const sky = this.add.graphics().setDepth(0);
    const topCol = 0x1a0505;    // dark red / near-black
    const bottomCol = 0xd8663a; // pale orange-red
    sky.fillGradientStyle(topCol, topCol, bottomCol, bottomCol, 1);
    sky.fillRect(0, 0, GAME_WIDTH, groundY + 40);

    // Static moon, top-right-ish and inset from the edges, behind clouds/dunes.
    const moon = this.add
      .image(GAME_WIDTH * 0.78, GAME_HEIGHT * 0.2, 'w2-moon')
      .setOrigin(0.5, 0.5)
      .setDepth(1);
    moon.setScale(Math.min(1, (GAME_WIDTH * 0.28) / moon.width));
    // Soften just the moon with a very light blur.
    moon.postFX.addBlur(0, 1, 1, 0.4, 0xffffff, 2);

    // Clouds (smoke/ember clouds), mostly small with the occasional big one.
    const cloudKeys = ['w2-cloud0', 'w2-cloud2'];
    for (let i = 0; i < 6; i++) {
      const key = cloudKeys[i % 2]!;
      const x = Phaser.Math.Between(0, GAME_WIDTH);
      const y = Phaser.Math.Between(40, groundY * 0.5);
      const cloudScale = Math.random() < 0.2
        ? Phaser.Math.FloatBetween(0.35, 0.55)
        : Phaser.Math.FloatBetween(0.12, 0.25);
      const img = this.add.image(x, y, key).setDepth(2).setScale(cloudScale).setAlpha(0.85);
      img.setFlipX(Math.random() < 0.5);
      img.setFlipY(Math.random() < 0.5);
      this.clouds.push({ img, speed: Phaser.Math.FloatBetween(0.05, 0.12) });
    }

    // Parallax layers: bg-2 farthest/slowest/tallest behind, bg-0 nearest/
    // fastest/shortest in front — same A, A-mirrored, A pattern as World 1.
    this.layers.push(this.buildLayer('w2-bg2', 3, 0.15, groundY, 0.62));
    this.layers.push(this.buildLayer('w2-bg1', 4, 0.30, groundY, 0.42));
    this.layers.push(this.buildLayer('w2-bg0', 5, 0.55, groundY, 0.22));
  }

  private buildLayer(
    key: string, depth: number, speed: number, bottomY: number, heightFrac: number,
  ): ParallaxLayer {
    const src = this.textures.get(key).getSourceImage();
    const targetH = bottomY * heightFrac;
    const scale = targetH / src.height;
    const panelWidth = src.width * scale;

    const count = Math.ceil(GAME_WIDTH / panelWidth) + 2;
    const panels: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < count; i++) {
      const img = this.add
        .image(i * panelWidth, bottomY, key)
        .setOrigin(0, 1)
        .setScale(scale)
        .setDepth(depth);
      img.setFlipX(i % 2 === 1);
      img.setData('col', i);
      panels.push(img);
    }
    return { panels, panelWidth, speed };
  }

  private scrollBackground(dx: number): void {
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
    const groundY = GAME_HEIGHT - GROUND_H;
    for (const cloud of this.clouds) {
      cloud.img.x -= dx * cloud.speed;
      const w = cloud.img.displayWidth;
      if (cloud.img.x < -w) {
        cloud.img.x = GAME_WIDTH + w;
        cloud.img.y = Phaser.Math.Between(40, groundY * 0.5);
      }
    }
  }

  /** Classic Flappy: every flap sets a fixed upward velocity, any time. */
  private flap(): void {
    if (this.dead) {
      this.scene.restart();
      return;
    }
    if (this.paused) return;
    this.started = true;
    this.vy = WORLD2.flapVelocity;
    playJumpSfx(this);
  }

  /** Flight animation: fly-0 while rising, fall-0 while descending. */
  private updateKinoAnimation(): void {
    const key = this.vy < 0 ? 'kino-fly' : 'kino-fall';
    if (this.bird.texture.key !== key) {
      this.bird.setTexture(key).setScale(this.birdScale);
    }
  }

  update(_time: number, delta: number): void {
    if (this.dead) return;
    this.pauseCtl.tick(delta);
    if (this.paused) return;
    // Skill timers advance on REAL time; the returned scale slows the world
    // while Time Slow is active.
    const timeScale = this.skill.tick(delta);
    const dt = (delta / 1000) * timeScale;

    if (this.started) {
      this.vy += WORLD2.gravity * dt;
      this.bird.y += this.vy * dt;

      const dx = WORLD2.scrollSpeed * dt;
      this.scrollBackground(dx);
      this.distanceToNextSpawn -= dx;
      if (this.distanceToNextSpawn <= 0) {
        this.spawnPipePair();
        const jitter = Phaser.Math.Between(
          -WORLD2.spawnSpacingJitter,
          WORLD2.spawnSpacingJitter,
        );
        this.distanceToNextSpawn = WORLD2.spawnSpacing + jitter;
      }
      this.movePipes(dx);
    }

    this.updateKinoAnimation();
    this.updateHat();
    this.checkCollisions();
  }

  private updateHat(): void {
    // Top of Kino's head; visual only.
    this.hat.update(this.bird.x, this.bird.y - WORLD2.birdRadius);
  }

  private spawnPipePair(): void {
    const playableBottom = GAME_HEIGHT - GROUND_H;
    const minCenter = WORLD2.gapEdgeMargin + WORLD2.gapHeight / 2;
    const maxCenter = playableBottom - WORLD2.gapEdgeMargin - WORLD2.gapHeight / 2;
    const gapCenterY = Phaser.Math.Between(minCenter, maxCenter);

    const x = GAME_WIDTH + WORLD2.pipeWidth;
    const gapTop = gapCenterY - WORLD2.gapHeight / 2;
    const gapBottom = gapCenterY + WORLD2.gapHeight / 2;

    // Foundry pillars as sprites, stretched to fill their segment while keeping
    // the configured pipe width. Above the background layers.
    const upSrc = this.textures.get('w2-pillar-up').getSourceImage();
    const groundSrc = this.textures.get('w2-pillar-ground').getSourceImage();
    const sxUp = WORLD2.pipeWidth / upSrc.width;
    const syUp = gapTop / upSrc.height;
    const bottomHeight = playableBottom - gapBottom;
    const sxGround = WORLD2.pipeWidth / groundSrc.width;
    const syGround = bottomHeight / groundSrc.height;

    // Ceiling pillar: top edge at y=0, extends down to gapTop.
    const top = this.add
      .image(x, 0, 'w2-pillar-up')
      .setOrigin(0.5, 0)
      .setScale(sxUp, syUp)
      .setDepth(7);

    // Ground pillar: bottom edge at the floor, extends up to gapBottom.
    const bottom = this.add
      .image(x, playableBottom, 'w2-pillar-ground')
      .setOrigin(0.5, 1)
      .setScale(sxGround, syGround)
      .setDepth(7);

    this.pipes.push({ top, bottom, scored: false });
  }

  private movePipes(dx: number): void {
    for (const pipe of this.pipes) {
      pipe.top.x -= dx;
      pipe.bottom.x -= dx;
      if (!pipe.scored && pipe.top.x < WORLD2.birdX) {
        pipe.scored = true;
        this.score += 1;
        this.scoreText.setText(String(this.score));
        this.skill.notifyObstacleCleared();
        maybeUnlockAndToast(this, worldNumberFromKey('World2'), this.score);
      }
    }

    const alive: Pipe[] = [];
    for (const pipe of this.pipes) {
      if (pipe.top.x < -WORLD2.pipeWidth) {
        pipe.top.destroy();
        pipe.bottom.destroy();
      } else {
        alive.push(pipe);
      }
    }
    this.pipes = alive;
  }

  private checkCollisions(): void {
    const r = WORLD2.birdRadius;

    // Floor/ceiling no longer kill: clamp Kino's y to stay within bounds
    // (flappy-style). Only obstacles end the run.
    const floorY = GAME_HEIGHT - GROUND_H - r;
    const ceilY = r;
    if (this.bird.y >= floorY) {
      this.bird.y = floorY;
      if (this.vy > 0) this.vy = 0;
    } else if (this.bird.y <= ceilY) {
      this.bird.y = ceilY;
      if (this.vy < 0) this.vy = 0;
    }

    // Find the pipe Kino currently overlaps, if any.
    let hitGapCenter: number | null = null;
    for (const pipe of this.pipes) {
      if (this.hitsImage(pipe.top) || this.hitsImage(pipe.bottom)) {
        // The ceiling pillar's bottom edge is the top of the gap.
        const gapTop = pipe.top.y + pipe.top.displayHeight;
        hitGapCenter = gapTop + WORLD2.gapHeight / 2;
        break;
      }
    }

    if (hitGapCenter === null) {
      // No overlap: if we were phasing through an object, it's now cleared.
      if (this.skill.isPhaseActive()) this.skill.notifyPhasedObjectCleared();
      return;
    }
    this.handleHit(hitGapCenter);
  }

  /**
   * Resolve an OBSTACLE collision through the equipped skill:
   *   - Second Chance: phase through (keeps phasing until the object clears).
   *   - Ultra Instinct: teleport Kino to the safe y and survive.
   *   - otherwise: die.
   */
  private handleHit(safeY: number): void {
    if (this.skill.tryPhase()) return;
    if (this.skill.isUltraActive()) {
      this.bird.y = Phaser.Math.Clamp(safeY, 60, GAME_HEIGHT - GROUND_H - 60);
      this.vy = 0;
      return;
    }
    this.die();
  }

  /** Circle (bird) vs an image's axis-aligned display bounds. Uses getBounds()
   * so any origin/scale on the pillar is handled correctly. A small inset makes
   * the hitbox slightly forgiving relative to the art. */
  private hitsImage(img: Phaser.GameObjects.Image): boolean {
    const r = WORLD2.birdRadius;
    const b = img.getBounds();
    const inset = 6;
    const left = b.x + inset;
    const right = b.x + b.width - inset;
    const top = b.y + inset;
    const bottom = b.y + b.height - inset;

    const closestX = Phaser.Math.Clamp(this.bird.x, left, right);
    const closestY = Phaser.Math.Clamp(this.bird.y, top, bottom);
    const dx = this.bird.x - closestX;
    const dy = this.bird.y - closestY;
    return dx * dx + dy * dy <= r * r;
  }

  private die(): void {
    if (this.dead) return;
    this.dead = true;
    this.bird.setTexture('kino-dead').setScale(this.birdScale);

    addText(
      this, GAME_WIDTH / 2, GAME_HEIGHT / 2,
      'Game Over\nScore: ' + this.score + '\nClick to retry  -  Esc for menu',
      { fontSize: 52 },
    ).setDepth(20);
  }
}

// Minimal rebuild — SequenceRunner: one continuous run chaining movement modes.
//
// Worlds 3 and 4 play as a single run that switches movement mode mid-run
// (spec Req 4.4-4.7, 5.5). The current mode plays for `segmentPoints` points,
// then the run transitions to a RANDOM next mode from the pool through a single
// SEAMLESS opening centered at Kino's y: the last opening of the outgoing mode
// IS the first opening of the incoming mode. Controls swap when Kino crosses
// that opening.
//
// Modes:
//   flight     — classic Flappy: gravity down, tap = fixed upward flap.
//   zigzag     — Geometry-Dash corridor that snakes between vertices; tap flips
//                Kino's diagonal direction; straying out of the channel kills.
//   underwater — reverse Flappy: buoyancy up, tap = fixed downward dive.
//
// Shared frame: Kino is held at KINO_X; the world scrolls left at SCROLL. The
// ceiling and floor bands are deadly. +1 per opening (pipe gap OR corridor
// vertex) cleared.

import Phaser from 'phaser';
import {
  GAME_WIDTH,
  GAME_HEIGHT,
  KINO_X,
  WORLD2,
  WORLD3,
  WORLD4,
  type MovementMode,
  type SequenceConfig,
} from './config.ts';
import { HatSprite, loadHatAssets } from './cosmetics.ts';
import { SkillRuntime } from './skills.ts';
import { PauseController } from './pause.ts';

const EDGE = 40;
const PLAY_TOP = EDGE;
const PLAY_BOTTOM = GAME_HEIGHT - EDGE;
const SCROLL = 260; // px/s world scroll
const GAP = 300; // pipe-gap height
const CORRIDOR = 230; // zigzag channel height
const OBSTACLE_W = 90;
const PIPE_SPACING = 440; // world-px between pipe openings
const BIRD_R = 22;

type OpeningKind = 'pipe' | 'vertex';

/** One opening in the shared world-x timeline. */
interface Opening {
  worldX: number; // world-space x of the opening
  centerY: number; // y of the opening center
  mode: MovementMode; // the mode this opening belongs to (for rendering/collision)
  /** The control mode that becomes active once Kino crosses this opening.
   * Normally equals `mode`; at a seam it is the INCOMING mode. Control is set
   * imperatively from this on the crossing event — never re-derived per frame. */
  modeAfter: MovementMode;
  kind: OpeningKind;
  isTransition: boolean; // true if crossing it switches to the next mode
  scored: boolean;
  /** Tracks whether we've already applied this opening's crossing event. */
  crossed: boolean;
  /** Co-located seam opening: shares a slot with the previous opening, so it
   * must not award a second point for the same physical passage. */
  noScore: boolean;
  // Pipe visuals (kind === 'pipe') — pillar sprites.
  top?: Phaser.GameObjects.Image;
  bottom?: Phaser.GameObjects.Image;
}

/** One parallax layer for the flight background. */
interface ParallaxLayer {
  panels: Phaser.GameObjects.Image[];
  panelWidth: number;
  speed: number;
}



export class SequenceRunner extends Phaser.Scene {
  private seq!: SequenceConfig;
  /** Kino's ACTIVE control mode (set by the last opening he crossed). */
  private mode: MovementMode = 'flight';
  /** The mode whose obstacles are being GENERATED ahead (runs ahead of control). */
  private spawnMode: MovementMode = 'flight';

  private bird!: Phaser.GameObjects.Image;
  private birdScale = 1;
  private hat!: HatSprite;
  private skill!: SkillRuntime;
  private pauseCtl!: PauseController;
  private get paused(): boolean { return this.pauseCtl?.isPaused() ?? false; }
  private vy = 0;
  private zigDir: 1 | -1 = 1;
  private zigVSpeed = 0;
  private zigSlope = 0;

  private openings: Opening[] = [];
  private worldX = 0; // distance scrolled so far
  private nextSpawnWorldX = 0; // world-x at which to place the next opening
  private segmentCount = 0; // openings placed in the current mode's segment
  private corridorGfx!: Phaser.GameObjects.Graphics;

  // Background: flight gradient sky + parallax dunes, a parallax cave backdrop
  // (zigzag), and a parallax underwater backdrop. Edge bars recolor per mode.
  private sky!: Phaser.GameObjects.Graphics;
  private layers: ParallaxLayer[] = [];
  private caveLayers: ParallaxLayer[] = [];
  private waterLayers: ParallaxLayer[] = [];
  private topBar!: Phaser.GameObjects.Rectangle;
  private bottomBar!: Phaser.GameObjects.Rectangle;
  /** Per-backdrop crossfade weights (eased toward the active mode each frame). */
  private blendFlight = 1;
  private blendCave = 0;
  private blendWater = 0;

  /** Theme texture key for a logical name, namespaced by the world prefix. */
  private tk(name: string): string {
    return `${this.seq.theme.keyPrefix}-${name}`;
  }

  // Transition spin telegraph (transform-0 flipped on X four times).
  private spinning = false;
  private spinTimer = 0;
  private spinFlips = 0;

  private score = 0;
  private scoreText!: Phaser.GameObjects.Text;
  private modeText!: Phaser.GameObjects.Text;
  private started = false;
  private dead = false;

  constructor(key: string) {
    super(key);
  }

  init(data: { seq: SequenceConfig }): void {
    this.seq = data.seq;
  }

  preload(): void {
    loadHatAssets(this);
    const t = this.seq.theme;
    this.load.image(this.tk('bg2'), t.duneLayers[0]);
    this.load.image(this.tk('bg1'), t.duneLayers[1]);
    this.load.image(this.tk('bg0'), t.duneLayers[2]);
    this.load.image(this.tk('cave'), t.caveBg);
    this.load.image(this.tk('water'), t.underwaterBg);
    this.load.image(this.tk('flight-up'), t.flightPillarUp);
    this.load.image(this.tk('flight-ground'), t.flightPillarGround);
    this.load.image(this.tk('water-up'), t.underwaterPillarUp);
    this.load.image(this.tk('water-ground'), t.underwaterPillarGround);
    this.load.image('kino-fly', 'assets/animation/fly-0.png');
    this.load.image('kino-fall', 'assets/animation/fall-0.png');
    this.load.image('kino-zig-up', 'assets/animation/zigzag-up.png');
    this.load.image('kino-zig-down', 'assets/animation/zigzag-down.png');
    this.load.image('kino-swim-up', 'assets/animation/swim_up.png');
    this.load.image('kino-swim-down', 'assets/animation/swim_down.png');
    this.load.image('kino-transform', 'assets/animation/transform-0.png');
    this.load.image('kino-dead', 'assets/kino-dead.png');
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#0a3d62');

    this.mode = this.seq.start;
    this.spawnMode = this.seq.start;
    this.vy = 0;
    this.zigDir = 1;
    this.openings = [];
    this.worldX = 0;
    this.segmentCount = 0;
    this.score = 0;
    this.started = false;
    this.dead = false;
    this.layers = [];
    this.caveLayers = [];
    this.waterLayers = [];
    this.blendFlight = this.seq.start === 'flight' ? 1 : 0;
    this.blendCave = this.seq.start === 'zigzag' ? 1 : 0;
    this.blendWater = this.seq.start === 'underwater' ? 1 : 0;
    this.spinning = false;
    this.spinTimer = 0;
    this.spinFlips = 0;

    this.zigSlope = Math.tan(Phaser.Math.DegToRad(WORLD3.diagonalAngleDeg));
    this.zigVSpeed = SCROLL * this.zigSlope;

    // Background: flight parallax layers + a full-screen cave backdrop (hidden
    // until a zigzag segment is active).
    this.buildBackground();

    // Deadly top/bottom edge bars (above the background). Recolored per mode.
    this.topBar = this.add.rectangle(GAME_WIDTH / 2, EDGE / 2, GAME_WIDTH, EDGE, this.seq.theme.flightTopBar).setDepth(6);
    this.bottomBar = this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT - EDGE / 2, GAME_WIDTH, EDGE, this.seq.theme.flightBottomBar).setDepth(6);

    this.corridorGfx = this.add.graphics().setDepth(7);

    // Kino — a sprite; textures swap per mode. Collision still uses the config
    // circle radius centered on the sprite, so the hitbox is unaffected.
    const flySrc = this.textures.get('kino-fly').getSourceImage();
    this.birdScale = (BIRD_R * 2 * 1.6) / flySrc.height;
    this.bird = this.add
      .image(KINO_X, GAME_HEIGHT / 2, 'kino-fly')
      .setScale(this.birdScale)
      .setDepth(9);

    // Equipped cosmetic hat (visual only; never affects collision).
    this.hat = new HatSprite(this, 74, 10, 30);
    this.hat.update(this.bird.x, this.bird.y - BIRD_R);

    // Equipped super power — usable only while the run is active.
    this.skill = new SkillRuntime(this, () => this.started && !this.dead && !this.paused);

    // Pause button + overlay.
    this.pauseCtl = new PauseController(
      this,
      () => this.score,
      () => this.started && !this.dead,
      () => !this.dead,
    );

    this.scoreText = this.add
      .text(GAME_WIDTH / 2, 70, '0', {
        fontFamily: 'sans-serif', fontSize: '64px', color: '#ffffff', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(10);
    this.modeText = this.add
      .text(GAME_WIDTH / 2, 128, this.mode.toUpperCase(), {
        fontFamily: 'sans-serif', fontSize: '28px', color: '#cfeffd',
      }).setOrigin(0.5).setDepth(10);
    const hint = this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT * 0.42, 'Click or Space', {
        fontFamily: 'sans-serif', fontSize: '32px', color: '#cfeffd',
      }).setOrigin(0.5).setDepth(10);

    // Seed the first few openings for the starting mode.
    this.nextSpawnWorldX = PIPE_SPACING;
    this.seedInitialOpenings();

    const act = () => {
      if (hint.active) hint.setVisible(false);
      this.primaryAction();
    };
    // Only the LEFT mouse button acts; right-click is reserved for skills.
    // Skip the action when the click lands on the pause button (or while paused).
    const onPointer = (p: Phaser.Input.Pointer) => {
      if (this.pauseCtl.hitsButton(p)) return;
      if (p.leftButtonDown()) act();
    };
    this.input.on('pointerdown', onPointer);
    this.input.keyboard?.on('keydown-SPACE', act);
    this.input.keyboard?.on('keydown-UP', act);
    // Esc is handled by the PauseController (opens the pause menu).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.input.off('pointerdown', onPointer);
      this.input.keyboard?.off('keydown-SPACE', act);
      this.input.keyboard?.off('keydown-UP', act);
    });
  }

  private primaryAction(): void {
    if (this.dead) { this.scene.restart(); return; }
    this.started = true;
    if (this.mode === 'flight') this.vy = WORLD2.flapVelocity;
    else if (this.mode === 'underwater') this.vy = WORLD4.diveVelocity;
    else this.zigDir = (this.zigDir === 1 ? -1 : 1) as 1 | -1;
  }

  // -- opening generation -------------------------------------------------

  private seedInitialOpenings(): void {
    // Pre-place enough openings to fill the screen ahead.
    while (this.nextSpawnWorldX < this.worldX + GAME_WIDTH + PIPE_SPACING) {
      this.placeNextOpening();
    }
  }

  /**
   * Place the next opening for the SPAWN mode at nextSpawnWorldX.
   *
   * `spawnMode` (the mode of obstacles being generated ahead) is tracked
   * independently of `this.mode` (Kino's active control). Each opening records
   * the mode it belongs to; Kino's control later becomes the mode of the last
   * opening he crosses, so the handoff is automatic and seamless.
   *
   * Continuity at a segment boundary: the FIRST opening of a new segment is
   * placed at the SAME y as the previous opening, so a corridor connects to
   * where Kino exited the pipe gap (and a pipe gap opens where the corridor
   * ended). This realizes the "last pipe opening IS the corridor mouth" idea.
   */
  private placeNextOpening(): void {
    const segPts = this.seq.segmentPoints;
    const isFirstOfSegment = this.segmentCount === 0;
    const prevOpening = this.openings.length > 0
      ? this.openings[this.openings.length - 1]!
      : null;
    const prevY = prevOpening ? prevOpening.centerY : GAME_HEIGHT / 2;

    // Seam co-location: the first opening of a new segment shares the SAME
    // world-x AND y as the previous segment's last opening, so mode 1's last
    // obstacle and mode 2's first obstacle are the same opening with no empty
    // space between them. Otherwise advance one PIPE_SPACING as usual.
    const coLocate = isFirstOfSegment && prevOpening !== null;
    const worldXForThis = coLocate ? prevOpening!.worldX : this.nextSpawnWorldX;

    let centerY: number;
    if (coLocate) {
      // Seam: inherit the previous opening's y for a continuous passage.
      centerY = prevY;
    } else if (this.spawnMode === 'zigzag') {
      // Alternate upper/lower vertex bands so the channel snakes v^v^.
      // CRITICAL: the vertical span between consecutive vertices must equal
      // Kino's reachable rise/fall over one PIPE_SPACING run, i.e.
      // span = zigSlope * PIPE_SPACING, so holding the right diagonal tracks
      // the channel exactly (same lesson as standalone World 3).
      const span = this.zigSlope * PIPE_SPACING;
      const mid = GAME_HEIGHT / 2;
      const hi = mid - span / 2;
      const lo = mid + span / 2;
      centerY = this.segmentCount % 2 === 0 ? hi : lo;
    } else {
      const margin = GAP / 2 + 90;
      centerY = Phaser.Math.Between(PLAY_TOP + margin, PLAY_BOTTOM - margin);
    }

    const kind: OpeningKind = this.spawnMode === 'zigzag' ? 'vertex' : 'pipe';
    const opening: Opening = {
      worldX: worldXForThis,
      centerY,
      mode: this.spawnMode,
      // Crossing this opening makes its OWN mode active. At a co-located seam
      // the incoming opening is crossed last (see updateOpenings ordering), so
      // its mode wins and control hands forward cleanly.
      modeAfter: this.spawnMode,
      kind,
      isTransition: this.segmentCount === segPts - 1,
      scored: false,
      crossed: false,
      noScore: coLocate,
    };

    if (kind === 'pipe') this.drawPipe(opening);
    this.openings.push(opening);

    // Advance the segment counter; at the end, switch the SPAWN mode only.
    this.segmentCount += 1;
    if (this.segmentCount >= segPts) {
      this.spawnMode = this.pickNextMode(this.spawnMode);
      this.segmentCount = 0;
    }
    // Only advance the spawn cursor when this opening consumed a new slot. A
    // co-located seam opening reuses the previous slot, so don't advance then.
    if (!coLocate) {
      this.nextSpawnWorldX += PIPE_SPACING;
    }
  }

  /**
   * Pick the next mode at a transition: a fully RANDOM mode from the pool. The
   * same mode CAN be picked again, so two flights (or two zigzags) in a row are
   * possible — a repeat just extends that mode for another segment.
   */
  /** Pick the next mode among those ALLOWED from the current one (adjacency),
   * uniformly at random. Repeats are allowed when listed. */
  private pickNextMode(current: MovementMode): MovementMode {
    const options = this.seq.adjacency[current];
    if (!options || options.length === 0) return current;
    const idx = Phaser.Math.Between(0, options.length - 1);
    return options[idx] ?? current;
  }

  private drawPipe(o: Opening): void {
    const screenX = this.worldToScreen(o.worldX);
    const gapTop = o.centerY - GAP / 2;
    const gapBottom = o.centerY + GAP / 2;
    const topH = gapTop - PLAY_TOP;
    const botH = PLAY_BOTTOM - gapBottom;

    // Pick pillar textures by the opening's mode (flight vs underwater art).
    const upKey = o.mode === 'underwater' ? this.tk('water-up') : this.tk('flight-up');
    const grKey = o.mode === 'underwater' ? this.tk('water-ground') : this.tk('flight-ground');
    const upSrc = this.textures.get(upKey).getSourceImage();
    const grSrc = this.textures.get(grKey).getSourceImage();
    o.top = this.add
      .image(screenX, PLAY_TOP, upKey)
      .setOrigin(0.5, 0)
      .setScale(OBSTACLE_W / upSrc.width, topH / upSrc.height)
      .setDepth(8);
    o.bottom = this.add
      .image(screenX, PLAY_BOTTOM, grKey)
      .setOrigin(0.5, 1)
      .setScale(OBSTACLE_W / grSrc.width, botH / grSrc.height)
      .setDepth(8);
  }

  // -- background -----------------------------------------------------------

  private buildBackground(): void {
    const t = this.seq.theme;

    // Flight sky gradient (top -> bottom), behind everything.
    this.sky = this.add.graphics().setDepth(0);
    this.sky.fillGradientStyle(t.skyTop, t.skyTop, t.skyBottom, t.skyBottom, 1);
    this.sky.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Flight parallax dune layers (depth 2-4).
    this.layers.push(this.buildLayer(this.tk('bg2'), 2, 0.15, GAME_HEIGHT - EDGE, 0.62));
    this.layers.push(this.buildLayer(this.tk('bg1'), 3, 0.30, GAME_HEIGHT - EDGE, 0.42));
    this.layers.push(this.buildLayer(this.tk('bg0'), 4, 0.55, GAME_HEIGHT - EDGE, 0.22));

    // Cave + underwater full-height tiled parallax strips (depth 1), A/mirror/A.
    this.caveLayers.push(this.buildTiledLayer(this.tk('cave'), 0.4));
    this.waterLayers.push(this.buildTiledLayer(this.tk('water'), 0.4));
  }

  /** A full-height strip tiled with the A, A-mirrored, A pattern; starts hidden. */
  private buildTiledLayer(key: string, speed: number): ParallaxLayer {
    const src = this.textures.get(key).getSourceImage();
    const scale = GAME_HEIGHT / src.height;
    const panelWidth = src.width * scale;
    const count = Math.ceil(GAME_WIDTH / panelWidth) + 2;
    const panels: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < count; i++) {
      const img = this.add
        .image(i * panelWidth, GAME_HEIGHT / 2, key)
        .setOrigin(0, 0.5)
        .setScale(scale)
        .setDepth(1)
        .setAlpha(0);
      img.setFlipX(i % 2 === 1);
      img.setData('col', i);
      panels.push(img);
    }
    return { panels, panelWidth, speed };
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
    this.scrollLayers(this.layers, dx);
    this.scrollLayers(this.caveLayers, dx);
    this.scrollLayers(this.waterLayers, dx);
  }

  /** Scroll a set of parallax layers, preserving the A/mirror/A flip parity. */
  private scrollLayers(layers: ParallaxLayer[], dx: number): void {
    for (const layer of layers) {
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

  /**
   * Smoothly cross-fade among the three backdrops (flight sky+dunes, cave,
   * underwater) toward the active mode, and lerp the edge-bar colors to match:
   *   - flight: theme flight bar colors.
   *   - cave (zigzag): black bars.
   *   - underwater: a deep-water tint.
   */
  private updateBackgroundForMode(dt: number): void {
    const rate = Math.min(1, dt / 0.4); // ~0.4s crossfade
    const tgtFlight = this.mode === 'flight' ? 1 : 0;
    const tgtCave = this.mode === 'zigzag' ? 1 : 0;
    const tgtWater = this.mode === 'underwater' ? 1 : 0;
    this.blendFlight += (tgtFlight - this.blendFlight) * rate;
    this.blendCave += (tgtCave - this.blendCave) * rate;
    this.blendWater += (tgtWater - this.blendWater) * rate;

    this.sky.setAlpha(this.blendFlight);
    for (const layer of this.layers) for (const p of layer.panels) p.setAlpha(this.blendFlight);
    for (const layer of this.caveLayers) for (const p of layer.panels) p.setAlpha(this.blendCave);
    for (const layer of this.waterLayers) for (const p of layer.panels) p.setAlpha(this.blendWater);

    // Bar colors: blend flight -> (black for cave) / (deep water for water).
    const flightTop = this.seq.theme.flightTopBar;
    const flightBot = this.seq.theme.flightBottomBar;
    const caveCol = 0x000000;
    const waterCol = 0x062033; // deep water
    this.topBar.setFillStyle(this.blend3(flightTop, caveCol, waterCol));
    this.bottomBar.setFillStyle(this.blend3(flightBot, caveCol, waterCol));
  }

  /** Weighted blend of three colors by the current flight/cave/water weights. */
  private blend3(flightCol: number, caveCol: number, waterCol: number): number {
    const wf = this.blendFlight, wc = this.blendCave, ww = this.blendWater;
    const sum = wf + wc + ww || 1;
    const f = Phaser.Display.Color.ValueToColor(flightCol);
    const c = Phaser.Display.Color.ValueToColor(caveCol);
    const w = Phaser.Display.Color.ValueToColor(waterCol);
    const r = (f.red * wf + c.red * wc + w.red * ww) / sum;
    const g = (f.green * wf + c.green * wc + w.green * ww) / sum;
    const b = (f.blue * wf + c.blue * wc + w.blue * ww) / sum;
    return Phaser.Display.Color.GetColor(Math.round(r), Math.round(g), Math.round(b));
  }

  private worldToScreen(worldXpos: number): number {
    return KINO_X + (worldXpos - this.worldX);
  }

  // -- main loop ----------------------------------------------------------

  update(_time: number, delta: number): void {
    if (this.dead) return;
    this.pauseCtl.tick(delta);
    if (this.paused) return;
    // Tick skill timers on REAL time (so cooldown runs even before the first
    // input) and get the time scale for Time Slow.
    const timeScale = this.skill.tick(delta);
    if (!this.started) return;
    const dt = (delta / 1000) * timeScale;
    this.worldX += SCROLL * dt;
    this.scrollBackground(SCROLL * dt);

    // NOTE: control mode is NOT derived here. It is switched imperatively by
    // the crossing events in updateOpenings(), exactly once per opening.

    // Vertical motion by the active mode.
    if (this.mode === 'flight') {
      this.vy += WORLD2.gravity * dt; this.bird.y += this.vy * dt;
    } else if (this.mode === 'underwater') {
      this.vy += WORLD4.buoyancy * dt; this.bird.y += this.vy * dt;
    } else {
      this.bird.y += this.zigDir * this.zigVSpeed * dt;
    }

    // Keep the pipeline full of upcoming openings.
    while (this.nextSpawnWorldX < this.worldX + GAME_WIDTH + PIPE_SPACING) {
      this.placeNextOpening();
    }

    // Reposition pipe visuals + score + recycle.
    this.updateOpenings();
    this.drawCorridor();
    this.updateBackgroundForMode(dt);
    this.updateKinoAnimation(dt);
    this.hat.update(this.bird.x, this.bird.y - BIRD_R);
    this.checkCollisions();
  }

  /** Per-mode Kino frame + the transition spin telegraph. */
  private updateKinoAnimation(dt: number): void {
    // Spin telegraph: show transform-0 and flip on X four times, then stop.
    if (this.spinning) {
      this.spinTimer += dt;
      if (this.spinTimer >= 0.12) {
        this.spinTimer = 0;
        this.bird.setFlipX(!this.bird.flipX);
        this.spinFlips += 1;
        if (this.spinFlips >= 4) {
          this.spinning = false;
          this.bird.setFlipX(false);
        }
      }
      return; // hold the transform frame during the spin
    }

    let key: string;
    if (this.mode === 'zigzag') {
      key = this.zigDir === 1 ? 'kino-zig-down' : 'kino-zig-up';
    } else if (this.mode === 'underwater') {
      // Buoyancy floats up (vy<0) -> swim-up; dive pushes down -> swim-down.
      key = this.vy < 0 ? 'kino-swim-up' : 'kino-swim-down';
    } else {
      key = this.vy < 0 ? 'kino-fly' : 'kino-fall';
    }
    if (this.bird.texture.key !== key) {
      this.bird.setTexture(key).setScale(this.birdScale);
    }
  }

  /** Imperatively set Kino's control mode (called once per opening crossed). */
  private setControlMode(next: MovementMode): void {
    if (next === this.mode) return;
    this.mode = next;
    this.modeText.setText(next.toUpperCase());
    if (next === 'zigzag') {
      this.zigDir = 1;
    } else {
      this.vy = 0;
    }
    // Trigger the spin-to-transform telegraph on the mode switch.
    this.startSpin();
  }

  private startSpin(): void {
    this.spinning = true;
    this.spinTimer = 0;
    this.spinFlips = 0;
    this.bird.setTexture('kino-transform').setScale(this.birdScale).setFlipX(false);
  }

  private updateOpenings(): void {
    // Reposition pipe visuals.
    for (const o of this.openings) {
      if (o.kind === 'pipe' && o.top && o.bottom) {
        const sx = this.worldToScreen(o.worldX);
        o.top.x = sx;
        o.bottom.x = sx;
      }
    }

    // Process CROSSING events (score + control-mode switch) exactly once per
    // opening, in worldX order so co-located seam openings resolve
    // deterministically. For a tie in worldX, the opening with the greater
    // array index (the co-located INCOMING opening) is processed LAST, so its
    // modeAfter wins and control always hands forward. This replaces the old
    // per-frame re-derivation that caused the seam mode flicker.
    const newlyCrossed = this.openings
      .map((o, i) => ({ o, i }))
      .filter(({ o }) => !o.crossed && o.worldX <= this.worldX)
      .sort((a, b) => (a.o.worldX - b.o.worldX) || (a.i - b.i));

    for (const { o } of newlyCrossed) {
      o.crossed = true;
      o.scored = true;
      if (!o.noScore) {
        this.score += 1;
        this.scoreText.setText(String(this.score));
        this.skill.notifyObstacleCleared();
      }
      this.setControlMode(o.modeAfter);
    }
    // Recycle openings once fully off-screen to the left. A zigzag vertex
    // anchors the LEG that runs to the next vertex (~PIPE_SPACING to its
    // right), so a vertex must be kept until that whole leg has scrolled off;
    // otherwise the on-screen right half of the leg would vanish the instant
    // the left vertex is removed. Keep vertices until they are a full
    // PIPE_SPACING past the left edge; pipes only need to clear their own width.
    const alive: Opening[] = [];
    for (const o of this.openings) {
      const sx = this.worldToScreen(o.worldX);
      const cutoff = o.kind === 'vertex' ? -(PIPE_SPACING + 50) : -OBSTACLE_W;
      if (sx < cutoff) {
        o.top?.destroy();
        o.bottom?.destroy();
      } else {
        alive.push(o);
      }
    }
    this.openings = alive;
  }

  // -- zigzag corridor rendering + collision ------------------------------

  /** Return the zigzag channel center y at a given world-x by interpolating
   * between consecutive vertex openings. Returns null if not in a zigzag span. */
  private corridorCenterAtWorldX(wx: number): number | null {
    // Collect vertices in order and find the ones surrounding wx.
    let prev: Opening | null = null;
    let next: Opening | null = null;
    for (const o of this.openings) {
      if (o.kind !== 'vertex') continue;
      if (o.worldX <= wx) {
        prev = o;
      } else if (next === null) {
        next = o;
        break;
      }
    }

    // Collision is only defined STRICTLY BETWEEN two real vertices. No
    // extrapolation at either end: before the first vertex or after the last,
    // there is no channel (null). Kino is always mid-segment (a next vertex
    // exists) while in zigzag control, so this is the only case that matters.
    if (prev && next) {
      const t = (wx - prev.worldX) / (next.worldX - prev.worldX);
      return prev.centerY + (next.centerY - prev.centerY) * t;
    }
    return null;
  }

  private drawCorridor(): void {
    this.corridorGfx.clear();
    // Thicker, brighter path lines for the zigzag channel.
    this.corridorGfx.lineStyle(14, 0x6fe0a0, 1);
    const half = CORRIDOR / 2;



    // Draw the channel by connecting the STORED vertices directly (not by
    // per-pixel sampling, which could lose already-crossed segments). Split the
    // vertex list into CONTIGUOUS runs (adjacent in the opening timeline with
    // no non-vertex opening between them) so separate zigzag segments are never
    // joined by a stray line. Each run spans from left-of-screen (crossed) to
    // right-of-screen (upcoming), so the whole visible tunnel is drawn,
    // including the parts Kino just passed.
    const runs: Opening[][] = [];
    let current: Opening[] = [];
    for (const o of this.openings) {
      if (o.kind === 'vertex') {
        current.push(o);
      } else if (current.length > 0) {
        runs.push(current);
        current = [];
      }
    }
    if (current.length > 0) runs.push(current);

    for (const run of runs) {
      if (run.length < 2) continue;
      // Connect ONLY the real vertices with straight legs. No synthetic
      // extension before the first vertex (so the tunnel starts exactly at the
      // seam) and none after the last (so a crossed leg keeps its real slope
      // and scrolls off naturally, like a flight pipe, instead of visibly
      // straightening out).
      const pts: Array<[number, number]> = run.map((v) => [this.worldToScreen(v.worldX), v.centerY]);
      const topPts: Array<[number, number]> = pts.map(([x, y]) => [x, y - half]);
      const botPts: Array<[number, number]> = pts.map(([x, y]) => [x, y + half]);
      this.strokePolyline(topPts);
      this.strokePolyline(botPts);
    }
  }

  private strokePolyline(pts: Array<[number, number]>): void {
    if (pts.length < 2) return;
    this.corridorGfx.beginPath();
    const first = pts[0]!;
    this.corridorGfx.moveTo(first[0], first[1]);
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i]!;
      this.corridorGfx.lineTo(p[0], p[1]);
    }
    this.corridorGfx.strokePath();
  }

  private checkCollisions(): void {
    // Floor/ceiling no longer kill in flight/underwater: clamp y to bounds
    // (flappy-style). Only obstacles / corridor walls end the run.
    if (this.mode !== 'zigzag') {
      const ceilY = PLAY_TOP + BIRD_R;
      const floorY = PLAY_BOTTOM - BIRD_R;
      if (this.bird.y <= ceilY) {
        this.bird.y = ceilY;
        if (this.vy < 0) this.vy = 0;
      } else if (this.bird.y >= floorY) {
        this.bird.y = floorY;
        if (this.vy > 0) this.vy = 0;
      }
    }
    // Determine if Kino currently overlaps an obstacle, and the safe y there.
    let hitSafeY: number | null = null;
    if (this.mode === 'zigzag') {
      const c = this.corridorCenterAtWorldX(this.worldX);
      if (c !== null) {
        const half = CORRIDOR / 2;
        if (this.bird.y - BIRD_R < c - half || this.bird.y + BIRD_R > c + half) {
          hitSafeY = c;
        }
      }
    } else {
      for (const o of this.openings) {
        if (o.kind === 'pipe' && o.top && o.bottom) {
          if (this.hitsImage(o.top) || this.hitsImage(o.bottom)) {
            hitSafeY = o.centerY;
            break;
          }
        }
      }
    }

    if (hitSafeY === null) {
      // No overlap: if we were phasing through an object, it's now cleared.
      if (this.skill.isPhaseActive()) this.skill.notifyPhasedObjectCleared();
      return;
    }
    this.handleHit(hitSafeY);
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
      this.bird.y = Phaser.Math.Clamp(safeY, PLAY_TOP + BIRD_R + 2, PLAY_BOTTOM - BIRD_R - 2);
      this.vy = 0;
      return;
    }
    this.die();
  }

  /** Circle (bird) vs a pillar image's display bounds (origin/scale aware). */
  private hitsImage(img: Phaser.GameObjects.Image): boolean {
    const b = img.getBounds();
    const inset = 6;
    const left = b.x + inset;
    const right = b.x + b.width - inset;
    const top = b.y + inset;
    const bottom = b.y + b.height - inset;
    const cx = Phaser.Math.Clamp(this.bird.x, left, right);
    const cy = Phaser.Math.Clamp(this.bird.y, top, bottom);
    const dx = this.bird.x - cx;
    const dy = this.bird.y - cy;
    return dx * dx + dy * dy <= BIRD_R * BIRD_R;
  }

  private die(): void {
    if (this.dead) return;
    this.dead = true;
    this.spinning = false;
    this.bird.setTexture('kino-dead').setScale(this.birdScale).setFlipX(false);
    this.add
      .text(GAME_WIDTH / 2, GAME_HEIGHT / 2, 'Game Over\nScore: ' + this.score + '\nClick to retry   -   Esc for menu', {
        fontFamily: 'sans-serif', fontSize: '52px', color: '#ffffff', align: 'center', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(20);
  }
}

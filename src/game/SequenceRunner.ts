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
import { maybeUnlockAndToast, worldNumberFromKey } from './progression.ts';
import { paletteForWorld } from './uiTheme.ts';
import { addText } from './ui.ts';
import { loadJumpSfx, playJumpSfx } from './music.ts';

const EDGE = 40;
const PLAY_TOP = EDGE;
const PLAY_BOTTOM = GAME_HEIGHT - EDGE;
const SCROLL = 260; // px/s world scroll
const FINALE_SCORE = 5; // World 5 finale trigger (lowered for testing; was 30)
const WALK_SPEED = 220; // px/s Kiro auto-walks right during the finale
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
  /** Flipped sky gradient for reverse-gravity segments (null if not used). */
  private skyRev: Phaser.GameObjects.Graphics | null = null;
  private moon: Phaser.GameObjects.Image | null = null;
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

  // World 5 finale: after the finale score, stop SPAWNING new obstacles so the
  // current segment finishes, then once Kiro has cleared everything he drops to
  // the ground and walks right off the screen into a gradient -> menu.
  private finalePending = false;
  private finale = false;
  /** 'fall' = Kiro drops to the ground; 'walk' = he walks across the screen;
   * 'carry' = Kiro fixed, world scrolls the gradient in until its left edge
   * reaches the screen's left border; 'release' = he walks through the gradient
   * to 3/4 -> menu. */
  private finalePhase: 'fall' | 'walk' | 'carry' | 'release' = 'fall';
  private runFrameTimer = 0;
  private runFrame = 0;
  private finaleRect: Phaser.GameObjects.Graphics | null = null;
  private finaleRectW = 0;

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
    t.duneLayers.forEach((path, i) => this.load.image(this.tk(`dune${i}`), path));
    if (t.moonBg) this.load.image(this.tk('moon'), t.moonBg);
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
    // Walk frames for the World 5 finale walk-off.
    this.load.image('kino-run-0', 'assets/animation/run-0.png');
    this.load.image('kino-run-1', 'assets/animation/run-1.png');
    loadJumpSfx(this);
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
    this.finalePending = false;
    this.finale = false;
    this.finalePhase = 'fall';
    this.finaleRect = null;
    this.runFrameTimer = 0;
    this.runFrame = 0;

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
      paletteForWorld(worldNumberFromKey(this.scene.key)),
      () => this.dead,
    );

    this.scoreText = addText(this, GAME_WIDTH / 2, 70, '0', { fontSize: 64 }).setDepth(12);
    this.modeText = addText(this, GAME_WIDTH / 2, 128, this.modeLabel(this.mode), { fontSize: 28 }).setDepth(12);
    const hint = addText(this, GAME_WIDTH / 2, GAME_HEIGHT * 0.42, 'Click or Space', { fontSize: 32 }).setDepth(12);

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
    if (this.paused || this.finale) return;
    this.started = true;
    if (this.mode === 'flight') this.vy = WORLD2.flapVelocity;
    else if (this.mode === 'underwater') this.vy = WORLD4.diveVelocity;
    else this.zigDir = (this.zigDir === 1 ? -1 : 1) as 1 | -1;
    playJumpSfx(this);
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

    // Pick pillar textures by the opening's mode. For reverse-gravity worlds,
    // underwater reuses the FLIGHT pillar textures flipped vertically.
    const reverse = this.seq.theme.reverseGravity === true;
    const underwater = o.mode === 'underwater';
    const upKey = underwater && !reverse ? this.tk('water-up') : this.tk('flight-up');
    const grKey = underwater && !reverse ? this.tk('water-ground') : this.tk('flight-ground');
    const flipV = underwater && reverse;
    const upSrc = this.textures.get(upKey).getSourceImage();
    const grSrc = this.textures.get(grKey).getSourceImage();
    o.top = this.add
      .image(screenX, PLAY_TOP, upKey)
      .setOrigin(0.5, 0)
      .setScale(OBSTACLE_W / upSrc.width, topH / upSrc.height)
      .setFlipY(flipV)
      .setDepth(8);
    o.bottom = this.add
      .image(screenX, PLAY_BOTTOM, grKey)
      .setOrigin(0.5, 1)
      .setScale(OBSTACLE_W / grSrc.width, botH / grSrc.height)
      .setFlipY(flipV)
      .setDepth(8);
  }

  // -- background -----------------------------------------------------------

  private buildBackground(): void {
    const t = this.seq.theme;

    this.moon = null;
    this.skyRev = null;

    // Flight sky gradient (top -> bottom), behind everything.
    this.sky = this.add.graphics().setDepth(0);
    this.sky.fillGradientStyle(t.skyTop, t.skyTop, t.skyBottom, t.skyBottom, 1);
    this.sky.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);

    // Reverse-gravity sky: the SAME gradient flipped vertically (skyBottom on
    // top, skyTop at the bottom), shown during reverse-gravity segments.
    if (t.reverseGravity) {
      this.skyRev = this.add.graphics().setDepth(0);
      this.skyRev.fillGradientStyle(t.skyBottom, t.skyBottom, t.skyTop, t.skyTop, 1);
      this.skyRev.fillRect(0, 0, GAME_WIDTH, GAME_HEIGHT);
      this.skyRev.setAlpha(0);
    }

    // Static moon high in the sky (does not scroll); drawn above the sky but
    // behind the dunes. Shown during flight (fades with the flight backdrop).
    if (t.moonBg) {
      // Top-right-ish, inset from the edges (not touching the borders).
      this.moon = this.add
        .image(GAME_WIDTH * 0.78, GAME_HEIGHT * 0.2, this.tk('moon'))
        .setOrigin(0.5, 0.5)
        .setDepth(1);
      this.moon.setScale(Math.min(1, (GAME_WIDTH * 0.28) / this.moon.width));
      if (t.moonBlur) this.moon.postFX.addBlur(0, 1, 1, 0.4, 0xffffff, 2);
    }

    // Flight parallax dune layers (far -> near). Graded speed + height across
    // however many layers the theme provides.
    const n = this.seq.theme.duneLayers.length;
    for (let i = 0; i < n; i++) {
      const f = n === 1 ? 0 : i / (n - 1); // 0 (far) -> 1 (near)
      const speed = 0.15 + f * 0.45;
      const heightFrac = 0.6 - f * 0.4; // far tall -> near short
      this.layers.push(
        this.buildLayer(this.tk(`dune${i}`), 2 + i, speed, GAME_HEIGHT - EDGE, heightFrac, false),
      );
    }

    this.caveLayers.push(this.buildTiledLayer(this.tk('cave'), 0.4));

    if (this.seq.theme.reverseGravity) {
      // Reverse gravity reuses the flight dunes FLIPPED vertically, anchored to
      // the TOP (dunes hang from the ceiling). Same textures as flight.
      for (let i = 0; i < n; i++) {
        const f = n === 1 ? 0 : i / (n - 1);
        const speed = 0.15 + f * 0.45;
        const heightFrac = 0.6 - f * 0.4;
        this.waterLayers.push(
          this.buildLayer(this.tk(`dune${i}`), 2 + i, speed, EDGE, heightFrac, true),
        );
      }
    } else {
      this.waterLayers.push(this.buildTiledLayer(this.tk('water'), 0.4));
    }

    // Initialize backdrop alphas to the STARTING mode so nothing is wrongly
    // visible before the first frame of the update loop. (buildLayer creates
    // flight dunes at alpha 1; the water/cave layers must start hidden.)
    for (const layer of this.waterLayers) for (const p of layer.panels) p.setAlpha(this.blendWater);
    this.sky.setAlpha(this.blendFlight);
    this.skyRev?.setAlpha(this.blendWater);
    this.moon?.setAlpha(this.blendFlight);
    for (const layer of this.layers) for (const p of layer.panels) p.setAlpha(this.blendFlight);
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

  /**
   * Build one parallax dune layer. `edgeY` is the anchor line and `heightFrac`
   * the fraction of the play area the dunes rise. When `anchorTop` is true the
   * dunes hang from the TOP edge, flipped vertically (reverse-gravity reuse of
   * flight art); otherwise they rise from the bottom as usual.
   */
  private buildLayer(
    key: string, depth: number, speed: number, edgeY: number, heightFrac: number,
    anchorTop: boolean,
  ): ParallaxLayer {
    const src = this.textures.get(key).getSourceImage();
    const playH = GAME_HEIGHT - 2 * EDGE;
    const targetH = playH * heightFrac;
    const scale = targetH / src.height;
    const panelWidth = src.width * scale;
    const count = Math.ceil(GAME_WIDTH / panelWidth) + 2;
    const panels: Phaser.GameObjects.Image[] = [];
    for (let i = 0; i < count; i++) {
      const img = this.add
        .image(i * panelWidth, edgeY, key)
        .setOrigin(0, anchorTop ? 0 : 1) // top-anchored when hanging from ceiling
        .setScale(scale)
        .setDepth(depth);
      img.setFlipX(i % 2 === 1);
      if (anchorTop) img.setFlipY(true); // flip the art vertically
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
    this.skyRev?.setAlpha(this.blendWater);
    this.moon?.setAlpha(this.blendFlight);
    for (const layer of this.layers) for (const p of layer.panels) p.setAlpha(this.blendFlight);
    for (const layer of this.caveLayers) for (const p of layer.panels) p.setAlpha(this.blendCave);
    for (const layer of this.waterLayers) for (const p of layer.panels) p.setAlpha(this.blendWater);

    // Bar colors per mode. Flight uses the theme flight bars; cave uses the
    // cave color; underwater uses a water tint, EXCEPT in reverse-gravity
    // worlds where the top/bottom flight colors SWAP (upside-down flight).
    const flightTop = this.seq.theme.flightTopBar;
    const flightBot = this.seq.theme.flightBottomBar;
    const caveCol = this.seq.theme.caveBar;
    const reverse = this.seq.theme.reverseGravity === true;
    const waterTop = reverse ? flightBot : 0x062033;
    const waterBot = reverse ? flightTop : 0x062033;
    this.topBar.setFillStyle(this.blend3(flightTop, caveCol, waterTop));
    this.bottomBar.setFillStyle(this.blend3(flightBot, caveCol, waterBot));
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

    if (this.finale) {
      this.updateFinale(dt);
      return;
    }

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

    // Keep the pipeline full of upcoming openings — UNLESS the finale is
    // pending, in which case we stop spawning so the current segment ends.
    if (!this.finalePending) {
      while (this.nextSpawnWorldX < this.worldX + GAME_WIDTH + PIPE_SPACING) {
        this.placeNextOpening();
      }
    }

    // Reposition pipe visuals + score + recycle.
    this.updateOpenings();
    this.drawCorridor();
    this.updateBackgroundForMode(dt);
    this.updateKinoAnimation(dt);
    this.hat.update(this.bird.x, this.bird.y - BIRD_R);
    this.checkCollisions();

    // Begin the walk-off once Kiro has cleared every remaining obstacle/vertex
    // (nothing left at or ahead of his x), so we never yank him out of a
    // corridor mid-segment.
    if (this.finalePending && !this.finale) {
      const anythingAhead = this.openings.some((o) => o.worldX >= this.worldX - PIPE_SPACING);
      if (!anythingAhead) this.startFinale();
    }
  }

  private isWorld5(): boolean {
    return worldNumberFromKey(this.scene.key) === 5;
  }

  /** Begin the finale: switch to the FLIGHT backdrop and let Kiro FALL to the
   * ground (phase 'fall'); walking + gradient come after he lands. */
  private startFinale(): void {
    this.finale = true;
    this.finalePhase = 'fall';
    this.spinning = false;
    this.corridorGfx.clear();
    this.mode = 'flight';
    this.modeText.setVisible(false);
    this.vy = 0;
    // Backdrop is NOT snapped here — during the 'fall' phase we keep running
    // the normal per-mode crossfade (now targeting flight), so coming from a
    // cave/reverse segment the background fades gracefully to the flight sky.
    // Keep Kiro where he is; gravity in the 'fall' phase brings him down.
  }

  private advanceWalkFrame(dt: number): void {
    this.runFrameTimer += dt;
    if (this.runFrameTimer >= 0.16) {
      this.runFrameTimer = 0;
      this.runFrame = this.runFrame === 0 ? 1 : 0;
      this.bird.setTexture(this.runFrame === 0 ? 'kino-run-0' : 'kino-run-1').setScale(this.birdScale);
    }
  }

  /** Scroll remaining obstacles off the left (background frozen). */
  private scrollRemainingObstacles(dx: number): void {
    for (const o of this.openings) {
      if (o.kind === 'pipe' && o.top && o.bottom) { o.top.x -= dx; o.bottom.x -= dx; }
    }
    this.openings = this.openings.filter((o) => {
      const gone = (o.top?.x ?? -999) < -OBSTACLE_W;
      if (gone) { o.top?.destroy(); o.bottom?.destroy(); }
      return !gone;
    });
  }

  /**
   * Three-phase finale:
   *  - walk:    Kiro's x advances across the screen (background frozen) until
   *             he reaches ~80% width; remaining obstacles scroll off.
   *  - carry:   Kiro held at that screen x while the world scrolls left, moving
   *             the gradient rect in until its LEFT edge reaches the screen's
   *             left border.
   *  - release: Kiro walks right again, through the gradient, until he is 3/4
   *             across it -> back to the menu.
   */
  private updateFinale(dt: number): void {
    const dx = SCROLL * dt;
    const groundY = PLAY_BOTTOM - BIRD_R;

    if (this.finalePhase === 'fall') {
      // Keep crossfading the backdrop toward flight (mode is already 'flight'),
      // so coming from cave/reverse it fades gracefully instead of snapping.
      this.updateBackgroundForMode(dt);
      // Kiro falls under gravity to the ground, showing the falling frame.
      this.vy += WORLD2.gravity * dt;
      this.bird.y += this.vy * dt;
      this.bird.setTexture('kino-fall').setScale(this.birdScale);
      const landed = this.bird.y >= groundY;
      if (landed) { this.bird.y = groundY; this.vy = 0; }
      // Only start walking once Kiro has landed AND the backdrop has faded to
      // flight, so the transition is graceful.
      if (landed && this.blendFlight > 0.98) {
        this.bird.setTexture('kino-run-0').setScale(this.birdScale);
        this.spawnFinaleGradient();
        this.finalePhase = 'walk';
        // Kiro has touched down in his hometown and takes his first step — the
        // moment he's back in control. A quiet, wondering beat.
        this.showFinaleNotice('Is this it...?');
      }
      this.hat.update(this.bird.x, this.bird.y - BIRD_R);
      return;
    }

    this.advanceWalkFrame(dt);
    const rect = this.finaleRect!;

    if (this.finalePhase === 'walk') {
      this.scrollRemainingObstacles(dx);
      this.bird.x += WALK_SPEED * dt;
      if (this.bird.x >= GAME_WIDTH * 0.8) {
        this.bird.x = GAME_WIDTH * 0.8;
        this.finalePhase = 'carry';
      }
    } else if (this.finalePhase === 'carry') {
      // Camera follows Kiro: the world scrolls left under him and the gradient
      // rect slides in until its left edge (rect.x, origin 0) reaches x=0.
      this.scrollBackground(dx);
      rect.x -= dx;
      if (rect.x <= 0) {
        rect.x = 0;
        this.finalePhase = 'release';
      }
    } else {
      // release: Kiro walks right through the now-stationary gradient.
      this.bird.x += WALK_SPEED * dt;
      const threeQuarters = rect.x + this.finaleRectW * 0.75;
      if (this.bird.x >= threeQuarters) {
        this.scene.start('EndCinematic');
      }
    }

    this.hat.update(this.bird.x, this.bird.y - BIRD_R);
  }

  /** Create the right-pointing transparent->white gradient (full height, 2x
   * screen width) as a GRAPHICS fill — no texture stretching, so there is no
   * sampling artifact / white line at the left edge. Starts just off the right
   * side of the screen (scrolled in during the 'carry' phase). */
  private spawnFinaleGradient(): void {
    this.finaleRectW = GAME_WIDTH * 2;
    const g = this.add.graphics().setDepth(50);
    // Per-corner alpha: left corners fully transparent, right corners opaque
    // white -> a clean horizontal transparent->white gradient.
    g.fillGradientStyle(0xffffff, 0xffffff, 0xffffff, 0xffffff, 0, 1, 0, 1);
    // Drawn in local space: left edge at x=0, full height (a touch taller than
    // the screen so no top/bottom edge shows). g.x is the on-screen left edge.
    g.fillRect(0, -10, this.finaleRectW, GAME_HEIGHT + 20);
    g.x = GAME_WIDTH + 40; // left edge starts just off the right of the screen
    g.y = 0;
    this.finaleRect = g;
  }

  /** A styled, World-5-themed notification that drifts in, holds, and fades out.
   * Used for the quiet "Is this it...?" beat the moment Kiro lands at the end of
   * the final world. Sits above everything (incl. the finale gradient). */
  private showFinaleNotice(message: string): void {
    const pal = paletteForWorld(5);
    const cam = this.cameras.main;
    const cx = cam.width / 2;
    const y0 = cam.height * 0.3;

    const c = this.add.container(cx, y0).setDepth(120);

    const pw = 560, ph = 110;
    const panel = this.add.graphics();
    panel.fillStyle(pal.panel, 0.92);
    panel.fillRoundedRect(-pw / 2, -ph / 2, pw, ph, 22);
    panel.lineStyle(4, pal.panelBorder, 1);
    panel.strokeRoundedRect(-pw / 2, -ph / 2, pw, ph, 22);

    const txt = addText(this, 0, 0, message, { fontSize: 46, color: pal.text })
      .setOrigin(0.5);
    // A soft red glow on the text to match the eerie, final-world mood.
    txt.setShadow(0, 0, '#ff3b6b', 12, true, true);

    c.add([panel, txt]);

    // Drift down + fade in, hold, then fade out and clean up.
    c.setAlpha(0);
    this.tweens.add({ targets: c, alpha: 1, y: y0 + 16, duration: 600, ease: 'Quad.out' });
    this.time.delayedCall(2600, () => {
      this.tweens.add({
        targets: c, alpha: 0, y: y0, duration: 700, ease: 'Quad.in',
        onComplete: () => c.destroy(),
      });
    });
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
    this.modeText.setText(this.modeLabel(next));
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

  /** HUD label for a mode. In reverse-gravity worlds, underwater reads as
   * "REVERSE GRAVITY" since the context changed. */
  private modeLabel(mode: MovementMode): string {
    if (mode === 'underwater' && this.seq.theme.reverseGravity) return 'REVERSE GRAVITY';
    return mode.toUpperCase();
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
        maybeUnlockAndToast(this, worldNumberFromKey(this.scene.key), this.score);
        // World 5 finale: once the finale score is hit, mark it PENDING. We
        // stop spawning new obstacles but let the current segment finish; the
        // walk-off begins only after Kiro clears everything (see update loop).
        if (this.isWorld5() && !this.finalePending && !this.finale && this.score >= FINALE_SCORE) {
          this.finalePending = true;
        }
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
    const half = CORRIDOR / 2;

    // Collect CONTIGUOUS vertex runs (so separate zigzag segments are never
    // joined by a stray line), then build each run's top/bottom polylines.
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

    const polylines: Array<Array<[number, number]>> = [];
    for (const run of runs) {
      if (run.length < 2) continue;
      const pts: Array<[number, number]> = run.map((v) => [this.worldToScreen(v.worldX), v.centerY]);
      polylines.push(pts.map(([x, y]) => [x, y - half]));
      polylines.push(pts.map(([x, y]) => [x, y + half]));
    }

    if (this.seq.theme.icyCorridor) {
      // Icy look: blue icicles growing INTO the channel from each wall (top
      // wall hangs down, bottom wall rises up), with a light-cyan tip -> deep
      // blue base gradient, plus a crisp wall line so the edge reads clearly.
      for (const run of runs) {
        if (run.length < 2) continue;
        const pts: Array<[number, number]> = run.map((v) => [this.worldToScreen(v.worldX), v.centerY]);
        const topWall = pts.map(([x, y]) => [x, y - half] as [number, number]);
        const botWall = pts.map(([x, y]) => [x, y + half] as [number, number]);
        this.drawIcicleWall(topWall, +1); // icicles point down (into channel)
        this.drawIcicleWall(botWall, -1); // icicles point up (into channel)
      }
      // Crisp pale-ice wall lines on top of the icicle bases.
      this.corridorGfx.lineStyle(6, 0xdff3ff, 1);
      for (const pl of polylines) this.strokePolyline(pl);
    } else if (this.seq.theme.laserCorridor) {
      // Laser look: thick bright-red outer glow, then a thin white inner core
      // on top — reads as a red->white gradient laser beam.
      this.corridorGfx.lineStyle(20, 0xff2a2a, 0.55);
      for (const pl of polylines) this.strokePolyline(pl);
      this.corridorGfx.lineStyle(12, 0xff3b3b, 1);
      for (const pl of polylines) this.strokePolyline(pl);
      this.corridorGfx.lineStyle(5, 0xffffff, 1);
      for (const pl of polylines) this.strokePolyline(pl);
    } else {
      this.corridorGfx.lineStyle(14, 0x6fe0a0, 1);
      for (const pl of polylines) this.strokePolyline(pl);
    }
  }

  /**
   * Draw a row of icicles hanging off a wall polyline. `dir` is +1 for icicles
   * pointing DOWN (top wall) or -1 for UP (bottom wall). Each icicle is a thin
   * triangle filled with a vertical icy gradient: pale cyan at the base (on the
   * wall) fading to a translucent light-blue tip.
   */
  private drawIcicleWall(wall: Array<[number, number]>, dir: number): void {
    const g = this.corridorGfx;
    const SPACING = 26;   // horizontal px between icicle centers
    const BASE_W = 16;    // icicle base width
    const baseCol = 0x8fd4ff; // pale cyan (base, on the wall)
    const tipCol = 0x2a79c4;  // deeper blue (tip)

    // Walk each wall segment and plant icicles at even spacing along it, so the
    // icicles follow the zigzag slope.
    for (let i = 0; i < wall.length - 1; i++) {
      const [x0, y0] = wall[i]!;
      const [x1, y1] = wall[i + 1]!;
      const segLen = Math.hypot(x1 - x0, y1 - y0);
      if (segLen < 1) continue;
      const nx = (x1 - x0) / segLen; // unit direction along the segment
      const ny = (y1 - y0) / segLen;
      const count = Math.max(1, Math.floor(segLen / SPACING));
      for (let k = 0; k < count; k++) {
        const t = (k + 0.5) / count;
        const bx = x0 + (x1 - x0) * t;
        const by = y0 + (y1 - y0) * t;
        // Pseudo-random but stable length per icicle position.
        const len = 18 + ((Math.abs(Math.sin(bx * 0.21 + by * 0.13)) * 22) | 0);
        const tipX = bx;
        const tipY = by + dir * len;
        // Base corners spread along the wall direction.
        const ax = bx - nx * (BASE_W / 2);
        const ay = by - ny * (BASE_W / 2);
        const cx = bx + nx * (BASE_W / 2);
        const cy = by + ny * (BASE_W / 2);
        // Gradient fill: base edge pale, tip deep blue.
        g.fillGradientStyle(baseCol, baseCol, tipCol, tipCol, 0.95, 0.95, 0.85, 0.85);
        g.fillTriangle(ax, ay, cx, cy, tipX, tipY);
      }
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
    // Floor/ceiling never kill: they CLAMP Kino's y in EVERY mode (flappy-
    // style). In zigzag this matters after a Second Chance phases Kino out of
    // the corridor — the hard ceiling/ground still stop him going off-screen
    // instead of letting him travel straight through.
    const ceilY = PLAY_TOP + BIRD_R;
    const floorY = PLAY_BOTTOM - BIRD_R;
    if (this.bird.y <= ceilY) {
      this.bird.y = ceilY;
      if (this.vy < 0) this.vy = 0;
    } else if (this.bird.y >= floorY) {
      this.bird.y = floorY;
      if (this.vy > 0) this.vy = 0;
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
    addText(
      this, GAME_WIDTH / 2, GAME_HEIGHT / 2,
      'Game Over\nScore: ' + this.score + '\nClick to retry   -   Esc for menu',
      { fontSize: 52 },
    ).setDepth(20);
  }
}

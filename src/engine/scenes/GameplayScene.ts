// Feature: kino-game
//
// GameplayScene — the Run scene. Drives the PURE simulation core each fixed
// step and renders an interpolated frame for the World 1 Jumping vertical slice
// (task 4.6; design: "GameplayScene (Run)", "The fixed-timestep driver",
// "Fixed-Kino scrolling run").
//
// SCOPE / TASK BOUNDARY (4.6): this scene stands up the minimal end-to-end
// Jumping run — fixed-timestep movement (Req 2.1-2.2), scoring on the obstacle
// `scoringLineX` crossing Kino's fixed `screenX` (Req 2.3, 9.5), body-only
// collision ending the run on a ground-obstacle touch (Req 44.1, 44.3), a HUD
// with the Score at top (Req 20.39) and a Menu control (Req 20.40, 20.41), and
// obstacles entering from the right over a ground at the bottom (Req 44.1 read
// as ground presence, Req 20.41). It intentionally leaves SEAMS for later work:
//
//   - Task 8.3 (Animation_Frame cycles): Kino renders a MINIMAL grounded-vs-
//     airborne visual (a tint/texture swap). Full run/jump frame cycles replace
//     `updateKinoVisual` later — see the `// SEAM(8.3)` marks.
//   - Task 4.7 (RunEndScene): on a fatal collision this scene routes to the
//     'RunEnd' scene with the run-stats data contract below. Until 4.7 registers
//     that scene we transition defensively back to the main menu and log a seam
//     — see `endRun` and `// SEAM(4.7)`.
//
// Task 5.2 adds the World 3 ZIGZAG run: Kino bounces on the ±30° diagonal
// (machine-driven; `applyPrimary` reverses the leg) between a TOP wall (y=0)
// and a BOTTOM wall (y=groundY); CONTACTING either wall with no Protective_Skill
// active ends the run (Req 4.8, 4.9, 44.4). Scoring credits one unit per
// transition-point marker crossing via the SAME `creditCrossings` path (Req 4.2).
// The Flight→Zigzag spin telegraph + pointed-arrow form is rendered MINIMALLY
// here (a spin tween on entry/exit + an arrow placeholder form while in zigzag)
// so task 5.4 can trigger it; see `// SEAM(5.4)` (full telegraphed transition +
// SequenceDirector wiring) and `// SEAM(8.3)` (spin-1/2 + zigzag Animation_Frames).
//
// The SCROLLING model (Req 45): Kino is pinned at a constant `screenX` on the
// left third; the WORLD scrolls leftward. We track `scrollX` (how far the world
// has advanced) and increase it by `scrollSpeed * dt` each fixed tick. Kino's
// WORLD-space x is therefore `screenX + scrollX`; it only ever moves vertically
// (the jump). Obstacles are produced by the spawner in WORLD space; an
// obstacle's screen x is `worldX - scrollX`, so a unit laid out ahead of the
// scroll slides in from the right and leftward as the run progresses.
//
// ENGINE layer, so importing Phaser is allowed (src/README.md). All simulation
// state lives in the Phaser-free core modules; this scene is only the wiring +
// drawing seam that brings their pure outputs on screen.

import Phaser from 'phaser';
import {
  createFixedTimestepDriver,
  createMovementStateMachine,
  createObstacleSpawner,
  createScoringSystem,
  createCollisionSystem,
  createFinaleController,
  createObjectPool,
  createDegradationLadder,
  worstCaseOnScreenCount,
  defaultParallaxLayers,
  visibleParallaxLayers,
  parallaxOffset,
  placeEnvironmentElements,
  resolvePaletteApplication,
  ATOMIC_OBSTACLES_KINO_TARGET,
  type PaletteApplication,
  type RenderContext,
  type Rgb,
  type ParallaxLayer,
  type EnvironmentElementPlacement,
  type EnvironmentElementSpec,
  type FixedTimestepDriver,
  type MovementStateMachine,
  type ObstacleSpawner,
  type ScoringSystem,
  type FinaleController,
  type ObjectPool,
  type DegradationLadder,
  type QualitySettings,
  type Obstacle,
  type MovementMode,
  type MovementState,
  type WorldId,
} from '../../core/index.ts';
import { getBootContext, type KinoBootContext } from '../sharedContext.ts';
import { InputManager } from '../input/index.ts';
import { createRunPauseController, type RunPauseController } from '../runPause.ts';
import { PAUSE_SCENE_KEY, type PauseSceneData } from './PauseScene.ts';
import { CINEMATIC_SCENE_KEY, FINAL_ENDING_CINEMATIC_ID } from './CinematicScene.ts';

/** Scene key, shared with MainMenuScene's `GAMEPLAY_SCENE_KEY` + main.ts. */
export const GAMEPLAY_SCENE_KEY = 'Gameplay';

/**
 * Key of the Run_End_Screen scene this scene hands off to when a run ends
 * (task 4.7). Until RunEndScene registers under this key we route defensively
 * back to the main menu (see {@link GameplayScene.endRun}). Exported so main.ts
 * and task 4.7 reference the same constant.
 */
export const RUN_END_SCENE_KEY = 'RunEnd';

/** Key the Menu control returns to (Req 20.40, 20.41). */
const MAIN_MENU_SCENE_KEY = 'MainMenu';

/** The resolved Kino sprite asset key (Req 24.7, 20.7). */
const KINO_SPRITE_KEY = 'starter:kinoSprite';

/** The World 1 ground-obstacle asset key the spawner's category maps to. */
const WORLD1_OBSTACLE_KEY = 'obstacle:world1_ground_obstacle';

/** The World 2 Flight pillar asset keys (top + bottom of each pair). */
const WORLD2_PILLAR_TOP_KEY = 'obstacle:world2_pillar_top';
const WORLD2_PILLAR_BOTTOM_KEY = 'obstacle:world2_pillar_bottom';

/**
 * The World 3 Zigzag wall art key (placeholder fallback). The same key dresses
 * BOTH the top/bottom corridor walls (the hazard, Req 4.8) and the thin
 * transition-point marker cues the spawner emits (Req 4.2).
 */
const WORLD3_ZIGZAG_WALL_KEY = 'obstacle:world3_zigzag_wall';

/**
 * The World 4 Underwater obstacle art keys. Each underwater unit is a PAIR: a
 * ceiling obstacle from the TOP (bound index 0) and a floor obstacle from the
 * BOTTOM (bound index 1), mirroring the Flight pillar top/bottom art pattern
 * (Req 5.11, 5.12, 38.2). Resolved through the Asset_Registry with placeholder
 * fallback, tinted from the world4 palette.
 */
const WORLD4_CEILING_OBSTACLE_KEY = 'obstacle:ceiling_underwater_obstacle';
const WORLD4_FLOOR_OBSTACLE_KEY = 'obstacle:floor_underwater_obstacle';

/**
 * Thickness (px) of the drawn Transition_Pane marker at the water surface
 * (Req 5.3, 5.13, 46.4). A thin horizontal band pinned to the top of the play
 * area for this always-underwater World 4 slice; task 5.4 drives the real
 * water-surface crossing that would move/flip it.
 */
const TRANSITION_PANE_THICKNESS_PX = 6;

/**
 * Thickness (px) of each drawn Zigzag corridor wall. Visual only; the fatal
 * wall-contact bounds check uses the wall PLANES at `y = 0` (top) and
 * `y = groundY` (bottom), independent of this drawn thickness.
 */
const ZIGZAG_WALL_THICKNESS_PX = 10;

/**
 * Launch data MainMenuScene passes (`{ world, mode }`). Both are optional so a
 * direct/dev launch of this scene still runs the World 1 Jumping default.
 */
export interface GameplaySceneData {
  world?: WorldId;
  mode?: MovementMode;
  /**
   * SEAM(11.2): start the run DIRECTLY in the World-5 scripted finale (crawl →
   * run → jump, Req 8.7-8.15). Normally the SequenceDirector reaches the finale
   * Sequence at the end of the World-5 plan and the engine calls
   * {@link GameplayScene.startFinale}; this flag lets that wiring (and dev/test
   * launches) hand straight into the finale. Only meaningful for World 5.
   */
  finale?: boolean;
}

/**
 * The run-stats contract handed to RunEndScene (task 4.7) when a run ends. Kept
 * here (and re-exported from the engine barrel) so RunEndScene imports the same
 * shape rather than re-declaring it. Mirrors Req 39.1 (final score, obstacles
 * cleared, run time) plus the world/mode needed to pick the relevant High_Score
 * and to drive Retry (same world/mode).
 */
export interface RunEndData {
  /** Final credited score at the moment the run ended (Req 39.1). */
  finalScore: number;
  /** The world the run was in (Retry target + High_Score key, Req 39.1-39.3). */
  world: WorldId;
  /** The movement mode the run was in (Retry target + High_Score key). */
  mode: MovementMode;
  /** Count of obstacle units cleared this run (Req 39.1). */
  obstaclesCleared: number;
  /** Wall-clock run duration in milliseconds (Req 39.1). */
  runTimeMs: number;
}

/** Nominal Kino body size (px) used for the fixed-Kino footprint + hitbox. */
const KINO_BODY_WIDTH = 48;
const KINO_BODY_HEIGHT = 48;

/** Height (px) of the drawn ground strip at the bottom of the play area. */
const GROUND_STRIP_HEIGHT = 96;

/**
 * The widest single obstacle-unit horizontal footprint across worlds (the 64 px
 * Flight pillar / Underwater column), used to size the obstacle-view pool to
 * the worst-case on-screen count (task 12.3; Req 26.3). Mirrors the spawner's
 * per-mode footprint constants; kept here as the pool-sizing input only.
 */
const MAX_OBSTACLE_FOOTPRINT_PX = 64;

/**
 * Lookahead (px) beyond the right screen edge to lay obstacles out before they
 * scroll on. Keeps a unit's view ready the moment it should appear (Req 20.41).
 */
const SPAWN_LOOKAHEAD_PX = 240;

/** Reusable sentinel: one obstacle list passed to the collision system. */
type ObstacleList = readonly Obstacle[];

/**
 * A realized parallax layer view (task 12.2a; Req 30.3). Pairs the PURE
 * {@link ParallaxLayer} descriptor with its Phaser render Container (a
 * double-viewport-width band of comic-book styled tiles) so {@link
 * GameplayScene.updateParallax} can scroll it by the layer's `-scrollX * factor`
 * offset and wrap it seamlessly. `halftone` is the non-essential shading row
 * hidden at the bottom degradation rung; `baseY` records the band's center for
 * reference.
 */
interface ParallaxLayerView {
  container: Phaser.GameObjects.Container;
  layer: ParallaxLayer;
  /** Wrap width (one viewport width) for the seamless double-width band. */
  wrapWidth: number;
  halftone: Phaser.GameObjects.Container;
  baseY: number;
}

/**
 * A realized DECORATIVE environment-element view (task 12.2b; Req 27.1-27.12).
 * Pairs the PURE {@link EnvironmentElementPlacement} with its placeholder-
 * friendly comic-styled Phaser shape so {@link
 * GameplayScene.updateEnvironmentElements} can scroll it with its parallax
 * layer's `-scrollX * factor` offset. `depth` is drawn just BEHIND the matching
 * parallax band so near scenery overlays far scenery without ever reaching the
 * gameplay depth band — these are render-only decoration, NEVER collidable and
 * NEVER fed to the CollisionSystem / Obstacle pool.
 */
interface EnvironmentElementView {
  shape: Phaser.GameObjects.Rectangle;
  /** Flavor sign label (e.g. "Route 53"), drawn only when present. */
  label?: Phaser.GameObjects.Text | undefined;
  /** The parallax factor this element rides (far scenery drifts slower). */
  factor: number;
  /** World-space x of this repeat (screen x = worldX - scrollX). */
  worldX: number;
}

export class GameplayScene extends Phaser.Scene {
  // -- run configuration (from launch data) --------------------------------
  private world: WorldId = 1;
  private mode: MovementMode = 'jumping';

  // -- pure simulation core (Phaser-free) ----------------------------------
  private driver!: FixedTimestepDriver<boolean>;
  private movement!: MovementStateMachine;
  private spawner!: ObstacleSpawner;
  private scoring!: ScoringSystem;

  /**
   * SEAM(11.2): the PURE World-5 scripted-finale controller (crawl → run → jump,
   * Req 8.7-8.15, 45.5). Created lazily when the SequenceDirector reaches the
   * World-5 FINALE Sequence (the terminal `isFinale` spec from
   * `core.buildWorld5SequencePlan`). This vertical slice launches single-mode
   * runs directly and does not yet run the SequenceDirector, so the finale is
   * not reached here in the current flow — see {@link startFinale} /
   * {@link stepFinale} for the complete engine contract the SequenceDirector
   * wiring calls. `undefined` while no finale is active.
   */
  private finale: FinaleController | undefined = undefined;

  // -- scrolling model state (Req 45) --------------------------------------
  /** How far the world has scrolled leftward (world-space px, increasing). */
  private scrollX = 0;
  /** Kino's fixed horizontal screen position (left third, Req 45.1). */
  private kinoScreenX = 0;
  /** Y of the ground line obstacles + Kino rest on (world == screen space). */
  private groundY = 0;
  /** Play-area height passed to the spawner. */
  private playHeight = 0;
  /**
   * World-space lead-in (px) for the obstacle field so the FIRST unit enters
   * from off the right edge of the screen rather than spawning on top of Kino
   * at the start ? a clear runway that fixes the instant-collision at run start
   * (Req 45, 46.1). Set once in create() from the viewport width + lookahead.
   */
  private runLeadInPx = 0;

  // -- run bookkeeping ------------------------------------------------------
  private obstaclesCleared = 0;
  private runStartMs = 0;
  /** Latched once the run ends so the loop stops and we hand off exactly once. */
  private runEnded = false;

  // -- input ----------------------------------------------------------------
  /** Named `inputManager` (not `input`) to avoid shadowing Phaser.Scene.input. */
  private inputManager!: InputManager;

  // -- pause (Req 7.9-7.13) -------------------------------------------------
  /**
   * The run-pause controller (task 6.3). Owns the single source of truth for
   * whether the run is paused and freezes/unfreezes the fixed-timestep driver —
   * which halts movement, obstacle progression, scoring, and all skill timers
   * together (Req 7.10-7.12). The `update()` loop gates on `pauseControl.isPaused()`
   * so nothing advances while paused.
   */
  private pauseControl!: RunPauseController;

  // -- rendering handles ----------------------------------------------------
  private kinoSprite?: Phaser.GameObjects.Image;
  private kinoPlaceholder?: Phaser.GameObjects.Shape;
  /**
   * The Kino placeholder's BASE fill tint (set once in buildKino). The atomic
   * underwater overlay blends onto THIS each frame so it never compounds, and
   * clears back to it when underwater becomes false (Req 38.4).
   */
  private kinoPlaceholderBaseTint = 0xf5e6c8;
  /**
   * Live obstacle views keyed by `${obstacleId}:${boundIndex}`. The Rectangle
   * objects themselves come from {@link obstacleViewPool} and are ACQUIRED when
   * a unit enters the window and RELEASED (hidden + returned to the pool, NOT
   * destroyed) when it scrolls off-screen left (task 12.3; Req 26.3). The map
   * only tracks which pooled view currently backs which key; it never owns the
   * allocation.
   */
  private readonly obstacleViews = new Map<string, Phaser.GameObjects.Rectangle>();

  /**
   * The pre-allocated pool backing the obstacle Rectangle views (task 12.3;
   * design: "Obstacle & particle pooling"; Req 26.3, 26.5). Sized to the
   * worst-case simultaneous on-screen rect count via `worstCaseOnScreenCount`
   * so a steady-state run performs ZERO view allocations: `acquire` reuses a
   * released Rectangle (re-shown + repositioned) and `release` hides it and
   * returns it rather than destroying it. Created in {@link buildCoreSystems}.
   */
  private obstacleViewPool?: ObjectPool<Phaser.GameObjects.Rectangle>;

  /**
   * Reusable scratch set of the view keys live THIS frame, cleared and refilled
   * in {@link syncObstacleViews} rather than reallocated — part of keeping the
   * render hot path free of per-frame allocation (Req 26.3).
   */
  private readonly liveViewKeys = new Set<string>();

  /**
   * The graceful-degradation ladder (task 12.3; design: "graceful degradation
   * ladder"; Req 26.4, 26.9). Sampled each rendered frame with the real frame
   * delta WHILE gameplay is active; its current {@link QualitySettings} gate the
   * particle count / parallax detail / non-essential effects the render path
   * uses. Reset per run so degradation never carries across runs (scoped to
   * active gameplay). The particle + parallax renderers are later-task seams; we
   * apply the ladder where effects exist today (e.g. the zigzag marker cue as a
   * non-essential effect) and expose {@link quality} for those seams.
   */
  private degradation?: DegradationLadder;

  /** The current frame's resolved quality knobs (from {@link degradation}). */
  private quality: QualitySettings = {
    level: 0,
    particleScale: 1,
    parallaxScale: 1,
    nonEssentialEffects: true,
  };

  /**
   * The per-World multi-layer parallax stack for this run (task 12.2a; design:
   * "Visual Direction"; Req 30.3). The PURE far→near layer descriptors come
   * from `core.defaultParallaxLayers(world)`; each descriptor is realized here
   * as a {@link ParallaxLayerView} (a tiled band of comic-book styled shapes)
   * and scrolled by its own `-scrollX * factor` offset each frame so far layers
   * move slower than near layers and read as depth. Rebuilt per run in
   * {@link buildWorldBackground}; empty until then.
   */
  private parallaxLayers: readonly ParallaxLayer[] = [];

  /**
   * The realized render views for {@link parallaxLayers}, same order (far→near).
   * Each view is a Container of tiled shapes wide enough to cover the viewport
   * twice so it can wrap seamlessly as it scrolls. Depth is set per layer below
   * the ground/obstacle layers. Works for BOTH placeholder shapes (the current
   * state) and final art (Req 30.6) because the per-World palette tint + comic
   * styling are applied to whatever fills the band.
   */
  private parallaxViews: ParallaxLayerView[] = [];

  /**
   * The per-World DECORATIVE environment elements for this run (task 12.2b;
   * Req 27.1-27.12). The PURE catalog/placement comes from
   * `core.placeEnvironmentElements(world, scrollX, windowWidth)`; each repeat is
   * realized here as an {@link EnvironmentElementView} (a tinted comic-styled
   * placeholder shape, plus flavor signage text for elements carrying an
   * `awsFlavor` like "Route 53", Req 27.7) and scrolled by its parallax layer's
   * `-scrollX * factor` each frame so far scenery drifts slower than near. These
   * are render-only decoration: they are NEVER added to the collision list,
   * scored, or placed in the Obstacle pool. Keyed by the stable placement id so
   * views recycle as the world scrolls; empty until {@link buildWorldBackground}.
   */
  private readonly envElementViews = new Map<string, EnvironmentElementView>();

  /** Maps a parallax layer NAME to its scroll factor for env-element scrolling. */
  private readonly envLayerFactorByName = new Map<string, number>();

  /** Scratch set of env-element view keys live THIS frame (no per-frame alloc). */
  private readonly liveEnvKeys = new Set<string>();

  private scoreText?: Phaser.GameObjects.Text;

  /**
   * SEAM(5.2/8.3): the pointed-arrow Kino form shown DURING the zigzag segment.
   * A minimal triangle placeholder standing in for the full `spin-1/2` + arrow
   * Animation_Frames (task 8.3). It is purely cosmetic and never collides.
   */
  private kinoArrowForm: Phaser.GameObjects.Triangle | undefined;

  /**
   * SEAM(5.4): whether Kino is CURRENTLY underwater. Drives the atomic blue
   * underwater overlay (Req 5.3, 38.4, 38.7). In this always-underwater World 4
   * slice it is pinned true; task 5.4's water-surface crossing flips it so the
   * overlay applies to obstacles + Kino TOGETHER while underwater and is removed
   * immediately when underwater becomes false. Never set outside World 4.
   */
  private underwater = false;

  /**
   * The resolved underwater overlay descriptor (world4 `underwaterBlue`), or
   * `undefined` when this run has no such overlay configured.
   */
  private underwaterOverlay: { tint: number; alpha: number } | undefined = undefined;

  /**
   * The resolved ELEMENT-LEVEL palette application for this run's World (task
   * 12.2c; Req 27.13-27.14, 38.3-38.6), computed in {@link buildWorldBackground}
   * from the PURE `core.resolvePaletteApplication(palette, context)`. It carries
   * the composited background / obstacles / Kino treatments including any
   * ALWAYS-ON overlays declared in config (World 2 `lavaGlow`, World 5
   * `redAlert`), so the sky backdrop and element base tints reflect the config
   * overlay/tint DEFAULTS (Req 38.3). The GATED atomic underwater overlay is
   * applied separately each frame via {@link applyUnderwaterOverlay} so it can
   * flip with the underwater condition (Req 38.5-38.6); it is excluded from this
   * build-time context (which has no gates active).
   */
  private paletteApp?: PaletteApplication;

  /** Cached boot context (config/balance/assets/save). */
  private ctx!: KinoBootContext;

  /** SEAM(11.2): whether this launch should hand straight into the World-5 finale. */
  private finaleRequested = false;

  constructor() {
    super({ key: GAMEPLAY_SCENE_KEY });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Capture the launch data (`{ world, mode }`) before `create` runs. */
  init(data: GameplaySceneData): void {
    this.world = data.world ?? 1;
    this.mode = data.mode ?? 'jumping';

    // World 4 EXCLUDES Jumping (Req 5.8): the environment drives the mode and
    // World 4 is Underwater, so a world-4 launch that asks for Jumping (or any
    // mode defaulting to jumping) is forced to 'underwater'. This mirrors the
    // spawner, which emits no units for World 4 + Jumping.
    if (this.world === 4 && this.mode === 'jumping') {
      this.mode = 'underwater';
    }

    // SEAM(11.2): the World-5 scripted finale is reachable only in World 5 and
    // its Movement_Mode is Jumping (the only Jumping in World 5, Req 8.6).
    this.finaleRequested = data.finale === true && this.world === 5;

    // Reset per-run transient state so a scene restart (Retry) is clean.
    this.scrollX = 0;
    this.obstaclesCleared = 0;
    this.runEnded = false;
    this.finale = undefined;
    // Release any pooled views from a prior run (Retry restarts the scene) so
    // the next run starts with a full free list and allocates nothing, then
    // drop the key map + reset the ladder — degradation is scoped per run.
    this.obstacleViewPool?.releaseAll();
    this.obstacleViews.clear();
    this.liveViewKeys.clear();
    this.degradation?.reset();
    // Underwater is the standing condition for this World 4 slice (always on);
    // other worlds are never underwater (Req 5.3). SEAM(5.4) flips this.
    this.underwater = this.world === 4 && this.mode === 'underwater';
  }

  create(): void {
    this.ctx = getBootContext(this);
    const { width, height } = this.scale.gameSize;

    // Scrolling geometry: Kino sits on the left third; the ground strip sits at
    // the bottom; the play area is everything above the ground.
    this.kinoScreenX = Math.round(width / 3);
    this.groundY = height - GROUND_STRIP_HEIGHT;
    this.playHeight = this.groundY;
    // Clear runway: push the first obstacle just past the right edge so Kino
    // gets reaction time at the start instead of an instant collision.
    this.runLeadInPx = width + SPAWN_LOOKAHEAD_PX;

    this.buildWorldBackground(width, height);
    this.buildCoreSystems();
    this.buildKino();
    // SEAM(11.2): when the run is launched into the World-5 scripted finale,
    // hand control to the PURE finale controller (crawl → run → jump, Req
    // 8.7-8.15). The SequenceDirector wiring calls this at the finale Sequence
    // boundary; the `finale` launch flag lets that (and dev/test launches) route
    // straight in. The update loop then defers ALL phase decisions to it.
    if (this.finaleRequested) {
      this.startFinale();
    }
    // SEAM(5.4): the Flight→Zigzag telegraphed environment transition is task
    // 5.4. Until then World 3 launches DIRECTLY in zigzag for playability; we
    // still play the spin telegraph + pointed-arrow form on entry so 5.4 can
    // trigger the same visual at the real Flight→Zigzag boundary (Req 6.7-6.8).
    if (this.mode === 'zigzag') {
      this.enterZigzagArrowForm();
    }
    // World 4 Underwater: draw the Transition_Pane at the water surface and
    // resolve the atomic blue underwater overlay from the world4 palette
    // (Req 5.3, 5.13, 38.4, 38.7, 46.4). No-op for other worlds.
    if (this.mode === 'underwater') {
      this.resolveUnderwaterOverlay();
      this.buildTransitionPane(width);
    }
    this.buildHud(width);

    // Edge-triggered intents are read once per rendered frame and threaded into
    // the fixed-step driver so one press maps to exactly one jump (Req 26.2).
    this.inputManager = new InputManager(this, this.ctx.save.controlBindings);

    // Pause control over the driver (task 6.3). Pausing freezes the driver so
    // NOTHING advances — movement, obstacle progression, scoring, and (when
    // wired) all skill cooldown/effect timers hold together (Req 7.10-7.12);
    // resume continues from the held values (Req 7.12-7.13).
    this.pauseControl = createRunPauseController(this.driver);

    // A pause/resume key on the run itself (Req 7.9): ESC or P pauses when
    // running. (Resume is driven by the PauseScene overlay / its own key.)
    const keyboard = this.input.keyboard;
    if (keyboard) {
      keyboard.on('keydown-ESC', this.onPauseKey, this);
      keyboard.on('keydown-P', this.onPauseKey, this);
      this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
        keyboard.off('keydown-ESC', this.onPauseKey, this);
        keyboard.off('keydown-P', this.onPauseKey, this);
      });
    }

    this.runStartMs = this.time.now;
  }

  /**
   * The run loop (design: "The fixed-timestep driver"). Read input once
   * (edge-triggered), advance the pure core in fixed ticks, then render an
   * interpolated frame from the resulting state. `delta` is ms; the driver
   * works in seconds.
   */
  update(_time: number, deltaMs: number): void {
    if (this.runEnded) return;

    // PAUSED (Req 7.10-7.11): short-circuit so NOTHING advances — no input is
    // consumed, the driver is not stepped, and no frame is rendered. The driver
    // is ALSO frozen (the authoritative freeze), so even a stray step would run
    // zero ticks; this guard just avoids the work entirely. Pending input is
    // cleared so a press buffered while paused does not fire on resume.
    if (this.pauseControl.isPaused()) {
      this.inputManager.clearFrame();
      return;
    }

    // One edge-triggered read per rendered frame (Req 26.2). The same pressed
    // flag is threaded into the driver; the advance callback consumes it on the
    // first tick only so a single press is one jump regardless of tick count.
    const primaryPressed = this.inputManager.consumePrimaryPressed();
    let pressConsumed = false;

    this.driver.step(deltaMs / 1000, primaryPressed, (dt, pressed) => {
      if (this.runEnded) return;

      // SEAM(11.2): while the World-5 scripted finale owns the run, ALL phase
      // decisions (descent, scripted rightward crawl→run, jump gating, and the
      // jump-through → ending hand-off) come from the pure finale controller;
      // the normal movement/scoring/collision path below is skipped (Req
      // 8.7-8.15, 45.5). `this.finale` is only set once the SequenceDirector
      // reaches the finale Sequence (not in this single-mode slice).
      if (this.finale) {
        const consume = pressed && !pressConsumed;
        if (consume) pressConsumed = true;
        this.stepFinale(dt, consume);
        return;
      }

      // 1. Jump impulse on the frame's press (first tick only), then physics.
      if (pressed && !pressConsumed) {
        this.movement.applyPrimary();
        pressConsumed = true;
      }
      const state = this.movement.step(dt);

      // 2. Jumping only: keep Kino on/above the ground — the ground is a hard
      //    floor for Jumping (Req 2.2 returns Kino to the ground). Flight falls
      //    continuously with no resting floor (Req 3.2); the top/bottom pillars
      //    + the play-area bounds constrain play instead, so we do NOT clamp.
      if (this.mode === 'jumping') {
        this.clampToGround(state);
      }

      // 3. Advance the world leftward at the current scroll speed (Req 45).
      this.scrollX += this.spawner.scrollSpeed(this.difficulty()) * dt;

      // 4. Produce the current window of world-space obstacles.
      const obstacles = this.spawnCurrentWindow();

      // 5. Credit any obstacle whose scoring line Kino's world x has now
      //    surpassed (exactly once via the ScoringSystem; Req 2.3, 9.5).
      this.creditCrossings(obstacles);

      // 6. Zigzag ONLY: the hazard is the corridor BOUNDARY, not a scrolling
      //    obstacle. If Kino's body touches the top wall (y=0) or bottom wall
      //    (y=groundY) with no Protective_Skill active (none in this slice),
      //    the run ends (Req 4.8, 4.9, 44.4). Checked distinctly from the
      //    obstacle collision path below, which zigzag markers are excluded
      //    from (they are scoring cues, not hazards).
      if (this.mode === 'zigzag' && this.touchesZigzagWall(state)) {
        this.endRun();
        return;
      }

      // 7. Body-only collision against the on-screen obstacles. A touch of a
      //    hazard with no Protective_Skill active ends the run (Req 44.1,
      //    44.3). No skills exist in this slice, so any hit is fatal. Zigzag
      //    markers are scoring cues, not hazards, so the collision path is
      //    skipped for zigzag (its hazard is the wall check above).
      if (this.mode !== 'zigzag' && this.checkCollision(obstacles, state)) {
        this.endRun();
        return;
      }
    });

    if (this.runEnded) return;

    // Graceful degradation (Req 26.4, 26.9), scoped to ACTIVE gameplay: feed the
    // real rendered-frame time (ms) to the ladder and read back the quality
    // knobs the render path uses this frame. Under sustained overload the ladder
    // steps down (fewer particles → flatter parallax → no non-essential effects)
    // and recovers when headroom returns. We are past the pause/runEnded guards,
    // so this never runs for a paused/ended run (or for menus/cinematics, which
    // are other scenes). The particle + parallax renderers are later-task seams;
    // `this.quality` is applied where effects exist today (see renderFrame).
    if (this.degradation) {
      this.degradation.sample(deltaMs);
      this.quality = this.degradation.settings();
    }

    // Render the frame from the latest simulation state.
    this.renderFrame();
  }

  // -------------------------------------------------------------------------
  // Core system construction
  // -------------------------------------------------------------------------

  /**
   * Build the pure core: a 120 Hz fixed-step driver, the Jumping movement
   * machine seeded resting on the ground, the World 1 spawner, and the scoring
   * authority. All read tunables through the BalanceTable (Req 26.8).
   */
  private buildCoreSystems(): void {
    this.driver = createFixedTimestepDriver<boolean>();

    // Seed Kino's starting vertical position per mode. Jumping rests Kino on
    // the ground (body TOP at groundY - height so its base touches the ground
    // line). Flight falls continuously (Req 3.2) with no ground floor, so start
    // Kino mid-play-area so the first impulse has room above and gravity has
    // room below.
    const restY = this.groundY - KINO_BODY_HEIGHT;
    // Flight and Zigzag both start Kino mid-corridor: Flight so the first
    // impulse has room above and gravity room below (Req 3.2); Zigzag so the
    // diagonal has room to bounce toward either wall before the first reversal
    // (Req 4.8). Jumping starts resting on the ground.
    const midY = Math.round(this.playHeight / 2 - KINO_BODY_HEIGHT / 2);
    // Flight, Zigzag, and Underwater all start Kino mid-area (no resting floor):
    // Underwater buoyancy pushes Kino UP continuously and the primary is a
    // downward impulse (Req 5.1-5.2), so starting mid-corridor gives room to
    // sink and to be pushed back up. Jumping starts resting on the ground.
    const startY =
      this.mode === 'flight' ||
      this.mode === 'zigzag' ||
      this.mode === 'underwater'
        ? midY
        : restY;
    this.movement = createMovementStateMachine(this.ctx.balance, {
      mode: this.mode,
      y: startY,
      vy: 0,
      // Start the zigzag heading downward so the first primary press reverses
      // to an upward leg — a well-defined alternation from frame one (Req 4.1).
      diagonalDir: 'down',
    });

    this.spawner = createObstacleSpawner(this.ctx.balance, {
      groundY: this.groundY,
      playHeight: this.playHeight,
    });

    this.scoring = createScoringSystem();

    // Obstacle-view object pool (task 12.3; Req 26.3, 26.5). Size to the
    // worst-case simultaneous on-screen rect count from the tightest density
    // (`minGapPx`), the viewport width + lookahead, and the widest single-unit
    // footprint — with boundsPerUnit=2 so Flight/Underwater PAIRS (two rects
    // per unit) are covered — plus a safety margin. The pool hands out hidden,
    // reusable Rectangles that `syncObstacleViews` positions; releasing a view
    // hides it and returns it rather than destroying it, so steady-state runs
    // allocate no views. The factory is only called while warming to the
    // working set (capped at capacity).
    const viewportWidth = this.scale.gameSize.width + SPAWN_LOOKAHEAD_PX;
    const poolCapacity = worstCaseOnScreenCount(
      viewportWidth,
      this.ctx.balance.minGapPx(),
      MAX_OBSTACLE_FOOTPRINT_PX,
    );
    this.obstacleViewPool = createObjectPool<Phaser.GameObjects.Rectangle>({
      capacity: poolCapacity,
      factory: () => {
        const view = this.add.rectangle(0, 0, 1, 1, 0xffffff).setDepth(2);
        view.setVisible(false);
        return view;
      },
      // On acquire, re-show a recycled view at full opacity; callers overwrite
      // size/position/tint immediately after. (A released view was hidden.)
      reset: (view) => {
        view.setVisible(true);
        view.setAlpha(1);
      },
    });

    // The graceful-degradation ladder (task 12.3; Req 26.4, 26.9). The default
    // ~16.6 ms down threshold is the 60 fps budget; hysteresis + sustain
    // windows keep it from flapping. Sampled per frame in `update` ONLY while
    // the run is live (scoped to active gameplay).
    this.degradation = createDegradationLadder();
    this.quality = this.degradation.settings();
  }

  /** The difficulty dial for the current run (ramps with cleared obstacles). */
  private difficulty(): { ramp: number; obstaclesCleared: number } {
    // A gentle ramp tied to cleared obstacles so the slice gets harder over a
    // run without a separate schedule. Clamped to [0,1] inside the spawner.
    return {
      ramp: Math.min(1, this.obstaclesCleared / 40),
      obstaclesCleared: this.obstaclesCleared,
    };
  }

  // -------------------------------------------------------------------------
  // Fixed-step simulation helpers (operate on pure core state)
  // -------------------------------------------------------------------------

  /**
   * Clamp Kino to rest on the ground. The movement machine owns `y`/`vy` but
   * does not know the ground line (it is pure); the scene applies the ground as
   * a floor. When Kino lands, zero the downward velocity so gravity does not
   * keep accumulating below the ground (Req 2.2 "return Kino to the ground").
   *
   * NOTE: the movement machine is the authority on y, so we re-seed it via a
   * no-op that keeps its internal y in sync — done by reading the state it just
   * returned and writing back through a floor clamp on the NEXT applyPrimary.
   * Because the machine exposes no y setter, we instead track the floor here
   * and mirror it: the machine integrates freely, and the scene treats any y
   * past the floor as resting for rendering + collision. To keep the machine's
   * internal y from drifting unbounded below the floor, we re-create it only on
   * landing is unnecessary — the clamp below mutates the snapshot we render and
   * collide against, and we reset vy through applyPrimary's impulse on the next
   * jump. For the vertical slice this is sufficient and deterministic.
   */
  private clampToGround(state: MovementState): void {
    const floorY = this.groundY - KINO_BODY_HEIGHT;
    if (state.y > floorY) {
      state.y = floorY;
      if (state.vy > 0) state.vy = 0;
    }
  }

  /**
   * Lay out the current world-space obstacle window: from the current scroll
   * position to one viewport width + lookahead ahead, so units exist before
   * they slide on from the right (Req 20.41). Stable ids let views recycle.
   */
  private spawnCurrentWindow(): Obstacle[] {
    const width = this.scale.gameSize.width;
    return this.spawner.spawnWindow({
      scrollX: this.scrollX,
      windowWidth: width + SPAWN_LOOKAHEAD_PX,
      leadInPx: this.runLeadInPx,
      world: this.world,
      mode: this.mode,
      difficulty: this.difficulty(),
    });
  }

  /**
   * Credit every obstacle whose `scoringLineX` Kino's WORLD x has surpassed and
   * which has not yet been credited (design: Scoring_Event mechanism). Kino's
   * world x is `kinoScreenX + scrollX`; an obstacle clears when its scoring line
   * is now behind that point. The ScoringSystem latch guarantees exactly-once
   * (Req 2.3, 9.1, 9.5), so re-passing a window cannot double count.
   */
  private creditCrossings(obstacles: ObstacleList): void {
    const kinoWorldX = this.kinoScreenX + this.scrollX;
    for (const obstacle of obstacles) {
      if (obstacle.scoringLineX > kinoWorldX) continue; // not yet surpassed
      if (this.scoring.hasCredited(obstacle.id)) continue; // already counted
      const event = this.scoring.credit(obstacle.id, this.mode);
      if (event) {
        this.obstaclesCleared += 1;
        // Immediately reflect the new score on the HUD (Req 9.5, 20.39).
        this.updateScoreText();
      }
    }
  }

  /**
   * Body-only collision in WORLD space. Kino's body top-left is at
   * (kinoScreenX + scrollX, state.y); obstacle bounds are already world-space.
   * The CollisionSystem shrinks the body to the fair per-mode hitbox and tests
   * the single shared AABB (Req 41, 44.13). Returns true on any overlap.
   */
  private checkCollision(obstacles: ObstacleList, state: MovementState): boolean {
    const body = {
      x: this.kinoScreenX + this.scrollX,
      y: state.y,
      width: KINO_BODY_WIDTH,
      height: KINO_BODY_HEIGHT,
    };
    // Rebuilt per tick as Kino moves (cheap — four numbers); keeps the core
    // pure (the system never mutates its captured body).
    const collision = createCollisionSystem(body, this.ctx.balance);
    return collision.check(obstacles, this.mode).collided;
  }

  /**
   * Zigzag wall-contact test (Req 4.8, 4.9, 44.4). The corridor is bounded by a
   * top wall at the play-area ceiling (`y = 0`) and a bottom wall at the ground
   * line (`y = groundY`). Kino's body spans `[state.y, state.y + height]`; a
   * contact is the body reaching or passing either plane. We shrink the body to
   * the same fair per-mode hitbox the CollisionSystem uses so the wall check is
   * as lenient as obstacle collisions (Req 41) rather than punishing the full
   * sprite footprint.
   *
   * SEAM(6.x): "no Protective_Skill active" is always true in this slice (no
   * skills exist yet). When SkillSystem lands, gate this death on the absence of
   * an active Protective_Skill exactly as the obstacle path will.
   */
  private touchesZigzagWall(state: MovementState): boolean {
    const scale = this.ctx.balance.hitboxScale('zigzag');
    const inset = (KINO_BODY_HEIGHT * (1 - scale)) / 2;
    const top = state.y + inset;
    const bottom = state.y + KINO_BODY_HEIGHT - inset;
    return top <= 0 || bottom >= this.groundY;
  }

  // -------------------------------------------------------------------------
  // Rendering
  // -------------------------------------------------------------------------

  /**
   * The color palette for the active world (World 1 vs World 2). Flight runs
   * use the World 2 (Foundry) palette; everything else falls back to World 1.
   */
  private worldPalette() {
    switch (this.world) {
      case 2:
        return this.ctx.config.colorPalettes.world2;
      case 3:
        return this.ctx.config.colorPalettes.world3;
      case 4:
        return this.ctx.config.colorPalettes.world4;
      default:
        return this.ctx.config.colorPalettes.world1;
    }
  }

  /**
   * The build-time render context for the pure palette resolver (task 12.2c;
   * Req 38.3-38.4). It declares NO gate conditions active, so
   * {@link resolvePaletteApplication} composites only ALWAYS-ON overlays into
   * the element base treatments (the config overlay/tint defaults). The GATED
   * atomic underwater overlay (`appliesWhen: 'underwaterSequence'`) is applied
   * separately each frame by {@link applyUnderwaterOverlay} so it can appear and
   * be REMOVED in lock-step with the underwater condition (Req 38.5-38.6).
   */
  private buildPaletteContext(): RenderContext {
    return {};
  }

  /**
   * Multi-layer parallax world background + ground strip (task 12.2a; Req 30.1,
   * 30.2, 30.3, 30.6). The sky backdrop is the flat saturated palette fill; on
   * top of it we build the per-World multi-layer parallax stack from the PURE
   * `core.defaultParallaxLayers(world)` model — each layer a comic-book styled
   * band tinted from the per-World Color_Palette with strong contrast — and
   * scroll each by its own `-scrollX * factor` offset each frame (Req 30.3). The
   * same styling works for placeholder shapes and real art (Req 30.6).
   */
  private buildWorldBackground(width: number, height: number): void {
    const palette = this.worldPalette();
    // Resolve the ELEMENT-LEVEL palette treatment (task 12.2c; Req 27.13-27.14,
    // 38.3). The build-time context has NO gates active, so this composites only
    // the ALWAYS-ON overlays declared in config (e.g. World 2 `lavaGlow`, World 5
    // `redAlert` background tints); the GATED atomic underwater overlay is left
    // for the per-frame pass so it can flip with the condition (Req 38.5-38.6).
    this.paletteApp = resolvePaletteApplication(palette, this.buildPaletteContext());
    const bgTint = rgbToNumber(this.paletteApp.background.color);
    const groundTint = rgbToNumber(this.paletteApp.obstacles.color);

    // Sky / world backdrop — the saturated, strong-contrast palette fill the
    // parallax layers sit in front of (Req 30.2), with any config-default
    // background overlay/tint already composited in (Req 38.3).
    this.add.rectangle(width / 2, height / 2, width, height, bgTint).setDepth(-10);

    // Multi-layer parallax stack, back (far) to front (near), Req 30.3.
    this.buildParallaxLayers(width, height);

    // Ground strip at the bottom of the play area (Req 20.41 ground presence).
    this.add
      .rectangle(
        width / 2,
        this.groundY + GROUND_STRIP_HEIGHT / 2,
        width,
        GROUND_STRIP_HEIGHT,
        groundTint,
      )
      .setDepth(-5);
    // A thin ground line marks exactly where obstacles + Kino rest.
    this.add
      .rectangle(width / 2, this.groundY, width, 3, 0x000000, 0.35)
      .setDepth(-4);

    // Zigzag ONLY: draw the TOP and BOTTOM walls that bound the corridor Kino
    // bounces between (Req 4.8, 46.3). They are the hazard; contacting either
    // ends the run (handled by `touchesZigzagWall`). Drawn full-width and
    // static (they do not scroll — they ARE the play-area boundary).
    if (this.mode === 'zigzag') {
      this.buildZigzagWalls(width);
    }
  }

  /**
   * Build the per-World MULTI-LAYER PARALLAX stack (task 12.2a; Req 30.3) from
   * the PURE `core.defaultParallaxLayers(world)` descriptors (ordered far→near
   * with non-decreasing scroll factors). Each layer becomes a comic-book styled
   * BAND of repeating shapes tinted from the per-World Color_Palette with strong
   * contrast (Req 30.1, 30.2): a cel-shaded fill, a thick dark outline, and a
   * subtle halftone dot overlay. The band is drawn twice the viewport width so
   * it can wrap seamlessly as it scrolls by its own `-scrollX * factor` each
   * frame. This is placeholder-friendly: when the World has no real background
   * texture (`worldBackgrounds[worldN] === ''`) we draw tinted placeholder
   * shapes so the parallax still reads; real art swaps in later via the same
   * seam without touching this geometry (Req 30.6).
   */
  private buildParallaxLayers(width: number, height: number): void {
    // Tear down any views from a prior build (Retry restarts the scene).
    for (const view of this.parallaxViews) view.container.destroy(true);
    this.parallaxViews = [];

    // Tear down decorative environment-element views from a prior build too.
    for (const [, view] of this.envElementViews) {
      view.shape.destroy();
      view.label?.destroy();
    }
    this.envElementViews.clear();
    this.liveEnvKeys.clear();

    this.parallaxLayers = defaultParallaxLayers(this.world);
    const palette = this.worldPalette();
    const n = this.parallaxLayers.length;

    // Index each layer's scroll factor by name so the decorative environment
    // elements (task 12.2b) can ride their layer at the same speed.
    this.envLayerFactorByName.clear();
    for (const layer of this.parallaxLayers) {
      this.envLayerFactorByName.set(layer.name, layer.factor);
    }

    this.parallaxLayers.forEach((layer, i) => {
      // Far layers sit lowest (just above the sky backdrop at -10); near layers
      // sit just below the ground strip (-5). Map the far→near index into that
      // depth band so the stack draws back-to-front correctly.
      const depth = -9 + (i / Math.max(1, n - 1)) * 3; // -9 (far) .. -6 (near)
      const view = this.buildParallaxLayerView(layer, i, n, width, height, palette);
      view.container.setDepth(depth);
      this.parallaxViews.push(view);
    });

    // Position them for the initial (scrollX = 0) frame and apply the current
    // degradation detail level.
    this.updateParallax();

    // Seed the per-World DECORATIVE environment elements on their layers for the
    // initial frame (task 12.2b; Req 27.1-27.12). Render-only; NEVER collidable.
    this.updateEnvironmentElements();
  }

  /**
   * Realize ONE parallax layer as a wrapping comic-book band. The band fills a
   * horizontal slice of the viewport whose vertical position tracks the layer's
   * depth (far layers higher/thinner silhouettes, near layers lower/larger),
   * built from repeating tiles so two band-widths of content exist for seamless
   * wrapping. Styling (cel-shaded fill, thick outline, halftone) is applied by
   * {@link styleComicBand} so it is identical for placeholder and final art.
   */
  private buildParallaxLayerView(
    layer: ParallaxLayer,
    index: number,
    count: number,
    width: number,
    height: number,
    palette: ReturnType<GameplayScene['worldPalette']>,
  ): ParallaxLayerView {
    const container = this.add.container(0, 0);

    // Depth fraction 0 (far) .. 1 (near); near layers are taller and lower.
    const depthFrac = count <= 1 ? 1 : index / (count - 1);
    const bandHeight = Math.round(height * (0.22 + depthFrac * 0.33));
    const bandBottom = this.groundY; // bands rest their foot on the ground line
    const bandTop = Math.max(0, bandBottom - bandHeight);
    const bandCenterY = (bandTop + bandBottom) / 2;

    // Tint: blend the palette BACKGROUND (far) toward the OBSTACLE tone (near)
    // so near layers contrast more strongly against the sky (Req 30.2). Darker
    // (lower lightness) for nearer layers reinforces foreground-to-background
    // contrast.
    const bgTint = hexToNumber(palette.background);
    const obsTint = hexToNumber(palette.obstacles);
    const fillTint = blendTint(bgTint, obsTint, depthFrac * 0.85);

    // The band spans TWO viewport widths so it wraps seamlessly: build repeated
    // "silhouette" tiles across that span. Tile width shrinks for nearer layers
    // so they show more detail/motion.
    const spanWidth = width * 2;
    const tileWidth = Math.max(48, Math.round(width / (3 + index * 2)));
    const tileCount = Math.ceil(spanWidth / tileWidth) + 1;

    for (let t = 0; t < tileCount; t++) {
      const x = t * tileWidth + tileWidth / 2;
      // Alternate silhouette heights for a hand-drawn, irregular comic skyline.
      const jitter = (t % 2 === 0 ? 0.82 : 1) * (0.7 + depthFrac * 0.3);
      const shapeH = Math.round(bandHeight * jitter);
      const shapeY = bandBottom - shapeH / 2;
      const shape = this.add.rectangle(x, shapeY, tileWidth - 6, shapeH, fillTint);
      this.styleComicBand(shape, depthFrac);
      container.add(shape);
    }

    // A subtle halftone-dot overlay row near the band's crest sells the
    // comic-book shading without a texture (Req 30.1). Non-essential: it is
    // hidden at the bottom degradation rung alongside other extras.
    const halftone = this.buildHalftoneRow(spanWidth, bandTop, tileWidth, fillTint);
    container.add(halftone);

    return {
      container,
      layer,
      wrapWidth: width, // wrap after one viewport width of travel
      halftone,
      baseY: bandCenterY,
    };
  }

  /**
   * Apply the comic-book render treatment to a band shape (Req 30.1, 30.6):
   * a thick irregular-reading black outline (cel outline) and a flat cel-shaded
   * fill. Kept in one place so placeholder shapes and swapped-in art get the
   * SAME treatment. `depthFrac` thickens the outline slightly for nearer layers.
   */
  private styleComicBand(shape: Phaser.GameObjects.Rectangle, depthFrac: number): void {
    const outline = 3 + Math.round(depthFrac * 3); // thicker outline up close
    shape.setStrokeStyle(outline, 0x101014, 0.9);
  }

  /**
   * Build a thin row of halftone dots across the band crest — the comic-book
   * shading cue (Req 30.1). Returns a Container of small circles; it is tagged
   * as a non-essential effect so the degradation ladder can hide it.
   */
  private buildHalftoneRow(
    spanWidth: number,
    y: number,
    spacing: number,
    tint: number,
  ): Phaser.GameObjects.Container {
    const row = this.add.container(0, 0);
    const dotSpacing = Math.max(18, Math.round(spacing / 4));
    const dotTint = blendTint(tint, 0xffffff, 0.35);
    for (let x = dotSpacing / 2; x < spanWidth; x += dotSpacing) {
      const dot = this.add.circle(x, y + 10, 3, dotTint, 0.5);
      row.add(dot);
    }
    return row;
  }

  /**
   * Scroll + detail-manage the parallax stack each frame (task 12.2a; Req 30.3,
   * 26.9). For each layer we compute its PURE `-scrollX * factor` offset and
   * wrap it into `[-wrapWidth, 0]` so the double-width band tiles seamlessly as
   * the world scrolls. The degradation ladder's `parallaxScale` selects how many
   * layers stay visible via `core.visibleParallaxLayers` (farthest dropped
   * first, nearest always kept); dropped layers are hidden rather than
   * destroyed so they restore instantly when headroom returns. The halftone
   * overlay rows are hidden when non-essential effects are off (bottom rung).
   */
  private updateParallax(): void {
    if (this.parallaxViews.length === 0) return;

    const visible = visibleParallaxLayers(this.parallaxLayers, this.quality.parallaxScale);
    const visibleSet = new Set<ParallaxLayer>(visible);

    for (const view of this.parallaxViews) {
      const show = visibleSet.has(view.layer);
      view.container.setVisible(show);
      if (!show) continue;

      // Pure geometry: far layers move slower than near layers (Req 30.3).
      const raw = parallaxOffset(view.layer.factor, this.scrollX);
      // Wrap into one viewport width so the double-width band repeats seamlessly.
      const wrapped = view.wrapWidth > 0 ? wrapOffset(raw, view.wrapWidth) : raw;
      view.container.x = wrapped;

      // Halftone shading is a non-essential extra (Req 26.9).
      view.halftone.setVisible(this.quality.nonEssentialEffects);
    }
  }

  /**
   * Scroll + recycle the per-World DECORATIVE environment elements each frame
   * (task 12.2b; Req 27.1-27.12). The PURE `core.placeEnvironmentElements` lays
   * out every repeat in the current world-space scroll window on a per-kind grid
   * anchored at x=0 (deterministic, window-stable ids); for each placement we
   * ACQUIRE/REUSE a placeholder comic-styled shape (plus flavor signage text for
   * elements carrying an `awsFlavor` like "Route 53", Req 27.7), positioned at
   * `worldX - scrollX` so it slides in from the right, and OFFSET additionally
   * by its parallax layer's `-scrollX * factor` so far scenery drifts slower
   * than near (shares the task-12.2a depth geometry). Views whose placement left
   * the window are hidden and dropped. The degradation ladder sheds decorative
   * elements as detail drops: at the bottom rung (non-essential effects off) we
   * draw nothing. These shapes are RENDER-ONLY — they are never added to the
   * collision list, scored, or pooled as Obstacles (Req 41/44 unaffected).
   */
  private updateEnvironmentElements(): void {
    const width = this.scale.gameSize.width;
    this.liveEnvKeys.clear();

    // Degradation: shed ALL decorative scenery at the bottom rung (Req 26.9).
    if (!this.quality.nonEssentialEffects) {
      for (const [, view] of this.envElementViews) {
        view.shape.setVisible(false);
        view.label?.setVisible(false);
      }
      return;
    }

    const palette = this.worldPalette();
    const placements = placeEnvironmentElements(
      this.world,
      this.scrollX - SPAWN_LOOKAHEAD_PX,
      width + 2 * SPAWN_LOOKAHEAD_PX,
    );

    for (const placement of placements) {
      this.liveEnvKeys.add(placement.id);
      let view = this.envElementViews.get(placement.id);
      if (!view) {
        view = this.buildEnvironmentElementView(placement, palette);
        this.envElementViews.set(placement.id, view);
      }
      view.shape.setVisible(true);
      // Screen x = worldX - scrollX, with the parallax factor applied so the
      // scenery rides its layer's depth speed (task 12.2a geometry).
      const factor = this.envLayerFactorByName.get(placement.spec.parallaxLayer) ?? 1;
      const screenX = placement.worldX - this.scrollX * factor;
      view.shape.x = screenX;
      if (view.label) {
        view.label.setVisible(true);
        view.label.x = screenX;
      }
    }

    // Drop any decorative view no longer in the window (render-only culling).
    for (const [key, view] of this.envElementViews) {
      if (!this.liveEnvKeys.has(key)) {
        view.shape.destroy();
        view.label?.destroy();
        this.envElementViews.delete(key);
      }
    }
  }

  /**
   * Realize ONE decorative environment element as a placeholder-friendly comic-
   * styled shape (task 12.2b; Req 27.1-27.12, 30.1, 30.6). The size hint maps to
   * a footprint, the vertical band fraction to a y on the play area, and the
   * tint blends the per-World palette (near scenery contrasts more). Elements
   * carrying an AWS `awsFlavor` reference also get a small signage label drawn
   * over them as in-world flavor (Req 27.7) — decorative only. Depth sits just
   * BEHIND the gameplay layer but IN FRONT of the parallax bands so scenery
   * reads as foreground decoration without ever entering the collision path.
   */
  private buildEnvironmentElementView(
    placement: EnvironmentElementPlacement,
    palette: ReturnType<GameplayScene['worldPalette']>,
  ): EnvironmentElementView {
    const spec: EnvironmentElementSpec = placement.spec;
    const factor = this.envLayerFactorByName.get(spec.parallaxLayer) ?? 1;

    // Size hint -> footprint (scaled gently by play height for larger scenery).
    const base =
      spec.size === 'large' ? 120 : spec.size === 'medium' ? 72 : 40;
    const w = Math.round(base * (0.6 + factor * 0.6));
    const h = Math.round(base * (0.6 + factor * 0.6));
    const y = Math.round(spec.yBand * this.groundY);

    // Tint: blend the palette BACKGROUND toward OBSTACLE tone by depth so near
    // decorative scenery contrasts more strongly (Req 30.2). Placeholder-
    // friendly — real art swaps in via the same seam (Req 30.6).
    const fillTint = blendTint(
      hexToNumber(palette.background),
      hexToNumber(palette.obstacles),
      0.4 + factor * 0.4,
    );

    // Screen depth: in front of the parallax bands (-6..-9) and the ground
    // strip (-5), behind the gameplay layer. Far scenery lower, near higher.
    const depth = -4.5 + factor * 0.4;

    const shape = this.add
      .rectangle(placement.worldX - this.scrollX * factor, y, w, h, fillTint)
      .setDepth(depth);
    // Thick comic outline, matching the parallax band treatment (Req 30.1).
    shape.setStrokeStyle(3, 0x101014, 0.9);

    let label: Phaser.GameObjects.Text | undefined;
    if (spec.awsFlavor) {
      // In-world flavor signage (e.g. "Route 53"), decorative only (Req 27.7).
      label = this.add
        .text(placement.worldX - this.scrollX * factor, y - h / 2 - 12, spec.awsFlavor, {
          fontFamily: 'monospace',
          fontSize: '12px',
          color: '#101014',
          backgroundColor: '#f5e6c8',
          padding: { x: 4, y: 2 },
        })
        .setOrigin(0.5, 1)
        .setDepth(depth + 0.1);
    }

    return { shape, label, factor, worldX: placement.worldX };
  }

  /**
   * Draw the two static Zigzag corridor walls — top at the ceiling (`y = 0`)
   * and bottom at the ground line (`y = groundY`) — tinted from the world3
   * palette with a placeholder fallback via `obstacle:world3_zigzag_wall`
   * (Req 4.8, 46.3, 24.10). Visual only; the fatal bounds check uses the wall
   * PLANES, not these drawn strips.
   */
  private buildZigzagWalls(width: number): void {
    const palette = this.worldPalette();
    const wallTint = this.resolvedTint(WORLD3_ZIGZAG_WALL_KEY, palette.obstacles);
    const t = ZIGZAG_WALL_THICKNESS_PX;
    // Top wall hangs from the ceiling plane y=0 downward.
    this.add
      .rectangle(width / 2, t / 2, width, t, wallTint)
      .setDepth(2);
    // Bottom wall sits with its top edge on the ground plane y=groundY.
    this.add
      .rectangle(width / 2, this.groundY + t / 2, width, t, wallTint)
      .setDepth(2);
  }

  /**
   * Resolve the atomic blue underwater overlay from the world4 palette
   * (`underwaterBlue`, Req 5.3, 38.4, 38.7). The config declares it with
   * `target: 'obstacles+kino'` (atomic — both tinted TOGETHER) and
   * `appliesWhen: 'underwaterSequence'` (only while the underwater condition
   * holds). We read the FIRST overlay whose `target` is the atomic
   * obstacles+kino pair and whose gate is the underwater sequence; if the
   * config omits it we leave `underwaterOverlay` undefined (overlay is simply a
   * no-op, matching the placeholder-tolerant philosophy).
   */
  private resolveUnderwaterOverlay(): void {
    // Route through the PURE palette resolver so there is ONE source of truth
    // for which overlays apply and how they composite (task 12.2c; Req 38.3-38.6).
    // Resolve the World-4 palette with the underwater gate ACTIVE, then read the
    // atomic obstacles+kino overlay the resolver surfaced (it emits the SAME
    // overlay into both the obstacles and Kino treatments — the atomic coupling).
    // If the config omits it the list is empty and we leave the overlay
    // undefined (a no-op, matching the placeholder-tolerant philosophy).
    const app = resolvePaletteApplication(
      this.ctx.config.colorPalettes.world4,
      { underwaterSequence: true },
    );
    const atomic = app.obstacles.overlays.find(
      (o) => o.target === ATOMIC_OBSTACLES_KINO_TARGET,
    );
    if (!atomic) {
      this.underwaterOverlay = undefined;
      return;
    }
    this.underwaterOverlay = {
      tint: hexToNumber(atomic.tintHex),
      alpha: clamp01(atomic.alpha),
    };
  }

  /**
   * Draw the Transition_Pane at the water surface (Req 5.3, 5.13, 46.4). For
   * this always-underwater World 4 slice the whole play area is below the
   * surface, so the pane is a distinct thin band pinned to the TOP of the play
   * area (`y = 0`) marking where the surface sits. It is a static visual marker
   * (full width, non-collidable); task 5.4 drives the real water-surface
   * crossing that would reposition/flip it as Kino dives under and surfaces.
   */
  private buildTransitionPane(width: number): void {
    const palette = this.worldPalette();
    // Tint toward the overlay blue if present, else the palette kino tone, so
    // the pane reads as the water surface distinct from the backdrop.
    const tint = this.underwaterOverlay
      ? this.underwaterOverlay.tint
      : hexToNumber(palette.kino);
    const t = TRANSITION_PANE_THICKNESS_PX;
    // Static full-width marker pinned to the surface (top of the play area).
    // SEAM(5.4): the water-surface crossing would reposition/flip this.
    this.add.rectangle(width / 2, t / 2, width, t, tint, 0.9).setDepth(3);
  }

  /**
   * Build Kino at its fixed screen x. Resolve the starter sprite through the
   * Asset_Registry: real texture renders as an image, else a tinted geometric
   * placeholder (Req 24.1-24.3, 24.10) — identical collision/physics either way.
   */
  private buildKino(): void {
    const resolved = this.ctx.assets.resolve(KINO_SPRITE_KEY);
    const restCenterY = this.groundY - KINO_BODY_HEIGHT / 2;

    if (resolved.source === 'real' && this.textures.exists(KINO_SPRITE_KEY)) {
      const img = this.add
        .image(this.kinoScreenX + KINO_BODY_WIDTH / 2, restCenterY, KINO_SPRITE_KEY)
        .setOrigin(0.5, 0.5)
        .setDepth(5);
      const scale = Math.min(
        KINO_BODY_WIDTH / img.width,
        KINO_BODY_HEIGHT / img.height,
        1,
      );
      img.setScale(scale);
      this.kinoSprite = img;
      return;
    }

    // Placeholder path: a tinted shape sized to the body footprint.
    const ph = resolved.placeholder;
    const tint = ph ? hexToNumber(ph.tint) : 0xf5e6c8;
    const shape =
      ph && ph.kind === 'circle'
        ? this.add.circle(
            this.kinoScreenX + KINO_BODY_WIDTH / 2,
            restCenterY,
            KINO_BODY_WIDTH / 2,
            tint,
          )
        : this.add.rectangle(
            this.kinoScreenX + KINO_BODY_WIDTH / 2,
            restCenterY,
            KINO_BODY_WIDTH,
            KINO_BODY_HEIGHT,
            tint,
          );
    shape.setDepth(5);
    this.kinoPlaceholder = shape;
    this.kinoPlaceholderBaseTint = tint;
  }

  /**
   * SEAM(5.2/8.3): build the pointed-arrow Kino form for the zigzag segment and
   * play the entry spin telegraph (Req 6.7). This is the MINIMAL stand-in the
   * task calls for: a triangle "arrow" that replaces the normal Kino visual
   * while in zigzag, plus a short spin tween on entry. Task 8.3 swaps this for
   * the real `spin-1/2` spin cycle + zigzag Animation_Frames; task 5.4 drives
   * the Flight→Zigzag environment transition that TRIGGERS this (we enter
   * zigzag directly here for playability until then — see `// SEAM(5.4)`).
   *
   * Called only when the run launches in zigzag; the arrow sits on top of the
   * normal Kino visual (which we hide) and is purely cosmetic (never collides).
   */
  private enterZigzagArrowForm(): void {
    const palette = this.worldPalette();
    const tint = hexToNumber(palette.kino);
    const cx = this.kinoScreenX + KINO_BODY_WIDTH / 2;
    const cy = this.groundY / 2;
    const h = KINO_BODY_HEIGHT;
    const w = KINO_BODY_WIDTH;

    // A right-pointing triangle: the "pointed arrow form" for the diagonal.
    const arrow = this.add
      .triangle(cx, cy, 0, 0, 0, h, w, h / 2, tint)
      .setOrigin(0.5, 0.5)
      .setDepth(6);
    this.kinoArrowForm = arrow;

    // Hide the normal Kino visual while the arrow form is active (Req 6.7).
    this.kinoSprite?.setVisible(false);
    this.kinoPlaceholder?.setVisible(false);

    // Entry spin telegraph: one quick full rotation settling at 0 (Req 6.7).
    // SEAM(8.3): a tween stands in for the spin-1/2 frame cycle.
    arrow.setAngle(0);
    this.tweens.add({
      targets: arrow,
      angle: 360,
      duration: 260,
      ease: 'Cubic.easeOut',
    });
  }

  /**
   * SEAM(5.2/8.3): reverse the spin back to the Flight form when the zigzag
   * segment ends (Req 6.8). Plays a reverse spin on the arrow, then restores
   * the normal Kino visual and removes the arrow form.
   *
   * PUBLIC on purpose: this is the API seam task 5.4's SequenceDirector calls at
   * a Zigzag→Flight segment boundary. It is NOT invoked within this slice (we
   * run a single continuous zigzag segment for playability — see
   * `// SEAM(5.4)`), but it is implemented and exposed so 5.4 can trigger it.
   */
  exitZigzagArrowForm(): void {
    const arrow = this.kinoArrowForm;
    if (!arrow) return;
    this.tweens.add({
      targets: arrow,
      angle: -360,
      duration: 260,
      ease: 'Cubic.easeIn',
      onComplete: () => {
        arrow.destroy();
        if (this.kinoArrowForm === arrow) {
          this.kinoArrowForm = undefined;
        }
        this.kinoSprite?.setVisible(true);
        this.kinoPlaceholder?.setVisible(true);
      },
    });
  }

  /** Score text at the top of the HUD + a Menu control (Req 20.39, 20.40). */
  private buildHud(width: number): void {
    this.scoreText = this.add
      .text(width / 2, 24, this.scoreLabel(), {
        fontFamily: 'monospace',
        fontSize: '32px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0)
      .setDepth(100);

    this.addMenuControl(width);
    this.addPauseControl(width);
  }

  /**
   * Render one frame from the current simulation state: position Kino
   * vertically, update its grounded/airborne visual, and sync obstacle views to
   * their screen positions (recycling by stable id).
   */
  private renderFrame(): void {
    // Scroll the multi-layer parallax stack each frame: far layers move slower
    // than near layers (Req 30.3), with the degradation ladder's parallax-detail
    // level selecting how many layers stay visible (Req 26.9).
    this.updateParallax();
    // Scroll the DECORATIVE per-World environment elements on their layers
    // (task 12.2b; Req 27.1-27.12). Render-only decoration — never collidable.
    this.updateEnvironmentElements();

    const state = this.movement.state();
    // Jumping renders Kino clamped to the ground; Flight falls freely (no floor).
    if (this.mode === 'jumping') {
      this.clampToGround(state);
    }

    const kinoCenterY = state.y + KINO_BODY_HEIGHT / 2;
    if (this.kinoSprite) this.kinoSprite.y = kinoCenterY;
    if (this.kinoPlaceholder) this.kinoPlaceholder.y = kinoCenterY;

    // Zigzag arrow form tracks Kino's vertical position and, when not mid spin
    // tween, points along the current diagonal leg (up vs down) so the "pointed
    // arrow form" reads as the direction of travel (Req 4.1, 6.7). SEAM(8.3):
    // the full zigzag-up/down + spin-1/2 frames replace this.
    if (this.kinoArrowForm) {
      this.kinoArrowForm.y = kinoCenterY;
      if (!this.tweens.isTweening(this.kinoArrowForm)) {
        this.kinoArrowForm.setAngle(state.diagonalDir === 'up' ? -30 : 30);
      }
    }

    this.updateKinoVisual(state);
    this.syncObstacleViews(this.spawnCurrentWindow());
  }

  /**
   * SEAM(8.3): minimal run/jump visual. Grounded vs airborne is shown by a
   * slight tint shift (and, with a real sprite, no frame swap yet). Task 8.3
   * replaces this with the full Animation_Frame cycles (run-step-right/left on
   * the ground; jump-go-up/apex/go-down airborne, Req 30.13). Underwater REUSES
   * the Flight frames (fly-up/apex/down) since its motion is Flight's inverse
   * (Req 30.9 reuse note); in this slice that is the same tint-swap stand-in,
   * and the atomic underwater overlay (applied after this in the frame) casts
   * the blue over whatever tint this sets, so the overlay stays authoritative.
   */
  private updateKinoVisual(state: MovementState): void {
    const floorY = this.groundY - KINO_BODY_HEIGHT;
    const airborne = state.y < floorY - 0.5;
    // Tint the grounded state slightly to read as the run cycle vs the lighter
    // airborne jump. A no-op on exact palette but gives a visible seam.
    const groundedTint = 0xffffff;
    const airborneTint = 0xbfe3ff;
    const tint = airborne ? airborneTint : groundedTint;
    this.kinoSprite?.setTint(tint);
    // Placeholder shapes do not take a multiplicative tint the same way; nudge
    // the alpha instead so the state change is still visible on placeholders.
    this.kinoPlaceholder?.setAlpha(airborne ? 0.85 : 1);
  }

  /**
   * Sync the obstacle view pool to the current world-space window. Each unit's
   * screen x is `worldX - scrollX`, so units slide in from the right and move
   * left. Views are keyed by the stable obstacle id so the same unit reuses its
   * rectangle across frames; views whose unit left the window are destroyed.
   */
  private syncObstacleViews(obstacles: ObstacleList): void {
    const palette = this.worldPalette();
    // Resolve the per-bound tint. Jumping uses the single world1 ground art for
    // every rect; Flight uses the top-pillar art for bound[0] and the
    // bottom-pillar art for bound[1], each tinted from the world2 palette with
    // a placeholder fallback (Req 24.10, 38.1-38.2).
    const groundTint = this.resolvedTint(WORLD1_OBSTACLE_KEY, palette.obstacles);
    const pillarTopTint = this.resolvedTint(
      WORLD2_PILLAR_TOP_KEY,
      palette.obstacles,
    );
    const pillarBottomTint = this.resolvedTint(
      WORLD2_PILLAR_BOTTOM_KEY,
      palette.obstacles,
    );
    // Zigzag transition-point markers share the zigzag wall art tint (Req 4.2).
    const zigzagMarkerTint = this.resolvedTint(
      WORLD3_ZIGZAG_WALL_KEY,
      palette.obstacles,
    );
    // Underwater uses the ceiling art for bound[0] and the floor art for
    // bound[1], each tinted from the world4 palette with placeholder fallback
    // (Req 5.11, 5.12, 38.2), mirroring Flight's top/bottom pattern.
    const ceilingTint = this.resolvedTint(
      WORLD4_CEILING_OBSTACLE_KEY,
      palette.obstacles,
    );
    const floorTint = this.resolvedTint(
      WORLD4_FLOOR_OBSTACLE_KEY,
      palette.obstacles,
    );

    // Reuse the scratch live-key set rather than allocating one per frame
    // (Req 26.3 zero per-frame allocation on the render hot path).
    const live = this.liveViewKeys;
    live.clear();
    for (const obstacle of obstacles) {
      // Each visual rectangle gets its own recycled view keyed by the unit's
      // stable id + the bound index, so a Flight pair draws BOTH pillars while
      // still being ONE scoring unit (Req 9.6). Jumping units have one bound.
      for (let i = 0; i < obstacle.bounds.length; i++) {
        const bound = obstacle.bounds[i]!;
        // Skip degenerate (zero-height) pillars — e.g. a flush top/bottom pillar.
        if (bound.width <= 0 || bound.height <= 0) continue;

        const viewKey = `${obstacle.id}:${i}`;
        live.add(viewKey);

        const tint =
          obstacle.mode === 'flight'
            ? i === 0
              ? pillarTopTint
              : pillarBottomTint
            : obstacle.mode === 'zigzag'
              ? zigzagMarkerTint
              : obstacle.mode === 'underwater'
                ? i === 0
                  ? ceilingTint
                  : floorTint
                : groundTint;

        const centerX = bound.x - this.scrollX + bound.width / 2;
        const centerY = bound.y + bound.height / 2;

        // Zigzag markers are crossing CUES, not hazards: render them
        // semi-transparent so they read as transition lines rather than solid
        // walls (the walls are drawn opaque at the corridor edges). They are a
        // NON-ESSENTIAL visual effect, so the degradation ladder hides them at
        // the bottom rung (Req 26.9); they stay fully present otherwise.
        const markerAlpha = this.quality.nonEssentialEffects ? 0.4 : 0;

        let view = this.obstacleViews.get(viewKey);
        if (!view) {
          // ACQUIRE a recycled view from the pool (no allocation once warmed,
          // Req 26.3). The pool re-shows + resets alpha; we set geometry/tint.
          view = this.obstacleViewPool!.acquire();
          view.setPosition(centerX, centerY);
          view.setSize(bound.width, bound.height);
          view.setFillStyle(tint, 1);
          if (obstacle.mode === 'zigzag') view.setAlpha(markerAlpha);
          this.obstacleViews.set(viewKey, view);
        } else {
          view.x = centerX;
          view.y = centerY;
          // Keep the recycled rect's geometry in sync with its (stable-id) unit.
          view.setSize(bound.width, bound.height);
          // Re-seat the BASE art tint every frame so the atomic underwater
          // overlay (applied below) blends onto a clean base rather than
          // compounding across frames (Req 38.4). A no-op visually for Worlds
          // 1-3 where no overlay follows.
          view.setFillStyle(tint, view.fillAlpha);
          if (obstacle.mode === 'zigzag') view.setAlpha(markerAlpha);
        }
      }
    }

    // ATOMIC underwater overlay (Req 5.3, 38.4, 38.7): while underwater, tint
    // EVERY obstacle view AND Kino TOGETHER with the blue overlay; the moment
    // the underwater condition is false, clear the overlay from both. Applied
    // AFTER the per-bound tint so the overlay layers on top uniformly, and
    // keyed on the single `underwater` boolean so obstacles + Kino can never
    // fall out of sync (the atomic guarantee).
    this.applyUnderwaterOverlay();

    // RELEASE views whose rect left the window back to the pool — hide them
    // and return them for reuse rather than destroying them, so no obstacle
    // sprite is garbage-collected mid-run (task 12.3; Req 26.3). A unit absent
    // from this frame's live window has scrolled off-screen (off the left as
    // the world scrolls, or past the right lookahead); the pure spawner window
    // IS the off-screen-culling pass here, so any live view not re-seen is
    // culled and recycled.
    for (const [key, view] of this.obstacleViews) {
      if (!live.has(key)) {
        view.setVisible(false);
        this.obstacleViewPool!.release(view);
        this.obstacleViews.delete(key);
      }
    }
  }

  /**
   * Apply (or remove) the ATOMIC blue underwater overlay to the obstacle views
   * AND Kino together (Req 5.3, 38.4, 38.7). The single `underwater` boolean is
   * the sole gate: when true, every live obstacle view and the Kino visual are
   * tinted with the overlay color at the overlay alpha; when false, the overlay
   * is cleared from BOTH in the same pass so they are never out of sync. This
   * is called every rendered frame from {@link syncObstacleViews}, so a 5.4
   * surface crossing that flips `underwater` removes the overlay IMMEDIATELY on
   * the next frame.
   *
   * Non-World-4 runs never set `underwater`, so this is a cheap no-op there (it
   * clears nothing because nothing was ever tinted).
   */
  private applyUnderwaterOverlay(): void {
    const overlay = this.underwaterOverlay;
    // Nothing to do if this run has no underwater overlay configured and is not
    // underwater — avoids touching views in Worlds 1-3.
    if (!overlay && !this.underwater) return;

    if (this.underwater && overlay) {
      // Tint obstacles + Kino TOGETHER (atomic). Blend the overlay tint over
      // the view's current tint by alpha so the obstacle art still reads
      // through the blue cast rather than being flattened to a flat color.
      for (const view of this.obstacleViews.values()) {
        const base = view.fillColor;
        view.setFillStyle(blendTint(base, overlay.tint, overlay.alpha));
      }
      // Kino: a real sprite takes a multiplicative tint; a placeholder shape
      // gets its fill blended the same way an obstacle does. Both are tinted in
      // the SAME pass as the obstacles so the overlay is atomic (Req 38.4).
      this.kinoSprite?.setTint(overlay.tint);
      this.kinoPlaceholder?.setFillStyle(
        blendTint(this.kinoPlaceholderBaseTint, overlay.tint, overlay.alpha),
        this.kinoPlaceholder.fillAlpha,
      );
    } else {
      // Underwater is false: remove the overlay from obstacles + Kino together.
      // Obstacle views are re-seated to their base art color on the next sync
      // pass; Kino is cleared back to its base here so BOTH drop the overlay in
      // lock-step (atomic removal, Req 38.7).
      this.kinoSprite?.clearTint();
      this.kinoPlaceholder?.setFillStyle(
        this.kinoPlaceholderBaseTint,
        this.kinoPlaceholder.fillAlpha,
      );
    }
  }

  /**
   * Resolve an obstacle art key to a Phaser tint: the placeholder descriptor's
   * tint when the registry falls back to a placeholder, else the world palette
   * obstacle color. Keeps collision/physics identical to the real-art path
   * (Req 24.3, 24.6, 24.10).
   */
  private resolvedTint(key: string, paletteObstacleHex: string): number {
    const resolved = this.ctx.assets.resolve(key);
    return resolved.source === 'placeholder' && resolved.placeholder
      ? hexToNumber(resolved.placeholder.tint)
      : hexToNumber(paletteObstacleHex);
  }

  /** Format the Score label for the HUD (Req 20.39). */
  private scoreLabel(): string {
    return `Score: ${this.scoring.current()}`;
  }

  /** Push the latest score to the HUD immediately (Req 9.5, 20.39). */
  private updateScoreText(): void {
    this.scoreText?.setText(this.scoreLabel());
  }

  /**
   * A simple Menu control on the run HUD that returns to the main menu
   * (Req 20.40, 20.41). Styled minimally to match the vertical slice; Phase 9
   * replaces the HUD with the full styled controls.
   */
  private addMenuControl(width: number): void {
    const label = this.ctx.config.labels.menu;
    const x = width - 16;
    const y = 16;

    const text = this.add
      .text(0, 0, label, {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#0b0f16',
      })
      .setOrigin(1, 0)
      .setDepth(101);
    // Position the text's right edge at the margin, then place the bg behind it.
    text.setPosition(x, y + 8);

    const padX = 14;
    const padY = 8;
    const bg = this.add
      .rectangle(
        x - text.width / 2 - padX,
        y + text.height / 2 + padY,
        text.width + padX * 2,
        text.height + padY * 2,
        0xf5e6c8,
      )
      .setOrigin(0.5, 0.5)
      .setDepth(100)
      .setInteractive({ useHandCursor: true });

    bg.on('pointerover', () => bg.setFillStyle(0xffffff));
    bg.on('pointerout', () => bg.setFillStyle(0xf5e6c8));
    bg.on('pointerup', () => this.returnToMenu());
  }

  /**
   * The Pause control on the run HUD (Req 7.9). Sits just left of the Menu
   * control at the top-right. Pressing it pauses the run — freezing gameplay,
   * movement, obstacle progression, and all skill timers (Req 7.10-7.12) — and
   * launches the PauseScene overlay, whose Resume continues from the held state
   * (Req 7.13). Styled minimally to match the vertical-slice HUD; Phase 9
   * replaces the HUD with the full styled controls.
   */
  private addPauseControl(width: number): void {
    const label = this.ctx.config.labels.pause;
    // Place it to the LEFT of the Menu control (which hugs the right margin).
    // A fixed offset is adequate for the minimal slice HUD.
    const x = width - 120;
    const y = 16;

    const text = this.add
      .text(0, 0, label, {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#0b0f16',
      })
      .setOrigin(1, 0)
      .setDepth(101);
    text.setPosition(x, y + 8);

    const padX = 14;
    const padY = 8;
    const bg = this.add
      .rectangle(
        x - text.width / 2 - padX,
        y + text.height / 2 + padY,
        text.width + padX * 2,
        text.height + padY * 2,
        0xf5e6c8,
      )
      .setOrigin(0.5, 0.5)
      .setDepth(100)
      .setInteractive({ useHandCursor: true });

    bg.on('pointerover', () => bg.setFillStyle(0xffffff));
    bg.on('pointerout', () => bg.setFillStyle(0xf5e6c8));
    bg.on('pointerup', () => this.pauseRun());
  }

  // -------------------------------------------------------------------------
  // Pause / resume (Req 7.9-7.13)
  // -------------------------------------------------------------------------

  /**
   * The ESC / P key handler on the running run: pause when running. Resume is
   * owned by the PauseScene overlay (and its own ESC/P key), so pressing the key
   * here only ever pauses — when the run is already paused this scene's update
   * loop is short-circuited and the overlay is on top handling the key.
   */
  private onPauseKey(): void {
    if (this.runEnded) return;
    if (!this.pauseControl.isPaused()) this.pauseRun();
  }

  /**
   * Pause the run (Req 7.10): freeze the driver so the simulation advances
   * nothing — movement, the leftward scroll (obstacle progression), scoring,
   * and every skill cooldown/effect timer all hold at their current values
   * (Req 7.11), because they are only ever driven by the now-frozen driver's
   * `advance` callback. Then launch the PauseScene overlay with a `resume`
   * callback so the overlay can continue the run from the held state (Req 7.12-
   * 7.13). Idempotent: a second pause while already paused is a no-op.
   */
  private pauseRun(): void {
    if (this.runEnded) return;
    // `pause()` returns false if already paused — avoids launching a second
    // overlay on a doubled key + pointer event.
    if (!this.pauseControl.pause()) return;

    const data: PauseSceneData = { resume: () => this.resumeRun() };

    if (this.scene.get(PAUSE_SCENE_KEY)) {
      // Launch the overlay in PARALLEL (scene.launch) so this gameplay scene
      // stays alive and frozen beneath it (design: overlays pause the scene
      // beneath). The frozen driver — not Phaser's scene.pause — is what
      // guarantees nothing advances, so this scene's update loop is also gated
      // on `pauseControl.isPaused()` as belt-and-braces.
      this.scene.launch(PAUSE_SCENE_KEY, data);
      this.scene.bringToTop(PAUSE_SCENE_KEY);
      return;
    }

    // SEAM: PauseScene not registered (e.g. a dev/direct launch). The run is
    // still genuinely frozen via the driver; log that the overlay is absent.
    console.info(
      `[KINO][Gameplay] Paused (driver frozen). '${PAUSE_SCENE_KEY}' overlay not registered.`,
    );
  }

  /**
   * Resume the run (Req 7.12, 7.13): unfreeze the driver so it continues from
   * the held values and the paused run state — positions, `scrollX`, score, and
   * all skill timers were never mutated while paused, so the run simply picks up
   * where it left off. Called by the PauseScene overlay's Resume control via the
   * callback handed in {@link pauseRun}. Idempotent.
   */
  private resumeRun(): void {
    if (!this.pauseControl.resume()) return;
    // Drop any input buffered during the pause so it does not fire on the first
    // resumed frame.
    this.inputManager.clearFrame();
  }

  // -------------------------------------------------------------------------
  // World-5 scripted finale (SEAM 11.2 — Req 8.7-8.15, 45.5)
  // -------------------------------------------------------------------------

  /**
   * SEAM(11.2): hand control to the PURE finale controller when the
   * SequenceDirector reaches the World-5 FINALE Sequence (the terminal
   * `isFinale` spec, mode Jumping — the only Jumping in World 5, Req 8.6). The
   * engine side is deliberately THIN — every phase decision comes from the pure
   * `core.createFinaleController`:
   *
   *   1. Flight is DISABLED and Kino descends to the ground (Req 8.7-8.8) — the
   *      controller's DESCEND phase; the engine drives Kino's y toward the
   *      ground strip while `currentPhase() === 'descend'`.
   *   2. AUTOMATIC CONTROL: while `isAutoControlled()` (DESCEND/CRAWL/RUN) the
   *      engine IGNORES player locomotion input and scripts Kino's x RIGHTWARD
   *      (the sanctioned horizontal-movement exception, Req 8.9-8.12/45.5),
   *      feeding `scrollSpeed * dt` into `advance(delta)` each fixed tick.
   *   3. LOCOMOTION FRAMES come from `locomotionFrame(clock)` — a crawl-step
   *      during CRAWL and a run-step during RUN (Req 8.11-8.12) — fed to the
   *      KinoRenderer's `setPose` exactly like the normal frame cycle.
   *   4. The final JUMP stays DISABLED until the barrier (`jumpEnabled()` is
   *      false through DESCEND/CRAWL/RUN, Req 8.13); at AT_BARRIER it becomes
   *      available and a player primary press calls `jump()` (Req 8.14).
   *   5. On a successful `jump()` the finale is COMPLETE
   *      (`isComplete()` / `endingCinematicId()`); the engine starts the
   *      CinematicScene with FINAL_ENDING_CINEMATIC_ID (Req 8.15 → 21.8),
   *      passing nothing extra — the CinematicScene resolves the ending's
   *      Junior→Senior + next-egg labels from the current Save_Store generation.
   *
   * NOTE: this vertical slice launches single-mode runs and does not yet run the
   * SequenceDirector/World-5 plan, so `startFinale`/`stepFinale` are not reached
   * in the current flow; they capture the exact contract the SequenceDirector
   * wiring invokes so the pure controller drops in with no rework.
   */
  private startFinale(): void {
    this.finale = createFinaleController();
    // Flight is disabled at finale start (Req 8.7); descent + scripted
    // locomotion are driven per fixed tick by stepFinale().
  }

  /**
   * SEAM(11.2): advance the active finale one fixed tick. Reads ALL phase
   * decisions from the pure controller; the engine only applies them (scripts
   * Kino's x/y, selects the frame, gates the jump) and, on the jump-through,
   * hands off to the ending cinematic. Returns true while the finale owns the
   * run so the caller skips the normal movement/collision path.
   */
  private stepFinale(dt: number, primaryPressed: boolean): boolean {
    const finale = this.finale;
    if (!finale) return false;

    // Script rightward progress while under automatic control (Req 8.9-8.12).
    if (finale.isAutoControlled()) {
      finale.advance(this.spawner.scrollSpeed(this.difficulty()) * dt);
    }

    // The ONLY player action in the finale is the final jump AT the barrier
    // (Req 8.13-8.14): honor a press only when the controller enables it.
    if (primaryPressed && finale.jumpEnabled()) {
      finale.jump();
    }

    // On the jump-through the finale is complete → play the FINAL ending
    // cinematic (Req 8.15 → 21.8). Start it exactly once.
    if (finale.isComplete() && !this.runEnded) {
      const cinematicId = finale.endingCinematicId() ?? FINAL_ENDING_CINEMATIC_ID;
      this.runEnded = true;
      if (this.scene.get(CINEMATIC_SCENE_KEY)) {
        this.scene.start(CINEMATIC_SCENE_KEY, {
          cinematicId,
          nextSceneKey: MAIN_MENU_SCENE_KEY,
        });
      } else {
        console.info(
          `[KINO][Gameplay] Finale jump-through; would play '${cinematicId}'. ` +
            `'${CINEMATIC_SCENE_KEY}' scene not registered.`,
        );
        this.returnToMenu();
      }
    }
    return true;
  }

  // -------------------------------------------------------------------------
  // Run end + hand-off
  // -------------------------------------------------------------------------

  /**
   * End the current run (Req 44.1, 44.3). Latches `runEnded` so the loop halts
   * and the hand-off fires exactly once, then routes to RunEndScene with the
   * run-stats contract. SEAM(4.7): until RunEndScene ('RunEnd') is registered we
   * transition defensively back to the main menu and log a clear seam.
   */
  private endRun(): void {
    if (this.runEnded) return;
    this.runEnded = true;

    const data: RunEndData = {
      finalScore: this.scoring.current(),
      world: this.world,
      mode: this.mode,
      obstaclesCleared: this.obstaclesCleared,
      runTimeMs: Math.max(0, Math.round(this.time.now - this.runStartMs)),
    };

    if (this.scene.get(RUN_END_SCENE_KEY)) {
      this.scene.start(RUN_END_SCENE_KEY, data);
      return;
    }

    // SEAM(4.7): RunEndScene not registered yet. Route defensively to the menu
    // so the chain never crashes, and log the stats we WOULD have passed.
    console.info(
      `[KINO][Gameplay] Run ended; would show RunEnd (${JSON.stringify(
        data,
      )}). '${RUN_END_SCENE_KEY}' scene not registered yet (task 4.7).`,
    );
    this.returnToMenu();
  }

  /** Return to the main menu (Menu control + the defensive run-end fallback). */
  private returnToMenu(): void {
    if (this.scene.get(MAIN_MENU_SCENE_KEY)) {
      this.scene.start(MAIN_MENU_SCENE_KEY);
      return;
    }
    console.info(
      `[KINO][Gameplay] Menu pressed; '${MAIN_MENU_SCENE_KEY}' scene not registered.`,
    );
  }
}

/**
 * Parse a `#RRGGBB` hex color string to the 0xRRGGBB number Phaser wants.
 * Tolerates a missing leading '#'. Falls back to white on a malformed value.
 */
function hexToNumber(hex: string): number {
  const cleaned = hex.replace('#', '').trim();
  const parsed = Number.parseInt(cleaned, 16);
  return Number.isNaN(parsed) ? 0xffffff : parsed;
}

/**
 * Pack a pure-core {@link Rgb} (0..255 channels) into the 0xRRGGBB number
 * Phaser wants (task 12.2c; Req 38.3). The bridge between the resolver's
 * element-level composited colors and the Phaser fill/tint API.
 */
function rgbToNumber(rgb: Rgb): number {
  const r = clampChannelByte(rgb.r);
  const g = clampChannelByte(rgb.g);
  const b = clampChannelByte(rgb.b);
  return (r << 16) | (g << 8) | b;
}

/** Clamp/round a channel value to an integer byte in [0,255]. */
function clampChannelByte(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const r = Math.round(v);
  if (r < 0) return 0;
  if (r > 255) return 255;
  return r;
}

/** Clamp a value into [0, 1] (used for overlay alpha, Req 38.4). */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/**
 * Wrap a scrolling x-offset into the half-open range `(-span, 0]` so a band
 * built two viewport widths wide repeats seamlessly as it scrolls left (task
 * 12.2a; Req 30.3). Keeps the container offset bounded regardless of how far
 * `scrollX` grows over a long run. Non-finite input / non-positive span degrade
 * to 0 so parallax geometry can never produce NaN.
 */
function wrapOffset(offset: number, span: number): number {
  if (!Number.isFinite(offset) || !(span > 0)) return 0;
  // JS `%` keeps the sign of the dividend; offset is <= 0 for forward scroll,
  // so the modulo already lands in (-span, 0]. Normalize any edge to that range.
  const m = offset % span;
  return m > 0 ? m - span : m;
}

/**
 * Alpha-blend `overlay` (0xRRGGBB) over `base` (0xRRGGBB) at `alpha` in [0, 1]
 * and return the resulting 0xRRGGBB. Used for the atomic underwater overlay so
 * the obstacle/Kino art still reads through the blue cast rather than being
 * flattened to a flat color (Req 38.4). Per-channel linear interpolation.
 */
function blendTint(base: number, overlay: number, alpha: number): number {
  const a = clamp01(alpha);
  const br = (base >> 16) & 0xff;
  const bg = (base >> 8) & 0xff;
  const bb = base & 0xff;
  const or = (overlay >> 16) & 0xff;
  const og = (overlay >> 8) & 0xff;
  const ob = overlay & 0xff;
  const r = Math.round(br + (or - br) * a);
  const g = Math.round(bg + (og - bg) * a);
  const b = Math.round(bb + (ob - bb) * a);
  return (r << 16) | (g << 8) | b;
}

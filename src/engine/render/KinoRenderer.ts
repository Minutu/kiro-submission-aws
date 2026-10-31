// Feature: kino-game
//
// KinoRenderer — the Phaser renderer that draws base Kino plus any equipped
// Cosmetic layers (design: "Cosmetics & Layered Rendering", Req 19.1-19.4,
// 19.6, 6.5). It is the one place that stitches independent sprites into Kino's
// on-screen appearance WITHOUT ever baking a combined sprite:
//
//   - BASE Kino is a single sprite/placeholder resolved from the Asset_Registry
//     and drawn independently of any Cosmetic (Req 19.1). Its position/size is
//     the sole visual the CollisionSystem's body-only KinoBody mirrors.
//
//   - Each EQUIPPED Cosmetic is a SEPARATE transparent layer (a child Phaser
//     game object) drawn OVER base Kino (Req 19.2). Its offset for the current
//     pose comes from the pure `cosmeticAnchor(mode, frame)` table (Req 19.3),
//     so no unique per-combination sprite is required (Req 19.4).
//
//   - Cosmetic layers are RENDER-ONLY. They are Phaser display objects and
//     nothing more: this class never hands cosmetic geometry to the
//     CollisionSystem. Collision is evaluated against `KinoBody` alone — a shape
//     that structurally has no field for cosmetics (see
//     src/core/collisionSystem.ts, Req 41.4-41.5, 44.13) — so cosmetics are
//     excluded from collision by construction, not by a runtime filter (Req
//     19.6). This renderer exposes `bodyRect()` as the ONLY geometry a caller
//     should ever feed into collision; it deliberately exposes no cosmetic
//     bounds.
//
//   - During a Transition, cosmetic layers are HIDDEN (Req 6.5) via
//     `setTransitioning(true)` — the transition animation (spin cue, etc.) owns
//     the character silhouette and gets render priority (Req 6.6, handled by the
//     scene's transition overlay). `setTransitioning(false)` restores them.
//
// This is engine-layer code: Phaser is allowed here. The OFFSET MATH lives in
// the Phaser-free `cosmeticAnchors.ts` so it stays unit-testable; this class
// only consumes it and applies the result to child sprites.

import Phaser from 'phaser';
import type { MovementMode } from '../../core/types.ts';
import type { AssetRegistry, ResolvedAsset } from '../../assets/index.ts';
import {
  cosmeticAnchor,
  defaultFrameForMode,
  isFrameForMode,
  type AnchorOffset,
  type AnimationFrame,
} from './cosmeticAnchors.ts';
import {
  selectAnimationFrame,
  type FrameCycleInput,
} from '../../core/animationFrameCycle.ts';

/** Nominal Kino body footprint (px), matching GameplayScene's `KINO_BODY_*`. */
export const KINO_BODY_WIDTH = 48;
export const KINO_BODY_HEIGHT = 48;

/** Depth ordering: base Kino below, cosmetic layers just above it. */
const BASE_DEPTH = 5;
const COSMETIC_DEPTH = 6;

/** Body-only collision rectangle (top-left origin), mirroring `KinoBody`. */
export interface BodyRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Options for constructing a KinoRenderer. */
export interface KinoRendererOptions {
  /** The Asset_Registry choke point (`resolve`/`hasReal`). */
  readonly assets: AssetRegistry;
  /** Asset key for base Kino (defaults to the starter sprite, Req 24.7). */
  readonly baseKey?: string;
  /** Initial Movement_Mode (defaults to `'jumping'`). */
  readonly initialMode?: MovementMode;
  /** Fallback base tint when the base resolves to a placeholder with none. */
  readonly baseTintFallback?: number;
}

/**
 * A cosmetic layer's backing Phaser object. Both branches (real art = Image,
 * placeholder = Rectangle) support the transform/visibility/alpha/depth methods
 * this renderer uses, so the union is sufficient and avoids leaking a wider
 * `GameObject` type that lacks `setPosition`.
 */
type CosmeticObject = Phaser.GameObjects.Image | Phaser.GameObjects.Rectangle;

/** A single equipped Cosmetic layer and its backing Phaser object. */
interface CosmeticLayer {
  readonly cosmeticId: string;
  readonly assetKey: string;
  readonly object: CosmeticObject;
}

/** Default Kino tint when a placeholder descriptor carries none. */
const DEFAULT_KINO_TINT = 0xf5e6c8;

/** Convert a `#RRGGBB` string to a Phaser numeric tint; tolerant of junk. */
function hexToNumber(hex: string): number {
  const parsed = Number.parseInt(hex.replace(/^#/, ''), 16);
  return Number.isFinite(parsed) ? parsed : DEFAULT_KINO_TINT;
}

/**
 * KinoRenderer owns base Kino plus its cosmetic layers for a single scene. A
 * scene creates one, calls {@link setPose} each time the mode/frame changes,
 * and {@link setTransitioning} around environment transitions. It is available
 * for the full cosmetic/animation tasks (8.2/8.3) to build on; the World-1
 * slice may keep its existing direct draw.
 */
export class KinoRenderer {
  private readonly scene: Phaser.Scene;
  private readonly assets: AssetRegistry;
  private readonly baseKey: string;
  private readonly baseTintFallback: number;

  /** Base Kino's on-screen CENTER (px). Cosmetic offsets are relative to it. */
  private centerX = 0;
  private centerY = 0;

  /** Current pose. */
  private mode: MovementMode;
  private frame: AnimationFrame;

  /** True while an environment Transition is in progress (Req 6.5). */
  private transitioning = false;

  /** Base Kino display object (image for real art, shape for placeholder). */
  private base: Phaser.GameObjects.Image | Phaser.GameObjects.Shape | undefined;

  /** Equipped cosmetic layers, in draw order. At most one today (Req 19.7). */
  private readonly cosmetics: CosmeticLayer[] = [];

  constructor(scene: Phaser.Scene, options: KinoRendererOptions) {
    this.scene = scene;
    this.assets = options.assets;
    this.baseKey = options.baseKey ?? 'starter:kinoSprite';
    this.baseTintFallback = options.baseTintFallback ?? DEFAULT_KINO_TINT;
    this.mode = options.initialMode ?? 'jumping';
    this.frame = defaultFrameForMode(this.mode);
  }

  /**
   * Build base Kino at a screen position and draw it INDEPENDENTLY of any
   * cosmetic (Req 19.1). `x`/`y` is Kino's center. Returns `this` for chaining.
   * Resolving through the Asset_Registry means real art and placeholder render
   * identically to the rest of the game (Req 24.1-24.3).
   */
  create(x: number, y: number): this {
    this.centerX = x;
    this.centerY = y;
    this.base?.destroy();
    this.base = this.buildBase(x, y);
    // Reposition any already-equipped cosmetics onto the new base.
    this.repositionCosmetics();
    return this;
  }

  /** Build the base Kino display object (real image or tinted placeholder). */
  private buildBase(
    x: number,
    y: number,
  ): Phaser.GameObjects.Image | Phaser.GameObjects.Shape {
    const resolved = this.assets.resolve(this.baseKey);
    if (resolved.source === 'real' && this.scene.textures.exists(this.baseKey)) {
      const img = this.scene.add
        .image(x, y, this.baseKey)
        .setOrigin(0.5, 0.5)
        .setDepth(BASE_DEPTH);
      const scale = Math.min(
        KINO_BODY_WIDTH / img.width,
        KINO_BODY_HEIGHT / img.height,
        1,
      );
      img.setScale(scale);
      return img;
    }
    const tint = this.placeholderTint(resolved, this.baseTintFallback);
    const shape =
      resolved.placeholder && resolved.placeholder.kind === 'circle'
        ? this.scene.add.circle(x, y, KINO_BODY_WIDTH / 2, tint)
        : this.scene.add.rectangle(x, y, KINO_BODY_WIDTH, KINO_BODY_HEIGHT, tint);
    shape.setDepth(BASE_DEPTH);
    return shape;
  }

  /** Numeric tint for a placeholder-resolved asset, else the given fallback. */
  private placeholderTint(resolved: ResolvedAsset, fallback: number): number {
    if (resolved.source === 'placeholder' && resolved.placeholder) {
      return hexToNumber(resolved.placeholder.tint);
    }
    return fallback;
  }

  /**
   * Move base Kino (and its cosmetic layers) to a new screen center. Cosmetics
   * follow via the anchor offset so the layered look holds as Kino moves.
   */
  setPosition(x: number, y: number): void {
    this.centerX = x;
    this.centerY = y;
    this.base?.setPosition(x, y);
    this.repositionCosmetics();
  }

  /**
   * Update the pose (Movement_Mode + Animation_Frame) and REPOSITION every
   * cosmetic layer via the anchor table (Req 19.3). If `frame` is omitted or is
   * not valid for `mode`, falls back to that mode's default resting frame so a
   * caller can switch mode without naming a frame. Drives the "layers reposition
   * per pose" contract.
   */
  setPose(mode: MovementMode, frame?: AnimationFrame): void {
    this.mode = mode;
    if (frame !== undefined && isFrameForMode(mode, frame)) {
      this.frame = frame;
    } else {
      this.frame = defaultFrameForMode(mode);
    }
    this.repositionCosmetics();
  }

  /**
   * Advance the pose by running the PURE frame cycle (task 8.3,
   * `src/core/animationFrameCycle.ts`) and applying the selected frame via
   * {@link setPose}. The scene calls this each render tick with Kino's current
   * motion state (grounded, vertical velocity, zigzag leg, elapsed time, and —
   * during transitions / the W5 finale — `transitionActive` / `finalePhase`);
   * the cycle owns "which frame when" so this class stays a thin consumer. The
   * `mode` defaults to the renderer's current mode when omitted. Returns the
   * frame that was applied.
   */
  advance(input: Omit<FrameCycleInput, 'mode'> & { mode?: MovementMode }): AnimationFrame {
    const mode = input.mode ?? this.mode;
    const frame = selectAnimationFrame({ ...input, mode });
    this.setPose(mode, frame);
    return frame;
  }

  /** The current pose, for inspection/tests. */
  pose(): { mode: MovementMode; frame: AnimationFrame } {
    return { mode: this.mode, frame: this.frame };
  }

  /**
   * Equip a Cosmetic as a new transparent layer over base Kino (Req 19.2). Per
   * Req 19.7 at most one Cosmetic is equipped, so this clears any existing
   * layer first. `assetKey` is resolved through the Asset_Registry (real art or
   * placeholder). Positioned immediately for the current pose.
   */
  equipCosmetic(cosmeticId: string, assetKey: string): void {
    this.clearCosmetics();
    const object = this.buildCosmeticObject(assetKey);
    const layer: CosmeticLayer = { cosmeticId, assetKey, object };
    this.cosmetics.push(layer);
    this.positionLayer(layer);
    // Respect the current transition state on a freshly equipped layer.
    object.setVisible(!this.transitioning);
  }

  /** Build a single cosmetic layer's Phaser object (real image or placeholder). */
  private buildCosmeticObject(assetKey: string): CosmeticObject {
    const resolved = this.assets.resolve(assetKey);
    if (resolved.source === 'real' && this.scene.textures.exists(assetKey)) {
      return this.scene.add
        .image(this.centerX, this.centerY, assetKey)
        .setOrigin(0.5, 0.5)
        .setDepth(COSMETIC_DEPTH);
    }
    // Placeholder: a small tinted rect standing in for the hat, drawn with
    // partial alpha so it reads as a transparent overlay (Req 19.2).
    const tint = this.placeholderTint(resolved, 0x8844cc);
    const rect = this.scene.add
      .rectangle(this.centerX, this.centerY, KINO_BODY_WIDTH * 0.6, KINO_BODY_HEIGHT * 0.4, tint)
      .setDepth(COSMETIC_DEPTH);
    rect.setAlpha(0.95);
    return rect;
  }

  /** Remove every equipped cosmetic layer and destroy its backing object. */
  clearCosmetics(): void {
    for (const layer of this.cosmetics) {
      layer.object.destroy();
    }
    this.cosmetics.length = 0;
  }

  /**
   * Enter/leave the transition state. While transitioning, every cosmetic layer
   * is HIDDEN (Req 6.5); leaving restores them. Base Kino is never hidden here —
   * the transition animation (spin cue / arrow form) is layered on top by the
   * scene and owns render priority (Req 6.6).
   */
  setTransitioning(transitioning: boolean): void {
    this.transitioning = transitioning;
    for (const layer of this.cosmetics) {
      layer.object.setVisible(!transitioning);
    }
  }

  /** True while cosmetics are hidden for a transition. */
  isTransitioning(): boolean {
    return this.transitioning;
  }

  /**
   * The body-only collision rectangle (top-left origin), derived SOLELY from
   * base Kino's footprint — never from any cosmetic layer. This is the ONLY
   * geometry a caller should feed into the CollisionSystem (`KinoBody`); this
   * class intentionally exposes NO cosmetic bounds, so cosmetics cannot reach
   * collision (Req 19.6, 41.4, 44.13).
   */
  bodyRect(): BodyRect {
    return {
      x: this.centerX - KINO_BODY_WIDTH / 2,
      y: this.centerY - KINO_BODY_HEIGHT / 2,
      width: KINO_BODY_WIDTH,
      height: KINO_BODY_HEIGHT,
    };
  }

  /** The base Kino display object, for scenes that tween/tint it directly. */
  baseObject(): Phaser.GameObjects.Image | Phaser.GameObjects.Shape | undefined {
    return this.base;
  }

  /** Number of currently equipped cosmetic layers (0 or 1 today). */
  cosmeticCount(): number {
    return this.cosmetics.length;
  }

  /** Reposition every cosmetic layer for the current pose + base position. */
  private repositionCosmetics(): void {
    for (const layer of this.cosmetics) {
      this.positionLayer(layer);
    }
  }

  /** Place a single cosmetic layer at base center + the anchor offset. */
  private positionLayer(layer: CosmeticLayer): void {
    const offset: AnchorOffset = cosmeticAnchor(this.mode, this.frame);
    layer.object.setPosition(this.centerX + offset.x, this.centerY + offset.y);
  }

  /** Destroy base Kino and all cosmetic layers; the renderer is unusable after. */
  destroy(): void {
    this.clearCosmetics();
    this.base?.destroy();
    this.base = undefined;
  }
}

// Feature: kino-game
//
// The PURE, Phaser-free MULTI-LAYER PARALLAX MODEL (task 12.2a; design: "Visual
// Direction"; Req 30.3, and the per-World palette/aesthetic Req 30.1/30.2/30.6
// that the ENGINE render treatment applies on top of this geometry).
//
// Req 30.3 asks for multi-layer parallax backgrounds that scroll at different
// speeds and change per World. The SPEED relationship is pure geometry: given a
// world's ordered layer set — each layer carrying a scroll FACTOR in [0,1]
// where 0 is a static far backdrop and 1 is a foreground that moves 1:1 with
// the world — and the world scroll offset `scrollX` (how far the world has
// advanced leftward, the GameplayScene Scrolling_Model, Req 45), each layer's
// rendered x-offset is `-scrollX * factor`. Far layers (small factor) move
// slower than near layers (large factor), which reads as depth.
//
// This module owns ONLY that deterministic geometry plus a config/data-driven
// per-World default layer stack. The COMIC-BOOK aesthetic (thick outlines,
// cel-shading, halftone, strong contrast) and the saturated per-World palette
// TINTING are render treatment applied by the engine (GameplayScene) on top of
// these layers — they are intentionally NOT here, because they are Phaser
// render concerns and this module must stay Phaser-free and property-testable.
//
// HARD RULE (enforced by test/boundary.core-no-phaser.test.ts): no `phaser`
// import, directly or transitively. Pure data + pure functions only.

import type { WorldId } from './types.ts';

/**
 * A single parallax layer descriptor. `factor` is the scroll factor in [0,1]:
 * 0 = static far background (never moves), 1 = foreground moving 1:1 with the
 * world scroll. `name` is a stable role label the engine uses to decide render
 * treatment (e.g. which layers are the far sky vs the near foreground) and to
 * key its pooled layer views; it carries no gameplay meaning.
 */
export interface ParallaxLayer {
  /** Stable role label, far→near: 'sky' | 'far' | 'mid' | 'near' | 'foreground'. */
  name: string;
  /** Scroll factor in [0,1]; 0 static, 1 moves 1:1 with scrollX. */
  factor: number;
}

/** A layer's resolved horizontal render offset for the current scroll. */
export interface ParallaxLayerOffset {
  /** The layer this offset belongs to (same reference as the input layer). */
  layer: ParallaxLayer;
  /** Rendered x-offset = -scrollX * factor (far layers move less). */
  x: number;
}

/** Clamp a factor into the valid [0,1] parallax range; non-finite => 0. */
function clampFactor(factor: number): number {
  if (!Number.isFinite(factor)) return 0;
  if (factor < 0) return 0;
  if (factor > 1) return 1;
  return factor;
}

/**
 * Compute one layer's rendered x-offset for a world scroll offset. PURE and
 * total: `-scrollX * factor`, with the factor clamped to [0,1]. A factor-0
 * layer yields 0 for ANY scrollX (static far backdrop); a factor-1 layer yields
 * `-scrollX` (moves 1:1 with the world); intermediate factors scale linearly.
 * A non-finite `scrollX` degrades to 0 (no movement) so a bad caller value can
 * never produce NaN geometry.
 */
export function parallaxOffset(factor: number, scrollX: number): number {
  const f = clampFactor(factor);
  if (!Number.isFinite(scrollX)) return 0;
  // `+ 0` normalizes the negative-zero JS produces from `-scrollX * 0` (static
  // layer) to a plain `0` so callers get stable, sign-free static offsets.
  return -scrollX * f + 0;
}

/**
 * Compute every layer's rendered x-offset for the current world scroll offset
 * (Req 30.3 "scroll at different speeds"). PURE, deterministic, allocation of a
 * single result array; the i-th result pairs the i-th input layer with its
 * `-scrollX * factor` offset. Order is preserved (far→near as given) so the
 * engine can draw back-to-front directly. Handles `scrollX` of 0, large, and
 * negative values gracefully (negative scroll simply mirrors the offset sign).
 */
export function parallaxOffsets(
  layers: readonly ParallaxLayer[],
  scrollX: number,
): ParallaxLayerOffset[] {
  const out: ParallaxLayerOffset[] = [];
  for (const layer of layers) {
    out.push({ layer, x: parallaxOffset(layer.factor, scrollX) });
  }
  return out;
}

/**
 * The DEFAULT per-World parallax layer stacks (Req 30.3 "change per World").
 * Each world gets a 4-layer, far→near ordered stack with NON-DECREASING scroll
 * factors so depth always reads correctly (far moves slowest, foreground moves
 * fastest). Factors are data-driven here so a world can be re-tuned without
 * touching the geometry; the per-World VARIATION (which is what Req 30.3's
 * "change per World" asks for) lives in these numbers and the engine's per-World
 * palette tinting. The stacks are frozen so a caller can never mutate the
 * shared defaults.
 */
export const DEFAULT_WORLD_PARALLAX_LAYERS: Readonly<
  Record<WorldId, readonly ParallaxLayer[]>
> = {
  // World 1 Desert — wide slow dunes, gentle depth.
  1: Object.freeze([
    { name: 'sky', factor: 0 },
    { name: 'far', factor: 0.2 },
    { name: 'mid', factor: 0.5 },
    { name: 'near', factor: 0.8 },
  ]),
  // World 2 Foundry — layered machinery, a touch more mid depth.
  2: Object.freeze([
    { name: 'sky', factor: 0 },
    { name: 'far', factor: 0.25 },
    { name: 'mid', factor: 0.55 },
    { name: 'near', factor: 0.85 },
  ]),
  // World 3 Memory Jungle — dense foliage, strong near-layer motion.
  3: Object.freeze([
    { name: 'sky', factor: 0 },
    { name: 'far', factor: 0.3 },
    { name: 'mid', factor: 0.6 },
    { name: 'near', factor: 0.9 },
  ]),
  // World 4 Ice & Underwater — slow drifting backdrop, floating near layer.
  4: Object.freeze([
    { name: 'sky', factor: 0 },
    { name: 'far', factor: 0.18 },
    { name: 'mid', factor: 0.45 },
    { name: 'near', factor: 0.75 },
  ]),
  // World 5 Security Citadel — tall static structures, sharp foreground.
  5: Object.freeze([
    { name: 'sky', factor: 0 },
    { name: 'far', factor: 0.22 },
    { name: 'mid', factor: 0.5 },
    { name: 'near', factor: 0.95 },
  ]),
};

/**
 * The default parallax layer stack for a World (Req 30.3). Returns the frozen
 * data-driven stack for the given world, falling back to World 1's stack for an
 * out-of-range id so a caller always gets a sensible ordered far→near set.
 */
export function defaultParallaxLayers(world: WorldId): readonly ParallaxLayer[] {
  return DEFAULT_WORLD_PARALLAX_LAYERS[world] ?? DEFAULT_WORLD_PARALLAX_LAYERS[1];
}

/**
 * Apply the degradation ladder's parallax-detail level to a layer stack
 * (design: "graceful degradation ladder" shedding parallax detail; Req 26.9,
 * 30.3). `parallaxScale` is the fraction of full parallax DETAIL to keep in
 * [0,1] (from `qualitySettingsForLevel(...).parallaxScale`): the ladder drops
 * the LEAST-essential (farthest / most subtle) layers FIRST while always
 * keeping the nearest (foreground) layer so the scene never goes blank. The
 * stack is assumed far→near (as the defaults are); we keep the LAST
 * `ceil(n * scale)` layers (the nearest ones). `scale` 1 keeps all; `scale` 0
 * keeps exactly one (the foreground). PURE — returns a new sliced array and
 * never mutates the input.
 */
export function visibleParallaxLayers(
  layers: readonly ParallaxLayer[],
  parallaxScale: number,
): readonly ParallaxLayer[] {
  if (layers.length === 0) return layers;
  const scale = clampFactor(parallaxScale);
  // Always keep at least the nearest layer; round up so partial scale keeps a
  // useful amount of depth rather than collapsing early.
  const keep = Math.max(1, Math.ceil(layers.length * scale));
  if (keep >= layers.length) return layers;
  return layers.slice(layers.length - keep);
}

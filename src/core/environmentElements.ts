// Feature: kino-game
//
// The PURE, Phaser-free PER-WORLD ENVIRONMENT-ELEMENT CATALOG + PLACEMENT model
// (task 12.2b; design: "Visual Direction"; Req 27.1-27.12). This is the
// DECORATION layer that dresses each World with its signature scenery — the
// desert highway and Route 53 signs of World 1, the lava rocks and compute
// structures of World 2, the jungle vines and caves of World 3, the icebergs
// and water surface of World 4, the data center and restricted zones of World 5
// — and lays those elements out along the scroll on the multi-layer parallax
// backdrop (task 12.2a, `./parallax.ts`).
//
// SCOPE / HARD BOUNDARY: these elements are PURELY DECORATIVE. Every spec here
// carries `decorative: true` and NONE of them is ever collidable. They are NOT
// obstacles — they never enter the ObstacleSpawner's `Obstacle` stream, never
// reach the CollisionSystem, and never score (the body-only collision contract
// of Req 41/44 is unaffected). This module describes ONLY where decorative art
// rides and how densely it repeats; the GameplayScene renders them on the
// matching parallax layer and scrolls them with that layer's `-scrollX * factor`
// offset (far scenery drifts slower than near scenery, exactly like the bands).
//
// The AWS references (e.g. "Route 53" road signage in World 1, Req 27.7) are
// in-world FLAVOR text attached to an element — decorative only, never a
// tutorial and never gameplay-affecting.
//
// Determinism/purity (testability, mirrors obstacleSpawner's grid anchoring):
// element placement is derived from a fixed WORLD-SPACE grid anchored at x=0
// per element kind (cumulative `spacingPx` from index 0), so the same inputs
// always yield the same placements with the same stable ids — no ambient RNG.
// The anchoring means two overlapping scroll windows AGREE on the placements in
// their overlap (stable ids across calls), which is what lets the GameplayScene
// recycle decorative views safely as the world scrolls.
//
// HARD RULE (enforced by test/boundary.core-no-phaser.test.ts): no `phaser`
// import, directly or transitively. Pure data + pure functions only.

import type { WorldId } from './types.ts';
import { defaultParallaxLayers, type ParallaxLayer } from './parallax.ts';

/**
 * A relative size hint for a decorative element, mapped by the engine to a
 * drawn footprint on its parallax layer (far layers render the same hint
 * smaller for depth). Flavor sizing only — carries no gameplay meaning.
 */
export type ElementSizeHint = 'small' | 'medium' | 'large';

/**
 * One decorative environment element KIND for a World (Req 27.1-27.12). Pure
 * data: it names the element, the World it belongs to, which parallax layer it
 * rides (a `name` from `./parallax.ts`'s far→near stack), and a deterministic
 * placement recipe (world-space horizontal `spacingPx` between repeats and a
 * vertical `yBand` fraction of the play area where it sits). `decorative` is
 * ALWAYS true — the structural guarantee these never become obstacles. The
 * optional `awsFlavor` carries an in-world AWS reference string (e.g.
 * "Route 53") the engine may stamp on the element as decorative signage
 * (Req 27.7); it never affects gameplay.
 */
export interface EnvironmentElementSpec {
  /** Stable kind id, unique within a World (e.g. 'route53-sign'). */
  kind: string;
  /** The World this element dresses (1..5). */
  worldId: WorldId;
  /** Parallax layer name it rides — one of its World's `./parallax.ts` stack. */
  parallaxLayer: string;
  /**
   * World-space horizontal spacing (px) between consecutive repeats of this
   * element. Positive; anchors a per-kind grid at world x=0 for deterministic,
   * window-stable placement (like obstacleSpawner's pitch).
   */
  spacingPx: number;
  /**
   * World-space horizontal offset (px) of the FIRST repeat from x=0, so two
   * element kinds on the same layer do not all stack on the same column.
   */
  phasePx: number;
  /**
   * Vertical band CENTER as a fraction of the play area height in [0,1], where
   * 0 is the top (sky) and 1 is the ground line. The engine maps this to a
   * pixel y for the element's drawn footprint.
   */
  yBand: number;
  /** Relative size hint for the drawn footprint. */
  size: ElementSizeHint;
  /** ALWAYS true — decorative, never collidable, never an obstacle. */
  decorative: true;
  /** Optional in-world AWS flavor reference (e.g. 'Route 53'), decorative only. */
  awsFlavor?: string;
}

/**
 * One resolved decorative placement along the scroll: an element SPEC paired
 * with the world-space x at which a repeat sits and its stable instance id.
 * The GameplayScene draws the spec's art at `worldX - scrollX` (screen space)
 * on the spec's parallax layer. PURE data — no Phaser object here.
 */
export interface EnvironmentElementPlacement {
  /** The element kind being placed (same reference as the catalog spec). */
  spec: EnvironmentElementSpec;
  /** World-space x of this repeat (anchored on the per-kind grid). */
  worldX: number;
  /** Stable instance id: `<kind>-<gridIndex>`, repeatable across calls. */
  id: string;
}

/**
 * The per-World decorative environment-element CATALOG (Req 27.1-27.12). Each
 * World lists the element KINDS that dress it, each pinned to one of its
 * parallax layers (far scenery on far layers, foreground scenery on near
 * layers) with a deterministic spacing/phase/band. Frozen so a caller can never
 * mutate the shared catalog.
 *
 *  - W1 Desert (Req 27.1, 27.8): desert highway, Route 53 road signs (AWS
 *    flavor), cacti, rocks, tumbleweeds.
 *  - W2 Foundry/Mountains (Req 27.2, 27.9): mountains, lava rocks, industrial
 *    pipes, mechanical compute structures.
 *  - W3 Memory Jungle (Req 27.3, 27.10): dense jungle, vines, caves,
 *    interconnected paths.
 *  - W4 Ice & Underwater (Req 27.4, 27.11): icebergs, icy structures, the water
 *    surface, underwater scenery — PLUS the icy surface shown BEFORE the water.
 *  - W5 Security Citadel (Req 27.5, 27.12): data center, security
 *    infrastructure, defensive barriers, restricted zones.
 */
export const WORLD_ENVIRONMENT_ELEMENTS: Readonly<
  Record<WorldId, readonly EnvironmentElementSpec[]>
> = {
  // World 1 — Desert (Req 27.1, 27.8). The highway is a near-ground ribbon; the
  // Route 53 signs carry the AWS flavor (Req 27.7); cacti/rocks/tumbleweeds
  // dress the mid/near layers.
  1: Object.freeze([
    {
      kind: 'desert-highway',
      worldId: 1,
      parallaxLayer: 'near',
      spacingPx: 320,
      phasePx: 0,
      yBand: 0.92,
      size: 'large',
      decorative: true,
    },
    {
      kind: 'route53-sign',
      worldId: 1,
      parallaxLayer: 'near',
      spacingPx: 760,
      phasePx: 180,
      yBand: 0.62,
      size: 'medium',
      decorative: true,
      awsFlavor: 'Route 53',
    },
    {
      kind: 'cactus',
      worldId: 1,
      parallaxLayer: 'mid',
      spacingPx: 440,
      phasePx: 90,
      yBand: 0.78,
      size: 'medium',
      decorative: true,
    },
    {
      kind: 'rock',
      worldId: 1,
      parallaxLayer: 'mid',
      spacingPx: 300,
      phasePx: 210,
      yBand: 0.85,
      size: 'small',
      decorative: true,
    },
    {
      kind: 'tumbleweed',
      worldId: 1,
      parallaxLayer: 'near',
      spacingPx: 520,
      phasePx: 60,
      yBand: 0.88,
      size: 'small',
      decorative: true,
    },
  ]),

  // World 2 — Foundry / Mountains (Req 27.2, 27.9). Mountains sit far; lava
  // rocks mid; pipes and compute structures crowd the near layer.
  2: Object.freeze([
    {
      kind: 'mountain',
      worldId: 2,
      parallaxLayer: 'far',
      spacingPx: 640,
      phasePx: 0,
      yBand: 0.55,
      size: 'large',
      decorative: true,
    },
    {
      kind: 'lava-rock',
      worldId: 2,
      parallaxLayer: 'mid',
      spacingPx: 360,
      phasePx: 120,
      yBand: 0.82,
      size: 'small',
      decorative: true,
    },
    {
      kind: 'pipe',
      worldId: 2,
      parallaxLayer: 'near',
      spacingPx: 420,
      phasePx: 60,
      yBand: 0.7,
      size: 'medium',
      decorative: true,
    },
    {
      kind: 'compute-structure',
      worldId: 2,
      parallaxLayer: 'near',
      spacingPx: 560,
      phasePx: 260,
      yBand: 0.6,
      size: 'large',
      decorative: true,
      awsFlavor: 'EC2',
    },
  ]),

  // World 3 — Memory Jungle (Req 27.3, 27.10). Jungle canopy far; caves mid;
  // vines and interconnected paths near.
  3: Object.freeze([
    {
      kind: 'jungle',
      worldId: 3,
      parallaxLayer: 'far',
      spacingPx: 400,
      phasePx: 0,
      yBand: 0.5,
      size: 'large',
      decorative: true,
    },
    {
      kind: 'cave',
      worldId: 3,
      parallaxLayer: 'mid',
      spacingPx: 680,
      phasePx: 200,
      yBand: 0.72,
      size: 'large',
      decorative: true,
    },
    {
      kind: 'vine',
      worldId: 3,
      parallaxLayer: 'near',
      spacingPx: 260,
      phasePx: 40,
      yBand: 0.3,
      size: 'medium',
      decorative: true,
    },
    {
      kind: 'path',
      worldId: 3,
      parallaxLayer: 'near',
      spacingPx: 360,
      phasePx: 150,
      yBand: 0.9,
      size: 'medium',
      decorative: true,
    },
  ]),

  // World 4 — Ice & Underwater (Req 27.4, 27.11). Icebergs far; icy structures
  // mid; the water surface is a near-layer ribbon; underwater scenery sits
  // deep; and the ICY SURFACE (navigated BEFORE the water) is its own near
  // element so the "icy surface before the water" reading is explicit.
  4: Object.freeze([
    {
      kind: 'iceberg',
      worldId: 4,
      parallaxLayer: 'far',
      spacingPx: 560,
      phasePx: 0,
      yBand: 0.48,
      size: 'large',
      decorative: true,
    },
    {
      kind: 'icy-structure',
      worldId: 4,
      parallaxLayer: 'mid',
      spacingPx: 400,
      phasePx: 130,
      yBand: 0.66,
      size: 'medium',
      decorative: true,
    },
    {
      kind: 'icy-surface',
      worldId: 4,
      parallaxLayer: 'near',
      spacingPx: 320,
      phasePx: 40,
      yBand: 0.8,
      size: 'large',
      decorative: true,
    },
    {
      kind: 'water-surface',
      worldId: 4,
      parallaxLayer: 'near',
      spacingPx: 300,
      phasePx: 0,
      yBand: 0.84,
      size: 'large',
      decorative: true,
    },
    {
      kind: 'underwater-scenery',
      worldId: 4,
      parallaxLayer: 'mid',
      spacingPx: 440,
      phasePx: 220,
      yBand: 0.93,
      size: 'medium',
      decorative: true,
    },
  ]),

  // World 5 — Security Citadel (Req 27.5, 27.12). The data center looms far;
  // security infrastructure mid; defensive barriers and restricted zones near.
  5: Object.freeze([
    {
      kind: 'data-center',
      worldId: 5,
      parallaxLayer: 'far',
      spacingPx: 600,
      phasePx: 0,
      yBand: 0.5,
      size: 'large',
      decorative: true,
      awsFlavor: 'IAM',
    },
    {
      kind: 'security-infra',
      worldId: 5,
      parallaxLayer: 'mid',
      spacingPx: 380,
      phasePx: 110,
      yBand: 0.64,
      size: 'medium',
      decorative: true,
    },
    {
      kind: 'barrier',
      worldId: 5,
      parallaxLayer: 'near',
      spacingPx: 300,
      phasePx: 50,
      yBand: 0.78,
      size: 'medium',
      decorative: true,
    },
    {
      kind: 'restricted-zone',
      worldId: 5,
      parallaxLayer: 'near',
      spacingPx: 520,
      phasePx: 240,
      yBand: 0.7,
      size: 'large',
      decorative: true,
    },
  ]),
};

/**
 * The decorative environment-element SPECS for a World (Req 27.1-27.12).
 * Returns the frozen catalog for the given world, falling back to World 1's
 * set for an out-of-range id so a caller always gets a sensible list. PURE.
 */
export function environmentElementsForWorld(
  world: WorldId,
): readonly EnvironmentElementSpec[] {
  return WORLD_ENVIRONMENT_ELEMENTS[world] ?? WORLD_ENVIRONMENT_ELEMENTS[1];
}

/**
 * Validate that every element in a World's catalog references a parallax-layer
 * NAME that actually exists in that World's `./parallax.ts` stack (task 12.2a).
 * Returns the offending `kind`s (empty when the catalog is internally
 * consistent). PURE — used by tests and as a self-check seam; the engine can
 * assume a clean catalog.
 */
export function elementsWithUnknownLayer(world: WorldId): string[] {
  const layerNames = new Set(
    defaultParallaxLayers(world).map((l: ParallaxLayer) => l.name),
  );
  const offenders: string[] = [];
  for (const spec of environmentElementsForWorld(world)) {
    if (!layerNames.has(spec.parallaxLayer)) offenders.push(spec.kind);
  }
  return offenders;
}

/**
 * Deterministically place ONE element kind across a world-space scroll window
 * `[windowStartX, windowStartX + windowWidth]` (Req 27.1-27.12, parallax-ride
 * placement). Repeats sit on a per-kind grid anchored at world x=0:
 * `worldX(n) = phasePx + n * spacingPx`. We emit every repeat whose `worldX`
 * lies in the window, each with a STABLE `<kind>-<n>` id, so overlapping
 * windows agree on their shared repeats (the recycle-safe contract). PURE and
 * deterministic: identical inputs yield identical placements. A non-positive
 * `spacingPx` or non-finite window degrades to an empty list rather than
 * looping forever / producing NaN geometry.
 */
export function placeElement(
  spec: EnvironmentElementSpec,
  windowStartX: number,
  windowWidth: number,
): EnvironmentElementPlacement[] {
  const out: EnvironmentElementPlacement[] = [];
  if (!Number.isFinite(windowStartX) || !Number.isFinite(windowWidth)) return out;
  if (!(spec.spacingPx > 0) || windowWidth < 0) return out;

  const windowEndX = windowStartX + windowWidth;
  // First grid index whose worldX >= windowStartX, clamped to >= 0 (the grid
  // starts at phasePx; nothing exists left of index 0).
  const firstIndex = Math.max(
    0,
    Math.ceil((windowStartX - spec.phasePx) / spec.spacingPx),
  );
  for (let n = firstIndex; ; n++) {
    const worldX = spec.phasePx + n * spec.spacingPx;
    if (worldX > windowEndX) break;
    out.push({ spec, worldX, id: `${spec.kind}-${n}` });
  }
  return out;
}

/**
 * Deterministically place EVERY decorative element of a World across a scroll
 * window (Req 27.1-27.12). Concatenates {@link placeElement} over the World's
 * catalog in catalog order (far→near friendly for the engine's back-to-front
 * draw). PURE and deterministic: identical inputs yield identical placements
 * with identical stable ids, so overlapping windows agree on their overlap and
 * the GameplayScene can recycle decorative views safely as the world scrolls.
 */
export function placeEnvironmentElements(
  world: WorldId,
  windowStartX: number,
  windowWidth: number,
): EnvironmentElementPlacement[] {
  const out: EnvironmentElementPlacement[] = [];
  for (const spec of environmentElementsForWorld(world)) {
    out.push(...placeElement(spec, windowStartX, windowWidth));
  }
  return out;
}

// Feature: kino-game
//
// UNIT tests for the PURE per-World environment-element catalog + placement
// model (task 12.2b; design: "Visual Direction"; Req 27.1-27.12). Verifies each
// World returns its documented element kinds, that elements reference valid
// parallax layer names, that placement is deterministic and grid-anchored (so
// overlapping windows agree), that every element is flagged decorative /
// non-collidable, and that the AWS flavor reference (Route 53) appears in W1.

import { describe, it, expect } from 'vitest';
import {
  environmentElementsForWorld,
  elementsWithUnknownLayer,
  placeElement,
  placeEnvironmentElements,
  defaultParallaxLayers,
  WORLD_ENVIRONMENT_ELEMENTS,
  type WorldId,
  type EnvironmentElementSpec,
} from '../src/core/index.ts';

const WORLD_IDS: WorldId[] = [1, 2, 3, 4, 5];

/** The element KINDS each World is documented to render (Req 27.8-27.12). */
const EXPECTED_KINDS: Record<WorldId, string[]> = {
  1: ['desert-highway', 'route53-sign', 'cactus', 'rock', 'tumbleweed'],
  2: ['mountain', 'lava-rock', 'pipe', 'compute-structure'],
  3: ['jungle', 'vine', 'cave', 'path'],
  4: [
    'iceberg',
    'icy-structure',
    'icy-surface',
    'water-surface',
    'underwater-scenery',
  ],
  5: ['data-center', 'security-infra', 'barrier', 'restricted-zone'],
};

describe('environmentElementsForWorld — documented per-World element kinds', () => {
  it('each World returns exactly its documented element kinds (Req 27.8-27.12)', () => {
    for (const world of WORLD_IDS) {
      const kinds = environmentElementsForWorld(world).map((e) => e.kind);
      for (const expected of EXPECTED_KINDS[world]) {
        expect(kinds).toContain(expected);
      }
    }
  });

  it('W4 includes BOTH the water surface and the icy surface shown before it (Req 27.11)', () => {
    const kinds = environmentElementsForWorld(4).map((e) => e.kind);
    expect(kinds).toContain('water-surface');
    expect(kinds).toContain('icy-surface');
    expect(kinds).toContain('underwater-scenery');
  });

  it('falls back to World 1 for an out-of-range id', () => {
    const fallback = environmentElementsForWorld(99 as unknown as WorldId);
    expect(fallback).toBe(WORLD_ENVIRONMENT_ELEMENTS[1]);
  });

  it('exposes frozen catalogs a caller cannot mutate', () => {
    for (const world of WORLD_IDS) {
      expect(Object.isFrozen(WORLD_ENVIRONMENT_ELEMENTS[world])).toBe(true);
    }
  });
});

describe('AWS references ride as in-world flavor (Req 27.7)', () => {
  it('World 1 carries the Route 53 flavor reference on its signage element', () => {
    const w1 = environmentElementsForWorld(1);
    const sign = w1.find((e) => e.kind === 'route53-sign');
    expect(sign).toBeDefined();
    expect(sign!.awsFlavor).toBe('Route 53');
  });

  it('a flavor reference appears somewhere in World 1 (decorative, not gameplay)', () => {
    const anyFlavor = environmentElementsForWorld(1).some((e) =>
      (e.awsFlavor ?? '').includes('Route 53'),
    );
    expect(anyFlavor).toBe(true);
  });
});

describe('decorative / non-collidable flag (keeps elements out of collision)', () => {
  it('every element in every World is flagged decorative: true', () => {
    for (const world of WORLD_IDS) {
      for (const spec of environmentElementsForWorld(world)) {
        expect(spec.decorative).toBe(true);
      }
    }
  });

  it('no element carries obstacle/collision fields (bounds/scoringLineX)', () => {
    for (const world of WORLD_IDS) {
      for (const spec of environmentElementsForWorld(world)) {
        // Decorative specs are not Obstacles — they never reach the spawner.
        expect(spec).not.toHaveProperty('bounds');
        expect(spec).not.toHaveProperty('scoringLineX');
      }
    }
  });
});

describe('elements reference valid parallax layer names (task 12.2a)', () => {
  it('every element rides a layer that exists in its World parallax stack', () => {
    for (const world of WORLD_IDS) {
      expect(elementsWithUnknownLayer(world)).toEqual([]);
    }
  });

  it('cross-checks each element layer against defaultParallaxLayers directly', () => {
    for (const world of WORLD_IDS) {
      const names = new Set(defaultParallaxLayers(world).map((l) => l.name));
      for (const spec of environmentElementsForWorld(world)) {
        expect(names.has(spec.parallaxLayer)).toBe(true);
      }
    }
  });
});

describe('placeElement — deterministic grid-anchored placement', () => {
  const spec: EnvironmentElementSpec = {
    kind: 'cactus',
    worldId: 1,
    parallaxLayer: 'mid',
    spacingPx: 100,
    phasePx: 20,
    yBand: 0.8,
    size: 'medium',
    decorative: true,
  };

  it('places repeats on the per-kind grid worldX = phasePx + n*spacingPx', () => {
    const placements = placeElement(spec, 0, 350);
    // grid: 20, 120, 220, 320 all within [0,350].
    expect(placements.map((p) => p.worldX)).toEqual([20, 120, 220, 320]);
    expect(placements.map((p) => p.id)).toEqual([
      'cactus-0',
      'cactus-1',
      'cactus-2',
      'cactus-3',
    ]);
  });

  it('is deterministic — identical inputs yield identical placements', () => {
    const a = placeElement(spec, 500, 400);
    const b = placeElement(spec, 500, 400);
    expect(a).toEqual(b);
  });

  it('overlapping windows agree on their shared repeats (stable ids)', () => {
    const left = placeElement(spec, 0, 500); // worldX up to 500
    const right = placeElement(spec, 300, 400); // worldX 300..700
    const overlapL = left.filter((p) => p.worldX >= 300);
    const overlapR = right.filter((p) => p.worldX <= 500);
    // Same ids AND same worldX in the shared [300,500] band.
    expect(overlapL.map((p) => [p.id, p.worldX])).toEqual(
      overlapR.map((p) => [p.id, p.worldX]),
    );
  });

  it('never emits a repeat left of index 0 (grid starts at phasePx)', () => {
    // Window reaches well past phasePx so index 0 is included; no repeat may
    // land left of the grid origin even though the window starts far negative.
    const placements = placeElement(spec, -1000, 1200);
    expect(placements.length).toBeGreaterThan(0);
    expect(placements.every((p) => p.worldX >= spec.phasePx)).toBe(true);
    expect(placements[0]!.id).toBe('cactus-0');
    expect(placements[0]!.worldX).toBe(spec.phasePx);
  });

  it('degrades a non-positive spacing or non-finite window to an empty list', () => {
    expect(placeElement({ ...spec, spacingPx: 0 }, 0, 500)).toEqual([]);
    expect(placeElement({ ...spec, spacingPx: -10 }, 0, 500)).toEqual([]);
    expect(placeElement(spec, Number.NaN, 500)).toEqual([]);
    expect(placeElement(spec, 0, Number.POSITIVE_INFINITY)).toEqual([]);
  });

  it('a zero-width window includes only a repeat exactly on the start edge', () => {
    // Window [120,120]: only the grid point at 120 qualifies.
    expect(placeElement(spec, 120, 0).map((p) => p.worldX)).toEqual([120]);
    // A window on no grid point yields nothing.
    expect(placeElement(spec, 121, 0)).toEqual([]);
  });
});

describe('placeEnvironmentElements — whole-World deterministic placement', () => {
  it('concatenates every element kind of the World across the window', () => {
    for (const world of WORLD_IDS) {
      const placements = placeEnvironmentElements(world, 0, 1200);
      // Every placed id belongs to a catalog kind of this World.
      const kinds = new Set(environmentElementsForWorld(world).map((e) => e.kind));
      for (const p of placements) {
        expect(kinds.has(p.spec.kind)).toBe(true);
        expect(p.spec.decorative).toBe(true);
      }
      // At least one repeat of each kind appears over a wide window.
      for (const kind of kinds) {
        expect(placements.some((p) => p.spec.kind === kind)).toBe(true);
      }
    }
  });

  it('is deterministic across repeated calls', () => {
    const a = placeEnvironmentElements(4, 777, 900);
    const b = placeEnvironmentElements(4, 777, 900);
    expect(a).toEqual(b);
  });

  it('overlapping windows agree on the whole-World overlap', () => {
    const left = placeEnvironmentElements(2, 0, 1000);
    const right = placeEnvironmentElements(2, 600, 800);
    const overlapL = left
      .filter((p) => p.worldX >= 600 && p.worldX <= 1000)
      .map((p) => [p.id, p.worldX]);
    const overlapR = right
      .filter((p) => p.worldX >= 600 && p.worldX <= 1000)
      .map((p) => [p.id, p.worldX]);
    expect(overlapL).toEqual(overlapR);
  });
});

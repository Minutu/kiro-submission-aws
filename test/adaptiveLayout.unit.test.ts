// Feature: kino-game
//
// Adaptive_Layout math UNIT tests (task 9.9; Req 26.10, 26.11, 26.12).
//
// Exercises the PURE `computeLayout`/`mapPoint`/`mapRect` helpers in
// `src/core/adaptiveLayout.ts`: the aspect-preserving centered "contain" fit of
// a fixed squarish DESIGN surface into desktop/tablet viewports, the letterbox
// offsets, and the design->actual mapping. No Phaser, no DOM.

import { describe, it, expect } from 'vitest';
import {
  computeLayout,
  mapPoint,
  mapRect,
} from '../src/core/adaptiveLayout.ts';

/** The squarish desktop-style design target the game renders at. */
const DESIGN = { width: 960, height: 960 } as const;

describe('computeLayout — equal design == actual (Req 26.11)', () => {
  it('yields scale 1 and zero offsets when actual matches design', () => {
    const layout = computeLayout(DESIGN, { width: 960, height: 960 });
    expect(layout.scale).toBe(1);
    expect(layout.offsetX).toBe(0);
    expect(layout.offsetY).toBe(0);
    expect(layout.scaledWidth).toBe(960);
    expect(layout.scaledHeight).toBe(960);
  });

  it('yields scale 1 / zero offset for a non-square equal surface', () => {
    const design = { width: 1280, height: 720 };
    const layout = computeLayout(design, { width: 1280, height: 720 });
    expect(layout.scale).toBe(1);
    expect(layout.offsetX).toBe(0);
    expect(layout.offsetY).toBe(0);
  });
});

describe('computeLayout — wider-than-design actual letterboxes horizontally (Req 26.12)', () => {
  it('centers with bars on the left/right and no vertical offset', () => {
    // 1920x960 is twice as wide as the 960x960 design: height is the tight
    // axis, so scale fits height (960/960 = 1) and the extra width becomes
    // equal horizontal letterbox bars.
    const layout = computeLayout(DESIGN, { width: 1920, height: 960 });
    expect(layout.scale).toBe(1);
    expect(layout.offsetY).toBe(0);
    expect(layout.offsetX).toBeGreaterThan(0);
    // (1920 - 960*1) / 2 = 480 on each side.
    expect(layout.offsetX).toBe(480);
    expect(layout.scaledWidth).toBe(960);
    expect(layout.scaledHeight).toBe(960);
  });

  it('preserves aspect ratio when the wider viewport also grows (desktop)', () => {
    // 1600x900 landscape desktop. Tight axis is height: 900/960 vs 1600/960.
    const layout = computeLayout(DESIGN, { width: 1600, height: 900 });
    const expectedScale = 900 / 960;
    expect(layout.scale).toBeCloseTo(expectedScale, 10);
    expect(layout.offsetY).toBeCloseTo(0, 10);
    expect(layout.offsetX).toBeGreaterThan(0);
    // Aspect preserved: fitted surface stays square (w == h) like the design.
    expect(layout.scaledWidth).toBeCloseTo(layout.scaledHeight, 10);
  });
});

describe('computeLayout — taller-than-design actual letterboxes vertically (Req 26.12)', () => {
  it('centers with bars on the top/bottom and no horizontal offset', () => {
    // 960x1440 (portrait tablet): width is the tight axis, scale fits width
    // (960/960 = 1), extra height becomes equal vertical bars.
    const layout = computeLayout(DESIGN, { width: 960, height: 1440 });
    expect(layout.scale).toBe(1);
    expect(layout.offsetX).toBe(0);
    expect(layout.offsetY).toBeGreaterThan(0);
    // (1440 - 960) / 2 = 240 top and bottom.
    expect(layout.offsetY).toBe(240);
  });

  it('preserves aspect ratio on a tablet-ish portrait viewport', () => {
    // 768x1024 portrait tablet. Tight axis is width: 768/960 vs 1024/960.
    const layout = computeLayout(DESIGN, { width: 768, height: 1024 });
    const expectedScale = 768 / 960;
    expect(layout.scale).toBeCloseTo(expectedScale, 10);
    expect(layout.offsetX).toBeCloseTo(0, 10);
    expect(layout.offsetY).toBeGreaterThan(0);
    expect(layout.scaledWidth).toBeCloseTo(layout.scaledHeight, 10);
  });
});

describe('computeLayout — proportional scaling, no stretch (Req 26.11)', () => {
  it('uses ONE uniform scale for both axes (fitted surface keeps design aspect)', () => {
    for (const actual of [
      { width: 1920, height: 1080 }, // desktop 16:9
      { width: 1366, height: 768 }, // laptop
      { width: 1024, height: 768 }, // tablet landscape 4:3
      { width: 800, height: 1280 }, // tablet portrait
    ]) {
      const layout = computeLayout(DESIGN, actual);
      // A square design stays square after a single-factor scale -> no stretch.
      expect(layout.scaledWidth).toBeCloseTo(layout.scaledHeight, 9);
      // The fitted surface never exceeds the viewport on either axis.
      expect(layout.scaledWidth).toBeLessThanOrEqual(actual.width + 1e-9);
      expect(layout.scaledHeight).toBeLessThanOrEqual(actual.height + 1e-9);
    }
  });

  it('scales a non-square design uniformly without changing its aspect', () => {
    const design = { width: 1200, height: 800 }; // 3:2
    const layout = computeLayout(design, { width: 600, height: 600 });
    // Tight axis is width (600/1200 = 0.5) vs height (600/800 = 0.75).
    expect(layout.scale).toBeCloseTo(0.5, 10);
    // Aspect ratio preserved after scaling.
    expect(layout.scaledWidth / layout.scaledHeight).toBeCloseTo(1200 / 800, 10);
  });
});

describe('mapPoint — design-space point maps to expected actual-space point (Req 26.10)', () => {
  it('maps the design center to the actual viewport center', () => {
    const actual = { width: 1920, height: 960 };
    const layout = computeLayout(DESIGN, actual);
    const center = mapPoint({ x: 480, y: 480 }, layout);
    expect(center.x).toBeCloseTo(actual.width / 2, 9);
    expect(center.y).toBeCloseTo(actual.height / 2, 9);
  });

  it('maps the design origin to the top-left letterbox corner', () => {
    const layout = computeLayout(DESIGN, { width: 1920, height: 960 });
    const origin = mapPoint({ x: 0, y: 0 }, layout);
    expect(origin.x).toBe(layout.offsetX);
    expect(origin.y).toBe(layout.offsetY);
  });

  it('applies actual = design * scale + offset', () => {
    const layout = computeLayout(DESIGN, { width: 960, height: 1440 });
    // scale 1, offsetY 240, offsetX 0.
    const p = mapPoint({ x: 100, y: 200 }, layout);
    expect(p.x).toBeCloseTo(100 * 1 + 0, 9);
    expect(p.y).toBeCloseTo(200 * 1 + 240, 9);
  });

  it('maps proportionally when scaled down (tablet)', () => {
    const layout = computeLayout(DESIGN, { width: 768, height: 1024 });
    const scale = 768 / 960;
    const p = mapPoint({ x: 480, y: 480 }, layout);
    expect(p.x).toBeCloseTo(480 * scale + layout.offsetX, 9);
    expect(p.y).toBeCloseTo(480 * scale + layout.offsetY, 9);
  });
});

describe('mapRect — rect repositions AND rescales (Req 26.10, 26.12)', () => {
  it('scales size by the uniform factor and offsets the corner', () => {
    const layout = computeLayout(DESIGN, { width: 1600, height: 900 });
    const scale = 900 / 960;
    const rect = mapRect({ x: 100, y: 50, width: 200, height: 80 }, layout);
    expect(rect.x).toBeCloseTo(100 * scale + layout.offsetX, 9);
    expect(rect.y).toBeCloseTo(50 * scale + layout.offsetY, 9);
    expect(rect.width).toBeCloseTo(200 * scale, 9);
    expect(rect.height).toBeCloseTo(80 * scale, 9);
  });

  it('is identity on size when actual == design', () => {
    const layout = computeLayout(DESIGN, { width: 960, height: 960 });
    const rect = mapRect({ x: 10, y: 20, width: 30, height: 40 }, layout);
    expect(rect).toEqual({ x: 10, y: 20, width: 30, height: 40 });
  });
});

describe('computeLayout — degenerate inputs stay finite', () => {
  it('returns an empty layout for a non-positive design surface', () => {
    const layout = computeLayout({ width: 0, height: 960 }, { width: 800, height: 600 });
    expect(layout).toEqual({
      scale: 0,
      offsetX: 0,
      offsetY: 0,
      scaledWidth: 0,
      scaledHeight: 0,
    });
  });

  it('clamps a non-positive actual axis without NaN', () => {
    const layout = computeLayout(DESIGN, { width: 0, height: 600 });
    expect(Number.isFinite(layout.scale)).toBe(true);
    expect(layout.scale).toBe(0);
    expect(Number.isFinite(layout.offsetX)).toBe(true);
    expect(Number.isFinite(layout.offsetY)).toBe(true);
  });
});

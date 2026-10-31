// Feature: kino-game
//
// UNIT tests for the PURE palette APPLICATION / OVERLAY resolver (task 12.2c;
// design: "Visual Direction"; Req 27.13-27.14, 38.3-38.6). Verifies:
//   - each World's base element colors (background/obstacles/kino) resolve from
//     its ColorPalette (Req 27.13-27.14, 38.3);
//   - an overlay with NO gate is ALWAYS active (W2 lavaGlow, W5 redAlert, Req
//     38.3-38.4);
//   - a GATED overlay (W4 underwaterBlue) applies ONLY when its condition is
//     active and is ABSENT when inactive (Req 38.4);
//   - the ATOMIC obstacles+kino overlay resolves IDENTICALLY into BOTH targets
//     (applied together) and both DROP it when the condition goes false (Req
//     38.5-38.6);
//   - color compositing is deterministic and correct at alpha 0 (no change) and
//     alpha 1 (full tint).
//
// Uses the DEFAULT Config_File palettes (the authoritative overlay/tint
// defaults, Req 38.3): W2 `lavaGlow` + W5 `redAlert` are ungated background
// overlays; W4 `underwaterBlue` is the gated atomic obstacles+kino overlay.

import { describe, it, expect } from 'vitest';
import {
  resolvePaletteApplication,
  activeOverlays,
  isOverlayActive,
  compositeColor,
  parseHexColor,
  rgbToHex,
  ATOMIC_OBSTACLES_KINO_TARGET,
  type Rgb,
} from '../src/core/index.ts';
import { defaultConfig } from '../src/config/index.ts';

const palettes = defaultConfig.colorPalettes;
const ALL = [
  ['world1', palettes.world1],
  ['world2', palettes.world2],
  ['world3', palettes.world3],
  ['world4', palettes.world4],
  ['world5', palettes.world5],
] as const;

function rgb(hex: string): Rgb {
  return parseHexColor(hex);
}

describe('parseHexColor / rgbToHex — deterministic color parsing', () => {
  it('parses #RRGGBB into channels and round-trips back to hex', () => {
    expect(parseHexColor('#1E6FB0')).toEqual({ r: 0x1e, g: 0x6f, b: 0xb0 });
    expect(rgbToHex({ r: 0x1e, g: 0x6f, b: 0xb0 })).toBe('#1E6FB0');
  });

  it('tolerates a missing leading # and surrounding whitespace', () => {
    expect(parseHexColor('  FF6A00 ')).toEqual({ r: 255, g: 106, b: 0 });
  });

  it('degrades a malformed value to black (no NaN channels)', () => {
    expect(parseHexColor('nope')).toEqual({ r: 0, g: 0, b: 0 });
    expect(parseHexColor('')).toEqual({ r: 0, g: 0, b: 0 });
  });
});

describe('compositeColor — alpha blend boundary contracts (Req 38.5-38.6)', () => {
  const base: Rgb = { r: 100, g: 150, b: 200 };
  const over: Rgb = { r: 0, g: 0, b: 0 };

  it('alpha 0 returns the base UNCHANGED (overlay removed)', () => {
    expect(compositeColor(base, over, 0)).toEqual(base);
  });

  it('alpha 1 returns the overlay (full tint applied)', () => {
    expect(compositeColor(base, over, 1)).toEqual(over);
  });

  it('alpha 0.5 is the per-channel midpoint', () => {
    expect(compositeColor({ r: 0, g: 0, b: 0 }, { r: 200, g: 100, b: 50 }, 0.5)).toEqual({
      r: 100,
      g: 50,
      b: 25,
    });
  });

  it('is deterministic — same inputs, same output', () => {
    const a = compositeColor(base, { r: 30, g: 111, b: 176 }, 0.35);
    const b = compositeColor(base, { r: 30, g: 111, b: 176 }, 0.35);
    expect(a).toEqual(b);
  });

  it('clamps a non-finite / out-of-range alpha to [0,1]', () => {
    expect(compositeColor(base, over, Number.NaN)).toEqual(base); // => 0
    expect(compositeColor(base, over, 5)).toEqual(over); // => 1
    expect(compositeColor(base, over, -5)).toEqual(base); // => 0
  });
});

describe('resolvePaletteApplication — base element colors (Req 27.13-27.14, 38.3)', () => {
  it.each(ALL)('%s resolves background/obstacles/kino from its ColorPalette', (_name, palette) => {
    const app = resolvePaletteApplication(palette, {});
    expect(app.background.base).toEqual(rgb(palette.background));
    expect(app.obstacles.base).toEqual(rgb(palette.obstacles));
    expect(app.kino.base).toEqual(rgb(palette.kino));
    expect(app.background.baseHex).toBe(palette.background);
    expect(app.obstacles.baseHex).toBe(palette.obstacles);
    expect(app.kino.baseHex).toBe(palette.kino);
  });

  it('a palette with NO overlays leaves every target color == base (World 1)', () => {
    const app = resolvePaletteApplication(palettes.world1, { underwaterSequence: true });
    expect(app.background.overlays).toEqual([]);
    expect(app.obstacles.overlays).toEqual([]);
    expect(app.kino.overlays).toEqual([]);
    expect(app.background.color).toEqual(app.background.base);
    expect(app.obstacles.color).toEqual(app.obstacles.base);
    expect(app.kino.color).toEqual(app.kino.base);
  });
});

describe('ungated overlays are ALWAYS active (Req 38.3-38.4)', () => {
  it('World 2 lavaGlow applies to the background regardless of context', () => {
    for (const ctx of [{}, { underwaterSequence: true }, { anything: true }]) {
      const app = resolvePaletteApplication(palettes.world2, ctx);
      expect(app.background.overlays.map((o) => o.name)).toEqual(['lavaGlow']);
      // Obstacles + Kino carry no overlay (lavaGlow targets background only).
      expect(app.obstacles.overlays).toEqual([]);
      expect(app.kino.overlays).toEqual([]);
      // The composited background differs from the raw base (tint applied).
      expect(app.background.color).not.toEqual(app.background.base);
    }
  });

  it('World 5 redAlert applies to the background regardless of context', () => {
    const app = resolvePaletteApplication(palettes.world5, {});
    expect(app.background.overlays.map((o) => o.name)).toEqual(['redAlert']);
    expect(app.obstacles.overlays).toEqual([]);
    expect(app.kino.overlays).toEqual([]);
  });

  it('an ungated overlay reports active via isOverlayActive with any context', () => {
    const lavaGlow = palettes.world2.overlays[0]!;
    expect(isOverlayActive(lavaGlow, {})).toBe(true);
    expect(isOverlayActive(lavaGlow, { underwaterSequence: false })).toBe(true);
  });
});

describe('gated overlay applies ONLY when its condition is active (Req 38.4)', () => {
  const underwaterBlue = palettes.world4.overlays[0]!;

  it('isOverlayActive is true only when the gate key is true', () => {
    expect(isOverlayActive(underwaterBlue, { underwaterSequence: true })).toBe(true);
    expect(isOverlayActive(underwaterBlue, { underwaterSequence: false })).toBe(false);
    expect(isOverlayActive(underwaterBlue, {})).toBe(false); // missing => inactive
  });

  it('activeOverlays includes the gated overlay only when active', () => {
    expect(activeOverlays(palettes.world4, { underwaterSequence: true }).map((o) => o.name)).toEqual(
      ['underwaterBlue'],
    );
    expect(activeOverlays(palettes.world4, { underwaterSequence: false })).toEqual([]);
    expect(activeOverlays(palettes.world4, {})).toEqual([]);
  });
});

describe('atomic obstacles+kino overlay resolves for BOTH targets together (Req 38.4-38.6)', () => {
  it('when active: identical overlay in obstacles AND kino, absent from background', () => {
    const app = resolvePaletteApplication(palettes.world4, { underwaterSequence: true });

    const obsOverlay = app.obstacles.overlays.find((o) => o.target === ATOMIC_OBSTACLES_KINO_TARGET);
    const kinoOverlay = app.kino.overlays.find((o) => o.target === ATOMIC_OBSTACLES_KINO_TARGET);

    expect(obsOverlay).toBeDefined();
    expect(kinoOverlay).toBeDefined();
    // The SAME overlay descriptor is surfaced on both (atomic coupling).
    expect(obsOverlay).toEqual(kinoOverlay);
    expect(obsOverlay!.name).toBe('underwaterBlue');

    // Background never receives the atomic obstacles+kino overlay.
    expect(app.background.overlays).toEqual([]);

    // Both composited colors differ from their base (tint applied together).
    expect(app.obstacles.color).not.toEqual(app.obstacles.base);
    expect(app.kino.color).not.toEqual(app.kino.base);
  });

  it('when the condition goes false: BOTH obstacles and kino DROP it (Req 38.5-38.6)', () => {
    const app = resolvePaletteApplication(palettes.world4, { underwaterSequence: false });

    expect(app.obstacles.overlays).toEqual([]);
    expect(app.kino.overlays).toEqual([]);
    // Colors return to the raw base — the overlay is fully removed.
    expect(app.obstacles.color).toEqual(app.obstacles.base);
    expect(app.kino.color).toEqual(app.kino.base);
  });

  it('obstacles and kino stay in lock-step as the gate flips on and off', () => {
    for (const active of [true, false, true, false]) {
      const app = resolvePaletteApplication(palettes.world4, { underwaterSequence: active });
      const obsHas = app.obstacles.overlays.some((o) => o.target === ATOMIC_OBSTACLES_KINO_TARGET);
      const kinoHas = app.kino.overlays.some((o) => o.target === ATOMIC_OBSTACLES_KINO_TARGET);
      // Both or neither — never one without the other.
      expect(obsHas).toBe(active);
      expect(kinoHas).toBe(active);
      expect(obsHas).toBe(kinoHas);
    }
  });

  it('the atomic composited color equals a manual composite at the config alpha', () => {
    const app = resolvePaletteApplication(palettes.world4, { underwaterSequence: true });
    const overlay = palettes.world4.overlays[0]!;
    const expected = compositeColor(
      rgb(palettes.world4.obstacles),
      rgb(overlay.tint),
      overlay.alpha,
    );
    expect(app.obstacles.color).toEqual(expected);
    // Kino composites the SAME overlay onto ITS base.
    const expectedKino = compositeColor(
      rgb(palettes.world4.kino),
      rgb(overlay.tint),
      overlay.alpha,
    );
    expect(app.kino.color).toEqual(expectedKino);
  });
});

describe('resolvePaletteApplication — determinism (Req 38.3)', () => {
  it('same palette + context yields an equal application', () => {
    const a = resolvePaletteApplication(palettes.world4, { underwaterSequence: true });
    const b = resolvePaletteApplication(palettes.world4, { underwaterSequence: true });
    expect(a).toEqual(b);
  });
});

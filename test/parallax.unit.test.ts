// Feature: kino-game
//
// UNIT tests for the PURE multi-layer parallax model (task 12.2a; design:
// "Visual Direction"; Req 30.3). Verifies the scroll-factor geometry (factor-0
// static, factor-1 1:1, intermediate proportional), per-World default stacks
// (ordered far→near with non-decreasing factors), determinism, graceful
// scrollX edge handling, and the degradation-detail layer trimming.

import { describe, it, expect } from 'vitest';
import {
  parallaxOffset,
  parallaxOffsets,
  defaultParallaxLayers,
  visibleParallaxLayers,
  DEFAULT_WORLD_PARALLAX_LAYERS,
  type ParallaxLayer,
  type WorldId,
} from '../src/core/index.ts';

const WORLD_IDS: WorldId[] = [1, 2, 3, 4, 5];

describe('parallaxOffset — single-layer geometry', () => {
  it('a factor-0 layer never moves for any scrollX', () => {
    for (const scrollX of [0, 1, 100, 99999, -250, -1]) {
      expect(parallaxOffset(0, scrollX)).toBe(0);
    }
  });

  it('a factor-1 layer moves 1:1 with scrollX (-scrollX)', () => {
    expect(parallaxOffset(1, 0)).toBe(0);
    expect(parallaxOffset(1, 100)).toBe(-100);
    expect(parallaxOffset(1, 12345)).toBe(-12345);
    expect(parallaxOffset(1, -300)).toBe(300);
  });

  it('intermediate factors move proportionally', () => {
    expect(parallaxOffset(0.5, 200)).toBe(-100);
    expect(parallaxOffset(0.25, 400)).toBe(-100);
    expect(parallaxOffset(0.8, 1000)).toBeCloseTo(-800, 10);
  });

  it('clamps out-of-range factors into [0,1]', () => {
    expect(parallaxOffset(-5, 100)).toBe(0); // clamps to 0 => static
    expect(parallaxOffset(2, 100)).toBe(-100); // clamps to 1 => 1:1
  });

  it('degrades a non-finite scrollX to 0 (no NaN geometry)', () => {
    expect(parallaxOffset(0.5, Number.NaN)).toBe(0);
    expect(parallaxOffset(0.5, Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('is deterministic — same inputs, same output', () => {
    const a = parallaxOffset(0.37, 814);
    const b = parallaxOffset(0.37, 814);
    expect(a).toBe(b);
  });
});

describe('parallaxOffsets — multi-layer resolution', () => {
  const layers: ParallaxLayer[] = [
    { name: 'sky', factor: 0 },
    { name: 'far', factor: 0.25 },
    { name: 'mid', factor: 0.5 },
    { name: 'near', factor: 1 },
  ];

  it('resolves each layer to -scrollX * factor and preserves order', () => {
    const result = parallaxOffsets(layers, 400);
    expect(result.map((r) => r.x)).toEqual([0, -100, -200, -400]);
    expect(result.map((r) => r.layer.name)).toEqual(['sky', 'far', 'mid', 'near']);
  });

  it('far layers move strictly less than near layers (depth reads)', () => {
    const result = parallaxOffsets(layers, 1000);
    const magnitudes = result.map((r) => Math.abs(r.x));
    for (let i = 1; i < magnitudes.length; i++) {
      expect(magnitudes[i]!).toBeGreaterThanOrEqual(magnitudes[i - 1]!);
    }
  });

  it('handles scrollX of 0, large, and negative gracefully', () => {
    expect(parallaxOffsets(layers, 0).every((r) => r.x === 0)).toBe(true);
    const large = parallaxOffsets(layers, 1_000_000);
    expect(large.every((r) => Number.isFinite(r.x))).toBe(true);
    const negative = parallaxOffsets(layers, -500);
    // Negative scroll mirrors the sign: offsets are >= 0.
    expect(negative.every((r) => r.x >= 0)).toBe(true);
    expect(negative[3]!.x).toBe(500);
  });

  it('returns an empty array for an empty layer set', () => {
    expect(parallaxOffsets([], 100)).toEqual([]);
  });

  it('is deterministic across repeated calls', () => {
    const a = parallaxOffsets(layers, 777).map((r) => r.x);
    const b = parallaxOffsets(layers, 777).map((r) => r.x);
    expect(a).toEqual(b);
  });
});

describe('DEFAULT_WORLD_PARALLAX_LAYERS — per-World default stacks', () => {
  it('every world yields a sensible ordered far→near stack', () => {
    for (const world of WORLD_IDS) {
      const layers = defaultParallaxLayers(world);
      // Non-empty, multi-layer stack.
      expect(layers.length).toBeGreaterThanOrEqual(3);
      // Factors are ordered far→near: non-decreasing.
      for (let i = 1; i < layers.length; i++) {
        expect(layers[i]!.factor).toBeGreaterThanOrEqual(layers[i - 1]!.factor);
      }
      // Every factor is within [0,1].
      for (const layer of layers) {
        expect(layer.factor).toBeGreaterThanOrEqual(0);
        expect(layer.factor).toBeLessThanOrEqual(1);
      }
      // The farthest layer is a static backdrop; the nearest moves.
      expect(layers[0]!.factor).toBe(0);
      expect(layers[layers.length - 1]!.factor).toBeGreaterThan(0);
    }
  });

  it('the stacks vary per World (Req 30.3 "change per World")', () => {
    const signatures = WORLD_IDS.map((w) =>
      defaultParallaxLayers(w)
        .map((l) => l.factor)
        .join(','),
    );
    expect(new Set(signatures).size).toBeGreaterThan(1);
  });

  it('defaultParallaxLayers falls back to World 1 for an out-of-range id', () => {
    // Cast an invalid id to exercise the fallback branch.
    const fallback = defaultParallaxLayers(99 as unknown as WorldId);
    expect(fallback).toBe(DEFAULT_WORLD_PARALLAX_LAYERS[1]);
  });

  it('exposes frozen stacks a caller cannot mutate', () => {
    expect(Object.isFrozen(DEFAULT_WORLD_PARALLAX_LAYERS[1])).toBe(true);
  });
});

describe('visibleParallaxLayers — degradation-detail trimming', () => {
  const layers = defaultParallaxLayers(1); // 4 layers far→near

  it('keeps all layers at full detail (scale 1)', () => {
    expect(visibleParallaxLayers(layers, 1)).toEqual(layers);
  });

  it('drops the farthest layers first, keeping the nearest', () => {
    const half = visibleParallaxLayers(layers, 0.5);
    expect(half.length).toBe(2);
    // The kept layers are the NEAREST (last) two.
    expect(half).toEqual(layers.slice(layers.length - 2));
  });

  it('always keeps at least the foreground layer at scale 0', () => {
    const minimal = visibleParallaxLayers(layers, 0);
    expect(minimal.length).toBe(1);
    expect(minimal[0]).toBe(layers[layers.length - 1]);
  });

  it('clamps an out-of-range scale and never mutates the input', () => {
    const before = [...layers];
    expect(visibleParallaxLayers(layers, 5).length).toBe(layers.length);
    expect(visibleParallaxLayers(layers, -1).length).toBe(1);
    expect(layers).toEqual(before);
  });

  it('returns the input unchanged for an empty stack', () => {
    const empty: ParallaxLayer[] = [];
    expect(visibleParallaxLayers(empty, 0.5)).toBe(empty);
  });
});

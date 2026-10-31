// Feature: kino-game
//
// UNIT tests for the PURE menu equip jiggle MATH (task 9.5) — the "jello bob"
// curve + the "menu-equip-jiggle" config/timing resolution behind the
// InventoryScene's equip-feedback animation (Req 43.1-43.5). These pin the
// contract with no Phaser:
//   - jelloBob(0) and jelloBob(1) are the NEUTRAL/identity transform so the item
//     rests at both ends (Req 43.3)
//   - the curve DEVIATES from neutral in the middle (a visible up/down bob,
//     Req 43.1-43.2)
//   - resolveEquipJiggleConfig returns the configured "menu-equip-jiggle" asset
//     key when present, and the documented placeholder fallback when the key is
//     missing/empty (Req 43.4-43.5)
//   - the resolved duration is positive and finite
//
// Pure TypeScript, no Phaser — matches the Node-only test environment. Plain
// unit tests plus one fast-check invariant pinning the rest contract.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  resolveEquipJiggleConfig,
  jelloBob,
  EQUIP_JIGGLE_PLACEHOLDER_KEY,
  DEFAULT_EQUIP_JIGGLE_DURATION_MS,
  NEUTRAL_JELLO_TRANSFORM,
} from '../src/core/equipJiggle.ts';

const EPS = 1e-9;

function isNeutral(tf: { scaleX: number; scaleY: number; offsetY: number }): boolean {
  return (
    Math.abs(tf.scaleX - 1) <= EPS &&
    Math.abs(tf.scaleY - 1) <= EPS &&
    Math.abs(tf.offsetY) <= EPS
  );
}

describe('jelloBob — rest contract (Req 43.3)', () => {
  it('returns the neutral/identity transform at t=0 (item rests)', () => {
    const tf = jelloBob(0);
    expect(tf.scaleX).toBeCloseTo(1, 9);
    expect(tf.scaleY).toBeCloseTo(1, 9);
    expect(tf.offsetY).toBeCloseTo(0, 9);
    expect(isNeutral(tf)).toBe(true);
  });

  it('returns the neutral/identity transform at t=1 (item returns to rest)', () => {
    const tf = jelloBob(1);
    expect(tf.scaleX).toBeCloseTo(1, 9);
    expect(tf.scaleY).toBeCloseTo(1, 9);
    expect(tf.offsetY).toBeCloseTo(0, 9);
    expect(isNeutral(tf)).toBe(true);
  });

  it('exposes a NEUTRAL_JELLO_TRANSFORM constant equal to the rest transform', () => {
    expect(NEUTRAL_JELLO_TRANSFORM).toEqual({ scaleX: 1, scaleY: 1, offsetY: 0 });
  });

  it('clamps and tolerates out-of-range / non-finite t to rest at the bounds', () => {
    expect(isNeutral(jelloBob(-0.5))).toBe(true); // clamps to 0
    expect(isNeutral(jelloBob(1.5))).toBe(true); // clamps to 1
    expect(isNeutral(jelloBob(Number.NaN))).toBe(true); // treated as 0
  });
});

describe('jelloBob — visible bob in the middle (Req 43.1-43.2)', () => {
  it('deviates from neutral somewhere between the endpoints', () => {
    // Sample the interior; at least one point must be a visible (non-neutral) bob.
    const samples = [0.1, 0.2, 0.3, 0.4, 0.6, 0.7, 0.8, 0.9].map((t) => jelloBob(t));
    const anyNonNeutral = samples.some((tf) => !isNeutral(tf));
    expect(anyNonNeutral).toBe(true);
  });

  it('bobs both up and down (offsetY takes both signs across the animation)', () => {
    const offsets = Array.from({ length: 99 }, (_, i) => jelloBob((i + 1) / 100).offsetY);
    expect(offsets.some((o) => o > EPS)).toBe(true); // moves down at some point
    expect(offsets.some((o) => o < -EPS)).toBe(true); // moves up at some point
  });

  it('squashes and stretches inversely (volume-preserving feel)', () => {
    // Scan the interior for a point with a non-trivial deviation, then assert
    // scaleX and scaleY move in OPPOSITE directions relative to 1 there (squash
    // one axis, stretch the other) — the jello look.
    const deviating = Array.from({ length: 99 }, (_, i) => jelloBob((i + 1) / 100)).find(
      (tf) => Math.abs(tf.scaleY - 1) > 1e-3,
    );
    expect(deviating).toBeDefined();
    const tf = deviating!;
    expect((tf.scaleX - 1) * (tf.scaleY - 1)).toBeLessThan(0);
  });

  it('respects a larger amplitude with a bigger deviation', () => {
    const small = jelloBob(0.25, { amplitude: 0.05 });
    const big = jelloBob(0.25, { amplitude: 0.4 });
    expect(Math.abs(big.offsetY)).toBeGreaterThan(Math.abs(small.offsetY));
  });

  it('property: always rests at both endpoints for any bobs/amplitude', () => {
    fc.assert(
      fc.property(
        fc.double({ min: 1, max: 6, noNaN: true }),
        fc.double({ min: 0, max: 0.9, noNaN: true }),
        (bobs, amplitude) => {
          expect(isNeutral(jelloBob(0, { bobs, amplitude }))).toBe(true);
          expect(isNeutral(jelloBob(1, { bobs, amplitude }))).toBe(true);
        },
      ),
    );
  });
});

describe('resolveEquipJiggleConfig — asset key + placeholder fallback (Req 43.4-43.5)', () => {
  it('returns the configured "menu-equip-jiggle" asset key when present', () => {
    const resolved = resolveEquipJiggleConfig({ menuEquipJiggle: 'assets/jiggle.png' });
    expect(resolved.assetKey).toBe('assets/jiggle.png');
    expect(resolved.usedPlaceholder).toBe(false);
  });

  it('falls back to the documented placeholder when the key is EMPTY (Req 43.5)', () => {
    const resolved = resolveEquipJiggleConfig({ menuEquipJiggle: '' });
    expect(resolved.assetKey).toBe(EQUIP_JIGGLE_PLACEHOLDER_KEY);
    expect(resolved.usedPlaceholder).toBe(true);
  });

  it('falls back to the placeholder when the key is MISSING / config absent', () => {
    expect(resolveEquipJiggleConfig({}).assetKey).toBe(EQUIP_JIGGLE_PLACEHOLDER_KEY);
    expect(resolveEquipJiggleConfig({}).usedPlaceholder).toBe(true);
    expect(resolveEquipJiggleConfig().assetKey).toBe(EQUIP_JIGGLE_PLACEHOLDER_KEY);
    expect(resolveEquipJiggleConfig().usedPlaceholder).toBe(true);
  });

  it('treats a whitespace-only key as empty and falls back', () => {
    const resolved = resolveEquipJiggleConfig({ menuEquipJiggle: '   ' });
    expect(resolved.assetKey).toBe(EQUIP_JIGGLE_PLACEHOLDER_KEY);
    expect(resolved.usedPlaceholder).toBe(true);
  });

  it('resolves a positive, finite duration (default when unspecified)', () => {
    const resolved = resolveEquipJiggleConfig({ menuEquipJiggle: 'x' });
    expect(resolved.durationMs).toBe(DEFAULT_EQUIP_JIGGLE_DURATION_MS);
    expect(Number.isFinite(resolved.durationMs)).toBe(true);
    expect(resolved.durationMs).toBeGreaterThan(0);
    expect(resolved.bobs).toBeGreaterThan(0);
  });

  it('honors valid timing overrides but ignores non-positive/non-finite ones', () => {
    expect(resolveEquipJiggleConfig({}, { durationMs: 500 }).durationMs).toBe(500);
    // Non-positive / non-finite overrides fall back to the positive default.
    expect(resolveEquipJiggleConfig({}, { durationMs: 0 }).durationMs).toBe(
      DEFAULT_EQUIP_JIGGLE_DURATION_MS,
    );
    expect(resolveEquipJiggleConfig({}, { durationMs: -10 }).durationMs).toBe(
      DEFAULT_EQUIP_JIGGLE_DURATION_MS,
    );
    expect(
      resolveEquipJiggleConfig({}, { durationMs: Number.POSITIVE_INFINITY }).durationMs,
    ).toBe(DEFAULT_EQUIP_JIGGLE_DURATION_MS);
  });
});

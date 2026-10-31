// Feature: kino-game
//
// UNIT tests for the PURE cosmetic anchor table (task 8.1) that drives
// KinoRenderer's layered cosmetic rendering (Req 19.2-19.4). These pin the
// offset-per-pose contract without any Phaser: every (mode, frame) resolves to
// a finite offset, distinct poses within a mode reposition the layer, and the
// mode<->frame legality (incl. underwater reusing flight frames, Req 30.9)
// holds. KinoRenderer itself is the thin Phaser consumer of this lookup.
//
// Pure TypeScript, no Phaser — matches the Node-only test environment.

import { describe, it, expect } from 'vitest';
import type { MovementMode } from '../src/core/types.ts';
import {
  cosmeticAnchor,
  isFrameForMode,
  defaultFrameForMode,
  MODE_FRAMES,
  DEFAULT_ANCHOR,
  type AnimationFrame,
} from '../src/engine/render/cosmeticAnchors.ts';

const MODES: MovementMode[] = ['jumping', 'flight', 'zigzag', 'underwater'];

describe('cosmeticAnchor — offset lookup per (mode, frame)', () => {
  it('returns a finite offset for every legal (mode, frame) pose', () => {
    for (const mode of MODES) {
      for (const frame of MODE_FRAMES[mode]) {
        const offset = cosmeticAnchor(mode, frame);
        expect(Number.isFinite(offset.x)).toBe(true);
        expect(Number.isFinite(offset.y)).toBe(true);
      }
    }
  });

  it('places the cosmetic ABOVE base Kino (negative y) for every pose', () => {
    // A hat rides on the head: offsets are measured from Kino's origin with +y
    // DOWN, so every anchor sits above center.
    for (const mode of MODES) {
      for (const frame of MODE_FRAMES[mode]) {
        expect(cosmeticAnchor(mode, frame).y).toBeLessThan(0);
      }
    }
  });

  it('repositions the layer per pose: distinct jumping frames give distinct offsets', () => {
    // Req 19.3: as the animation frame changes within a mode, the cosmetic
    // layer moves. The jumping run cycle sways the hat left vs right.
    const right = cosmeticAnchor('jumping', 'run-step-right');
    const left = cosmeticAnchor('jumping', 'run-step-left');
    expect(right).not.toEqual(left);

    // The jump arc moves the hat through distinct positions, too.
    const up = cosmeticAnchor('jumping', 'jump-go-up');
    const apex = cosmeticAnchor('jumping', 'jump-apex');
    const down = cosmeticAnchor('jumping', 'jump-go-down');
    const arc = new Set([JSON.stringify(up), JSON.stringify(apex), JSON.stringify(down)]);
    expect(arc.size).toBe(3);
  });

  it('repositions the layer across flight and zigzag poses', () => {
    expect(cosmeticAnchor('flight', 'fly-up')).not.toEqual(
      cosmeticAnchor('flight', 'fly-down'),
    );
    expect(cosmeticAnchor('zigzag', 'zigzag-up')).not.toEqual(
      cosmeticAnchor('zigzag', 'zigzag-down'),
    );
  });

  it('shares the flight anchors between flight and underwater (Req 30.9)', () => {
    // Underwater reuses the flight frames, so the SAME frame resolves to the
    // SAME offset regardless of which of the two modes asks.
    for (const frame of MODE_FRAMES.flight) {
      expect(cosmeticAnchor('underwater', frame)).toEqual(
        cosmeticAnchor('flight', frame),
      );
    }
  });

  it('is total/defensive: an unknown frame falls back to DEFAULT_ANCHOR, never throwing', () => {
    const bogus = 'not-a-real-frame' as AnimationFrame;
    expect(() => cosmeticAnchor('jumping', bogus)).not.toThrow();
    expect(cosmeticAnchor('jumping', bogus)).toEqual(DEFAULT_ANCHOR);
  });
});

describe('isFrameForMode — mode<->frame legality', () => {
  it('accepts each mode\'s own frames', () => {
    for (const mode of MODES) {
      for (const frame of MODE_FRAMES[mode]) {
        expect(isFrameForMode(mode, frame)).toBe(true);
      }
    }
  });

  it('underwater accepts flight frames but not jumping frames (Req 30.9)', () => {
    expect(isFrameForMode('underwater', 'fly-apex')).toBe(true);
    expect(isFrameForMode('underwater', 'run-step-right')).toBe(false);
  });

  it('rejects a frame that belongs to a different mode', () => {
    expect(isFrameForMode('jumping', 'fly-up')).toBe(false);
    expect(isFrameForMode('zigzag', 'jump-apex')).toBe(false);
  });
});

describe('defaultFrameForMode — resting pose per mode', () => {
  it('returns a frame that is legal for its mode', () => {
    for (const mode of MODES) {
      const frame = defaultFrameForMode(mode);
      expect(isFrameForMode(mode, frame)).toBe(true);
    }
  });

  it('rests flight and underwater on the shared apex frame', () => {
    expect(defaultFrameForMode('flight')).toBe('fly-apex');
    expect(defaultFrameForMode('underwater')).toBe('fly-apex');
  });
});

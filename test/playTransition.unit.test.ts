// Feature: kino-game
//
// Play-button expand transition MATH unit tests (task 9.8; Req 20.12, 20.36,
// 20.37, 20.38).
//
// Exercises the PURE helpers in `src/core/playTransition.ts` that back the
// Play/Continue-Story launch choreography the engine MainMenuScene tweens:
// the eased glide interpolation (endpoints + monotonicity), the run-start
// position derived from the fixed-Kino geometry, and the phase timing resolver.
// No Phaser, no DOM.

import { describe, it, expect } from 'vitest';
import {
  easeInOut,
  computeGlide,
  glideScalar,
  computeRunStartPosition,
  resolvePlayTransitionTiming,
  DEFAULT_RUN_START_GEOMETRY,
  DEFAULT_PLAY_TRANSITION_TIMING,
} from '../src/core/playTransition.ts';

describe('easeInOut — smoothstep easing (shared glide/fill curve)', () => {
  it('fixes the endpoints: ease(0)=0, ease(1)=1', () => {
    expect(easeInOut(0)).toBe(0);
    expect(easeInOut(1)).toBe(1);
  });

  it('is symmetric about the midpoint (ease(0.5)=0.5)', () => {
    expect(easeInOut(0.5)).toBeCloseTo(0.5, 10);
  });

  it('clamps out-of-range t and treats non-finite as 0', () => {
    expect(easeInOut(-1)).toBe(0);
    expect(easeInOut(2)).toBe(1);
    expect(easeInOut(Number.NaN)).toBe(0);
  });

  it('is monotonic non-decreasing across the unit interval', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const v = easeInOut(i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      prev = v;
    }
  });
});

describe('computeGlide — Kino glide-to-start interpolation (Req 20.38)', () => {
  const from = { x: 480, y: 384 };
  const to = { x: 160, y: 820 };

  it('returns exactly `from` at t=0', () => {
    expect(computeGlide(from, to, 0)).toEqual(from);
  });

  it('returns exactly `to` at t=1', () => {
    expect(computeGlide(from, to, 1)).toEqual(to);
  });

  it('clamps t outside [0,1] back to the endpoints', () => {
    expect(computeGlide(from, to, -5)).toEqual(from);
    expect(computeGlide(from, to, 5)).toEqual(to);
  });

  it('moves monotonically from `from` toward `to` on each axis', () => {
    // from.x > to.x (moving left) => x strictly non-increasing.
    // from.y < to.y (moving down) => y strictly non-decreasing.
    let prevX = Infinity;
    let prevY = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const p = computeGlide(from, to, i / 20);
      expect(p.x).toBeLessThanOrEqual(prevX + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(prevY - 1e-9);
      // Stays within the bounding box of the endpoints (no overshoot).
      expect(p.x).toBeGreaterThanOrEqual(to.x - 1e-9);
      expect(p.x).toBeLessThanOrEqual(from.x + 1e-9);
      expect(p.y).toBeGreaterThanOrEqual(from.y - 1e-9);
      expect(p.y).toBeLessThanOrEqual(to.y + 1e-9);
      prevX = p.x;
      prevY = p.y;
    }
  });
});

describe('glideScalar — eased scalar (color-fill height / alpha fade)', () => {
  it('hits the endpoints exactly', () => {
    expect(glideScalar(0, 960, 0)).toBe(0);
    expect(glideScalar(0, 960, 1)).toBe(960);
    expect(glideScalar(0, 1, 0)).toBe(0);
    expect(glideScalar(0, 1, 1)).toBe(1);
  });

  it('rises monotonically for a 0→height fill', () => {
    let prev = -Infinity;
    for (let i = 0; i <= 20; i++) {
      const v = glideScalar(0, 960, i / 20);
      expect(v).toBeGreaterThanOrEqual(prev);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(960);
      prev = v;
    }
  });
});

describe('computeRunStartPosition — fixed-Kino run seed (Req 20.38, 45.1)', () => {
  it('pins Kino on the left third resting on the ground strip (default geometry)', () => {
    const screen = { width: 960, height: 960 };
    const pos = computeRunStartPosition(screen);
    // screenX = round(960/3) = 320; center = 320 + 48/2 = 344.
    expect(pos.x).toBe(320 + DEFAULT_RUN_START_GEOMETRY.kinoBodyWidth / 2);
    // groundY = 960 - 96 = 864; center = 864 - 48/2 = 840.
    const groundY = 960 - DEFAULT_RUN_START_GEOMETRY.groundStripHeight;
    expect(pos.y).toBe(groundY - DEFAULT_RUN_START_GEOMETRY.kinoBodyHeight / 2);
  });

  it('lands in the left portion of the screen (left of center)', () => {
    const screen = { width: 1200, height: 800 };
    const pos = computeRunStartPosition(screen);
    expect(pos.x).toBeLessThan(screen.width / 2);
  });

  it('honors custom geometry overrides', () => {
    const screen = { width: 900, height: 600 };
    const geometry = {
      kinoBodyWidth: 60,
      kinoBodyHeight: 60,
      groundStripHeight: 120,
    };
    const pos = computeRunStartPosition(screen, geometry);
    expect(pos.x).toBe(Math.round(900 / 3) + 30);
    expect(pos.y).toBe(600 - 120 - 30);
  });
});

describe('resolvePlayTransitionTiming — ordered phase durations (Req 20.36–20.38)', () => {
  it('uses the documented defaults when no config is given', () => {
    const timing = resolvePlayTransitionTiming();
    expect(timing.expandMs).toBe(DEFAULT_PLAY_TRANSITION_TIMING.expandMs);
    expect(timing.fadeMs).toBe(DEFAULT_PLAY_TRANSITION_TIMING.fadeMs);
    expect(timing.glideMs).toBe(DEFAULT_PLAY_TRANSITION_TIMING.glideMs);
    expect(timing.totalMs).toBe(
      DEFAULT_PLAY_TRANSITION_TIMING.expandMs +
        DEFAULT_PLAY_TRANSITION_TIMING.fadeMs +
        DEFAULT_PLAY_TRANSITION_TIMING.glideMs,
    );
  });

  it('applies valid overrides and recomputes the total', () => {
    const timing = resolvePlayTransitionTiming({
      expandMs: 100,
      fadeMs: 200,
      glideMs: 300,
    });
    expect(timing.expandMs).toBe(100);
    expect(timing.fadeMs).toBe(200);
    expect(timing.glideMs).toBe(300);
    expect(timing.totalMs).toBe(600);
  });

  it('ignores negative / non-finite overrides, falling back to defaults', () => {
    const timing = resolvePlayTransitionTiming({
      expandMs: -50,
      fadeMs: Number.NaN,
      glideMs: Number.POSITIVE_INFINITY,
    });
    expect(timing.expandMs).toBe(DEFAULT_PLAY_TRANSITION_TIMING.expandMs);
    expect(timing.fadeMs).toBe(DEFAULT_PLAY_TRANSITION_TIMING.fadeMs);
    expect(timing.glideMs).toBe(DEFAULT_PLAY_TRANSITION_TIMING.glideMs);
  });

  it('allows an explicit zero-length phase (0 is valid)', () => {
    const timing = resolvePlayTransitionTiming({ fadeMs: 0 });
    expect(timing.fadeMs).toBe(0);
  });
});

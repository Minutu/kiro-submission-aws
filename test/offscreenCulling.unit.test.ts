// Feature: kino-game
//
// UNIT tests for the off-screen culling predicates + the bounded history/log
// buffer (task 12.3; design: "Off-screen culling means the spawner/collision
// pass updates ... only obstacles within or near the viewport window" and
// "history/log buffers are capped rather than grown unbounded"; Req 26.3, 26.5).

import { describe, it, expect } from 'vitest';
import {
  isWithinViewport,
  isRectWithinViewport,
  isScrolledOffLeft,
  createBoundedBuffer,
} from '../src/core/index.ts';

describe('off-screen culling predicates', () => {
  const windowWidth = 800;

  it('keeps a rect inside the window live', () => {
    // scrollX 100; a rect at worldX 400 (screen x 300) is well inside [0,800].
    expect(isWithinViewport(400, 48, 100, windowWidth)).toBe(true);
  });

  it('culls a rect fully scrolled off the left', () => {
    // scrollX 1000; rect worldX 100..148 => screen x -900..-852, off the left.
    expect(isWithinViewport(100, 48, 1000, windowWidth)).toBe(false);
  });

  it('culls a rect past the right lookahead edge', () => {
    // scrollX 0; rect at worldX 2000 => screen x 2000, past the 800 window.
    expect(isWithinViewport(2000, 48, 0, windowWidth)).toBe(false);
  });

  it('honors the margin as slack on both edges', () => {
    // Rect just off the left by 20px: culled with margin 0, kept with margin 50.
    // worldRight = 100, scrollX = 120 => screenRight = -20.
    expect(isWithinViewport(52, 48, 120, windowWidth, 0)).toBe(false);
    expect(isWithinViewport(52, 48, 120, windowWidth, 50)).toBe(true);
  });

  it('isRectWithinViewport matches the primitive form', () => {
    const rect = { x: 400, y: 0, width: 48, height: 100 };
    expect(isRectWithinViewport(rect, 100, windowWidth)).toBe(
      isWithinViewport(400, 48, 100, windowWidth),
    );
  });

  it('isScrolledOffLeft fires exactly when the right edge passes the left margin', () => {
    // rightEdgeX 500, scrollX 480 => screen right 20 (on screen) => not off.
    expect(isScrolledOffLeft(500, 480)).toBe(false);
    // rightEdgeX 500, scrollX 520 => screen right -20 => off the left.
    expect(isScrolledOffLeft(500, 520)).toBe(true);
    // With a margin of 50, -20 is still within the slack => not yet off.
    expect(isScrolledOffLeft(500, 520, 50)).toBe(false);
  });
});

describe('bounded history/log buffer', () => {
  it('never exceeds its capacity and drops the oldest when full', () => {
    const buf = createBoundedBuffer<number>(3);
    buf.push(1);
    buf.push(2);
    buf.push(3);
    expect(buf.size()).toBe(3);
    expect(buf.toArray()).toEqual([1, 2, 3]);

    // Pushing past capacity drops the oldest (1), keeping the newest 3.
    buf.push(4);
    expect(buf.size()).toBe(3);
    expect(buf.toArray()).toEqual([2, 3, 4]);

    buf.push(5);
    expect(buf.toArray()).toEqual([3, 4, 5]);
  });

  it('stays flat (bounded) over many pushes', () => {
    const cap = 5;
    const buf = createBoundedBuffer<number>(cap);
    for (let i = 0; i < 1000; i++) {
      buf.push(i);
      expect(buf.size()).toBeLessThanOrEqual(cap);
    }
    expect(buf.size()).toBe(cap);
    // Holds only the last `cap` values, oldest-first.
    expect(buf.toArray()).toEqual([995, 996, 997, 998, 999]);
    expect(buf.last()).toBe(999);
  });

  it('reports last() and clears correctly', () => {
    const buf = createBoundedBuffer<string>(2);
    expect(buf.last()).toBeUndefined();
    buf.push('a');
    buf.push('b');
    expect(buf.last()).toBe('b');
    buf.clear();
    expect(buf.size()).toBe(0);
    expect(buf.toArray()).toEqual([]);
    expect(buf.last()).toBeUndefined();
  });

  it('rejects a non-positive capacity', () => {
    expect(() => createBoundedBuffer<number>(0)).toThrow();
    expect(() => createBoundedBuffer<number>(-1)).toThrow();
  });
});

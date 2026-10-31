// Feature: kino-game
//
// Off-screen culling + bounded history/log buffer (task 12.3; design:
// "Obstacle & particle pooling / memory management (Req 26.3, 26.5)":
// "Off-screen culling means the spawner/collision pass updates and collision-
// checks only obstacles within or near the viewport window; released pool
// objects are inert." and "history/log buffers are capped rather than grown
// unbounded (Req 26.5)").
//
// PURE and Phaser-free helpers. The culling predicate decides whether a view /
// obstacle has scrolled off the LEFT of the viewport (so its pooled view can be
// RELEASED, not destroyed) or is still within/near the window. The bounded
// buffer is a small ring buffer that caps growth by dropping the OLDEST entry
// when full, keeping the heap flat during long endless runs (Req 26.5).

import type { Rect } from './types.ts';

/**
 * Is a world-space rect (`x`..`x+width`) still within or near the scroll window
 * `[scrollX - margin, scrollX + windowWidth + margin]`? Returns false once the
 * rect's RIGHT edge is left of the window (fully scrolled off the left) or its
 * LEFT edge is past the window's right lookahead — i.e. it can be culled.
 *
 * The world scrolls leftward as `scrollX` increases; an obstacle's screen x is
 * `worldX - scrollX`, so "off the left" means `worldRight - scrollX < -margin`.
 *
 * @param rectX        World-space left edge of the rect.
 * @param rectWidth    Rect width (px).
 * @param scrollX      Current scroll position (world x of the left viewport edge).
 * @param windowWidth  Viewport width (px).
 * @param margin       Extra slack on both sides so near-edge units stay live (default 0).
 */
export function isWithinViewport(
  rectX: number,
  rectWidth: number,
  scrollX: number,
  windowWidth: number,
  margin = 0,
): boolean {
  const screenLeft = rectX - scrollX;
  const screenRight = screenLeft + Math.max(0, rectWidth);
  const lo = -Math.max(0, margin);
  const hi = Math.max(0, windowWidth) + Math.max(0, margin);
  // Overlaps the [lo, hi] screen-space window at all => still live.
  return screenRight >= lo && screenLeft <= hi;
}

/** Convenience over {@link isWithinViewport} for a {@link Rect}. */
export function isRectWithinViewport(
  rect: Rect,
  scrollX: number,
  windowWidth: number,
  margin = 0,
): boolean {
  return isWithinViewport(rect.x, rect.width, scrollX, windowWidth, margin);
}

/**
 * Should a view at world-space `rightEdgeX` be RELEASED because it has fully
 * scrolled off the LEFT of the viewport? True once its right edge is left of
 * the window minus the margin — the exact "release off-screen" trigger for the
 * obstacle-view pool (Req 26.3). Independent of the right/lookahead edge (new
 * units entering from the right are handled by acquire, not release).
 */
export function isScrolledOffLeft(
  rightEdgeX: number,
  scrollX: number,
  margin = 0,
): boolean {
  return rightEdgeX - scrollX < -Math.max(0, margin);
}

/**
 * A bounded ring buffer that caps its length and DROPS THE OLDEST entry when
 * full (design: "history/log buffers are capped rather than grown unbounded";
 * Req 26.5). PURE and Phaser-free; backs run-history / debug-log buffers so a
 * long endless run keeps a flat heap instead of growing an array forever.
 */
export interface BoundedBuffer<T> {
  /** Append `value`; if at capacity, the oldest entry is dropped first. */
  push(value: T): void;
  /** The entries, oldest-first. Returns a fresh array snapshot each call. */
  toArray(): T[];
  /** Current number of stored entries (never exceeds the cap). */
  size(): number;
  /** The configured maximum capacity. */
  capacity(): number;
  /** Remove all entries. */
  clear(): void;
  /** The most recently pushed entry, or undefined when empty. */
  last(): T | undefined;
}

/**
 * Create a bounded ring buffer with the given capacity. Pushing past capacity
 * overwrites the oldest slot (fixed-size backing array, no unbounded growth).
 *
 * @param capacity Maximum entries retained. Must be a positive integer.
 */
export function createBoundedBuffer<T>(capacity: number): BoundedBuffer<T> {
  const cap = Math.floor(capacity);
  if (!Number.isFinite(cap) || cap <= 0) {
    throw new Error(`BoundedBuffer capacity must be a positive integer, got ${capacity}`);
  }

  // Fixed-size backing store; `start` is the oldest entry's slot, `count` how
  // many slots are filled. Writing wraps around (ring), overwriting the oldest.
  const store: T[] = new Array<T>(cap);
  let start = 0;
  let count = 0;

  function push(value: T): void {
    const writeIndex = (start + count) % cap;
    store[writeIndex] = value;
    if (count < cap) {
      count++;
    } else {
      // Full: the write overwrote the oldest, so advance start past it.
      start = (start + 1) % cap;
    }
  }

  function toArray(): T[] {
    const out: T[] = new Array<T>(count);
    for (let i = 0; i < count; i++) {
      out[i] = store[(start + i) % cap]!;
    }
    return out;
  }

  function clear(): void {
    start = 0;
    count = 0;
  }

  function last(): T | undefined {
    if (count === 0) return undefined;
    return store[(start + count - 1) % cap];
  }

  return {
    push,
    toArray,
    size: () => count,
    capacity: () => cap,
    clear,
    last,
  };
}

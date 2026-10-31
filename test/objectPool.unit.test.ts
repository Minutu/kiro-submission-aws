// Feature: kino-game
//
// UNIT tests for the generic ObjectPool (task 12.3; design: "Obstacle &
// particle pooling / memory management"; Req 26.3, 26.5).
//
// These assert the pooling contract the obstacle-view / particle recycling
// relies on: acquire reuses a released instance (same object identity) after
// resetting it, the pool never grows past its worst-case capacity under
// acquire/release cycles, double-release is a no-op, and `releaseAll` returns
// every live instance for the next run. Deterministic (no randomness).

import { describe, it, expect } from 'vitest';
import {
  createObjectPool,
  worstCaseOnScreenCount,
} from '../src/core/index.ts';

interface Box {
  id: number;
  value: string;
}

describe('ObjectPool', () => {
  it('reuses a released instance (same identity) and resets it on acquire', () => {
    let nextId = 0;
    const pool = createObjectPool<Box>({
      capacity: 4,
      factory: () => ({ id: nextId++, value: 'fresh' }),
      reset: (b) => {
        b.value = 'reset';
      },
    });

    const a = pool.acquire();
    a.value = 'dirty';
    pool.release(a);

    // Next acquire hands back the SAME object (no allocation) and resets it.
    const b = pool.acquire();
    expect(b).toBe(a); // same identity reused
    expect(b.value).toBe('reset'); // reset fn cleared the stale value
    expect(pool.size()).toBe(1); // factory called exactly once total
  });

  it('does not grow past capacity under repeated acquire/release cycles', () => {
    let constructed = 0;
    const capacity = 3;
    const pool = createObjectPool<Box>({
      capacity,
      factory: () => ({ id: constructed++, value: '' }),
    });

    // Cycle far more times than capacity; each cycle acquires `capacity`
    // instances then releases them all. The pool must never construct more
    // than `capacity` instances.
    for (let cycle = 0; cycle < 50; cycle++) {
      const taken: Box[] = [];
      for (let i = 0; i < capacity; i++) taken.push(pool.acquire());
      for (const t of taken) pool.release(t);
      expect(pool.liveCount()).toBe(0);
    }

    expect(pool.size()).toBe(capacity);
    expect(constructed).toBe(capacity);
  });

  it('throws when acquiring past capacity (surfaces an undersized pool)', () => {
    const pool = createObjectPool<Box>({
      capacity: 2,
      factory: () => ({ id: 0, value: '' }),
    });
    pool.acquire();
    pool.acquire();
    expect(() => pool.acquire()).toThrow(/exhausted/i);
  });

  it('treats a double-release as a no-op (free list never duplicates an instance)', () => {
    const pool = createObjectPool<Box>({
      capacity: 2,
      factory: () => ({ id: 0, value: '' }),
    });
    const a = pool.acquire();
    expect(pool.release(a)).toBe(true);
    expect(pool.release(a)).toBe(false); // already released
    expect(pool.freeCount()).toBe(1); // not duplicated onto the free list

    // Acquiring must not hand the same instance to two owners.
    const b = pool.acquire();
    const c = pool.acquire();
    expect(b).toBe(a);
    expect(c).not.toBe(b);
  });

  it('prewarms up to capacity so initial acquires allocate nothing', () => {
    let constructed = 0;
    const pool = createObjectPool<Box>({
      capacity: 5,
      prewarm: 3,
      factory: () => ({ id: constructed++, value: '' }),
    });
    expect(pool.size()).toBe(3);
    expect(pool.freeCount()).toBe(3);

    const before = constructed;
    pool.acquire();
    pool.acquire();
    pool.acquire();
    expect(constructed).toBe(before); // all served from the prewarmed free list
  });

  it('releaseAll returns every live instance for reuse', () => {
    const pool = createObjectPool<Box>({
      capacity: 4,
      factory: () => ({ id: 0, value: '' }),
    });
    pool.acquire();
    pool.acquire();
    pool.acquire();
    expect(pool.liveCount()).toBe(3);

    pool.releaseAll();
    expect(pool.liveCount()).toBe(0);
    expect(pool.freeCount()).toBe(3);
    expect(pool.size()).toBe(3); // no new allocation
  });

  it('rejects a non-positive capacity', () => {
    expect(() => createObjectPool<Box>({ capacity: 0, factory: () => ({ id: 0, value: '' }) })).toThrow();
    expect(() => createObjectPool<Box>({ capacity: -2, factory: () => ({ id: 0, value: '' }) })).toThrow();
  });
});

describe('worstCaseOnScreenCount', () => {
  it('sizes to ceil(width/pitch)+1 units times boundsPerUnit plus the safety margin', () => {
    // width 800, minGap 200, obstacleWidth 64 => pitch 264.
    // ceil(800/264)+1 = 4+1 = 5 units; *2 bounds = 10; +2 margin = 12.
    expect(worstCaseOnScreenCount(800, 200, 64, 2, 2)).toBe(12);
  });

  it('scales up as the gap tightens (more units fit the same width)', () => {
    const wide = worstCaseOnScreenCount(800, 300, 64);
    const tight = worstCaseOnScreenCount(800, 100, 64);
    expect(tight).toBeGreaterThan(wide);
  });

  it('never returns less than 1', () => {
    expect(worstCaseOnScreenCount(0, 200, 64, 1, 0)).toBeGreaterThanOrEqual(1);
  });
});

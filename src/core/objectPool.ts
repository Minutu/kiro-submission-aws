// Feature: kino-game
//
// The generic ObjectPool (task 12.3; design: "Obstacle & particle pooling /
// memory management (Req 26.3, 26.5)"). PURE and Phaser-free so it can back
// BOTH the Phaser obstacle views / particle sprites in the engine AND the core
// `Obstacle` data objects without the pool itself ever touching Phaser.
//
// Contract:
//   - A pool is constructed with a `factory` (how to make a fresh T), an
//     optional `reset` (how to re-initialize a recycled T on acquire), and a
//     `capacity` sized to the WORST-CASE simultaneous live count. The whole
//     point (Req 26.3, 26.5) is to ACQUIRE on spawn and RELEASE off-screen so
//     that, once warmed to its working set, a steady-state run performs ZERO
//     allocations — `acquire` reuses a released instance instead of calling the
//     factory, and the SAME object identity comes back out.
//   - `acquire()` returns a previously released instance when one is available
//     (applying `reset` first so no stale state leaks into the next use), else
//     calls `factory()` to grow the pool — but never past `capacity`. Acquiring
//     past capacity throws, surfacing an undersized pool as a loud bug rather
//     than silently allocating unbounded.
//   - `release(obj)` returns an instance to the free list for reuse. Releasing
//     the same instance twice is a no-op guarded by the live set, so a
//     double-release can never corrupt the free list into handing one object to
//     two owners.
//
// Determinism/purity: the pool holds only plain arrays/sets and calls the two
// injected callbacks; given the same acquire/release sequence it reuses the
// same instances in the same order (LIFO free list), which is exactly what the
// unit tests assert (same identity reused, no growth past capacity).

/** How to construct a fresh pooled instance when the free list is empty. */
export type PoolFactory<T> = () => T;

/**
 * How to re-initialize a recycled instance on `acquire`, clearing any stale
 * state from its previous life. Called with the instance being handed out.
 * Optional: pools of immutable-on-acquire values may omit it.
 */
export type PoolReset<T> = (obj: T) => void;

/** Construction options for {@link createObjectPool}. */
export interface ObjectPoolOptions<T> {
  /** Build a fresh instance (called only when the free list is empty). */
  factory: PoolFactory<T>;
  /** Re-initialize a recycled instance on acquire (optional). */
  reset?: PoolReset<T>;
  /**
   * Worst-case simultaneous live count. `acquire` never grows the pool past
   * this; exceeding it throws (an undersized pool is a bug, not a silent leak).
   * Must be a positive integer.
   */
  capacity: number;
  /**
   * How many instances to pre-allocate up front (warm the pool so the first
   * `capacity` acquires in a run allocate nothing). Clamped to `[0, capacity]`.
   * Default 0 (lazy growth up to capacity).
   */
  prewarm?: number;
}

/** The public surface of the generic object pool. */
export interface ObjectPool<T> {
  /**
   * Hand out an instance: a recycled one from the free list (reset first) when
   * available, else a freshly constructed one — never past `capacity`.
   * @throws if all `capacity` instances are already live.
   */
  acquire(): T;
  /**
   * Return an instance to the free list for reuse. A no-op if the instance is
   * not currently live (guards against double-release).
   * @returns true if the instance was live and is now released, else false.
   */
  release(obj: T): boolean;
  /** Count of instances currently handed out (live). */
  liveCount(): number;
  /** Count of instances available for immediate reuse (on the free list). */
  freeCount(): number;
  /** Total instances the pool has constructed so far (live + free). */
  size(): number;
  /** The configured worst-case capacity. */
  capacity(): number;
  /**
   * Release EVERY live instance back to the free list in one pass (e.g. on a
   * run teardown / scene restart so the next run starts with a full free list
   * and allocates nothing). Each released instance is NOT reset here — reset
   * happens on the next acquire.
   */
  releaseAll(): void;
}

/**
 * Create a generic object pool (design: "Obstacle & particle pooling"; Req
 * 26.3, 26.5). See the module header for the acquire/release/zero-allocation
 * contract.
 */
export function createObjectPool<T>(options: ObjectPoolOptions<T>): ObjectPool<T> {
  const { factory, reset } = options;
  const capacity = Math.floor(options.capacity);
  if (!Number.isFinite(capacity) || capacity <= 0) {
    throw new Error(`ObjectPool capacity must be a positive integer, got ${options.capacity}`);
  }

  // Free list is a LIFO stack of released instances available for reuse. The
  // live set tracks what is currently handed out so release is idempotent and
  // liveCount is exact. `constructed` counts how many the factory has produced
  // so acquire never grows past capacity.
  const free: T[] = [];
  const live = new Set<T>();
  let constructed = 0;

  // Prewarm: build up to `prewarm` instances onto the free list so the first
  // acquires in a run reuse rather than allocate (Req 26.3 zero steady-state).
  const prewarm = Math.max(0, Math.min(capacity, Math.floor(options.prewarm ?? 0)));
  for (let i = 0; i < prewarm; i++) {
    free.push(factory());
    constructed++;
  }

  function acquire(): T {
    let obj = free.pop();
    if (obj === undefined) {
      // No free instance: grow the pool, but never past the worst-case cap.
      if (constructed >= capacity) {
        throw new Error(
          `ObjectPool exhausted: all ${capacity} instances are live. ` +
            `Increase capacity (sized to the worst-case on-screen count).`,
        );
      }
      obj = factory();
      constructed++;
    } else if (reset) {
      // Reusing a released instance: clear stale state before handing it out so
      // no field (e.g. the Obstacle `scored` latch) leaks into the next use.
      reset(obj);
    }
    live.add(obj);
    return obj;
  }

  function release(obj: T): boolean {
    // Guard double-release: only a currently-live instance can be released, so
    // the free list can never hold the same object twice (which would hand one
    // instance to two owners).
    if (!live.delete(obj)) return false;
    free.push(obj);
    return true;
  }

  function releaseAll(): void {
    for (const obj of live) free.push(obj);
    live.clear();
  }

  return {
    acquire,
    release,
    releaseAll,
    liveCount: () => live.size,
    freeCount: () => free.length,
    size: () => constructed,
    capacity: () => capacity,
  };
}

/**
 * Compute a worst-case on-screen obstacle-unit count for sizing a view pool
 * (design: "Pools are sized to the worst-case simultaneous on-screen count,
 * derived from `obstacleDensity.minGapPx`, screen width, and a safety margin").
 * PURE helper so the engine sizes its Phaser-view pool from the same tunables
 * the spawner lays obstacles out with.
 *
 * At the TIGHTEST density every unit occupies `obstacleWidthPx + minGapPx` of
 * horizontal pitch; the number of units whose footprint can intersect a window
 * of `screenWidthPx` (plus a lookahead margin) is `ceil(width / pitch) + 1`.
 * Each unit may draw up to `boundsPerUnit` rectangles (a Flight/Underwater pair
 * draws 2), and we add a `safetyMargin` of extra slots. The result is clamped
 * to at least 1.
 *
 * @param screenWidthPx    Viewport width in px (plus any lookahead already folded in).
 * @param minGapPx         The tightest inter-unit gap (from the BalanceTable).
 * @param obstacleWidthPx  The widest single-unit footprint in px.
 * @param boundsPerUnit    Max visual rectangles a single unit draws (default 2).
 * @param safetyMargin     Extra view slots beyond the computed worst case (default 2).
 */
export function worstCaseOnScreenCount(
  screenWidthPx: number,
  minGapPx: number,
  obstacleWidthPx: number,
  boundsPerUnit = 2,
  safetyMargin = 2,
): number {
  const pitch = Math.max(1, obstacleWidthPx + Math.max(0, minGapPx));
  const width = Math.max(0, screenWidthPx);
  // +1 because a unit can straddle each window edge; *boundsPerUnit for pairs.
  const units = Math.ceil(width / pitch) + 1;
  const rects = units * Math.max(1, Math.floor(boundsPerUnit));
  return Math.max(1, rects + Math.max(0, Math.floor(safetyMargin)));
}

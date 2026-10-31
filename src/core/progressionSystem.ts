// Feature: kino-game
//
// ProgressionSystem — the WORLD-UNLOCK + ENDLESS-CONTINUATION flow for a single
// STORY run (task 7.3; design: "World unlock flow (Req 7.1–7.8)", "Difficulty
// ramp (Req 7.6, 23.3)"; Req 7.1-7.6, 7.8).
//
// PURE simulation logic — no Phaser, no clocks, no ambient randomness, no I/O.
// It is a deterministic state machine driven by the run SCORE, plus a couple of
// read helpers over the Save_Store `worlds` map. It OWNS exactly one concern:
//
//   When a story run crosses the 50-point threshold (Req 7.1), what happens to
//   the SAME run: the next world is marked unlocked, Kino hovers while a
//   "new world unlocked" message shows, then an "endless starting" message,
//   then the run keeps going endlessly with RAMPING difficulty — never an
//   auto-transition to the next world, never a fresh run (Req 7.2-7.6).
//
// It deliberately does NOT own:
//   - high-score tracking (task 7.6 / Req 28) — its own module.
//   - the Skill_Unlock_Schedule (task 7.5 / Req 36) — its own module.
//   - endless-mode ability restriction (task 7.8 / Req 23.7-23.8) — its own
//     module (the SequenceDirector `allowedEndlessModes` allow-list).
//   - applying the save mutation / persisting it, hovering the sprite, or
//     rendering the message text — those are GameplayScene (engine) concerns.
//     This module returns the INTENT (which world to mark discovered, which
//     message to show); the scene applies it to the Save_Store and persists.
//
// WHY PURE / HERE: keeping the flow Phaser-free lets its state machine, the
// next-world math, and the beyond-50 difficulty ramp be unit-tested in plain
// Node (enforced by test/boundary.core-no-phaser.test.ts; see src/README.md).
//
// STATE MACHINE (keyed on the run score via `onScore`):
//
//   preThreshold ──score ≥ threshold──▶ thresholdReached ──▶ endlessContinuation
//        │              (worlds 1-4)          │                      │
//        │                                    │                      └─ stays here for the
//        │                                    │                         rest of the run; the
//        │                                    │                         `difficulty(cleared)`
//        │                                    │                         ramp keeps climbing.
//        │                                    └─ emits, ON THAT SINGLE tick:
//        │                                         • a WorldUnlock intent (mark NEXT world
//        │                                           discovered) — ONCE per run (Req 7.1)
//        │                                         • the ordered message sequence
//        │                                           [newWorldUnlocked, endlessStarting]
//        │                                           (Req 7.2-7.3), the scene renders them
//        │                                           in order then resumes the SAME run
//        │                                           (Req 7.4) — NO auto-transition (Req 7.5).
//        │
//        └─ a final/World-5 story world has NO next world and NO endless
//           continuation (Req 23.2): the threshold event never fires there, so
//           it stays `preThreshold` forever and `difficulty` never ramps past
//           the threshold. (World 5 is a finite designed finale, Req 8.1.)

import type { BalanceTable } from '../config/index.ts';
import type { Difficulty } from './obstacleSpawner.ts';
import type { WorldId, WorldProgressState } from './index.ts';

/**
 * The three run phases of the world-unlock flow, keyed on the run score.
 *
 *   - `preThreshold`        — below 50 points; a normal story run.
 *   - `thresholdReached`    — the SINGLE tick on which the run first crossed 50
 *                             (worlds 1-4): the unlock + message intents fire
 *                             exactly here. A transient the scene consumes.
 *   - `endlessContinuation` — the same run, past 50, continuing endlessly with
 *                             the ramping beyond-50 difficulty (Req 7.4, 7.6).
 */
export type ProgressionPhase =
  | 'preThreshold'
  | 'thresholdReached'
  | 'endlessContinuation';

/**
 * Semantic message ids the threshold event emits, IN ORDER (Req 7.2, 7.3). The
 * scene maps these to the configured label text (`cfg.labels.newWorldUnlocked`
 * / `cfg.labels.endlessStarting`) and renders them sequentially — keeping the
 * actual strings (and any i18n) a config/render concern, not a core one.
 */
export type ProgressionMessageId = 'newWorldUnlocked' | 'endlessStarting';

/**
 * The one-time intent to mark the NEXT story world unlocked (Req 7.1). This
 * module does NOT touch the Save_Store itself — it returns the world id the
 * scene should set `worlds[world].discovered = true` on, then persist. Returned
 * at most once per run (on the threshold tick).
 */
export interface WorldUnlockIntent {
  /** The next world to mark discovered (current world + 1). */
  world: WorldId;
}

/**
 * What `onScore` returns on the tick it processes. On the threshold-crossing
 * tick (worlds 1-4), `justCrossed` is true and `unlock` + `messages` carry the
 * one-time intents; on every other tick they are null/empty. `phase` is the
 * phase AFTER processing this score.
 */
export interface ProgressionEvent {
  /** Phase after applying this score. */
  phase: ProgressionPhase;
  /** True ONLY on the single tick the run first crosses the threshold. */
  justCrossed: boolean;
  /** The next-world unlock intent — non-null only on the crossing tick. */
  unlock: WorldUnlockIntent | null;
  /**
   * The ordered message sequence to display — non-empty (`['newWorldUnlocked',
   * 'endlessStarting']`) only on the crossing tick, else empty (Req 7.2-7.3).
   */
  messages: ProgressionMessageId[];
}

/** Options for {@link createProgressionSystem}. */
export interface ProgressionSystemOptions {
  /** The story world this run is playing (drives the next-world math). */
  world: WorldId;
  /**
   * Override the unlock threshold (points). Defaults to
   * `balance.worldUnlockThreshold()` (50). A non-finite or non-positive value
   * falls back to the balance default.
   */
  threshold?: number;
}

/** The public surface of the ProgressionSystem (design: `ProgressionSystem`). */
export interface ProgressionSystem {
  /** The world this run is playing. */
  readonly world: WorldId;
  /** The resolved unlock threshold in points (default 50, Req 7.1). */
  readonly threshold: number;
  /**
   * The next story world after `world`, or null when there is none — i.e. the
   * final world (World 5) has NO next world (Req 23.2, 8.1). Worlds are capped
   * at 5; `nextWorld` of 5 is null.
   */
  readonly nextWorld: WorldId | null;
  /**
   * Does this world support the 50-point endless continuation? True for the
   * story worlds that HAVE a next world (1-4); false for the final World 5
   * (finite finale, no endless, Req 23.2, 8.1).
   */
  readonly supportsEndless: boolean;
  /** Current phase of the flow. */
  phase(): ProgressionPhase;

  /**
   * Feed the current run score; advance the state machine and return what to do
   * on THIS tick. The threshold event (unlock intent + ordered messages) fires
   * on exactly ONE tick — the first time `score ≥ threshold` for a world that
   * supports endless (Req 7.1-7.5). Thereafter the system sits in
   * `endlessContinuation` and the event never re-fires (idempotent for repeated
   * or higher scores). Monotonic in intent: a later score never un-crosses.
   *
   * For the final World 5 (no next world), the threshold event NEVER fires:
   * `onScore` keeps returning `preThreshold` with no unlock/messages regardless
   * of score (Req 23.2).
   */
  onScore(score: number): ProgressionEvent;

  /**
   * The difficulty inputs (ramp + obstaclesCleared) to feed the
   * ObstacleSpawner for the given cleared-obstacle count. The scroll-speed ramp
   * is driven by `obstaclesCleared` (handed straight through so the spawner's
   * `scrollSpeed` climbs, Req 7.6); the gap `ramp` in [0,1] climbs linearly
   * with cleared obstacles and, crucially, keeps climbing PAST the threshold
   * while in `endlessContinuation` so obstacle DENSITY ramps beyond 50 for
   * worlds 1-4 (Req 7.6) — while the spawner's own `minGapPx` / gap floors keep
   * it feasible. The ramp is clamped to [0,1] so it stays within the spawner's
   * feasible bounds at every score.
   */
  difficulty(obstaclesCleared: number): Difficulty;
}

/** Hard cap on world ids (Req 27 — worlds 1..5). */
const MAX_WORLD_ID = 5 as const;

/**
 * Cleared-obstacle count at which the gap `ramp` reaches 1.0 (its feasible
 * hard cap). Layout/pacing geometry, not a balance tunable: it sets HOW FAST
 * density tightens with progress. Past this the ramp stays clamped at 1.0, so
 * the spawner holds obstacles at its `minGapPx` floor (still feasible, Req 7.6,
 * 23.3). Chosen so the ramp is still climbing across the ~50-point threshold
 * region and keeps climbing a good while into the endless continuation.
 */
const RAMP_SATURATION_OBSTACLES = 120;

/** Clamp `v` into the inclusive range `[lo, hi]`. */
function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * The next story world after `world`, or null at the cap (World 5 has no next,
 * Req 23.2). Pure integer math capped at {@link MAX_WORLD_ID}.
 */
export function computeNextWorld(world: WorldId): WorldId | null {
  if (world >= MAX_WORLD_ID) return null;
  return (world + 1) as WorldId;
}

/**
 * Read the unlocked (discovered) worlds from a Save_Store `worlds` map, in
 * ascending world order (Req 7.8). A world is selectable from the menu iff it
 * is discovered — this is the SAME set, since the only menu gate this module
 * owns is discovery (left-behind/endless gating belongs to other tasks). The
 * scene uses this to populate the "choose any unlocked world" menu after a run
 * ends (Req 7.7-7.8). Tolerates missing/extra keys: only well-formed `worldN`
 * entries with `discovered === true` count.
 */
export function unlockedWorlds(
  worlds: Record<string, Pick<WorldProgressState, 'discovered'>>,
): WorldId[] {
  const out: WorldId[] = [];
  for (let id = 1 as number; id <= MAX_WORLD_ID; id += 1) {
    const entry = worlds[`world${id}`];
    if (entry && entry.discovered === true) out.push(id as WorldId);
  }
  return out;
}

/**
 * Create a ProgressionSystem for a single story run of `options.world`.
 *
 * Pure factory: the returned system is a deterministic function of its options
 * and the ordered `onScore` calls it receives. See the module header for the
 * full state machine and the ownership boundary.
 */
export function createProgressionSystem(
  balance: BalanceTable,
  options: ProgressionSystemOptions,
): ProgressionSystem {
  const world = options.world;
  const next = computeNextWorld(world);
  // A world supports the 50-point endless continuation iff it has a next world
  // (worlds 1-4); World 5 is the finite finale (Req 23.2, 8.1).
  const supportsEndless = next !== null;

  // Resolve the threshold: explicit override wins when sane, else the balance
  // default (50). A bad override falls back so the flow can never be disabled
  // by a non-finite/zero threshold.
  const threshold = (() => {
    const t = options.threshold;
    if (t !== undefined && Number.isFinite(t) && t > 0) return t;
    const w = balance.worldUnlockThreshold();
    return Number.isFinite(w) && w > 0 ? w : 50;
  })();

  // The flow starts below the threshold. Worlds with no endless continuation
  // (World 5) stay here permanently — the crossing event never fires.
  let phase: ProgressionPhase = 'preThreshold';
  // One-way latch: true once the threshold event has fired, so it fires exactly
  // once per run (Req 7.1 one-time unlock; Req 7.5 no auto-transition / no
  // re-fire). Mirrors the ScoringSystem's exactly-once latch discipline.
  let crossed = false;

  function onScore(score: number): ProgressionEvent {
    // Non-finite scores are ignored (treated as no change) so a bad read can
    // never spuriously trip the one-time unlock.
    const s = Number.isFinite(score) ? score : -Infinity;

    // Fire the crossing event on exactly the first tick that reaches the
    // threshold — but only for worlds that support endless (worlds 1-4). The
    // final World 5 never crosses (Req 23.2): it has no next world to unlock
    // and no endless continuation to enter.
    if (!crossed && supportsEndless && s >= threshold) {
      crossed = true;
      phase = 'endlessContinuation';
      return {
        // AFTER processing this score we are already in the endless
        // continuation (the `thresholdReached` phase is the transient this tick
        // represents). The scene plays the message sequence while the SAME run
        // keeps going (Req 7.4) — there is NO auto-transition (Req 7.5).
        phase: 'thresholdReached',
        justCrossed: true,
        // One-time next-world unlock intent (Req 7.1). `next` is non-null here
        // because `supportsEndless` is true.
        unlock: { world: next as WorldId },
        // Ordered messages: "new world unlocked" then "endless starting"
        // (Req 7.2, 7.3). The scene renders them in this order.
        messages: ['newWorldUnlocked', 'endlessStarting'],
      };
    }

    // Already past the threshold: stay in the endless continuation; the event
    // never re-fires regardless of how the score climbs further (idempotent).
    return { phase, justCrossed: false, unlock: null, messages: [] };
  }

  function difficulty(obstaclesCleared: number): Difficulty {
    const cleared = Math.max(0, Math.floor(obstaclesCleared || 0));
    // Gap ramp climbs linearly with cleared obstacles toward 1.0 and is clamped
    // to [0,1]. It keeps climbing PAST the 50-point threshold (into the endless
    // continuation) so DENSITY ramps beyond 50 for worlds 1-4 (Req 7.6); the
    // spawner's own `minGapPx`/gap floors keep every resulting gap feasible.
    const ramp = clamp(cleared / RAMP_SATURATION_OBSTACLES, 0, 1);
    // `obstaclesCleared` is handed straight through so the spawner's
    // `scrollSpeed` ramp (base * clamp(1 + rampPerObstacle*cleared, 1,
    // maxMultiplier)) climbs too — speed AND density ramp together (Req 7.6),
    // and the spawner's `maxMultiplier` cap keeps speed feasible.
    return { ramp, obstaclesCleared: cleared };
  }

  return {
    world,
    threshold,
    nextWorld: next,
    supportsEndless,
    phase: () => phase,
    onScore,
    difficulty,
  };
}

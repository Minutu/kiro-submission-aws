// Feature: kino-game
//
// ScoringSystem (design: "Collision & Scoring > Scoring_Event mechanism";
// Req 9.1-9.6, 2.3-2.4, 3.3-3.4, 4.2-4.3, 5.3-5.4).
//
// The scoring authority for a run. It credits exactly one unit-valued point per
// Obstacle_Unit, attributes that point to the Movement_Mode active at the moment
// of clearing, and applies the score multiplier snapshotted AT credit time.
//
// Three invariants the design calls out as "invalid scoring results" if ever
// violated (Req 9.3) — this module structurally prevents each:
//   1. Exactly once (Req 9.1, 9.6, 35.4): a one-way latch per obstacle id. Once
//      an id is credited it can never be credited again; a second attempt is
//      rejected and does not change the total.
//   2. Unit base value (Req 2.4, 3.4, 4.3, 5.4): `baseValue` is always 1 and the
//      emitted event literally carries the `1` literal type. There is no path
//      that credits a non-unit base.
//   3. Correct attribution (Req 9.2, 9.3): the event is attributed to the mode
//      passed at the moment of clearing; an unrecognized mode is rejected rather
//      than producing a wrong-mode event.
//
// The multiplier is read through an injectable source (a getter) so the Score
// Multiplier skill (task 6.8, Req 17.1) can drive it in a later task without
// this module depending on the skill system. The default source yields 1 and a
// non-finite/non-positive multiplier from the source is treated as invalid
// (rejected) so a bad multiplier can never corrupt the running total.
//
// Purity/determinism: the system owns only the running total and the set of
// credited ids. Given the same construction and the same ordered sequence of
// `credit` calls (and the same multiplier-source readings), it produces the same
// events and totals — no clocks, randomness, or Phaser.

import type { MovementMode, ScoringEvent } from './types.ts';

/** The four valid Movement_Modes, for attribution validation (Req 9.3). */
const VALID_MODES: ReadonlySet<MovementMode> = new Set<MovementMode>([
  'jumping',
  'flight',
  'zigzag',
  'underwater',
]);

/**
 * Sentinel for a rejected / invalid scoring result (design: `ScoringEvent |
 * Invalid`, Req 9.3). `null` is distinguishable from a successful
 * {@link ScoringEvent} object and is cheap for callers to test with `=== null`
 * or a truthiness check.
 */
export type Invalid = null;

/** Result of {@link ScoringSystem.credit}: an event on success, else invalid. */
export type ScoringResult = ScoringEvent | Invalid;

/** Why a `credit` attempt was rejected (for observation/telemetry/tests). */
export type RejectionReason =
  | 'already-credited' // one-way latch already set for this id (Req 9.1, 9.6)
  | 'invalid-mode' // attribution mode not a recognized Movement_Mode (Req 9.3)
  | 'invalid-multiplier'; // multiplier source produced a non-finite/non-positive value

/** A getter the ScoreMultiplier skill can inject to drive the live multiplier. */
export type MultiplierSource = () => number;

/** Construction options for {@link createScoringSystem}. */
export interface ScoringSystemOptions {
  /**
   * Source of the currently active score multiplier, read AT credit time
   * (Req 9.4, 17.1). Defaults to a constant 1. The ScoreMultiplier skill can
   * supply a getter that returns 2 while active (task 6.8).
   */
  multiplierSource?: MultiplierSource;
  /** Optional hook invoked when a credit attempt is rejected (observation). */
  onReject?: (obstacleId: string, reason: RejectionReason) => void;
}

/**
 * The scoring authority (design: ScoringSystem). Credits exactly once per
 * obstacle id, attributes to the active mode at clearing, and snapshots the
 * multiplier at credit time.
 */
export interface ScoringSystem {
  /**
   * Credit one unit for clearing the obstacle `obstacleId` while `mode` is the
   * Movement_Mode active at the moment of clearing (Req 9.1-9.4).
   *
   * On success: sets the one-way latch for `obstacleId`, snapshots
   * `multiplierAtCredit = activeMultiplier()`, computes
   * `creditedValue = 1 * multiplierAtCredit`, adds it to the running total, and
   * returns the resulting {@link ScoringEvent}.
   *
   * On rejection (returns {@link Invalid} === null, total unchanged):
   *   - `obstacleId` was already credited (exactly-once latch, Req 9.1, 9.6);
   *   - `mode` is not a recognized Movement_Mode (wrong-mode guard, Req 9.3);
   *   - the multiplier source produced a non-finite/non-positive value.
   */
  credit(obstacleId: string, mode: MovementMode): ScoringResult;
  /** Has this obstacle id already been credited (latch set)? */
  hasCredited(obstacleId: string): boolean;
  /** The running total score (Req 9.5 HUD source). */
  current(): number;
  /** The currently active score multiplier (read from the injected source). */
  activeMultiplier(): number;
  /** Number of distinct obstacle ids credited so far (one event each). */
  creditedCount(): number;
  /** Reset the system to an empty run (zero total, no latches). */
  reset(): void;
}

/** Default multiplier source: a constant 1 (no multiplier skill active). */
const DEFAULT_MULTIPLIER_SOURCE: MultiplierSource = () => 1;

/**
 * Create a ScoringSystem. Pure factory: the returned system's behavior depends
 * only on its options and the ordered `credit` calls it receives.
 */
export function createScoringSystem(
  options: ScoringSystemOptions = {},
): ScoringSystem {
  const multiplierSource = options.multiplierSource ?? DEFAULT_MULTIPLIER_SOURCE;
  const onReject = options.onReject;

  // The one-way latch: an obstacle id present here has been credited and can
  // never be credited again (Req 9.1, 9.6).
  const credited = new Set<string>();
  let total = 0;

  function reject(obstacleId: string, reason: RejectionReason): Invalid {
    onReject?.(obstacleId, reason);
    return null;
  }

  function readMultiplier(): number {
    const m = multiplierSource();
    // A multiplier must be a finite, positive number; anything else is treated
    // as invalid so a bad source can never corrupt the running total.
    if (!Number.isFinite(m) || m <= 0) return Number.NaN;
    return m;
  }

  function credit(obstacleId: string, mode: MovementMode): ScoringResult {
    // Guard 1 — exactly-once latch (Req 9.1, 9.6, 35.4). Reject re-credit; the
    // total is left untouched so an obstacle can never be double-counted.
    if (credited.has(obstacleId)) {
      return reject(obstacleId, 'already-credited');
    }

    // Guard 2 — attribution must be to a recognized Movement_Mode (Req 9.2,
    // 9.3). A wrong/unknown mode is an invalid scoring result, not an event.
    if (!VALID_MODES.has(mode)) {
      return reject(obstacleId, 'invalid-mode');
    }

    // Snapshot the multiplier AT credit time (Req 9.4, 17.1).
    const multiplierAtCredit = readMultiplier();
    if (Number.isNaN(multiplierAtCredit)) {
      return reject(obstacleId, 'invalid-multiplier');
    }

    // Commit: set the latch first so the credit is atomic and idempotent.
    credited.add(obstacleId);

    // baseValue is always the unit value 1 (Req 2.4, 3.4, 4.3, 5.4).
    const event: ScoringEvent = {
      obstacleId,
      baseValue: 1,
      mode,
      multiplierAtCredit,
      creditedValue: 1 * multiplierAtCredit,
    };
    total += event.creditedValue;
    return event;
  }

  function activeMultiplier(): number {
    const m = multiplierSource();
    // Expose a safe value to callers/HUD; fall back to 1 if the source is bad.
    return Number.isFinite(m) && m > 0 ? m : 1;
  }

  return {
    credit,
    hasCredited: (obstacleId: string) => credited.has(obstacleId),
    current: () => total,
    activeMultiplier,
    creditedCount: () => credited.size,
    reset: () => {
      credited.clear();
      total = 0;
    },
  };
}

// Feature: kino-game
//
// UNIT tests for the World 1 Jumping vertical-slice WIRING (task 4.8).
//
// The slice is assembled in GameplayScene (Phaser, browser-bound) on top of the
// PURE core modules. The scene itself is not unit-testable without a scene
// harness (the project has none), so these tests exercise the PURE behaviors the
// slice wiring depends on, framed as the slice's contract — exactly the way
// GameplayScene drives them (see src/engine/scenes/GameplayScene.ts):
//
//   • creditCrossings(): for each obstacle whose `scoringLineX` Kino's WORLD x
//     (kinoScreenX + scrollX) has surpassed and that has not yet been credited,
//     call scoring.credit(id, mode). The latch guarantees exactly-once.
//   • checkCollision(): build Kino's body at (kinoScreenX + scrollX, y) and run
//     CollisionSystem.check(obstacles, mode); `.collided` is the signal the
//     scene uses to end the run.
//   • endRun(): assemble the RunEndData the scene hands to RunEndScene, and the
//     pure runEndStats helpers derive the displayed Run_End_Screen values.
//
// Pure TypeScript, no Phaser scene instantiation. A default BalanceTable drives
// the documented defaults. Covers:
//   - Req 2.3 : surpassing one Jumping obstacle credits EXACTLY ONE point of
//               value 1 attributed to jumping; re-passing never double counts.
//   - Req 44.3: a ground obstacle overlapping the body hitbox makes
//               check(...).collided true (run-ending signal); clear = no collide.
//   - Req 39.1: the RunEndData shape carries finalScore, world, mode,
//               obstaclesCleared, runTimeMs, and the pure stat helpers produce
//               the Run_End_Screen values (final score, high score, cleared
//               count, formatted time).

import { describe, it, expect } from 'vitest';
import {
  createObstacleSpawner,
  createScoringSystem,
  createCollisionSystem,
  type PlayArea,
  type Difficulty,
  type Obstacle,
  type MovementMode,
  type WorldId,
  type KinoBody,
} from '../src/core/index.ts';
// Pure Phaser-free stat helpers live in runEndStats.ts precisely so they can be
// exercised in plain Node; import them directly (not via the engine barrel,
// which pulls in Phaser scenes). RunEndData is a TYPE-only import — erased at
// compile time — so referencing the scene module here never loads Phaser.
import { relevantHighScore, formatRunTime } from '../src/engine/runEndStats.ts';
import type { RunEndData } from '../src/engine/index.ts';
import type { HighScoreState } from '../src/engine/saveState.ts';
import { createBalanceTable } from '../src/config/index.ts';

// --- shared fixtures mirroring the GameplayScene World 1 slice --------------

const balance = createBalanceTable(); // documented defaults

/** Ground line obstacles + Kino rest on (world == screen space in the slice). */
const GROUND_Y = 600;
const PLAY_AREA: PlayArea = { groundY: GROUND_Y, playHeight: GROUND_Y };

/** Nominal Kino body size the scene uses for the fixed-Kino footprint/hitbox. */
const KINO_BODY_WIDTH = 48;
const KINO_BODY_HEIGHT = 48;

const WORLD_1: WorldId = 1;
const JUMPING: MovementMode = 'jumping';
const EASY: Difficulty = { ramp: 0, obstaclesCleared: 0 };

function makeSpawner() {
  return createObstacleSpawner(balance, PLAY_AREA);
}

/** A World 1 Jumping window covering world-space [scrollX, scrollX + width]. */
function jumpingWindow(scrollX: number, width: number, difficulty: Difficulty) {
  return {
    scrollX,
    windowWidth: width,
    world: WORLD_1,
    mode: JUMPING,
    difficulty,
  };
}

/**
 * The scene's creditCrossings() re-expressed as a pure helper: credit every
 * obstacle whose scoring line Kino's world x has surpassed and that is not yet
 * credited. Returns the number of NEW credits this pass made (the scene's
 * `obstaclesCleared += 1` per successful event).
 */
function creditCrossings(
  scoring: ReturnType<typeof createScoringSystem>,
  obstacles: readonly Obstacle[],
  kinoWorldX: number,
  mode: MovementMode,
): number {
  let newlyCleared = 0;
  for (const obstacle of obstacles) {
    if (obstacle.scoringLineX > kinoWorldX) continue; // not yet surpassed
    if (scoring.hasCredited(obstacle.id)) continue; // already counted
    const event = scoring.credit(obstacle.id, mode);
    if (event) newlyCleared += 1;
  }
  return newlyCleared;
}

/**
 * The scene's checkCollision() re-expressed as a pure helper: Kino's body is at
 * (kinoScreenX + scrollX, y); obstacle bounds are world-space. Returns the full
 * CollisionResult so tests can assert both the `.collided` run-ending signal and
 * the offending obstacle id.
 */
function checkCollision(
  obstacles: readonly Obstacle[],
  kinoWorldX: number,
  kinoY: number,
  mode: MovementMode,
) {
  const body: KinoBody = {
    x: kinoWorldX,
    y: kinoY,
    width: KINO_BODY_WIDTH,
    height: KINO_BODY_HEIGHT,
  };
  return createCollisionSystem(body, balance).check(obstacles, mode);
}

// ---------------------------------------------------------------------------
// 1) Scoring wiring: exactly one point per cleared Jumping obstacle (Req 2.3)
// ---------------------------------------------------------------------------

describe('World 1 slice — scoring wiring (Req 2.3)', () => {
  it('credits exactly one point of value 1, attributed to jumping, when a unit is cleared', () => {
    const spawner = makeSpawner();
    const scoring = createScoringSystem();

    // Lay out the first few units at the start of the run.
    const units = spawner.spawnWindow(jumpingWindow(0, 2000, EASY));
    expect(units.length).toBeGreaterThan(0);
    const first = units[0]!;

    // Before Kino reaches the scoring line: nothing is credited.
    const beforeWorldX = first.scoringLineX - 1; // just short of the line
    expect(creditCrossings(scoring, units, beforeWorldX, JUMPING)).toBe(0);
    expect(scoring.current()).toBe(0);
    expect(scoring.hasCredited(first.id)).toBe(false);

    // Advance Kino's world x PAST the first unit's scoring line (surpassed).
    const afterWorldX = first.scoringLineX; // line now at/behind Kino
    const newly = creditCrossings(scoring, units, afterWorldX, JUMPING);

    // Exactly one new credit, of value 1, attributed to the jumping mode.
    expect(newly).toBe(1);
    expect(scoring.creditedCount()).toBe(1);
    expect(scoring.current()).toBe(1);
    expect(scoring.hasCredited(first.id)).toBe(true);
  });

  it('does not double count the same obstacle when the window is re-passed (exactly-once latch)', () => {
    const spawner = makeSpawner();
    const scoring = createScoringSystem();
    const units = spawner.spawnWindow(jumpingWindow(0, 2000, EASY));
    const first = units[0]!;

    // First pass surpasses the first unit and credits it once.
    expect(creditCrossings(scoring, units, first.scoringLineX, JUMPING)).toBe(1);
    expect(scoring.current()).toBe(1);

    // Re-pass the SAME world window (e.g. the scene re-evaluates the same
    // overlapping lookahead window on the next tick): no new credit, no change
    // to the total. Spawner is deterministic, so ids are stable across calls.
    const sameUnits = spawner.spawnWindow(jumpingWindow(0, 2000, EASY));
    expect(sameUnits[0]!.id).toBe(first.id);
    expect(creditCrossings(scoring, sameUnits, first.scoringLineX, JUMPING)).toBe(0);
    expect(scoring.current()).toBe(1);
    expect(scoring.creditedCount()).toBe(1);
  });

  it('credits each surpassed unit exactly once as Kino advances through several', () => {
    const spawner = makeSpawner();
    const scoring = createScoringSystem();
    const units = spawner.spawnWindow(jumpingWindow(0, 4000, EASY));
    // Take the first three units in scoring-line order.
    const ordered = [...units].sort((a, b) => a.scoringLineX - b.scoringLineX);
    const [u0, u1, u2] = ordered as [Obstacle, Obstacle, Obstacle];

    // Advance just past u1: u0 and u1 credited, u2 not yet.
    creditCrossings(scoring, units, u1.scoringLineX, JUMPING);
    expect(scoring.creditedCount()).toBe(2);
    expect(scoring.current()).toBe(2);
    expect(scoring.hasCredited(u0.id)).toBe(true);
    expect(scoring.hasCredited(u1.id)).toBe(true);
    expect(scoring.hasCredited(u2.id)).toBe(false);

    // Advance past u2: now three credited, total still one-per-unit.
    creditCrossings(scoring, units, u2.scoringLineX, JUMPING);
    expect(scoring.creditedCount()).toBe(3);
    expect(scoring.current()).toBe(3);
  });
});

// ---------------------------------------------------------------------------
// 2) Collision wiring: ground collision ends the run (Req 44.3)
// ---------------------------------------------------------------------------

describe('World 1 slice — collision wiring ends the run (Req 44.3)', () => {
  it('reports a collision (run-ending signal) when a ground obstacle overlaps the body hitbox', () => {
    const spawner = makeSpawner();
    const units = spawner.spawnWindow(jumpingWindow(0, 2000, EASY));
    const unit = units[0]!;
    const ground = unit.bounds[0]!; // the ground-resting block

    // Kino's world x is placed so the body overlaps the obstacle column, and
    // Kino is resting on the ground (body base at groundY), so it overlaps the
    // obstacle vertically too. This is the "touched a ground obstacle" case.
    const kinoWorldX = ground.x; // body left edge over the block
    const kinoY = GROUND_Y - KINO_BODY_HEIGHT; // resting on the ground line

    const result = checkCollision(units, kinoWorldX, kinoY, JUMPING);
    expect(result.collided).toBe(true); // the scene ends the run on this
    expect(result.obstacleId).toBe(unit.id);
  });

  it('reports no collision when Kino has jumped clear above the obstacle', () => {
    const spawner = makeSpawner();
    const units = spawner.spawnWindow(jumpingWindow(0, 2000, EASY));
    const unit = units[0]!;
    const ground = unit.bounds[0]!;

    // Same horizontal overlap, but Kino is high in the air — its body sits
    // entirely above the obstacle's top edge, so no overlap: the run continues.
    const kinoWorldX = ground.x;
    const kinoY = ground.y - KINO_BODY_HEIGHT - 20; // fully above the block top

    const result = checkCollision(units, kinoWorldX, kinoY, JUMPING);
    expect(result.collided).toBe(false);
    expect(result.obstacleId).toBeNull();
  });

  it('reports no collision when the obstacle is horizontally clear of Kino', () => {
    const spawner = makeSpawner();
    const units = spawner.spawnWindow(jumpingWindow(0, 2000, EASY));
    const unit = units[0]!;
    const ground = unit.bounds[0]!;

    // Kino far to the LEFT of the obstacle column (obstacle not yet reached),
    // resting on the ground: no horizontal overlap, so no collision.
    const kinoWorldX = ground.x - 500;
    const kinoY = GROUND_Y - KINO_BODY_HEIGHT;

    const result = checkCollision(units, kinoWorldX, kinoY, JUMPING);
    expect(result.collided).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3) Run-end data contract: Run_End_Screen values (Req 39.1)
// ---------------------------------------------------------------------------

describe('World 1 slice — run-end data contract (Req 39.1)', () => {
  /**
   * Assemble the RunEndData the scene hands to RunEndScene, mirroring
   * GameplayScene.endRun(): finalScore from the scoring total, world/mode from
   * the run config, obstaclesCleared from the per-run counter, runTimeMs as a
   * clamped, rounded wall-clock duration.
   */
  function makeRunEndData(
    scoring: ReturnType<typeof createScoringSystem>,
    obstaclesCleared: number,
    runStartMs: number,
    nowMs: number,
  ): RunEndData {
    return {
      finalScore: scoring.current(),
      world: WORLD_1,
      mode: JUMPING,
      obstaclesCleared,
      runTimeMs: Math.max(0, Math.round(nowMs - runStartMs)),
    };
  }

  it('carries finalScore, world, mode, obstaclesCleared, and runTimeMs', () => {
    const spawner = makeSpawner();
    const scoring = createScoringSystem();
    const units = spawner.spawnWindow(jumpingWindow(0, 4000, EASY));
    const ordered = [...units].sort((a, b) => a.scoringLineX - b.scoringLineX);

    // Simulate a run that cleared the first three units, then ended.
    const cleared = creditCrossings(
      scoring,
      units,
      ordered[2]!.scoringLineX,
      JUMPING,
    );

    const data = makeRunEndData(scoring, cleared, 1000, 5200);

    expect(data.finalScore).toBe(3);
    expect(data.world).toBe(1);
    expect(data.mode).toBe('jumping');
    expect(data.obstaclesCleared).toBe(3);
    expect(data.runTimeMs).toBe(4200);
  });

  it('clamps and rounds runTimeMs defensively (never negative)', () => {
    const scoring = createScoringSystem();
    // now before start → clamped to 0.
    expect(makeRunEndData(scoring, 0, 5000, 4000).runTimeMs).toBe(0);
    // fractional ms rounded.
    expect(makeRunEndData(scoring, 0, 0, 4200.6).runTimeMs).toBe(4201);
  });

  it('the pure stat helpers derive the Run_End_Screen display values', () => {
    const spawner = makeSpawner();
    const scoring = createScoringSystem();
    const units = spawner.spawnWindow(jumpingWindow(0, 4000, EASY));
    const ordered = [...units].sort((a, b) => a.scoringLineX - b.scoringLineX);
    const cleared = creditCrossings(
      scoring,
      units,
      ordered[1]!.scoringLineX,
      JUMPING,
    );
    const data = makeRunEndData(scoring, cleared, 0, 2500);

    // High scores: this World 1 story run beat a prior best of 1.
    const highScores: HighScoreState = { story: { world1: 1 }, endless: {} };

    // Final score shown is the run's credited total.
    expect(data.finalScore).toBe(2);
    // Relevant High_Score for (jumping, world 1) read from the story map.
    expect(relevantHighScore(highScores, data.mode, data.world)).toBe(1);
    // Obstacles-cleared shown is the per-run counter.
    expect(data.obstaclesCleared).toBe(2);
    // Run time formatted for display.
    expect(formatRunTime(data.runTimeMs)).toBe('2.5s');
  });

  it('reads a missing World 1 high score as 0 (new best this run)', () => {
    const emptyHighScores: HighScoreState = { story: {}, endless: {} };
    expect(relevantHighScore(emptyHighScores, JUMPING, WORLD_1)).toBe(0);
  });
});

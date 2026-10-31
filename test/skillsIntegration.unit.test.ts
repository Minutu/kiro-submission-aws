// Feature: kino-game
//
// Task 6.11 — consolidated INTEGRATION-style unit tests for the Nuke and the
// two protective skills, exercised TOGETHER exactly as the GameplayScene would
// compose them (design: "Active Skill — Nuke", "Skill effects" table,
// "SAFE-REPOSITION ALGORITHM"; Req 35.2, 35.4, 13.2, 14.3).
//
// The per-module tests (nukeSkill / secondChanceSkill / timeEraseSkill) already
// pin each module's internal contract. This file is deliberately NOT a copy of
// those: it wires the REAL SkillSystem + ScoringSystem + SafeRepositionSolver
// together through their public composition seams and asserts the three task
// bullets as composed behaviors:
//
//   1. Req 35.2 / 35.4 — Nuke `detonate` credits each on-screen Obstacle_Unit
//      EXACTLY ONCE and WITH THE ACTIVE MULTIPLIER. Composed with a SkillSystem
//      that has Score Multiplier equipped+active and a ScoringSystem driven by
//      `createScoreMultiplierSource`, so the multiplier is read at credit time
//      (the active-multiplier interaction the per-module Nuke test only covers
//      with a single skill). A later credit of a destroyed id is rejected.
//
//   2. Req 13.2 — Second Chance phases through EXACTLY ONE hit then resolves:
//      armed → first `consumeOnCollision()` phases through once and disarms
//      (active → cooldown), the second hit is NOT phased.
//
//   3. Req 14.3 — Time Erase repositions to a NON-OVERLAPPING spot: armed →
//      `onImminentCollision()` returns a placement whose fair hitbox overlaps
//      no obstacle in the frozen field, verified with the SAME `aabbOverlap`
//      routine the CollisionSystem uses.
//
// PURE — no Phaser; every module under test is from src/core. Uses the real
// BalanceTable so the composed behavior reflects shipped tunables.

import { describe, it, expect } from 'vitest';
import {
  createSkillSystem,
  createScoringSystem,
  createScoreMultiplierSource,
  createSecondChanceSkill,
  createTimeEraseSkill,
  createSafeRepositionSolver,
  detonate,
  aabbOverlap,
  type Obstacle,
  type NukeTarget,
  type Rect,
} from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

function balance() {
  return createBalanceTable();
}

/** A minimal on-screen Nuke target with the given id and mode. */
function target(id: string, mode: NukeTarget['mode'] = 'jumping'): NukeTarget {
  return { id, mode };
}

/** Does Kino's fair hitbox at a placement overlap ANY obstacle bound? */
function overlapsField(
  hitbox: Rect,
  field: readonly Obstacle[],
): boolean {
  for (const obstacle of field) {
    for (const bound of obstacle.bounds) {
      if (aabbOverlap(hitbox, bound)) return true;
    }
  }
  return false;
}

/** Shrink a body about its center by `scale` — the CollisionSystem's fair box. */
function fairHitbox(body: Rect, scale: number): Rect {
  const s = Math.max(0, scale);
  const width = body.width * s;
  const height = body.height * s;
  return {
    x: body.x + (body.width - width) / 2,
    y: body.y + (body.height - height) / 2,
    width,
    height,
  };
}

// ── 1. Nuke credits each on-screen obstacle once, at the ACTIVE multiplier ──
// Req 35.2 (credit each destroyed unit exactly once) + Req 35.4 (no re-credit)
// composed with the active Score Multiplier (the GameplayScene wiring).
describe('Nuke + Score Multiplier composition (Req 35.2, 35.4)', () => {
  it('credits each on-screen obstacle exactly once at the active multiplier, then rejects re-credit', () => {
    const b = balance();
    // GameplayScene wiring: a real SkillSystem drives the multiplier source the
    // real ScoringSystem reads AT CREDIT TIME.
    const skills = createSkillSystem(b);
    const scoring = createScoringSystem({
      multiplierSource: createScoreMultiplierSource(skills, b),
    });

    // Score Multiplier equipped + active at the moment the Nuke detonates.
    skills.equip('scoreMultiplier');
    skills.activate();
    expect(skills.isActive()).toBe(true);

    const factor = b.scoreMultiplierFactor();
    expect(factor).toBeGreaterThan(1); // the composition is meaningful

    const field = [
      target('o1', 'jumping'),
      target('o2', 'flight'),
      target('o3', 'zigzag'),
    ];

    const res = detonate(field, 'jumping', scoring);

    // EXACTLY ONCE: every id destroyed and newly credited a single time.
    expect(res.destroyedIds).toEqual(['o1', 'o2', 'o3']);
    expect(res.creditedIds).toEqual(['o1', 'o2', 'o3']);
    expect(scoring.creditedCount()).toBe(3);

    // ACTIVE MULTIPLIER: each unit worth `factor`, snapshotted at credit time.
    expect(res.awarded).toBe(3 * factor);
    expect(scoring.current()).toBe(3 * factor);

    // Req 35.4: a later pass over any destroyed id is rejected — no re-credit.
    for (const id of ['o1', 'o2', 'o3']) {
      expect(scoring.credit(id, 'jumping')).toBeNull();
    }
    expect(scoring.current()).toBe(3 * factor); // unchanged
    expect(scoring.creditedCount()).toBe(3);
  });

  it('credits at 1x when no multiplier is active (default source), still exactly once', () => {
    const b = balance();
    const skills = createSkillSystem(b); // nothing equipped → source yields 1
    const scoring = createScoringSystem({
      multiplierSource: createScoreMultiplierSource(skills, b),
    });

    const res = detonate([target('a'), target('b')], 'jumping', scoring);

    expect(res.creditedIds).toEqual(['a', 'b']);
    expect(res.awarded).toBe(2); // 2 units × 1x
    expect(scoring.current()).toBe(2);
    // Re-credit still rejected (latch), proving exactly-once holds at 1x too.
    expect(scoring.credit('a', 'jumping')).toBeNull();
    expect(scoring.current()).toBe(2);
  });
});

// ── 2. Second Chance phases through exactly one hit, then resolves ──────────
// Req 13.2 composed over the real SkillSystem lifecycle.
describe('Second Chance one-shot phase-through (Req 13.2)', () => {
  it('phases through exactly one collision then disarms; the second hit is not phased', () => {
    const b = balance();
    const skills = createSkillSystem(b, { initialSkill: 'secondChance' });
    let resolved = 0;
    const secondChance = createSecondChanceSkill(skills, {
      onResolved: () => {
        resolved += 1;
      },
    });

    // Arm the protective window (Req 13.1).
    skills.activate();
    expect(secondChance.isArmed()).toBe(true);
    expect(skills.isActive()).toBe(true);

    // First hit: phases through, consumes the protection, ends the window.
    const first = secondChance.consumeOnCollision();
    expect(first.phasedThrough).toBe(true);
    expect(first.outcome).toBe('phased');
    expect(resolved).toBe(1);

    // Window ended immediately: disarmed, lifecycle collapsed to cooldown.
    expect(secondChance.isArmed()).toBe(false);
    expect(skills.isActive()).toBe(false);
    expect(skills.state()).toBe('cooldown');

    // Second hit in the same run: NOT phased (resolves as a normal fatal hit).
    const second = secondChance.consumeOnCollision();
    expect(second.phasedThrough).toBe(false);
    expect(second.outcome).toBe('not-armed');
    expect(resolved).toBe(1); // onResolved fired only once
  });

  it('does not phase through before the window is armed', () => {
    const b = balance();
    const skills = createSkillSystem(b, { initialSkill: 'secondChance' });
    const secondChance = createSecondChanceSkill(skills);

    // Equipped but ready (not activated) → no protection.
    expect(secondChance.isArmed()).toBe(false);
    const r = secondChance.consumeOnCollision();
    expect(r.phasedThrough).toBe(false);
    expect(r.outcome).toBe('not-armed');
  });
});

// ── 3. Time Erase repositions to a non-overlapping spot ─────────────────────
// Req 14.3 composed over the real SkillSystem + real SafeRepositionSolver,
// verified with the shared aabbOverlap routine.
describe('Time Erase safe reposition (Req 14.3)', () => {
  it('repositions Kino to a placement whose fair hitbox overlaps no obstacle', () => {
    const b = balance();
    const skills = createSkillSystem(b, { initialSkill: 'timeErase' });
    const solver = createSafeRepositionSolver(b);
    let resolved = 0;
    const timeErase = createTimeEraseSkill(skills, solver, {
      onResolved: () => {
        resolved += 1;
      },
    });

    // Arm the 4 s protection window (Req 14.1).
    skills.activate();
    expect(timeErase.isArmed()).toBe(true);

    // A flight field: top + bottom pillars overlapping Kino's column so the
    // body's current spot is NOT clear and the solver must move it to a gap.
    const body: Rect = { x: 100, y: 240, width: 40, height: 40 };
    const field: Obstacle[] = [
      {
        id: 'pillar-top',
        category: 'flight_obstacle',
        mode: 'flight',
        bounds: [{ x: 90, y: 0, width: 60, height: 260 }],
        scoringLineX: 90,
        scored: false,
      },
      {
        id: 'pillar-bottom',
        category: 'flight_obstacle',
        mode: 'flight',
        bounds: [{ x: 90, y: 320, width: 60, height: 180 }],
        scoringLineX: 90,
        scored: false,
      },
    ];
    const playArea = { groundY: 500, playHeight: 500 };

    // Sanity: the body's current position DOES overlap, so a real reposition
    // is required (the test would be vacuous otherwise).
    const scale = b.hitboxScale('flight');
    expect(overlapsField(fairHitbox(body, scale), field)).toBe(true);

    const result = timeErase.onImminentCollision({
      mode: 'flight',
      body,
      screenX: body.x,
      field,
      playArea,
      contactedObstacleId: 'pillar-top',
    });

    // Collision prevented and a placement returned (Req 14.2, 14.4).
    expect(result.prevented).toBe(true);
    expect(result.outcome).toBe('repositioned');
    expect(result.placement).not.toBeNull();
    expect(resolved).toBe(1);

    // Req 14.3: the placement's fair hitbox overlaps NO obstacle bound.
    const placement = result.placement!;
    const placedBody: Rect = { ...body, x: placement.x, y: placement.y };
    const placedHitbox = fairHitbox(placedBody, scale);
    expect(overlapsField(placedHitbox, field)).toBe(false);

    // Window ended immediately (active → cooldown); a second imminent collision
    // is no longer protected.
    expect(timeErase.isArmed()).toBe(false);
    expect(skills.state()).toBe('cooldown');
    const second = timeErase.onImminentCollision({
      mode: 'flight',
      body: placedBody,
      screenX: placedBody.x,
      field,
      playArea,
    });
    expect(second.prevented).toBe(false);
    expect(second.outcome).toBe('not-armed');
    expect(second.placement).toBeNull();
  });

  it('does not reposition when the window is not armed', () => {
    const b = balance();
    const skills = createSkillSystem(b, { initialSkill: 'timeErase' });
    const solver = createSafeRepositionSolver(b);
    const timeErase = createTimeEraseSkill(skills, solver);

    // Equipped but ready (not activated) → not armed.
    expect(timeErase.isArmed()).toBe(false);
    const r = timeErase.onImminentCollision({
      mode: 'jumping',
      body: { x: 0, y: 0, width: 40, height: 40 },
      field: [],
      playArea: { groundY: 500, playHeight: 500 },
    });
    expect(r.prevented).toBe(false);
    expect(r.outcome).toBe('not-armed');
    expect(r.placement).toBeNull();
  });
});

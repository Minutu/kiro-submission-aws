// Feature: kino-game
//
// Unit tests for the pure Ultra Instinct effect (design: "Skill effects";
// Req 18.1, 18.2). These pin the concrete contract of task 6.9:
//   - auto-evading EXACTLY while `ultraInstinct` is equipped AND active, for the
//     full 10 s window (Req 18.1);
//   - `autoEvade` returns a guaranteed non-overlapping SafePlacement from the
//     REAL SafeRepositionSolver, repeatedly within the window, WITHOUT ending it
//     (Req 18.2);
//   - not auto-evading (not activated / wrong skill / expired) → null so the
//     caller resolves the collision normally.
//
// Composed against the REAL SkillSystem + SafeRepositionSolver (no mocks), so
// "clear" here is validated by the same AABB basis the CollisionSystem uses.

import { describe, it, expect } from 'vitest';
import {
  createSkillSystem,
  createSafeRepositionSolver,
  createUltraInstinctSkill,
  aabbOverlap,
  type SkillSystem,
  type SafePlacement,
  type Rect,
  type Obstacle,
  type UltraInstinctEvadeRequest,
} from '../src/core/index.ts';
import { createBalanceTable, type BalanceTable } from '../src/config/index.ts';

function balance(): BalanceTable {
  return createBalanceTable();
}

/** Tick `sys` in whole fixed steps until just past `seconds` of sim time. */
function tickPast(sys: SkillSystem, seconds: number, step = 1 / 120): void {
  let elapsed = 0;
  const target = seconds + step; // one extra step to cross the boundary
  while (elapsed < target - 1e-9) {
    sys.tick(step);
    elapsed += step;
  }
}

/** Kino's body rect — a simple square used across the placement tests. */
function body(): Rect {
  return { x: 100, y: 300, width: 40, height: 40 };
}

/**
 * An obstacle whose single bound overlaps the body's column so the "ideal"
 * y is blocked and the solver must find a clear vertical-axis row. Flight
 * exercises the vertical-gap rule (nearest clear y along the vertical axis).
 */
function blockingField(): Obstacle[] {
  return [
    {
      id: 'ob-1',
      category: 'test',
      mode: 'flight',
      bounds: [{ x: 90, y: 260, width: 80, height: 120 }],
      scoringLineX: 90,
      scored: false,
    },
  ];
}

function playArea() {
  return { groundY: 600, playHeight: 600 };
}

function evadeRequest(
  field: Obstacle[] = blockingField(),
): UltraInstinctEvadeRequest {
  return {
    mode: 'flight',
    body: body(),
    screenX: body().x,
    field,
    playArea: playArea(),
  };
}

/** True iff the body placed at `placement` overlaps NO obstacle bound. */
function placementIsClear(
  placement: SafePlacement,
  b: Rect,
  field: readonly Obstacle[],
): boolean {
  // The solver validates with the fair, shrunk hitbox; the full body box is a
  // SUPERSET, so a clear full-body box is a strictly stronger guarantee.
  const box: Rect = { ...b, x: placement.x, y: placement.y };
  for (const o of field) {
    for (const bound of o.bounds) {
      if (aabbOverlap(box, bound)) return false;
    }
  }
  return true;
}

describe('createUltraInstinctSkill — auto-evading window (Req 18.1)', () => {
  it('is not auto-evading before activation', () => {
    const skills = createSkillSystem(balance());
    const ui = createUltraInstinctSkill(skills, createSafeRepositionSolver(balance()));
    skills.equip('ultraInstinct');
    expect(ui.isAutoEvading()).toBe(false); // ready, not active
    expect(ui.autoEvade(evadeRequest())).toBeNull();
  });

  it('auto-evades for the full 10 s balance window once activated', () => {
    const b = balance();
    expect(b.ultraInstinctDurationS()).toBe(10);
    const skills = createSkillSystem(b);
    const ui = createUltraInstinctSkill(skills, createSafeRepositionSolver(b));
    skills.equip('ultraInstinct');
    skills.activate();
    expect(ui.isAutoEvading()).toBe(true);
    expect(skills.effectRemaining()).toBeCloseTo(10);

    // Still auto-evading partway through the 10 s window.
    tickPast(skills, 5);
    expect(ui.isAutoEvading()).toBe(true);
    expect(skills.state()).toBe('active');
  });

  it('stops auto-evading when the 10 s window expires (→ cooldown)', () => {
    const b = balance();
    const skills = createSkillSystem(b);
    const ui = createUltraInstinctSkill(skills, createSafeRepositionSolver(b));
    skills.equip('ultraInstinct');
    skills.activate();

    tickPast(skills, b.ultraInstinctDurationS());
    expect(ui.isAutoEvading()).toBe(false);
    expect(skills.state()).toBe('cooldown');
    expect(ui.autoEvade(evadeRequest())).toBeNull();
  });

  it('is not auto-evading when a different skill is equipped', () => {
    const skills = createSkillSystem(balance());
    const ui = createUltraInstinctSkill(skills, createSafeRepositionSolver(balance()));
    skills.equip('timeSlow');
    skills.activate();
    expect(ui.isAutoEvading()).toBe(false);
    expect(ui.autoEvade(evadeRequest())).toBeNull();
  });
});

describe('createUltraInstinctSkill — vertical-axis teleport (Req 18.2)', () => {
  it('returns a guaranteed non-overlapping placement while active', () => {
    const b = balance();
    const skills = createSkillSystem(b);
    const ui = createUltraInstinctSkill(skills, createSafeRepositionSolver(b));
    skills.equip('ultraInstinct');
    skills.activate();

    const placement = ui.autoEvade(evadeRequest());
    expect(placement).not.toBeNull();
    expect(placementIsClear(placement!, body(), blockingField())).toBe(true);
  });

  it('keeps Kino on the vertical axis (fixed screenX) when teleporting', () => {
    const b = balance();
    const skills = createSkillSystem(b);
    const ui = createUltraInstinctSkill(skills, createSafeRepositionSolver(b));
    skills.equip('ultraInstinct');
    skills.activate();

    const placement = ui.autoEvade(evadeRequest())!;
    // Vertical-axis evasion holds the fixed horizontal screen position.
    expect(placement.x).toBe(body().x);
    // And it actually moved off the blocked ideal row.
    expect(placement.y).not.toBe(body().y);
  });

  it('auto-evades REPEATEDLY within the window without consuming it', () => {
    const b = balance();
    const skills = createSkillSystem(b);
    const ui = createUltraInstinctSkill(skills, createSafeRepositionSolver(b));
    skills.equip('ultraInstinct');
    skills.activate();

    // Several imminent collisions across the 10 s window all evade; the window
    // is NOT ended early by an evasion (contrast Second Chance's one-shot).
    for (let i = 0; i < 5; i++) {
      const placement = ui.autoEvade(evadeRequest());
      expect(placement).not.toBeNull();
      expect(placementIsClear(placement!, body(), blockingField())).toBe(true);
      expect(ui.isAutoEvading()).toBe(true);
      expect(skills.state()).toBe('active');
      tickPast(skills, 1);
    }
  });

  it('is deterministic — same request yields the same placement', () => {
    const b = balance();
    const skills = createSkillSystem(b);
    const ui = createUltraInstinctSkill(skills, createSafeRepositionSolver(b));
    skills.equip('ultraInstinct');
    skills.activate();

    const a = ui.autoEvade(evadeRequest())!;
    const c = ui.autoEvade(evadeRequest())!;
    expect(a).toEqual(c);
  });

  it('returns a clear placement even with no obstacles (total contract)', () => {
    const b = balance();
    const skills = createSkillSystem(b);
    const ui = createUltraInstinctSkill(skills, createSafeRepositionSolver(b));
    skills.equip('ultraInstinct');
    skills.activate();

    const placement = ui.autoEvade(evadeRequest([]));
    expect(placement).not.toBeNull();
    expect(placementIsClear(placement!, body(), [])).toBe(true);
  });
});

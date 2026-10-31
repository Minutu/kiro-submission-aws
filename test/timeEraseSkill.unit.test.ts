// Feature: kino-game
//
// Unit tests for the pure Time Erase effect (design: "Skill effects" +
// "SAFE-REPOSITION ALGORITHM"; Req 14.1, 14.2, 14.4). These pin the concrete
// contract of task 6.5: armed within the 4 s window (Req 14.1), an imminent
// collision while armed is PREVENTED and Kino is repositioned to a
// non-overlapping spot via the SafeRepositionSolver then the window ends
// immediately (Req 14.2), the placement is clear and per-mode (Req 14.3 via the
// solver), the resolve hook fires on reposition (Req 14.4 run continues), a
// second collision in the same window is NOT prevented, not armed → null, and
// window expiry disarms WITHOUT repositioning.

import { describe, it, expect, vi } from 'vitest';
import {
  createSkillSystem,
  createSafeRepositionSolver,
  createTimeEraseSkill,
  aabbOverlap,
  type SkillSystem,
  type SafePlacement,
  type MovementMode,
  type Obstacle,
  type Rect,
} from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

function balance() {
  return createBalanceTable();
}

const b = createBalanceTable();
const solver = createSafeRepositionSolver(b);

/** Kino's body rect used across tests. */
const BODY: Rect = { x: 200, y: 260, width: 40, height: 40 };
const PLAY = { groundY: 600, playHeight: 600 };

/** Build an obstacle from bound rectangles. */
function obstacle(id: string, mode: MovementMode, bounds: Rect[]): Obstacle {
  return { id, category: 'test', mode, bounds, scoringLineX: 0, scored: false };
}

/** The fair shrunk hitbox for a placement, mirroring CollisionSystem. */
function hitboxAt(mode: MovementMode, body: Rect, p: SafePlacement): Rect {
  const s = b.hitboxScale(mode);
  const width = body.width * s;
  const height = body.height * s;
  return {
    x: p.x + (body.width - width) / 2,
    y: p.y + (body.height - height) / 2,
    width,
    height,
  };
}

/** Assert the placement overlaps no obstacle under the shared routine. */
function expectClear(
  mode: MovementMode,
  body: Rect,
  field: readonly Obstacle[],
  p: SafePlacement,
): void {
  const box = hitboxAt(mode, body, p);
  for (const o of field) {
    for (const bound of o.bounds) {
      expect(aabbOverlap(box, bound)).toBe(false);
    }
  }
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

/** A jumping imminent-collision context used across the tests. */
function jumpingCollision() {
  const wall = obstacle('w', 'jumping', [
    { x: 220, y: 540, width: 48, height: 60 },
  ]);
  return {
    wall,
    collision: {
      mode: 'jumping' as const,
      body: BODY,
      field: [wall],
      playArea: PLAY,
      contactedObstacleId: 'w',
    },
  };
}

describe('createTimeEraseSkill — arming (Req 14.1)', () => {
  it('is not armed before activation', () => {
    const skills = createSkillSystem(balance());
    const te = createTimeEraseSkill(skills, solver);
    skills.equip('timeErase');
    expect(te.isArmed()).toBe(false); // ready, not active
  });

  it('arms on activation and stays armed within the 4 s window', () => {
    const bt = balance();
    const skills = createSkillSystem(bt);
    const te = createTimeEraseSkill(skills, solver);
    skills.equip('timeErase');
    skills.activate();
    expect(te.isArmed()).toBe(true);

    // Still armed partway through the window.
    tickPast(skills, bt.timeEraseWindowS() / 2);
    expect(te.isArmed()).toBe(true);
    expect(skills.state()).toBe('active');
  });

  it('uses the 4 s balance window as its armed duration (Req 14.1)', () => {
    const bt = balance();
    expect(bt.timeEraseWindowS()).toBe(4);
    const skills = createSkillSystem(bt);
    createTimeEraseSkill(skills, solver);
    skills.equip('timeErase');
    skills.activate();
    expect(skills.effectRemaining()).toBeCloseTo(bt.timeEraseWindowS());
  });

  it('is not armed when a different skill is equipped', () => {
    const skills = createSkillSystem(balance());
    const te = createTimeEraseSkill(skills, solver);
    skills.equip('secondChance');
    skills.activate();
    expect(te.isArmed()).toBe(false);
    const { collision } = jumpingCollision();
    expect(te.onImminentCollision(collision)).toEqual({
      prevented: false,
      outcome: 'wrong-skill',
      placement: null,
    });
  });
});

describe('createTimeEraseSkill — prevent & reposition (Req 14.2, 14.3, 14.4)', () => {
  it('prevents an imminent collision while armed and returns a non-overlapping placement', () => {
    const skills = createSkillSystem(balance());
    const te = createTimeEraseSkill(skills, solver);
    skills.equip('timeErase');
    skills.activate();
    expect(te.isArmed()).toBe(true);

    const { wall, collision } = jumpingCollision();
    const r = te.onImminentCollision(collision);

    expect(r.prevented).toBe(true);
    expect(r.outcome).toBe('repositioned');
    expect(r.placement).not.toBeNull();
    // Req 14.3: the placement overlaps no obstacle (solver guarantee).
    expectClear('jumping', BODY, [wall], r.placement as SafePlacement);
  });

  it('places per the mode-specific rule — jumping: right of and clear of the obstacle at ground level (Req 44.7)', () => {
    const skills = createSkillSystem(balance());
    const te = createTimeEraseSkill(skills, solver);
    skills.equip('timeErase');
    skills.activate();

    const { collision } = jumpingCollision();
    const p = te.onImminentCollision(collision).placement as SafePlacement;
    // Directly right of the obstacle's right edge (x = 220+48 = 268).
    expect(p.x).toBeGreaterThanOrEqual(268);
    // At ground level: body base sits on the ground line.
    expect(p.y + BODY.height).toBeCloseTo(PLAY.groundY, 10);
  });

  it('matches the solver placement exactly (pure forwarding, skill = timeErase)', () => {
    const skills = createSkillSystem(balance());
    const te = createTimeEraseSkill(skills, solver);
    skills.equip('timeErase');
    skills.activate();

    const { collision } = jumpingCollision();
    const expected = solver.reposition({ ...collision, skill: 'timeErase' });
    const p = te.onImminentCollision(collision).placement;
    expect(p).toEqual(expected);
  });

  it('ends the window immediately on reposition (Req 14.2): active → cooldown, disarmed', () => {
    const skills = createSkillSystem(balance());
    const te = createTimeEraseSkill(skills, solver);
    skills.equip('timeErase');
    skills.activate();

    const { collision } = jumpingCollision();
    te.onImminentCollision(collision);
    expect(te.isArmed()).toBe(false);
    expect(skills.state()).toBe('cooldown');
  });

  it('does NOT prevent a second collision in the same window', () => {
    const skills = createSkillSystem(balance());
    const te = createTimeEraseSkill(skills, solver);
    skills.equip('timeErase');
    skills.activate();

    const { collision } = jumpingCollision();
    expect(te.onImminentCollision(collision).prevented).toBe(true); // uses it
    const second = te.onImminentCollision(collision);
    expect(second).toEqual({
      prevented: false,
      outcome: 'not-armed',
      placement: null,
    });
  });

  it('fires onResolved exactly once with the placement, only on the prevented collision (Req 14.4)', () => {
    const onResolved = vi.fn();
    const skills = createSkillSystem(balance());
    const te = createTimeEraseSkill(skills, solver, { onResolved });
    skills.equip('timeErase');
    skills.activate();

    const { collision } = jumpingCollision();
    const r = te.onImminentCollision(collision); // prevented → fires
    te.onImminentCollision(collision); // not armed → does not fire
    expect(onResolved).toHaveBeenCalledTimes(1);
    expect(onResolved).toHaveBeenCalledWith(r.placement);
  });

  it('forwards the zigzag request and surfaces the returned diagonal control', () => {
    const skills = createSkillSystem(balance());
    const te = createTimeEraseSkill(skills, solver);
    skills.equip('timeErase');
    skills.activate();

    const body = { ...BODY, y: 20 }; // high up, nearing the top wall
    const p = te.onImminentCollision({
      mode: 'zigzag',
      body,
      screenX: 200,
      field: [],
      playArea: PLAY,
      diagonalDir: 'up',
    }).placement as SafePlacement;
    // Solver sends Kino down (away from the top wall) and returns control.
    expect(p.diagonalDir).toBe('down');
    expect(p.controlReturned).toBe(true);
    expectClear('zigzag', body, [], p);
  });
});

describe('createTimeEraseSkill — not armed returns null (Req 14.4)', () => {
  it('returns not-armed/null when called before activation', () => {
    const onResolved = vi.fn();
    const skills = createSkillSystem(balance());
    const te = createTimeEraseSkill(skills, solver, { onResolved });
    skills.equip('timeErase');
    const { collision } = jumpingCollision();
    expect(te.onImminentCollision(collision)).toEqual({
      prevented: false,
      outcome: 'not-armed',
      placement: null,
    });
    expect(onResolved).not.toHaveBeenCalled();
  });

  it('disarms on window expiry WITHOUT repositioning; a later collision is not prevented', () => {
    const bt = balance();
    const onResolved = vi.fn();
    const skills = createSkillSystem(bt);
    const te = createTimeEraseSkill(skills, solver, { onResolved });
    skills.equip('timeErase');
    skills.activate();
    expect(te.isArmed()).toBe(true);

    // Let the 4 s window fully elapse with no collision.
    tickPast(skills, bt.timeEraseWindowS());
    expect(te.isArmed()).toBe(false);
    expect(skills.state()).toBe('cooldown'); // expired naturally → cooldown

    const { collision } = jumpingCollision();
    expect(te.onImminentCollision(collision)).toEqual({
      prevented: false,
      outcome: 'not-armed',
      placement: null,
    });
    expect(onResolved).not.toHaveBeenCalled(); // expiry does not resolve
  });
});

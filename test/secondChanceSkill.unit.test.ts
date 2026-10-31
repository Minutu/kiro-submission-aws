// Feature: kino-game
//
// Unit tests for the pure Second Chance effect (design: "Skill effects";
// Req 13.1–13.4). These pin the concrete contract of task 6.4: armed within the
// ≤3 s window (Req 13.1), phases through EXACTLY ONE collision then disarms and
// ends the window immediately (Req 13.2), a second collision in the same window
// is NOT phased (Req 13.3), the halo-resolve hook fires on consume (Req 13.4),
// and window expiry disarms WITHOUT consuming.

import { describe, it, expect, vi } from 'vitest';
import {
  createSkillSystem,
  createSecondChanceSkill,
  type SkillSystem,
} from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

function balance() {
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

describe('createSecondChanceSkill — arming (Req 13.1)', () => {
  it('is not armed before activation', () => {
    const skills = createSkillSystem(balance());
    const sc = createSecondChanceSkill(skills);
    skills.equip('secondChance');
    expect(sc.isArmed()).toBe(false); // ready, not active
  });

  it('arms when Second Chance is activated and stays armed within the window', () => {
    const b = balance();
    const skills = createSkillSystem(b);
    const sc = createSecondChanceSkill(skills);
    skills.equip('secondChance');
    skills.activate();
    expect(sc.isArmed()).toBe(true);

    // Still armed partway through the ≤3 s window.
    tickPast(skills, b.secondChanceWindowS() / 2);
    expect(sc.isArmed()).toBe(true);
    expect(skills.state()).toBe('active');
  });

  it('uses the ≤3 s balance window as its armed duration', () => {
    const b = balance();
    expect(b.secondChanceWindowS()).toBeLessThanOrEqual(3);
    const skills = createSkillSystem(b);
    createSecondChanceSkill(skills);
    skills.equip('secondChance');
    skills.activate();
    expect(skills.effectRemaining()).toBeCloseTo(b.secondChanceWindowS());
  });

  it('is not armed when a different skill is equipped', () => {
    const skills = createSkillSystem(balance());
    const sc = createSecondChanceSkill(skills);
    skills.equip('timeSlow');
    skills.activate();
    expect(sc.isArmed()).toBe(false);
    expect(sc.consumeOnCollision()).toEqual({
      phasedThrough: false,
      outcome: 'wrong-skill',
    });
  });
});

describe('createSecondChanceSkill — phase through exactly one (Req 13.2, 13.3)', () => {
  it('phases through a collision while armed, then disarms and ends the window', () => {
    const skills = createSkillSystem(balance());
    const sc = createSecondChanceSkill(skills);
    skills.equip('secondChance');
    skills.activate();
    expect(sc.isArmed()).toBe(true);

    const first = sc.consumeOnCollision();
    expect(first).toEqual({ phasedThrough: true, outcome: 'phased' });

    // Window ended immediately (Req 13.2): active → cooldown, no longer armed.
    expect(sc.isArmed()).toBe(false);
    expect(skills.state()).toBe('cooldown');
  });

  it('does NOT phase a second collision in the same window (Req 13.3)', () => {
    const skills = createSkillSystem(balance());
    const sc = createSecondChanceSkill(skills);
    skills.equip('secondChance');
    skills.activate();

    expect(sc.consumeOnCollision().phasedThrough).toBe(true); // consumes it
    const second = sc.consumeOnCollision();
    expect(second).toEqual({ phasedThrough: false, outcome: 'not-armed' });
    expect(sc.isArmed()).toBe(false);
  });

  it('fires onResolved exactly once, only on the phased collision (Req 13.4)', () => {
    const onResolved = vi.fn();
    const skills = createSkillSystem(balance());
    const sc = createSecondChanceSkill(skills, { onResolved });
    skills.equip('secondChance');
    skills.activate();

    sc.consumeOnCollision(); // phased → fires
    sc.consumeOnCollision(); // not armed → does not fire
    expect(onResolved).toHaveBeenCalledTimes(1);
  });

  it('returns not-armed (no phase) when called before activation', () => {
    const onResolved = vi.fn();
    const skills = createSkillSystem(balance());
    const sc = createSecondChanceSkill(skills, { onResolved });
    skills.equip('secondChance');
    const r = sc.consumeOnCollision();
    expect(r).toEqual({ phasedThrough: false, outcome: 'not-armed' });
    expect(onResolved).not.toHaveBeenCalled();
  });
});

describe('createSecondChanceSkill — window expiry (Req 13.1, 13.3)', () => {
  it('disarms on window expiry WITHOUT consuming, and a later collision is not phased', () => {
    const b = balance();
    const onResolved = vi.fn();
    const skills = createSkillSystem(b);
    const sc = createSecondChanceSkill(skills, { onResolved });
    skills.equip('secondChance');
    skills.activate();
    expect(sc.isArmed()).toBe(true);

    // Let the ≤3 s window fully elapse with no collision.
    tickPast(skills, b.secondChanceWindowS());
    expect(sc.isArmed()).toBe(false);
    expect(skills.state()).toBe('cooldown'); // expired naturally → cooldown

    // A collision after expiry resolves as a normal hit (not phased).
    expect(sc.consumeOnCollision()).toEqual({
      phasedThrough: false,
      outcome: 'not-armed',
    });
    expect(onResolved).not.toHaveBeenCalled(); // expiry does not resolve
  });
});

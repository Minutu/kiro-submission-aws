// Feature: kino-game
//
// Unit tests for the pure SkillSystem lifecycle (design: "Active skill
// lifecycle (Req 12, 13–18, 35)", "Single equipped Skill (Req 12.15)";
// Req 12.2, 12.3, 12.4, 12.15, 12.16, 7.10–7.12). These pin the concrete
// contract of task 6.1: single-equip (unequip previous), the ready→active→
// cooldown→ready lifecycle driven only by `tick`, silent-defer when not ready,
// activation refused during a transition, and that timers advance ONLY via
// `tick` (so pause — the driver not calling `tick` — freezes them). The
// dedicated Property 7 pause-freeze test is task 6.2 and is NOT written here.

import { describe, it, expect, vi } from 'vitest';
import {
  createSkillSystem,
  createFixedTimestepDriver,
  type SkillSystem,
  type SkillId,
} from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

/** A BalanceTable built from documented defaults (cooldown 12 s). */
function balance() {
  return createBalanceTable();
}

/**
 * Advance `sys` with uniform fixed ticks of `step` seconds until AT LEAST
 * `seconds` of simulated time has elapsed (the last tick may push slightly
 * past, exactly like the real fixed-step driver, which only ticks in whole
 * `fixedDeltaS` units). Returns the total simulated time so callers can reason
 * about carryover into the next lifecycle phase.
 */
function tickSeconds(sys: SkillSystem, seconds: number, step = 1 / 120): number {
  let elapsed = 0;
  while (elapsed < seconds - 1e-9) {
    sys.tick(step);
    elapsed += step;
  }
  return elapsed;
}

/** Tick enough whole steps to be certain the current phase has fully ended. */
function tickPastPhase(sys: SkillSystem, seconds: number, step = 1 / 120): void {
  // One extra step guarantees we cross the boundary even if `seconds` is an
  // exact multiple of `step` and float rounding leaves a hair of time.
  tickSeconds(sys, seconds + step, step);
}

describe('createSkillSystem — equip / single-equip (Req 12.2, 12.15)', () => {
  it('starts with no equipped skill', () => {
    const sys = createSkillSystem(balance());
    expect(sys.equipped()).toBeNull();
    expect(sys.state()).toBeNull();
    expect(sys.skill()).toBeNull();
    expect(sys.hudSnapshot()).toBeNull();
  });

  it('equips a skill as the single equipped skill, starting ready', () => {
    const sys = createSkillSystem(balance());
    sys.equip('dash');
    expect(sys.equipped()).toBe('dash');
    expect(sys.state()).toBe('ready');
    expect(sys.isReady()).toBe(true);
    expect(sys.isActive()).toBe(false);
  });

  it('equipping a new skill unequips the previous one', () => {
    const sys = createSkillSystem(balance());
    sys.equip('dash');
    sys.equip('timeSlow');
    // At most one equipped at any time (Req 12.15).
    expect(sys.equipped()).toBe('timeSlow');
    expect(sys.skill()?.id).toBe('timeSlow');
  });

  it('re-equipping the current skill resets it to a fresh ready state', () => {
    const sys = createSkillSystem(balance());
    sys.equip('timeSlow');
    sys.activate();
    expect(sys.isActive()).toBe(true);
    sys.equip('timeSlow'); // re-equip
    expect(sys.state()).toBe('ready');
    expect(sys.effectRemaining()).toBe(0);
    expect(sys.cooldownRemaining()).toBe(0);
  });

  it('unequip clears the equipped skill', () => {
    const sys = createSkillSystem(balance());
    sys.equip('dash');
    sys.unequip();
    expect(sys.equipped()).toBeNull();
  });

  it('honors initialSkill from construction options', () => {
    const sys = createSkillSystem(balance(), { initialSkill: 'nuke' });
    expect(sys.equipped()).toBe('nuke');
  });
});

describe('createSkillSystem — activation lifecycle (Req 12.4, 12.16)', () => {
  it('activating a ready skill enters active for the effect duration', () => {
    const b = balance();
    const sys = createSkillSystem(b);
    sys.equip('timeSlow');
    const result = sys.activate();
    expect(result).toEqual({ activated: true, reason: 'none' });
    expect(sys.state()).toBe('active');
    expect(sys.effectRemaining()).toBeCloseTo(b.timeSlowDurationS());
  });

  it('runs active → cooldown → ready purely via tick', () => {
    const b = balance();
    const sys = createSkillSystem(b);
    sys.equip('timeSlow');
    sys.activate();

    // Still active partway through the effect.
    tickSeconds(sys, b.timeSlowDurationS() / 2);
    expect(sys.state()).toBe('active');

    // After the full effect elapses, it enters cooldown with (close to) the
    // full cooldown remaining — a hair may have bled into cooldown from the
    // boundary-crossing tick, which is expected driver behavior.
    tickPastPhase(sys, b.timeSlowDurationS() / 2);
    expect(sys.state()).toBe('cooldown');
    expect(sys.cooldownRemaining()).toBeLessThanOrEqual(b.defaultCooldownS());
    expect(sys.cooldownRemaining()).toBeGreaterThan(b.defaultCooldownS() - 1);

    // After the cooldown elapses, it returns to ready.
    tickPastPhase(sys, b.defaultCooldownS());
    expect(sys.state()).toBe('ready');
    expect(sys.isReady()).toBe(true);
    expect(sys.cooldownRemaining()).toBe(0);
  });

  it('fires onActivate / onEffectEnd / onReady at the transitions', () => {
    const b = balance();
    const onActivate = vi.fn();
    const onEffectEnd = vi.fn();
    const onReady = vi.fn();
    const sys = createSkillSystem(b, { onActivate, onEffectEnd, onReady });
    sys.equip('timeSlow');

    sys.activate();
    expect(onActivate).toHaveBeenCalledWith('timeSlow');

    tickPastPhase(sys, b.timeSlowDurationS());
    expect(onEffectEnd).toHaveBeenCalledWith('timeSlow');

    tickPastPhase(sys, b.defaultCooldownS());
    expect(onReady).toHaveBeenCalledWith('timeSlow');
  });

  it('resolves a zero-duration effect (nuke) straight into cooldown', () => {
    const sys = createSkillSystem(balance());
    sys.equip('nuke'); // effectDurationS === 0
    const result = sys.activate();
    expect(result.activated).toBe(true);
    // No lingering 0s active phase: goes directly to cooldown.
    expect(sys.state()).toBe('cooldown');
    expect(sys.isActive()).toBe(false);
  });
});

describe('createSkillSystem — silent defer (Req 12.16)', () => {
  it('silently defers activation while on cooldown (no state change)', () => {
    const b = balance();
    const sys = createSkillSystem(b);
    sys.equip('dash');
    sys.activate();
    tickPastPhase(sys, b.dashDurationS()); // now on cooldown
    expect(sys.state()).toBe('cooldown');

    const before = sys.cooldownRemaining();
    const result = sys.activate();
    expect(result).toEqual({ activated: false, reason: 'not-ready' });
    // Silent defer: no queue, no change to the cooldown timer.
    expect(sys.state()).toBe('cooldown');
    expect(sys.cooldownRemaining()).toBeCloseTo(before);
  });

  it('silently defers activation while already active (no re-trigger)', () => {
    const sys = createSkillSystem(balance());
    sys.equip('timeSlow');
    sys.activate();
    const before = sys.effectRemaining();
    const result = sys.activate();
    expect(result.activated).toBe(false);
    expect(result.reason).toBe('not-ready');
    // Effect timer is not refreshed by the deferred activation.
    expect(sys.effectRemaining()).toBeLessThanOrEqual(before);
  });

  it('reports no-skill when nothing is equipped', () => {
    const sys = createSkillSystem(balance());
    expect(sys.activate()).toEqual({ activated: false, reason: 'no-skill' });
  });
});

describe('createSkillSystem — activation disabled during transition (Req 12.4)', () => {
  it('refuses activation while a transition is in progress', () => {
    const sys = createSkillSystem(balance());
    sys.equip('dash');
    const result = sys.activate({ isTransitioning: true });
    expect(result).toEqual({ activated: false, reason: 'transitioning' });
    expect(sys.state()).toBe('ready'); // unchanged, still ready
  });

  it('allows activation once the transition is over', () => {
    const sys = createSkillSystem(balance());
    sys.equip('dash');
    expect(sys.activate({ isTransitioning: true }).activated).toBe(false);
    expect(sys.activate({ isTransitioning: false }).activated).toBe(true);
    expect(sys.state()).toBe('active');
  });
});

describe('createSkillSystem — timers advance only via tick (Req 7.10–7.12)', () => {
  it('does not advance timers without a tick call (pause-freeze seam)', () => {
    const sys = createSkillSystem(balance());
    sys.equip('timeSlow');
    sys.activate();
    const held = sys.effectRemaining();
    // No tick() calls === the driver is frozen (paused). Timers must hold.
    expect(sys.effectRemaining()).toBe(held);
    expect(sys.state()).toBe('active');
  });

  it('ignores non-positive / non-finite dt', () => {
    const sys = createSkillSystem(balance());
    sys.equip('timeSlow');
    sys.activate();
    const held = sys.effectRemaining();
    sys.tick(0);
    sys.tick(-1);
    sys.tick(Number.NaN);
    sys.tick(Number.POSITIVE_INFINITY);
    expect(sys.effectRemaining()).toBe(held);
  });

  it('freezes when the fixed-step driver is frozen and resumes on unfreeze', () => {
    const b = balance();
    const sys = createSkillSystem(b);
    sys.equip('timeSlow');
    sys.activate();

    const driver = createFixedTimestepDriver({ fixedDeltaS: 1 / 120 });
    const advance = (dt: number) => sys.tick(dt);

    // Run ~1s of real time: timers advance.
    driver.step(1, undefined as never, advance);
    const afterRun = sys.effectRemaining();
    expect(afterRun).toBeLessThan(b.timeSlowDurationS());

    // Freeze (pause): the driver halts, never calling tick → timers hold.
    driver.setFrozen(true);
    driver.step(5, undefined as never, advance);
    expect(sys.effectRemaining()).toBe(afterRun);

    // Unfreeze (resume): continues from the held value.
    driver.setFrozen(false);
    driver.step(0.25, undefined as never, advance);
    expect(sys.effectRemaining()).toBeLessThan(afterRun);
  });
});

describe('createSkillSystem — cooldown scale / HUD snapshot', () => {
  it('applies the injected cooldown scale when entering cooldown (Req 12.5 seam)', () => {
    const b = balance();
    const sys = createSkillSystem(b, { cooldownScale: () => 0.5 });
    sys.equip('dash');
    sys.activate();
    tickPastPhase(sys, b.dashDurationS());
    expect(sys.state()).toBe('cooldown');
    // Cooldown entered at scaled length (12 * 0.5 = 6), minus the sub-step of
    // carryover from the boundary-crossing tick.
    expect(sys.cooldownRemaining()).toBeLessThanOrEqual(b.defaultCooldownS() * 0.5);
    expect(sys.cooldownRemaining()).toBeGreaterThan(b.defaultCooldownS() * 0.5 - 0.1);
  });

  it('ignores a bad cooldown scale (non-positive / non-finite)', () => {
    const b = balance();
    const sys = createSkillSystem(b, { cooldownScale: () => Number.NaN });
    sys.equip('dash');
    sys.activate();
    tickPastPhase(sys, b.dashDurationS());
    expect(sys.state()).toBe('cooldown');
    // Bad scale ignored → full default cooldown (minus a sub-step of carryover).
    expect(sys.cooldownRemaining()).toBeLessThanOrEqual(b.defaultCooldownS());
    expect(sys.cooldownRemaining()).toBeGreaterThan(b.defaultCooldownS() - 0.1);
  });

  it('exposes a HUD snapshot for the run HUD (Req 12.3, 12.7)', () => {
    const b = balance();
    const sys = createSkillSystem(b);
    sys.equip('scoreMultiplier');

    const ready = sys.hudSnapshot();
    expect(ready).toMatchObject({
      id: 'scoreMultiplier',
      state: 'ready',
      available: true,
      cooldownRemaining: 0,
      effectRemaining: 0,
    });

    sys.activate();
    const active = sys.hudSnapshot();
    expect(active?.state).toBe('active');
    expect(active?.available).toBe(false);
    expect(active?.effectRemaining).toBeCloseTo(b.scoreMultiplierDurationS());
    expect(active?.effectDurationS).toBeCloseTo(b.scoreMultiplierDurationS());
  });
});

describe('createSkillSystem — reset', () => {
  it('resets the equipped skill to a fresh ready state', () => {
    const sys = createSkillSystem(balance());
    sys.equip('timeSlow');
    sys.activate();
    sys.reset();
    expect(sys.state()).toBe('ready');
    expect(sys.effectRemaining()).toBe(0);
    expect(sys.cooldownRemaining()).toBe(0);
  });

  it('is a no-op when nothing is equipped', () => {
    const sys = createSkillSystem(balance());
    expect(() => sys.reset()).not.toThrow();
    expect(sys.equipped()).toBeNull();
  });
});

// Keep the SkillId type import exercised so tsc flags a drift if the union
// changes without this test being revisited.
const _allSkillIds: SkillId[] = [
  'secondChance',
  'timeErase',
  'dash',
  'timeSlow',
  'scoreMultiplier',
  'ultraInstinct',
  'nuke',
];
void _allSkillIds;

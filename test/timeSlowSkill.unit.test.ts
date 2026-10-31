// Feature: kino-game
//
// Unit tests for the Time Slow skill effect (task 6.7; design: "Skill effects >
// Time Slow", "The fixed-timestep driver"; Req 16.1). These pin the concrete
// contract: activating Time Slow sets the driver's uniform time scale to
// `balance.timeSlowFactor()`; ending the effect restores the pre-activation
// scale (normally 1.0); and a driver running at the slowed scale advances
// PROPORTIONALLY LESS simulated time — the single, consistent slow that applies
// to Kino and obstacle progression alike because both ride the same fixed ticks
// (Req 16.1). An end-to-end test wires the REAL SkillSystem + REAL driver to
// prove the seam the GameplayScene will use.

import { describe, it, expect } from 'vitest';
import {
  createTimeSlowEffect,
  createFixedTimestepDriver,
  createSkillSystem,
  type TimeScaleHook,
} from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

/** A BalanceTable from documented defaults (timeSlow factor 0.5, duration 5 s). */
function balance() {
  return createBalanceTable();
}

/**
 * A tiny fake time-scale hook that records every scale it is set to. Lets the
 * tests assert exactly what the effect wrote without depending on the full
 * driver surface.
 */
function fakeHook(initial = 1): TimeScaleHook & { scale: number } {
  return {
    scale: initial,
    getTimeScale() {
      return this.scale;
    },
    setTimeScale(next: number) {
      this.scale = next;
    },
  };
}

describe('createTimeSlowEffect — activation sets the slowed scale (Req 16.1)', () => {
  it('onActivate sets the driver time scale to timeSlowFactor()', () => {
    const b = balance();
    const hook = fakeHook(1);
    const effect = createTimeSlowEffect(hook, b);

    effect.onActivate();

    expect(hook.scale).toBeCloseTo(b.timeSlowFactor());
    expect(hook.scale).toBeCloseTo(0.5); // documented default
  });

  it('onEffectEnd restores real time (1.0) after a slow from rest', () => {
    const hook = fakeHook(1);
    const effect = createTimeSlowEffect(hook, balance());

    effect.onActivate();
    expect(hook.scale).toBeLessThan(1);

    effect.onEffectEnd();
    expect(hook.scale).toBe(1);
  });

  it('restores the EXACT pre-activation scale, not a hard-coded 1.0', () => {
    // If some other system had nudged the scale (e.g. 0.8), ending Time Slow
    // returns to that value rather than blindly forcing 1.0.
    const hook = fakeHook(0.8);
    const effect = createTimeSlowEffect(hook, balance());

    effect.onActivate();
    expect(hook.scale).toBeCloseTo(0.5);

    effect.onEffectEnd();
    expect(hook.scale).toBeCloseTo(0.8);
  });
});

describe('createTimeSlowEffect — idempotency / order tolerance', () => {
  it('a stray onEffectEnd with no prior activation is a no-op', () => {
    const hook = fakeHook(1);
    const effect = createTimeSlowEffect(hook, balance());
    effect.onEffectEnd();
    expect(hook.scale).toBe(1);
  });

  it('a double onActivate keeps the original pre-slow scale for restore', () => {
    const hook = fakeHook(1);
    const effect = createTimeSlowEffect(hook, balance());

    effect.onActivate();
    effect.onActivate(); // redundant; must not capture the already-slowed 0.5
    expect(hook.scale).toBeCloseTo(0.5);

    effect.onEffectEnd();
    expect(hook.scale).toBe(1); // restored to the true pre-slow scale
  });

  it('re-activates cleanly after an end', () => {
    const hook = fakeHook(1);
    const effect = createTimeSlowEffect(hook, balance());

    effect.onActivate();
    effect.onEffectEnd();
    effect.onActivate();
    expect(hook.scale).toBeCloseTo(0.5);
    effect.onEffectEnd();
    expect(hook.scale).toBe(1);
  });
});

describe('createTimeSlowEffect — bad balance factor is clamped', () => {
  it('clamps a non-finite / out-of-range factor into a sane slow', () => {
    for (const bad of [Number.NaN, 0, -1, 5, Number.POSITIVE_INFINITY]) {
      const hook = fakeHook(1);
      const effect = createTimeSlowEffect(hook, {
        ...balance(),
        timeSlowFactor: () => bad,
      });
      effect.onActivate();
      // Never freezes the run (0) and never speeds it up (>1).
      expect(hook.scale).toBeGreaterThan(0);
      expect(hook.scale).toBeLessThanOrEqual(1);
    }
  });
});

describe('createTimeSlowEffect — a slowed driver advances proportionally less (Req 16.1)', () => {
  it('simulates ~half the time over the same real delta at factor 0.5', () => {
    const b = balance();
    // Two identical drivers; one gets Time Slow applied. A generous catch-up
    // cap lets a full second of real time resolve into ticks without the
    // spiral-of-death clamp, so the proportional comparison is clean.
    const normal = createFixedTimestepDriver<void>({
      fixedDeltaS: 1 / 120,
      maxCatchUpSteps: 1000,
    });
    const slowed = createFixedTimestepDriver<void>({
      fixedDeltaS: 1 / 120,
      maxCatchUpSteps: 1000,
    });

    const effect = createTimeSlowEffect(slowed, b);
    effect.onActivate();
    expect(slowed.getTimeScale()).toBeCloseTo(0.5);

    // Advance BOTH by the same 1 second of real time.
    const noop = () => {};
    const normalResult = normal.step(1, undefined as never, noop);
    const slowedResult = slowed.step(1, undefined as never, noop);

    // The slowed driver advances about half as much simulated time / ticks —
    // this is the single factor that slows Kino and obstacles together.
    expect(slowedResult.ticks).toBeLessThan(normalResult.ticks);
    expect(slowedResult.simulatedS).toBeCloseTo(normalResult.simulatedS * 0.5, 1);
  });

  it('returns to full-rate progression once the effect ends', () => {
    const b = balance();
    const driver = createFixedTimestepDriver<void>({
      fixedDeltaS: 1 / 120,
      maxCatchUpSteps: 1000,
    });
    const effect = createTimeSlowEffect(driver, b);
    const noop = () => {};

    effect.onActivate();
    effect.onEffectEnd();
    expect(driver.getTimeScale()).toBe(1);

    const full = createFixedTimestepDriver<void>({
      fixedDeltaS: 1 / 120,
      maxCatchUpSteps: 1000,
    });
    const afterEnd = driver.step(1, undefined as never, noop);
    const reference = full.step(1, undefined as never, noop);
    expect(afterEnd.simulatedS).toBeCloseTo(reference.simulatedS);
  });
});

describe('createTimeSlowEffect — end-to-end SkillSystem + driver seam (Req 16.1)', () => {
  it('wires through the SkillSystem activation hooks: slow while active, real time after', () => {
    const b = balance();
    const driver = createFixedTimestepDriver<void>({ fixedDeltaS: 1 / 120 });
    const effect = createTimeSlowEffect(driver, b);

    // This is exactly the attach the GameplayScene will use.
    const skills = createSkillSystem(b, {
      onActivate: (id) => {
        if (id === 'timeSlow') effect.onActivate();
      },
      onEffectEnd: (id) => {
        if (id === 'timeSlow') effect.onEffectEnd();
      },
    });
    skills.equip('timeSlow');

    // The SkillSystem's timers advance off the driver's fixed ticks.
    const advance = (dt: number) => skills.tick(dt);

    expect(driver.getTimeScale()).toBe(1);

    // Activate Time Slow: the driver is now slowed.
    expect(skills.activate().activated).toBe(true);
    expect(skills.isActive()).toBe(true);
    expect(driver.getTimeScale()).toBeCloseTo(b.timeSlowFactor());

    // Run real time until the (simulated) effect window elapses. The effect
    // window is measured in simulated time, so at factor 0.5 it takes about
    // twice the real time to burn the 5 s window — generously over-step.
    let realElapsed = 0;
    while (skills.isActive() && realElapsed < 60) {
      driver.step(0.1, undefined as never, advance);
      realElapsed += 0.1;
    }

    // The effect ended and real-time progression is restored.
    expect(skills.isActive()).toBe(false);
    expect(driver.getTimeScale()).toBe(1);
  });
});

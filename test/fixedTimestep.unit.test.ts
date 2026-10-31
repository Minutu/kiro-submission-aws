// Feature: kino-game
//
// Unit tests for the pure fixed-timestep driver (design: "The fixed-timestep
// driver"; Req 26.2, 26.9, 9.1, 16.1, 7.10 relation). These pin down the
// concrete contract: whole fixed ticks, the default 1/120 s step, uniform
// Time Slow scaling, the frozen/paused halt, and the catch-up spiral guard.

import { describe, it, expect } from 'vitest';
import {
  createFixedTimestepDriver,
  DEFAULT_FIXED_DELTA_S,
  DEFAULT_MAX_CATCH_UP_STEPS,
} from '../src/core/index.ts';

describe('createFixedTimestepDriver', () => {
  it('defaults to a 1/120 s step and the documented catch-up cap', () => {
    const d = createFixedTimestepDriver();
    expect(d.fixedDeltaS).toBeCloseTo(DEFAULT_FIXED_DELTA_S, 12);
    expect(d.fixedDeltaS).toBeCloseTo(1 / 120, 12);
    expect(d.maxCatchUpSteps).toBe(DEFAULT_MAX_CATCH_UP_STEPS);
    expect(d.getTimeScale()).toBe(1);
    expect(d.isFrozen()).toBe(false);
  });

  it('runs exactly one tick when real delta equals the fixed step', () => {
    const d = createFixedTimestepDriver<void>();
    let ticks = 0;
    const r = d.step(1 / 120, undefined, (fixed) => {
      ticks += 1;
      expect(fixed).toBeCloseTo(1 / 120, 12);
    });
    expect(ticks).toBe(1);
    expect(r.ticks).toBe(1);
    expect(r.simulatedS).toBeCloseTo(1 / 120, 12);
  });

  it('runs no tick for a delta smaller than the fixed step and carries remainder', () => {
    const d = createFixedTimestepDriver<void>();
    let ticks = 0;
    const r = d.step(1 / 240, undefined, () => { ticks += 1; });
    expect(ticks).toBe(0);
    expect(r.ticks).toBe(0);
    expect(r.accumulator).toBeCloseTo(1 / 240, 12);
  });

  it('accumulates leftover across frames until a full step is earned', () => {
    const d = createFixedTimestepDriver<void>();
    let ticks = 0;
    const adv = () => { ticks += 1; };
    d.step(1 / 240, undefined, adv); // half a step
    expect(ticks).toBe(0);
    d.step(1 / 240, undefined, adv); // completes the step
    expect(ticks).toBe(1);
    expect(d.getAccumulator()).toBeCloseTo(0, 12);
  });

  it('runs multiple ticks for a large delta within the cap', () => {
    const d = createFixedTimestepDriver<void>();
    let ticks = 0;
    const r = d.step((1 / 120) * 3, undefined, () => { ticks += 1; });
    expect(ticks).toBe(3);
    expect(r.ticks).toBe(3);
    expect(r.clamped).toBe(false);
  });

  it('caps catch-up ticks and drops surplus to avoid the spiral-of-death', () => {
    const d = createFixedTimestepDriver<void>({ maxCatchUpSteps: 3 });
    let ticks = 0;
    // 10 steps' worth of time but the cap is 3.
    const r = d.step((1 / 120) * 10, undefined, () => { ticks += 1; });
    expect(ticks).toBe(3);
    expect(r.ticks).toBe(3);
    expect(r.clamped).toBe(true);
    // Surplus dropped: accumulator stays below one fixed step, so the next
    // frame does not inherit an ever-growing backlog.
    expect(d.getAccumulator()).toBeLessThan(d.fixedDeltaS);
  });

  it('frozen (paused) halts accumulation entirely', () => {
    const d = createFixedTimestepDriver<void>();
    d.step(1 / 240, undefined, () => {}); // leave half a step accumulated
    const before = d.getAccumulator();
    d.setFrozen(true);
    let ticks = 0;
    const r = d.step(1, undefined, () => { ticks += 1; });
    expect(ticks).toBe(0);
    expect(r.ticks).toBe(0);
    // Accumulator is untouched while frozen (Req 7.10 relation).
    expect(d.getAccumulator()).toBeCloseTo(before, 12);
  });

  it('resumes after unfreeze using the preserved accumulator', () => {
    const d = createFixedTimestepDriver<void>();
    d.setFrozen(true);
    d.step(1, undefined, () => {});
    expect(d.getAccumulator()).toBe(0);
    d.setFrozen(false);
    let ticks = 0;
    d.step(1 / 120, undefined, () => { ticks += 1; });
    expect(ticks).toBe(1);
  });

  it('time scale uniformly slows the simulation (Time Slow, Req 16.1)', () => {
    const d = createFixedTimestepDriver<void>();
    d.setTimeScale(0.5);
    let ticks = 0;
    const adv = () => { ticks += 1; };
    // At half speed, one real fixed-step of delta yields only half a tick.
    d.step(1 / 120, undefined, adv);
    expect(ticks).toBe(0);
    // A second identical frame completes the scaled step.
    d.step(1 / 120, undefined, adv);
    expect(ticks).toBe(1);
  });

  it('ignores non-positive and non-finite deltas', () => {
    const d = createFixedTimestepDriver<void>();
    let ticks = 0;
    const adv = () => { ticks += 1; };
    expect(d.step(0, undefined, adv).ticks).toBe(0);
    expect(d.step(-5, undefined, adv).ticks).toBe(0);
    expect(d.step(Number.NaN, undefined, adv).ticks).toBe(0);
    expect(d.step(Number.POSITIVE_INFINITY, undefined, adv).ticks).toBe(0);
    expect(ticks).toBe(0);
    expect(d.getAccumulator()).toBe(0);
  });

  it('negative time scale is clamped to zero (fully slowed)', () => {
    const d = createFixedTimestepDriver<void>();
    d.setTimeScale(-2);
    expect(d.getTimeScale()).toBe(0);
    let ticks = 0;
    d.step(1, undefined, () => { ticks += 1; });
    expect(ticks).toBe(0);
  });

  it('reset clears the accumulator', () => {
    const d = createFixedTimestepDriver<void>();
    d.step(1 / 240, undefined, () => {});
    expect(d.getAccumulator()).toBeGreaterThan(0);
    d.reset();
    expect(d.getAccumulator()).toBe(0);
  });

  it('threads typed inputs through to the advance callback', () => {
    const d = createFixedTimestepDriver<{ jump: boolean }>();
    const seen: Array<{ jump: boolean }> = [];
    d.step((1 / 120) * 2, { jump: true }, (_fixed, inputs) => { seen.push(inputs); });
    expect(seen).toEqual([{ jump: true }, { jump: true }]);
  });

  it('rejects invalid construction options', () => {
    expect(() => createFixedTimestepDriver({ fixedDeltaS: 0 })).toThrow();
    expect(() => createFixedTimestepDriver({ fixedDeltaS: -1 })).toThrow();
    expect(() => createFixedTimestepDriver({ maxCatchUpSteps: 0 })).toThrow();
    expect(() => createFixedTimestepDriver({ maxCatchUpSteps: 1.5 })).toThrow();
  });
});

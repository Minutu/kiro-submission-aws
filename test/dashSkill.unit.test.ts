// Feature: kino-game
//
// Unit tests for the pure Dash effect (design: "Skill effect summary > Dash";
// Req 15.1, 15.3, 15.4, 45.3). These pin the concrete contract of task 6.6:
//   - burst direction is horizontal (+x, vy = 0) for jumping / flight /
//     underwater (Req 15.1, 15.3);
//   - burst runs along the current diagonal for zigzag — up vs down legs
//     (Req 15.4);
//   - total displacement summed over the duration ≈ dashDistancePx;
//   - no contribution outside the active window.

import { describe, it, expect } from 'vitest';
import {
  computeDashBurst,
  dashDisplacement,
  createDashEffect,
  type MovementMode,
} from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

/** A BalanceTable from documented defaults (dash 260px over 0.25s, 30°). */
function balance() {
  return createBalanceTable();
}

const EPS = 1e-6;

/** Sum a burst's displacement across `n` uniform ticks covering `duration`. */
function integrateBurst(
  vx: number,
  vy: number,
  duration: number,
  steps = 1000,
): { dx: number; dy: number } {
  const dt = duration / steps;
  let dx = 0;
  let dy = 0;
  for (let i = 0; i < steps; i += 1) {
    const d = dashDisplacement({ vx, vy }, dt);
    dx += d.dx;
    dy += d.dy;
  }
  return { dx, dy };
}

describe('computeDashBurst — horizontal modes (Req 15.1, 15.3, 45.3)', () => {
  const horizontalModes: MovementMode[] = ['jumping', 'flight', 'underwater'];

  for (const mode of horizontalModes) {
    it(`${mode}: burst is purely horizontal (+x, vy = 0)`, () => {
      const b = createBalanceTable();
      const burst = computeDashBurst(mode, b);
      expect(burst.vx).toBeGreaterThan(0);
      expect(burst.vy).toBe(0);
      // Speed is distance / duration.
      const expectedSpeed = b.dashDistancePx() / b.dashDurationS();
      expect(burst.vx).toBeCloseTo(expectedSpeed, 6);
    });

    it(`${mode}: total horizontal displacement over the duration ≈ dashDistancePx`, () => {
      const b = createBalanceTable();
      const burst = computeDashBurst(mode, b);
      const { dx, dy } = integrateBurst(burst.vx, burst.vy, b.dashDurationS());
      expect(dx).toBeCloseTo(b.dashDistancePx(), 3);
      expect(dy).toBeCloseTo(0, 6);
    });
  }

  it('diagonalDir is ignored for horizontal modes', () => {
    const b = balance();
    const up = computeDashBurst('flight', b, 'up');
    const down = computeDashBurst('flight', b, 'down');
    expect(up).toEqual(down);
    expect(up.vy).toBe(0);
  });
});

describe('computeDashBurst — zigzag along the diagonal (Req 15.4, 45.3)', () => {
  it('down leg: forward +x and downward +vy (y-DOWN)', () => {
    const b = balance();
    const burst = computeDashBurst('zigzag', b, 'down');
    expect(burst.vx).toBeGreaterThan(0);
    expect(burst.vy).toBeGreaterThan(0);
  });

  it('up leg: forward +x and upward -vy (y-DOWN)', () => {
    const b = balance();
    const burst = computeDashBurst('zigzag', b, 'up');
    expect(burst.vx).toBeGreaterThan(0);
    expect(burst.vy).toBeLessThan(0);
  });

  it('up and down legs mirror vertically but share the same forward vx', () => {
    const b = balance();
    const up = computeDashBurst('zigzag', b, 'up');
    const down = computeDashBurst('zigzag', b, 'down');
    expect(up.vx).toBeCloseTo(down.vx, 6);
    expect(up.vy).toBeCloseTo(-down.vy, 6);
  });

  it('decomposes the burst onto the configured angle (vx=cos, vy=±sin)', () => {
    const b = balance();
    const speed = b.dashDistancePx() / b.dashDurationS();
    const angleRad = (b.zigzagAngleDeg() * Math.PI) / 180;
    const burst = computeDashBurst('zigzag', b, 'down');
    expect(burst.vx).toBeCloseTo(speed * Math.cos(angleRad), 6);
    expect(burst.vy).toBeCloseTo(speed * Math.sin(angleRad), 6);
  });

  it('total displacement ALONG the diagonal over the duration ≈ dashDistancePx', () => {
    const b = balance();
    const burst = computeDashBurst('zigzag', b, 'down');
    const { dx, dy } = integrateBurst(burst.vx, burst.vy, b.dashDurationS());
    const alongDiagonal = Math.hypot(dx, dy);
    expect(alongDiagonal).toBeCloseTo(b.dashDistancePx(), 3);
    // It is a genuine diagonal, not a pure horizontal line.
    expect(dy).toBeGreaterThan(EPS);
    expect(dx).toBeGreaterThan(EPS);
  });
});

describe('dashDisplacement — the per-tick integrator', () => {
  it('scales the burst velocity by dt', () => {
    const d = dashDisplacement({ vx: 100, vy: -40 }, 0.5);
    expect(d.dx).toBeCloseTo(50, 6);
    expect(d.dy).toBeCloseTo(-20, 6);
  });

  it('non-positive / non-finite dt produces no movement', () => {
    expect(dashDisplacement({ vx: 100, vy: 50 }, 0)).toEqual({ dx: 0, dy: 0 });
    expect(dashDisplacement({ vx: 100, vy: 50 }, -1)).toEqual({ dx: 0, dy: 0 });
    expect(dashDisplacement({ vx: 100, vy: 50 }, NaN)).toEqual({ dx: 0, dy: 0 });
    expect(dashDisplacement({ vx: 100, vy: 50 }, Infinity)).toEqual({
      dx: 0,
      dy: 0,
    });
  });
});

describe('createDashEffect — active window (Req 15.1)', () => {
  it('contributes no movement before begin (outside the active window)', () => {
    const effect = createDashEffect(balance());
    expect(effect.isActive()).toBe(false);
    expect(effect.step(1 / 120)).toEqual({ dx: 0, dy: 0 });
    expect(effect.burst()).toEqual({ vx: 0, vy: 0 });
  });

  it('moves forward while active for a horizontal mode', () => {
    const b = balance();
    const effect = createDashEffect(b);
    effect.begin('jumping');
    expect(effect.isActive()).toBe(true);
    const d = effect.step(1 / 120);
    expect(d.dx).toBeGreaterThan(0);
    expect(d.dy).toBe(0);
  });

  it('summed steps over the duration ≈ dashDistancePx then zero after end', () => {
    const b = balance();
    const effect = createDashEffect(b);
    effect.begin('flight');

    const steps = 300;
    const dt = b.dashDurationS() / steps;
    let dx = 0;
    for (let i = 0; i < steps; i += 1) {
      dx += effect.step(dt).dx;
    }
    expect(dx).toBeCloseTo(b.dashDistancePx(), 3);

    // Outside the active window: zero contribution (Req 15.1).
    effect.end();
    expect(effect.isActive()).toBe(false);
    expect(effect.step(dt)).toEqual({ dx: 0, dy: 0 });
    expect(effect.burst()).toEqual({ vx: 0, vy: 0 });
  });

  it('captures the zigzag diagonal at begin (up vs down)', () => {
    const b = balance();
    const up = createDashEffect(b);
    up.begin('zigzag', 'up');
    const down = createDashEffect(b);
    down.begin('zigzag', 'down');
    const upStep = up.step(1 / 120);
    const downStep = down.step(1 / 120);
    expect(upStep.dx).toBeGreaterThan(0);
    expect(downStep.dx).toBeGreaterThan(0);
    expect(upStep.dy).toBeLessThan(0);
    expect(downStep.dy).toBeGreaterThan(0);
  });
});

// Feature: kino-game
//
// Dash effect — the pure, mode-dependent horizontal/diagonal burst (design:
// "Skill effect summary > Dash"; Req 15.1, 15.3, 15.4, 45.3).
//
// This module is the CONCRETE effect behind the Dash skill. The SkillSystem
// (src/core/skillSystem.ts) owns the generic ready→active→cooldown lifecycle
// and the `active` window length (`balance.dashDurationS()`); this module owns
// WHAT MOVES while that window is open. Keeping it a separate pure module (not
// a rewrite of skillSystem.ts) lets the other per-skill effect tasks compose
// against the same lifecycle seam without colliding on one shared file.
//
// What Dash does (Req 15.1): on activation it applies a burst that carries Kino
// a configured distance (`balance.dashDistancePx()`, ~260px) over the effect
// duration (`balance.dashDurationS()`, ~0.25s). The DIRECTION of that burst is
// mode-dependent:
//   - Jumping / Flight / Underwater (Req 15.1, 15.3): a straight HORIZONTAL
//     burst — Kino surges forward along +x. This is the sanctioned horizontal
//     exception to the fixed-`screenX` Scrolling_Model (Req 45.3): normally
//     Kino never moves on x, but Dash may displace it forward for the burst.
//   - Zigzag (Req 15.4): a burst ALONG Kino's current diagonal trajectory — the
//     active ±zigzagAngleDeg leg — so the distance is spread across both x and
//     y (the diagonal exception of Req 45.3), not a pure horizontal line.
//
// The burst is modeled as a constant velocity over the active window: distance
// `D` over duration `T` is a speed `D/T` along the burst direction. Callers
// integrate it per tick as `(vx*dt, vy*dt)`; summed across the whole window the
// displacement is exactly `D` along the direction (±rounding). Outside the
// active window the burst contributes nothing — the caller only applies it
// while `SkillSystem.isActive()` for Dash is true.
//
// PURE / deterministic — no Phaser, no randomness, no clock (src/core boundary,
// Req 26.6). A given (mode, diagonal, balance) yields one burst vector.

import type { BalanceTable } from '../config/index.ts';
import type { MovementMode, VerticalDir } from './types.ts';

/**
 * A per-second burst velocity (world px/s) along the Dash direction for the
 * active mode. Integrate as `dx = vx * dt`, `dy = vy * dt` each tick while the
 * Dash effect is `active`; the sum over the active window is the Dash distance
 * along the correct direction. `y` is world-DOWN (matching MovementState), so a
 * zigzag `up` leg has a NEGATIVE `vy`.
 */
export interface DashBurst {
  /** Horizontal burst velocity (px/s). Always ≥ 0 — Dash only moves forward. */
  vx: number;
  /** Vertical burst velocity (px/s, y-DOWN). Non-zero only for zigzag. */
  vy: number;
}

/** A zero burst — the contribution outside the active window. */
const NO_BURST: DashBurst = { vx: 0, vy: 0 };

/**
 * The displacement a {@link DashBurst} produces over `dt` seconds. A thin,
 * explicit integrator so callers (and tests) share one definition of how a
 * burst becomes movement. Non-positive / non-finite `dt` yields no movement.
 */
export interface DashDisplacement {
  dx: number;
  dy: number;
}

/**
 * Compute the constant burst velocity for a Dash activation in `mode`.
 *
 * The burst carries `balance.dashDistancePx()` over `balance.dashDurationS()`,
 * giving a speed of `distance / duration` along the mode's Dash direction:
 *   - jumping / flight / underwater: purely horizontal (+x), `vy = 0`
 *     (Req 15.1, 15.3, 45.3).
 *   - zigzag: along the current ±zigzagAngleDeg diagonal, so the speed splits
 *     into `vx = speed*cos(angle)` and `vy = ±speed*sin(angle)` where the sign
 *     follows `diagonalDir` ('up' → negative vy in the y-DOWN world) (Req 15.4,
 *     45.3). The total distance travelled along the diagonal still equals
 *     `dashDistancePx` because (cos²+sin²)=1.
 *
 * A non-positive / non-finite distance or duration yields a zero burst (the
 * BalanceTable already clamps to documented defaults, so this is just defense
 * in depth). `diagonalDir` is only consulted for zigzag; it defaults to 'down'.
 */
export function computeDashBurst(
  mode: MovementMode,
  balance: BalanceTable,
  diagonalDir: VerticalDir = 'down',
): DashBurst {
  const distance = balance.dashDistancePx();
  const duration = balance.dashDurationS();

  // Guard: without a positive finite distance AND duration there is no burst.
  if (
    !Number.isFinite(distance) ||
    distance <= 0 ||
    !Number.isFinite(duration) ||
    duration <= 0
  ) {
    return NO_BURST;
  }

  // Constant speed that covers `distance` over `duration` along the direction.
  const speed = distance / duration;

  if (mode === 'zigzag') {
    // Along the active diagonal: decompose the speed onto the ±angle leg so the
    // burst follows Kino's current trajectory rather than a pure horizontal
    // line (Req 15.4). Horizontal component is always forward (+x); vertical
    // component's sign follows the leg ('up' → negative vy, y-DOWN).
    const angleRad = (balance.zigzagAngleDeg() * Math.PI) / 180;
    const vx = speed * Math.cos(angleRad);
    const verticalMag = speed * Math.sin(angleRad);
    const vy = diagonalDir === 'up' ? -verticalMag : verticalMag;
    return { vx, vy };
  }

  // Jumping / Flight / Underwater: a straight horizontal-line burst (Req 15.3).
  return { vx: speed, vy: 0 };
}

/**
 * Integrate a {@link DashBurst} over `dt` seconds into a position delta. This
 * is what GameplayScene adds to Kino's position each fixed tick WHILE the Dash
 * effect is active. Non-positive / non-finite `dt` produces no movement.
 */
export function dashDisplacement(burst: DashBurst, dt: number): DashDisplacement {
  if (!Number.isFinite(dt) || dt <= 0) {
    return { dx: 0, dy: 0 };
  }
  return { dx: burst.vx * dt, dy: burst.vy * dt };
}

/**
 * A small stateful helper that tracks a single Dash burst across its active
 * window, for callers that prefer an object over threading the burst vector by
 * hand. Construct it, call {@link DashEffect.begin} on activation (SkillSystem
 * `onActivate` for `'dash'`), call {@link DashEffect.step} each tick with the
 * fixed delta to get the position delta, and {@link DashEffect.end} when the
 * effect ends (SkillSystem `onEffectEnd`). While inactive, `step` returns a
 * zero delta, so applying it unconditionally is safe (the burst only moves Kino
 * during the active window — Req 15.1).
 */
export interface DashEffect {
  /** Begin a burst for `mode` (+ zigzag `diagonalDir`); captures the vector. */
  begin(mode: MovementMode, diagonalDir?: VerticalDir): void;
  /** Position delta for this tick; a zero delta while not active. */
  step(dt: number): DashDisplacement;
  /** End the current burst (back to a zero contribution). */
  end(): void;
  /** True while a burst is in progress. */
  isActive(): boolean;
  /** The current burst vector (zero while not active) — for the render layer. */
  burst(): DashBurst;
}

/**
 * Create a {@link DashEffect} bound to `balance`. Pure/deterministic: the same
 * ordered `begin`/`step`/`end` calls always produce the same deltas.
 */
export function createDashEffect(balance: BalanceTable): DashEffect {
  let active = false;
  let current: DashBurst = NO_BURST;

  return {
    begin(mode: MovementMode, diagonalDir: VerticalDir = 'down'): void {
      current = computeDashBurst(mode, balance, diagonalDir);
      active = true;
    },
    step(dt: number): DashDisplacement {
      if (!active) return { dx: 0, dy: 0 };
      return dashDisplacement(current, dt);
    },
    end(): void {
      active = false;
      current = NO_BURST;
    },
    isActive: () => active,
    burst: () => (active ? current : NO_BURST),
  };
}

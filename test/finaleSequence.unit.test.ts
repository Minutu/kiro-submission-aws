// Feature: kino-game
//
// UNIT tests for the PURE World-5 scripted-finale controller (task 11.2) — the
// deterministic phase machine behind the auto-controlled crawl → run → jump
// finale (Req 8.7-8.15, 45.5). These pin, with NO Phaser:
//   - phases advance DESCEND → CRAWL → RUN → AT_BARRIER in order as accrued
//     distance grows, and JUMPED_THROUGH only via the final jump (Req 8.9-8.15)
//   - jumpEnabled() is false until the barrier, true AT the barrier (Req 8.13-8.14)
//   - isAutoControlled() holds through DESCEND/CRAWL/RUN, drops at the barrier
//     and after the jump (Req 8.9-8.12)
//   - the locomotion frame is a crawl-step during CRAWL and a run-step during
//     RUN via the SHARED selectAnimationFrame + FinalePhase (Req 8.11-8.12/30.13-30.14)
//   - Jumping is unavailable before the barrier — a jump() is rejected (Req 8.6/8.13)
//   - JUMPED_THROUGH reports the finale complete and triggers the ending
//     (FINAL_ENDING_CINEMATIC_ID) (Req 8.15 → 21.8)
//
// Pure TypeScript, no Phaser — matches the Node-only test environment. Plain
// table/sequence unit tests fit (this is NOT one of the 11 numbered correctness
// properties); a couple of fast-check invariants pin determinism + monotonicity.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createFinaleController,
  DEFAULT_FINALE_DISTANCES,
  FINALE_PHASES,
  type FinalePhaseName,
} from '../src/core/finaleSequence.ts';
import { FINAL_ENDING_CINEMATIC_ID } from '../src/core/endingCinematic.ts';
import { DEFAULT_FRAME_DURATION_MS } from '../src/core/animationFrameCycle.ts';

const D = DEFAULT_FINALE_DISTANCES;
// Cumulative phase-start thresholds for the default distances.
const DESCEND_END = D.descendDistance;
const CRAWL_END = DESCEND_END + D.crawlDistance;
const BARRIER_AT = CRAWL_END + D.runDistance;

describe('finale phases advance in order as distance accrues (Req 8.9-8.15)', () => {
  it('starts in DESCEND at distance 0 (Flight disabled, Kino descending — Req 8.7)', () => {
    const c = createFinaleController();
    expect(c.currentPhase()).toBe(FINALE_PHASES.Descend);
    expect(c.distance()).toBe(0);
  });

  it('walks DESCEND → CRAWL → RUN → AT_BARRIER as accrued distance crosses each threshold', () => {
    const c = createFinaleController();

    // DESCEND until the descend distance is covered (Req 8.7).
    expect(c.advance(DESCEND_END - 1)).toBe(FINALE_PHASES.Descend);
    // Reaching the ground begins the CRAWL locomotion (Req 8.10-8.11).
    expect(c.advance(1)).toBe(FINALE_PHASES.Crawl);
    // Still crawling partway through the crawl segment.
    expect(c.advance(D.crawlDistance - 1)).toBe(FINALE_PHASES.Crawl);
    // Crossing the crawl end advances into RUN (Req 8.12).
    expect(c.advance(1)).toBe(FINALE_PHASES.Run);
    // Still running partway through the run segment.
    expect(c.advance(D.runDistance - 1)).toBe(FINALE_PHASES.Run);
    // Reaching the barrier (Req 8.14).
    expect(c.advance(1)).toBe(FINALE_PHASES.AtBarrier);
    // Further distance stays AT_BARRIER — locomotion has stopped (Req 8.14).
    expect(c.advance(10_000)).toBe(FINALE_PHASES.AtBarrier);
  });

  it('phases are the pure function of accrued distance (independent query)', () => {
    const at = (d: number): FinalePhaseName => {
      const c = createFinaleController();
      c.advance(d);
      return c.currentPhase();
    };
    expect(at(0)).toBe(FINALE_PHASES.Descend);
    expect(at(DESCEND_END - 0.001)).toBe(FINALE_PHASES.Descend);
    expect(at(DESCEND_END)).toBe(FINALE_PHASES.Crawl);
    expect(at(CRAWL_END - 0.001)).toBe(FINALE_PHASES.Crawl);
    expect(at(CRAWL_END)).toBe(FINALE_PHASES.Run);
    expect(at(BARRIER_AT - 0.001)).toBe(FINALE_PHASES.Run);
    expect(at(BARRIER_AT)).toBe(FINALE_PHASES.AtBarrier);
    expect(at(BARRIER_AT + 5_000)).toBe(FINALE_PHASES.AtBarrier);
  });

  it('distance never moves backward; negative/non-finite deltas are treated as 0', () => {
    const c = createFinaleController();
    c.advance(100);
    expect(c.distance()).toBe(100);
    c.advance(-50);
    expect(c.distance()).toBe(100);
    c.advance(Number.NaN);
    expect(c.distance()).toBe(100);
    c.advance(Number.POSITIVE_INFINITY);
    expect(c.distance()).toBe(100);
  });
});

describe('jump availability — unavailable until the barrier (Req 8.13-8.14)', () => {
  it('jumpEnabled() is false through DESCEND/CRAWL/RUN and true AT the barrier', () => {
    const c = createFinaleController();
    expect(c.jumpEnabled()).toBe(false); // descend
    c.advance(DESCEND_END);
    expect(c.jumpEnabled()).toBe(false); // crawl
    c.advance(D.crawlDistance);
    expect(c.jumpEnabled()).toBe(false); // run
    c.advance(D.runDistance);
    expect(c.jumpEnabled()).toBe(true); // at barrier (Req 8.14)
  });

  it('rejects a jump() before the barrier (Jumping unavailable — Req 8.6/8.13)', () => {
    const c = createFinaleController();
    // During DESCEND.
    expect(c.jump()).toBe(false);
    expect(c.currentPhase()).toBe(FINALE_PHASES.Descend);
    // During CRAWL.
    c.advance(DESCEND_END);
    expect(c.jump()).toBe(false);
    expect(c.currentPhase()).toBe(FINALE_PHASES.Crawl);
    // During RUN.
    c.advance(D.crawlDistance);
    expect(c.jump()).toBe(false);
    expect(c.currentPhase()).toBe(FINALE_PHASES.Run);
    // Still not complete, no ending triggered yet.
    expect(c.isComplete()).toBe(false);
    expect(c.endingCinematicId()).toBeUndefined();
  });
});

describe('automatic control (Req 8.9-8.12)', () => {
  it('isAutoControlled() holds through DESCEND/CRAWL/RUN and drops at the barrier', () => {
    const c = createFinaleController();
    expect(c.isAutoControlled()).toBe(true); // descend
    c.advance(DESCEND_END);
    expect(c.isAutoControlled()).toBe(true); // crawl
    c.advance(D.crawlDistance);
    expect(c.isAutoControlled()).toBe(true); // run
    c.advance(D.runDistance);
    expect(c.isAutoControlled()).toBe(false); // at barrier — only action is the jump
  });

  it('automatic control is off after jumping through (control is the cinematic’s)', () => {
    const c = createFinaleController();
    c.advance(BARRIER_AT);
    expect(c.jump()).toBe(true);
    expect(c.isAutoControlled()).toBe(false);
  });
});

describe('locomotion frames — crawl-step during CRAWL, run-step during RUN (Req 8.11-8.12/30.13-30.14)', () => {
  it('exposes the crawl locomotion phase + a crawl-step frame during CRAWL', () => {
    const c = createFinaleController();
    c.advance(DESCEND_END); // enter CRAWL
    expect(c.locomotionPhase()).toBe('crawl');
    // The two-frame crawl cycle alternates crawl-step-right <-> crawl-step-left.
    expect(c.locomotionFrame({ frameTick: 0 })).toBe('crawl-step-right');
    expect(c.locomotionFrame({ frameTick: 1 })).toBe('crawl-step-left');
    // Time-driven cadence agrees with the shared default duration.
    expect(c.locomotionFrame({ elapsedMs: 0 })).toBe('crawl-step-right');
    expect(c.locomotionFrame({ elapsedMs: DEFAULT_FRAME_DURATION_MS })).toBe('crawl-step-left');
  });

  it('exposes the run locomotion phase + a run-step frame during RUN', () => {
    const c = createFinaleController();
    c.advance(CRAWL_END); // enter RUN
    expect(c.locomotionPhase()).toBe('run');
    expect(c.locomotionFrame({ frameTick: 0 })).toBe('run-step-right');
    expect(c.locomotionFrame({ frameTick: 1 })).toBe('run-step-left');
  });

  it('has no restricted locomotion during DESCEND / AT_BARRIER / JUMPED_THROUGH', () => {
    const c = createFinaleController();
    // DESCEND.
    expect(c.locomotionPhase()).toBeUndefined();
    expect(c.locomotionFrame({ frameTick: 0 })).toBeUndefined();
    // AT_BARRIER.
    c.advance(BARRIER_AT);
    expect(c.locomotionPhase()).toBeUndefined();
    expect(c.locomotionFrame({ frameTick: 0 })).toBeUndefined();
    // JUMPED_THROUGH.
    c.jump();
    expect(c.locomotionPhase()).toBeUndefined();
    expect(c.locomotionFrame({ frameTick: 0 })).toBeUndefined();
  });
});

describe('final jump through the barrier → ending (Req 8.15 → 21.8)', () => {
  it('jump() at the barrier latches JUMPED_THROUGH and reports the finale complete', () => {
    const c = createFinaleController();
    c.advance(BARRIER_AT);
    expect(c.currentPhase()).toBe(FINALE_PHASES.AtBarrier);
    expect(c.isComplete()).toBe(false);

    expect(c.jump()).toBe(true);
    expect(c.currentPhase()).toBe(FINALE_PHASES.JumpedThrough);
    expect(c.isComplete()).toBe(true);
  });

  it('triggers the FINAL ending cinematic on completion (FINAL_ENDING_CINEMATIC_ID)', () => {
    const c = createFinaleController();
    expect(c.endingCinematicId()).toBeUndefined();
    c.advance(BARRIER_AT);
    c.jump();
    expect(c.endingCinematicId()).toBe(FINAL_ENDING_CINEMATIC_ID);
    // Jump is consumed: no longer "enabled", and a second jump is a no-op.
    expect(c.jumpEnabled()).toBe(false);
    expect(c.jump()).toBe(false);
    expect(c.currentPhase()).toBe(FINALE_PHASES.JumpedThrough);
  });

  it('advance() is a no-op once JUMPED_THROUGH is latched', () => {
    const c = createFinaleController();
    c.advance(BARRIER_AT);
    c.jump();
    const d = c.distance();
    expect(c.advance(5_000)).toBe(FINALE_PHASES.JumpedThrough);
    expect(c.distance()).toBe(d);
  });
});

describe('config overrides + robustness', () => {
  it('respects custom phase distances', () => {
    const c = createFinaleController({
      distances: { descendDistance: 10, crawlDistance: 20, runDistance: 30 },
    });
    expect(c.advance(9)).toBe(FINALE_PHASES.Descend);
    expect(c.advance(1)).toBe(FINALE_PHASES.Crawl); // 10
    expect(c.advance(20)).toBe(FINALE_PHASES.Run); // 30
    expect(c.advance(30)).toBe(FINALE_PHASES.AtBarrier); // 60
  });

  it('clamps negative configured distances to 0 (stays total + monotonic)', () => {
    const c = createFinaleController({
      distances: {
        descendDistance: -100, // negative -> 0
        crawlDistance: 0, // collapse crawl
        runDistance: 5,
      },
    });
    // descend+crawl collapse to 0, so distance 0 is already AT the run start;
    // the first positive step past 0 reaches the barrier at runDistance=5.
    expect(c.currentPhase()).toBe(FINALE_PHASES.Run);
    expect(c.advance(5)).toBe(FINALE_PHASES.AtBarrier);
  });

  it('falls back to the default distance for a non-finite configured value', () => {
    const c = createFinaleController({
      distances: {
        descendDistance: Number.NaN, // non-finite -> default descendDistance
      },
    });
    // NaN descend falls back to the default descend distance, so distance 0 is
    // still DESCEND and the default descend threshold still applies.
    expect(c.currentPhase()).toBe(FINALE_PHASES.Descend);
    expect(c.advance(DEFAULT_FINALE_DISTANCES.descendDistance)).toBe(
      FINALE_PHASES.Crawl,
    );
  });
});

describe('determinism properties (deterministic, Phaser-free)', () => {
  it('currentPhase is monotonic along accrued distance (never regresses)', () => {
    const order: Record<FinalePhaseName, number> = {
      descend: 0,
      crawl: 1,
      run: 2,
      'at-barrier': 3,
      'jumped-through': 4,
    };
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 500, noNaN: true }), { maxLength: 40 }),
        (deltas) => {
          const c = createFinaleController();
          let prev = order[c.currentPhase()];
          for (const delta of deltas) {
            const rank = order[c.advance(delta)];
            if (rank < prev) return false; // regressed — not allowed
            prev = rank;
          }
          return true;
        },
      ),
    );
  });

  it('two controllers fed the same deltas agree on every query (deterministic)', () => {
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 400, noNaN: true }), { maxLength: 30 }),
        (deltas) => {
          const a = createFinaleController();
          const b = createFinaleController();
          for (const delta of deltas) {
            a.advance(delta);
            b.advance(delta);
          }
          return (
            a.currentPhase() === b.currentPhase() &&
            a.distance() === b.distance() &&
            a.jumpEnabled() === b.jumpEnabled() &&
            a.isAutoControlled() === b.isAutoControlled() &&
            a.locomotionPhase() === b.locomotionPhase()
          );
        },
      ),
    );
  });
});

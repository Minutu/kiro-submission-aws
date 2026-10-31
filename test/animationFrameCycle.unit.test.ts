// Feature: kino-game
//
// UNIT tests for the PURE Animation_Frame cycle (task 8.3) — the frame-selection
// state machine behind KinoRenderer's per-mode animation (Req 30.4-30.5,
// 30.7-30.15). These pin "which frame when" with no Phaser:
//   - jumping grounded walk alternation (Req 30.13)
//   - jumping airborne jump arc by vertical velocity (Req 30.4 analogue)
//   - flight up/apex/down by vertical velocity (Req 30.4, 30.8)
//   - underwater reuses the flight frame set and logic (Req 30.9)
//   - zigzag alternation by diagonal leg direction (Req 30.10)
//   - spin cycle overriding the mode while transitioning (Req 30.11, 30.15)
//   - World-5 finale crawl cycle then run cycle (Req 30.12, 30.14, 30.15)
//
// Pure TypeScript, no Phaser — matches the Node-only test environment. Plain
// table-driven unit tests are the right fit here (this task is NOT one of the 11
// numbered correctness properties); one fast-check invariant pins the walk-cycle
// alternation cadence for good measure.

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import type { MovementMode } from '../src/core/types.ts';
import {
  selectAnimationFrame,
  DEFAULT_FRAME_DURATION_MS,
  type FinalePhase,
} from '../src/core/animationFrameCycle.ts';
import { MODE_FRAMES } from '../src/core/animationFrames.ts';

const D = DEFAULT_FRAME_DURATION_MS;

describe('jumping — grounded ground walk cycle (Req 30.13)', () => {
  it('alternates run-step-right <-> run-step-left over time', () => {
    const base = { mode: 'jumping' as const, grounded: true };
    // step 0 -> right, step 1 -> left, step 2 -> right, ...
    expect(selectAnimationFrame({ ...base, elapsedMs: 0 })).toBe('run-step-right');
    expect(selectAnimationFrame({ ...base, elapsedMs: D * 0.5 })).toBe('run-step-right');
    expect(selectAnimationFrame({ ...base, elapsedMs: D })).toBe('run-step-left');
    expect(selectAnimationFrame({ ...base, elapsedMs: D * 2 })).toBe('run-step-right');
    expect(selectAnimationFrame({ ...base, elapsedMs: D * 3 })).toBe('run-step-left');
  });

  it('accepts an explicit frameTick as the cadence source', () => {
    const base = { mode: 'jumping' as const, grounded: true };
    expect(selectAnimationFrame({ ...base, frameTick: 0 })).toBe('run-step-right');
    expect(selectAnimationFrame({ ...base, frameTick: 1 })).toBe('run-step-left');
    expect(selectAnimationFrame({ ...base, frameTick: 4 })).toBe('run-step-right');
  });

  it('defaults grounded=true for jumping when not specified (rests on walk cycle)', () => {
    expect(selectAnimationFrame({ mode: 'jumping', elapsedMs: 0 })).toBe('run-step-right');
  });

  it('cadence alternation is deterministic and 2-periodic (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 100000 }), fc.integer({ min: 1, max: 500 }), (ms, dur) => {
        const a = selectAnimationFrame({ mode: 'jumping', grounded: true, elapsedMs: ms, frameDurationMs: dur });
        const b = selectAnimationFrame({ mode: 'jumping', grounded: true, elapsedMs: ms + 2 * dur, frameDurationMs: dur });
        // Two frame-durations later we are back to the same leg of the cycle.
        return a === b && (a === 'run-step-right' || a === 'run-step-left');
      }),
    );
  });
});

describe('jumping — airborne jump arc by vertical velocity (Req 30.4 analogue)', () => {
  const base = { mode: 'jumping' as const, grounded: false };
  it('rising (vy < 0) -> jump-go-up', () => {
    expect(selectAnimationFrame({ ...base, verticalVelocity: -200 })).toBe('jump-go-up');
  });
  it('level (vy ~ 0) -> jump-apex', () => {
    expect(selectAnimationFrame({ ...base, verticalVelocity: 0 })).toBe('jump-apex');
  });
  it('falling (vy > 0) -> jump-go-down', () => {
    expect(selectAnimationFrame({ ...base, verticalVelocity: 200 })).toBe('jump-go-down');
  });
  it('airborne arc ignores the clock (velocity, not time, drives it)', () => {
    const up1 = selectAnimationFrame({ ...base, verticalVelocity: -50, elapsedMs: 0 });
    const up2 = selectAnimationFrame({ ...base, verticalVelocity: -50, elapsedMs: D * 7 });
    expect(up1).toBe('jump-go-up');
    expect(up2).toBe('jump-go-up');
  });
});

describe('flight — up/apex/down by vertical velocity (Req 30.4, 30.8)', () => {
  const base = { mode: 'flight' as const };
  it('rising -> fly-up, level -> fly-apex, falling -> fly-down', () => {
    expect(selectAnimationFrame({ ...base, verticalVelocity: -1 })).toBe('fly-up');
    expect(selectAnimationFrame({ ...base, verticalVelocity: 0 })).toBe('fly-apex');
    expect(selectAnimationFrame({ ...base, verticalVelocity: 1 })).toBe('fly-down');
  });
  it('defaults to fly-apex when no velocity is supplied', () => {
    expect(selectAnimationFrame({ mode: 'flight' })).toBe('fly-apex');
  });
});

describe('underwater — REUSES the flight frame set and logic (Req 30.9)', () => {
  it('produces the exact same frame as flight for every velocity sign', () => {
    for (const vy of [-300, -1, 0, 1, 300]) {
      expect(selectAnimationFrame({ mode: 'underwater', verticalVelocity: vy })).toBe(
        selectAnimationFrame({ mode: 'flight', verticalVelocity: vy }),
      );
    }
  });
  it('only ever emits frames from the flight frame set', () => {
    const flightSet = new Set(MODE_FRAMES.flight);
    for (const vy of [-300, -1, 0, 1, 300]) {
      expect(flightSet.has(selectAnimationFrame({ mode: 'underwater', verticalVelocity: vy }))).toBe(true);
    }
  });
});

describe('zigzag — alternation by diagonal leg direction (Req 30.10)', () => {
  it('up leg -> zigzag-up, down leg -> zigzag-down', () => {
    expect(selectAnimationFrame({ mode: 'zigzag', zigzagDirection: 'up' })).toBe('zigzag-up');
    expect(selectAnimationFrame({ mode: 'zigzag', zigzagDirection: 'down' })).toBe('zigzag-down');
  });
  it('defaults to the up leg when direction is omitted', () => {
    expect(selectAnimationFrame({ mode: 'zigzag' })).toBe('zigzag-up');
  });
});

describe('transition spin cue — overrides the mode while active (Req 30.11, 30.15)', () => {
  it('alternates spin-1 <-> spin-2 over time', () => {
    const base = { mode: 'flight' as const, transitionActive: true };
    expect(selectAnimationFrame({ ...base, elapsedMs: 0 })).toBe('spin-1');
    expect(selectAnimationFrame({ ...base, elapsedMs: D })).toBe('spin-2');
    expect(selectAnimationFrame({ ...base, elapsedMs: D * 2 })).toBe('spin-1');
  });
  it('overrides the underlying mode frame regardless of mode/velocity', () => {
    // Even with flight velocity that would otherwise pick fly-up, the spin wins.
    expect(
      selectAnimationFrame({ mode: 'flight', transitionActive: true, verticalVelocity: -500, elapsedMs: 0 }),
    ).toBe('spin-1');
    expect(
      selectAnimationFrame({ mode: 'zigzag', transitionActive: true, zigzagDirection: 'down', elapsedMs: D }),
    ).toBe('spin-2');
  });
});

describe('World-5 finale — crawl cycle then run cycle (Req 30.12, 30.14, 30.15)', () => {
  it('crawl phase alternates crawl-step-right <-> crawl-step-left', () => {
    const base = { mode: 'jumping' as const, finalePhase: 'crawl' as FinalePhase };
    expect(selectAnimationFrame({ ...base, elapsedMs: 0 })).toBe('crawl-step-right');
    expect(selectAnimationFrame({ ...base, elapsedMs: D })).toBe('crawl-step-left');
    expect(selectAnimationFrame({ ...base, elapsedMs: D * 2 })).toBe('crawl-step-right');
  });
  it('run phase alternates run-step-right <-> run-step-left', () => {
    const base = { mode: 'jumping' as const, finalePhase: 'run' as FinalePhase };
    expect(selectAnimationFrame({ ...base, elapsedMs: 0 })).toBe('run-step-right');
    expect(selectAnimationFrame({ ...base, elapsedMs: D })).toBe('run-step-left');
  });
  it('finale locomotion overrides the normal grounded walk/jump arc', () => {
    // finalePhase present => crawl frames even though grounded/airborne flags set.
    expect(
      selectAnimationFrame({ mode: 'jumping', grounded: false, verticalVelocity: -300, finalePhase: 'crawl', elapsedMs: 0 }),
    ).toBe('crawl-step-right');
  });
  it('a transition still wins over the finale phase (spin has top priority)', () => {
    expect(
      selectAnimationFrame({ mode: 'jumping', finalePhase: 'run', transitionActive: true, elapsedMs: 0 }),
    ).toBe('spin-1');
  });
});

describe('totality — every normal pose resolves to a legal frame for its mode', () => {
  const MODES: MovementMode[] = ['jumping', 'flight', 'zigzag', 'underwater'];
  it('with no overrides, the selected frame belongs to the mode frame set', () => {
    for (const mode of MODES) {
      const legal = new Set(MODE_FRAMES[mode]);
      for (const vy of [-100, 0, 100]) {
        for (const dir of ['up', 'down'] as const) {
          for (const grounded of [true, false]) {
            const frame = selectAnimationFrame({
              mode,
              verticalVelocity: vy,
              zigzagDirection: dir,
              grounded,
              elapsedMs: 0,
            });
            expect(legal.has(frame)).toBe(true);
          }
        }
      }
    }
  });

  it('handles non-finite / negative time inputs without throwing (step clamps to 0)', () => {
    expect(() =>
      selectAnimationFrame({ mode: 'jumping', grounded: true, elapsedMs: Number.NaN }),
    ).not.toThrow();
    expect(selectAnimationFrame({ mode: 'jumping', grounded: true, elapsedMs: -999 })).toBe('run-step-right');
    expect(selectAnimationFrame({ mode: 'jumping', grounded: true, frameDurationMs: 0, elapsedMs: 0 })).toBe('run-step-right');
  });
});

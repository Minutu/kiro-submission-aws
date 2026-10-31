// Feature: kino-game
//
// UNIT tests for the SequenceDirector (task 5.4). Exercises the PURE
// composition + transition-scheduling contract:
//
//   • Composition / looping: World 3 cycles Flight→Zigzag→Flight… ; World 4
//     chains Flight, Zigzag, Underwater (water-gated) with NO Jumping.
//   • Telegraph at leadPx (Req 6.3): the TransitionTelegraph fires exactly once
//     when the remaining distance to the next boundary first drops below
//     `balance.telegraphLeadPx`.
//   • Transition-active flags (Req 6.4-6.6): while transitioning, skills are
//     disabled, cosmetic layers hidden, and the transition animation has render
//     priority.
//   • Water-surface gating (Req 5.9, 6.9-6.11): a Flight↔Underwater boundary
//     holds the current mode until `ctx.waterSurfaceCrossed` fires, then swaps.
//
// Pure TypeScript, no Phaser. Uses the documented default BalanceTable
// (telegraphLeadPx == 500) and explicit per-Sequence boundary distances so the
// scroll arithmetic is exact and deterministic.

import { describe, it, expect } from 'vitest';
import {
  createSequenceDirector,
  createMovementStateMachine,
  composeWorld3SequencePlan,
  composeWorld4SequencePlan,
  realizeSequence,
  type MovementMode,
  type SequenceSpec,
} from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

const balance = createBalanceTable(); // documented defaults; telegraphLeadPx == 500
const LEAD = balance.telegraphLeadPx();

describe('SequenceDirector — composition & looping', () => {
  it('composes World 3 as Flight→Zigzag that loops back to Flight', () => {
    const plan = composeWorld3SequencePlan();
    expect(plan.map((s) => s.mode)).toEqual(['flight', 'zigzag']);

    const dir = createSequenceDirector(plan, balance, {
      defaultBoundaryPx: 1000,
    });
    expect(dir.currentMode()).toBe('flight');

    // Cross the first boundary: Flight → Zigzag.
    dir.tick(1000);
    expect(dir.currentMode()).toBe('zigzag');

    // Cross the looping boundary: Zigzag → back to Flight (Req 4.7).
    dir.tick(1000);
    expect(dir.currentMode()).toBe('flight');

    // And again — it keeps alternating.
    dir.tick(1000);
    expect(dir.currentMode()).toBe('zigzag');
  });

  it('composes World 4 as Flight, Zigzag, Underwater chained with no Jumping', () => {
    const plan = composeWorld4SequencePlan();
    const modes = plan.map((s) => s.mode);
    expect(modes).not.toContain('jumping'); // Req 5.8
    expect(modes).toContain('flight');
    expect(modes).toContain('zigzag');
    expect(modes).toContain('underwater');
  });

  it('realizeSequence applies isFinale/loops defaults', () => {
    expect(realizeSequence({ mode: 'flight' })).toEqual({
      mode: 'flight',
      isFinale: false,
      loops: false,
    });
    expect(realizeSequence({ mode: 'zigzag', loops: true })).toEqual({
      mode: 'zigzag',
      isFinale: false,
      loops: true,
    });
  });
});

describe('SequenceDirector — telegraph at leadPx (Req 6.3)', () => {
  // Flight → Zigzag boundary at 2000px; lead == 500 so the cue should fire the
  // first step that pushes remaining distance below 500 (i.e. past 1500px).
  const plan: SequenceSpec[] = [{ mode: 'flight' }, { mode: 'zigzag' }];

  it('emits no telegraph while remaining distance exceeds leadPx', () => {
    const dir = createSequenceDirector(plan, balance, {
      defaultBoundaryPx: 2000,
    });
    // Travel to exactly the lead threshold boundary minus one: remaining == 501.
    const r = dir.tick(2000 - LEAD - 1); // scrolled 1499, remaining 501
    expect(r).toBeNull();
    expect(dir.isTransitioning()).toBe(false);
  });

  it('emits exactly one telegraph when remaining first drops below leadPx', () => {
    const dir = createSequenceDirector(plan, balance, {
      defaultBoundaryPx: 2000,
    });
    dir.tick(2000 - LEAD - 1); // remaining 501, no cue yet
    const cue = dir.tick(2); // scrolled 1501, remaining 499 < 500 -> telegraph
    expect(cue).not.toBeNull();
    expect(cue?.type).toBe('telegraph');
    if (cue && cue.type === 'telegraph') {
      expect(cue.from).toBe('flight');
      expect(cue.to).toBe('zigzag');
      expect(cue.waterGated).toBe(false);
      expect(cue.leadPx).toBeCloseTo(499);
    }
    expect(dir.isTransitioning()).toBe(true);

    // The cue fires exactly once — a subsequent sub-boundary step is silent.
    const again = dir.tick(10);
    expect(again).toBeNull();
  });
});

describe('SequenceDirector — transition-active disables skills & hides cosmetics (Req 6.4-6.6)', () => {
  const plan: SequenceSpec[] = [{ mode: 'flight' }, { mode: 'zigzag' }];

  it('flags skills disabled, cosmetics hidden, render priority while transitioning', () => {
    const dir = createSequenceDirector(plan, balance, {
      defaultBoundaryPx: 2000,
    });
    // Before the telegraph window: everything on, nothing hidden.
    dir.tick(1000);
    expect(dir.skillsDisabled()).toBe(false);
    expect(dir.cosmeticsHidden()).toBe(false);
    expect(dir.transitionHasRenderPriority()).toBe(false);

    // Enter the telegraph window.
    dir.tick(600); // scrolled 1600, remaining 400 < 500
    expect(dir.isTransitioning()).toBe(true);
    expect(dir.skillsDisabled()).toBe(true); // Req 6.4
    expect(dir.cosmeticsHidden()).toBe(true); // Req 6.5
    expect(dir.transitionHasRenderPriority()).toBe(true); // Req 6.6

    // After the boundary swap resolves, the window closes.
    dir.tick(600); // scrolled 2200 -> swap
    expect(dir.currentMode()).toBe('zigzag');
    expect(dir.isTransitioning()).toBe(false);
    expect(dir.skillsDisabled()).toBe(false);
  });
});

describe('SequenceDirector — water-surface gating (Req 5.9, 6.9-6.11)', () => {
  // Flight → Underwater boundary. The swap must wait for the crossing event.
  const plan: SequenceSpec[] = [{ mode: 'flight' }, { mode: 'underwater' }];

  it('keeps the current mode at the boundary WITHOUT the crossing event', () => {
    const machine = createMovementStateMachine(balance, { mode: 'flight' });
    const dir = createSequenceDirector(plan, balance, {
      machine,
      defaultBoundaryPx: 1000,
    });

    // Reach and pass the boundary with NO crossing event: no transition.
    const r = dir.tick(1000, { waterSurfaceCrossed: false });
    expect(r).toBeNull();
    expect(dir.currentMode()).toBe('flight'); // held
    expect(machine.active()).toBe('flight');
    // Still armed (transitioning) while waiting for the surface.
    expect(dir.isTransitioning()).toBe(true);

    // Another step past the boundary, still no event: still held.
    const r2 = dir.tick(50, { waterSurfaceCrossed: false });
    expect(r2).toBeNull();
    expect(dir.currentMode()).toBe('flight');
  });

  it('performs the swap on the step the crossing event fires', () => {
    const machine = createMovementStateMachine(balance, { mode: 'flight' });
    const dir = createSequenceDirector(plan, balance, {
      machine,
      defaultBoundaryPx: 1000,
    });

    dir.tick(1000, { waterSurfaceCrossed: false }); // at boundary, held
    expect(dir.currentMode()).toBe('flight');

    const evt = dir.tick(10, { waterSurfaceCrossed: true }); // crossing fires
    expect(evt).not.toBeNull();
    expect(evt?.type).toBe('transition');
    if (evt && evt.type === 'transition') {
      expect(evt.from).toBe('flight');
      expect(evt.to).toBe('underwater');
      expect(evt.waterGated).toBe(true);
    }
    expect(dir.currentMode()).toBe('underwater');
    expect(machine.active()).toBe('underwater');
    expect(dir.isTransitioning()).toBe(false);
  });

  it('requestTransition refuses a water-gated swap without the crossing event', () => {
    const machine = createMovementStateMachine(balance, { mode: 'flight' });
    const dir = createSequenceDirector(plan, balance, { machine });

    expect(dir.requestTransition('underwater', { waterSurfaceCrossed: false })).toBe(
      false,
    );
    expect(dir.currentMode()).toBe('flight');

    expect(dir.requestTransition('underwater', { waterSurfaceCrossed: true })).toBe(
      true,
    );
    expect(dir.currentMode()).toBe('underwater');
    expect(machine.active()).toBe('underwater');
  });

  it('a non-water boundary (Flight→Zigzag) swaps at the boundary with no event', () => {
    const plan2: SequenceSpec[] = [{ mode: 'flight' }, { mode: 'zigzag' }];
    const machine = createMovementStateMachine(balance, { mode: 'flight' });
    const dir = createSequenceDirector(plan2, balance, {
      machine,
      defaultBoundaryPx: 1000,
    });
    const evt = dir.tick(1000); // no ctx needed for non-water pairs
    expect(evt).not.toBeNull();
    expect(dir.currentMode()).toBe('zigzag');
    expect(machine.active()).toBe('zigzag');
  });
});

describe('SequenceDirector — guards', () => {
  it('rejects an empty sequence plan', () => {
    expect(() => createSequenceDirector([], balance)).toThrow();
  });

  it('ignores non-positive / non-finite scroll deltas', () => {
    const dir = createSequenceDirector([{ mode: 'flight' }, { mode: 'zigzag' }], balance, {
      defaultBoundaryPx: 1000,
    });
    expect(dir.tick(-5 as number)).toBeNull();
    expect(dir.tick(Number.NaN)).toBeNull();
    expect(dir.currentMode()).toBe('flight');
  });

  it('a terminal non-looping Sequence just accrues scroll with no events', () => {
    const dir = createSequenceDirector([{ mode: 'flight' }], balance, {
      defaultBoundaryPx: 1000,
    });
    expect(dir.tick(5000)).toBeNull();
    expect(dir.currentMode()).toBe('flight');
    expect(dir.isTransitioning()).toBe(false);
  });
});

// Keep the MovementMode import meaningful for readers scanning the plan modes.
const _assertMode: MovementMode = 'flight';
void _assertMode;

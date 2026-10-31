// Feature: kino-game
//
// UNIT tests for the World5Plan composition (task 11.1). Exercises the PURE
// World 5 (Security Citadel) STORY `sequencePlan` composer + its structural
// validator against the Req 8.2-8.6/8.8 guarantees:
//
//   • The plan chains ONLY Flight / Zigzag / Underwater before the finale —
//     NO Jumping in the pre-finale chain (Req 8.6).
//   • Exactly one mode is active per pre-finale Sequence (Req 8.4-8.5): each
//     SequenceSpec lists a single mode.
//   • The Sequence IMMEDIATELY before the finale is Flight (Req 8.2-8.3).
//   • The plan ENDS on a single scripted finale Sequence (`isFinale: true`,
//     Req 8.8) — the terminal boundary task 11.2 hooks into; Jumping appears
//     ONLY on that finale spec (Req 8.6).
//   • The validator passes for the real plan and FLAGS a Jumping-containing or
//     non-Flight-terminal plan.
//   • Fed into createSequenceDirector, every scheduled pre-finale mode is in
//     {flight, zigzag, underwater}.
//
// Pure TypeScript, no Phaser.

import { describe, it, expect } from 'vitest';
import {
  buildWorld5SequencePlan,
  validateWorld5Plan,
  isValidWorld5Plan,
  world5FinaleIndex,
  WORLD5_PREFINALE_MODES,
  WORLD5_FINALE_MODE,
  createSequenceDirector,
  realizeSequence,
  type MovementMode,
  type SequenceSpec,
  type World5PlanViolation,
} from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

const balance = createBalanceTable();

/** The three abilities combined in the World 5 pre-finale chain. */
const PREFINALE: ReadonlySet<MovementMode> = new Set([
  'flight',
  'zigzag',
  'underwater',
]);

describe('buildWorld5SequencePlan — composition (Req 8.1-8.6)', () => {
  const plan = buildWorld5SequencePlan();

  it('chains only Flight / Zigzag / Underwater before the finale — NO Jumping (Req 8.6)', () => {
    const finaleIdx = world5FinaleIndex(plan);
    expect(finaleIdx).toBeGreaterThanOrEqual(0);
    const prefinale = plan.slice(0, finaleIdx);
    expect(prefinale.length).toBeGreaterThan(0);
    for (const spec of prefinale) {
      expect(PREFINALE.has(spec.mode)).toBe(true);
      expect(spec.mode).not.toBe('jumping'); // Req 8.6
    }
  });

  it('lists exactly one mode per pre-finale Sequence (Req 8.4-8.5)', () => {
    const finaleIdx = world5FinaleIndex(plan);
    // A SequenceSpec carries a single `mode` field — single-mode by construction.
    for (const spec of plan.slice(0, finaleIdx)) {
      expect(typeof spec.mode).toBe('string');
      expect(WORLD5_PREFINALE_MODES).toContain(spec.mode);
    }
  });

  it('makes the Sequence immediately before the finale a Flight Sequence (Req 8.2-8.3)', () => {
    const finaleIdx = world5FinaleIndex(plan);
    expect(finaleIdx).toBeGreaterThanOrEqual(1);
    const beforeFinale = plan[finaleIdx - 1];
    expect(beforeFinale?.mode).toBe('flight');
  });

  it('ends on a single scripted finale Sequence flagged isFinale (Req 8.8)', () => {
    const finaleSpecs = plan.filter((s) => s.isFinale === true);
    expect(finaleSpecs).toHaveLength(1);
    // The finale is the LAST entry (terminal — World 5 is finite, Req 8.1).
    expect(world5FinaleIndex(plan)).toBe(plan.length - 1);
    const finale = plan[plan.length - 1];
    expect(finale?.isFinale).toBe(true);
    expect(finale?.loops ?? false).toBe(false);
  });

  it('places Jumping ONLY on the finale Sequence (Req 8.6)', () => {
    const jumpingSpecs = plan.filter((s) => s.mode === 'jumping');
    expect(jumpingSpecs).toHaveLength(1);
    expect(jumpingSpecs[0]?.isFinale).toBe(true);
    expect(WORLD5_FINALE_MODE).toBe('jumping');
  });

  it('exposes the documented Flight→Zigzag→Flight→Underwater→Flight→Finale chain', () => {
    expect(plan.map((s) => s.mode)).toEqual([
      'flight',
      'zigzag',
      'flight',
      'underwater',
      'flight',
      'jumping',
    ]);
  });
});

describe('validateWorld5Plan — structural guards (Req 8.2-8.6/8.8)', () => {
  it('passes (no violations) for the real plan', () => {
    const plan = buildWorld5SequencePlan();
    expect(validateWorld5Plan(plan)).toEqual([]);
    expect(isValidWorld5Plan(plan)).toBe(true);
  });

  it('flags a Jumping-containing pre-finale chain (Req 8.6)', () => {
    const bad: SequenceSpec[] = [
      { mode: 'flight' },
      { mode: 'jumping' }, // illegal before the finale
      { mode: 'flight' },
      { mode: 'jumping', isFinale: true },
    ];
    const violations = validateWorld5Plan(bad);
    expect(violations).toContain<World5PlanViolation>('jumping-before-finale');
    expect(isValidWorld5Plan(bad)).toBe(false);
  });

  it('flags a non-Flight pre-finale terminal Sequence (Req 8.2-8.3)', () => {
    const bad: SequenceSpec[] = [
      { mode: 'flight' },
      { mode: 'underwater' }, // immediately before finale, not Flight
      { mode: 'jumping', isFinale: true },
    ];
    expect(validateWorld5Plan(bad)).toContain<World5PlanViolation>(
      'prefinale-not-flight',
    );
  });

  it('flags a missing finale (Req 8.8)', () => {
    const bad: SequenceSpec[] = [{ mode: 'flight' }, { mode: 'zigzag' }];
    const violations = validateWorld5Plan(bad);
    expect(violations).toContain<World5PlanViolation>('missing-finale');
  });

  it('flags a finale that is not the terminal Sequence (Req 8.8)', () => {
    const bad: SequenceSpec[] = [
      { mode: 'flight' },
      { mode: 'jumping', isFinale: true },
      { mode: 'flight' },
    ];
    const violations = validateWorld5Plan(bad);
    expect(violations).toContain<World5PlanViolation>('finale-not-terminal');
  });

  it('flags multiple finales', () => {
    const bad: SequenceSpec[] = [
      { mode: 'flight' },
      { mode: 'jumping', isFinale: true },
      { mode: 'jumping', isFinale: true },
    ];
    expect(validateWorld5Plan(bad)).toContain<World5PlanViolation>(
      'multiple-finales',
    );
  });

  it('flags an invalid pre-finale mode is impossible for the real modes but caught generically', () => {
    // A finale as the first entry has no Flight run-up into it.
    const bad: SequenceSpec[] = [{ mode: 'jumping', isFinale: true }];
    expect(validateWorld5Plan(bad)).toContain<World5PlanViolation>(
      'prefinale-not-flight',
    );
  });

  it('flags a looping pre-finale Sequence (World 5 is finite, Req 8.1)', () => {
    const bad: SequenceSpec[] = [
      { mode: 'flight', loops: true },
      { mode: 'jumping', isFinale: true },
    ];
    expect(validateWorld5Plan(bad)).toContain<World5PlanViolation>(
      'prefinale-loops',
    );
  });

  it('flags an empty plan', () => {
    expect(validateWorld5Plan([])).toEqual<World5PlanViolation[]>(['empty-plan']);
  });
});

describe('World5Plan ↔ SequenceDirector — every pre-finale scheduled mode is in {flight, zigzag, underwater}', () => {
  it('drives through the chain with only pre-finale combined-ability modes before the finale', () => {
    const plan = buildWorld5SequencePlan();
    const finaleIdx = world5FinaleIndex(plan);

    const dir = createSequenceDirector(plan, balance, {
      defaultBoundaryPx: 1000,
    });

    // Confirm the SCHEDULE: every scheduled Sequence BEFORE the finale is a
    // combined-ability mode; the finale is the terminal scheduled Sequence.
    const schedule = dir.schedule();
    expect(schedule).toHaveLength(plan.length);
    schedule.forEach((entry, i) => {
      if (i < finaleIdx) {
        expect(PREFINALE.has(entry.sequence.mode)).toBe(true);
        expect(entry.sequence.mode).not.toBe('jumping');
        expect(entry.sequence.isFinale).toBe(false);
      }
    });
    expect(schedule[finaleIdx]?.sequence.isFinale).toBe(true);

    // Drive the run across every pre-finale boundary; the active mode is always
    // a combined-ability mode until the finale Sequence is reached. Water-gated
    // Underwater↔Flight boundaries need the crossing event to resolve.
    const ctx = { waterSurfaceCrossed: true };
    for (let i = 0; i < finaleIdx; i++) {
      expect(PREFINALE.has(dir.currentMode())).toBe(true);
      dir.tick(1000, ctx);
    }
    // After crossing every pre-finale boundary, the active Sequence is the finale.
    expect(dir.currentSequence().isFinale).toBe(true);
    expect(dir.currentMode()).toBe('jumping'); // Jumping only in the finale (Req 8.6)
  });

  it('realizes the finale spec with isFinale true and loops false', () => {
    const plan = buildWorld5SequencePlan();
    const finale = plan[plan.length - 1] as SequenceSpec;
    expect(realizeSequence(finale)).toEqual({
      mode: 'jumping',
      isFinale: true,
      loops: false,
    });
  });
});

// Feature: kino-game
//
// World5Plan — the PURE composition of the World 5 (Security Citadel) STORY
// `sequencePlan` (task 11.1; design: "Per-world sequence composition" row 5,
// "World 5 scripted finale (Req 8.7–8.15, 45.5)"; Req 8.1-8.6).
//
// PURE composition logic — no Phaser, no clocks, no ambient randomness, no I/O.
// Enforced Phaser-free by test/boundary.core-no-phaser.test.ts.
//
// World 5 is NOT procedural/endless (Req 8.1, 23.2): it is a FINITE, authored
// progression that chains Flight / Zigzag / Underwater Sequences and ENDS on a
// single scripted FINALE Sequence. This module owns exactly the composition of
// that `SequenceSpec[]`; it mirrors endlessMode.ts's style (a pure builder plus
// a structural validator) but for the designed STORY finale world, not an
// endless run. It does NOT drive transitions (that is sequenceDirector.ts) and
// does NOT run the scripted finale itself (task 11.2 wires the engine-side
// crawl→run→jump via CinematicScene) — it only PRODUCES the plan those consume.
//
// WHAT THE PLAN GUARANTEES (the four structural facts task 11.2 + tests rely on):
//
//   1. PRE-FINALE CHAIN uses ONLY {flight, zigzag, underwater} — NO Jumping
//      (Req 8.6: Jumping is available in World 5 ONLY during the finale). The
//      chain uses the same environment-forced, telegraphed transitions as the
//      other worlds (water-surface gating at the Underwater↔Flight boundaries,
//      exactly as World 4, Req 5.9/6.9-6.11) when fed to createSequenceDirector.
//
//   2. EXACTLY ONE mode per pre-finale Sequence (Req 8.4-8.5). A SequenceSpec
//      carries a single `mode`, and the SequenceDirector/MovementStateMachine
//      keep exactly one active — so every pre-finale segment is single-mode by
//      construction; the validator asserts the structural half (one mode listed
//      per spec, no multi-mode spec can exist in this shape).
//
//   3. The Sequence IMMEDIATELY BEFORE the finale is a FLIGHT Sequence
//      (Req 8.2-8.3): Flight is the active mode leading INTO the finale (so the
//      finale can disable Flight and descend Kino to the ground, Req 8.7). The
//      builder always places a Flight spec directly before the finale spec.
//
//   4. The FINALE boundary is REPRESENTED on the plan so task 11.2 can hook in:
//      the terminal `SequenceSpec` carries `isFinale: true` (Req 8.8 — the
//      scripted finale Sequence). Its `mode` is Jumping because the finale is
//      the ONLY place Jumping becomes available in World 5 (Req 8.6, 8.14-8.15:
//      the final primary action is a Jump through the portal barrier). Jumping
//      therefore appears ONLY on the finale spec and NEVER in the pre-finale
//      chain. The finale Sequence does not loop and has no further boundary.

import type { MovementMode, SequenceSpec } from './types.ts';

/**
 * The movement modes permitted in a World 5 PRE-FINALE Sequence (Req 8.2, 8.4):
 * the three combined abilities Flight, Zigzag, Underwater. Jumping is
 * deliberately EXCLUDED here — it is finale-only (Req 8.6).
 */
export const WORLD5_PREFINALE_MODES: readonly MovementMode[] = [
  'flight',
  'zigzag',
  'underwater',
] as const;

/** Membership form of {@link WORLD5_PREFINALE_MODES} for O(1) `has` checks. */
const PREFINALE_MODE_SET: ReadonlySet<MovementMode> = new Set(
  WORLD5_PREFINALE_MODES,
);

/**
 * The movement mode of the World 5 FINALE Sequence. Jumping is available in
 * World 5 ONLY during the finale (Req 8.6), and the finale's player-facing
 * action is the final Jump through the portal barrier (Req 8.14-8.15), so the
 * finale Sequence is a Jumping Sequence. This is the single place Jumping may
 * appear in a World 5 plan.
 */
export const WORLD5_FINALE_MODE: MovementMode = 'jumping';

/**
 * Build the World 5 STORY `sequencePlan` (Req 8.1-8.6). The plan CHAINS
 * Flight / Zigzag / Underwater Sequences (environment-forced, telegraphed
 * transitions; water-gated at the Underwater↔Flight boundaries exactly like
 * World 4, Req 5.9), makes the Sequence IMMEDIATELY BEFORE the finale a FLIGHT
 * Sequence (Req 8.2-8.3), and ENDS on a single scripted FINALE Sequence
 * (`isFinale: true`, Req 8.8) whose mode is Jumping — the ONLY Jumping in the
 * plan (Req 8.6).
 *
 * The composition mirrors the World 4 combined-ability chain (so the climactic
 * world recombines every learned ability, Req 8.2) and deliberately terminates
 * on Flight → Finale:
 *   Flight → Zigzag → Flight → Underwater → Flight(pre-finale) → FINALE(jumping)
 *
 * The returned array is a fresh array of fresh spec objects; the finale is the
 * last entry and does not loop (World 5 is finite, Req 8.1). Exactly one mode
 * is listed per Sequence (Req 8.4-8.5).
 */
export function buildWorld5SequencePlan(): SequenceSpec[] {
  return [
    { mode: 'flight' },
    { mode: 'zigzag' },
    { mode: 'flight' },
    { mode: 'underwater' },
    // The Sequence IMMEDIATELY before the finale is Flight (Req 8.2-8.3): Flight
    // is active leading INTO the finale so the finale can disable it (Req 8.7).
    { mode: 'flight' },
    // The scripted finale Sequence (Req 8.8). Jumping is available here ONLY
    // (Req 8.6); the final action is a Jump through the portal (Req 8.14-8.15).
    { mode: WORLD5_FINALE_MODE, isFinale: true },
  ];
}

/**
 * The index of the FINALE Sequence within a World 5 `plan`: the first entry
 * flagged `isFinale`. Returns -1 when the plan has no finale (a malformed World
 * 5 plan). Task 11.2 uses this to locate the scripted-finale boundary.
 */
export function world5FinaleIndex(plan: SequenceSpec[]): number {
  return plan.findIndex((spec) => spec.isFinale === true);
}

/**
 * The structural finding a World 5 plan can violate, in the order checked.
 * Each is a Req-8 guarantee the plan must hold; {@link validateWorld5Plan}
 * returns the list of violations (empty when the plan is well-formed) so
 * callers/tests can structurally verify Req 8.2-8.6.
 */
export type World5PlanViolation =
  /** The plan is empty (Req 8.1-8.2 — a World 5 plan must have Sequences). */
  | 'empty-plan'
  /** No Sequence is flagged `isFinale` (Req 8.8 — the finale must be present). */
  | 'missing-finale'
  /** The finale is not the LAST Sequence (Req 8.8 — the finale terminates W5). */
  | 'finale-not-terminal'
  /** More than one Sequence is flagged `isFinale` (there is a single finale). */
  | 'multiple-finales'
  /** A PRE-finale Sequence uses Jumping (Req 8.6 — Jumping is finale-only). */
  | 'jumping-before-finale'
  /** A PRE-finale Sequence uses a mode outside {flight, zigzag, underwater} (Req 8.2, 8.4). */
  | 'invalid-prefinale-mode'
  /** The Sequence immediately before the finale is not Flight (Req 8.2-8.3). */
  | 'prefinale-not-flight'
  /** A pre-finale Sequence loops (Req 8.1 — World 5 is a finite progression). */
  | 'prefinale-loops';

/**
 * Validate a World 5 `plan` against the Req 8.2-8.6/8.8 structural guarantees.
 * Returns the list of {@link World5PlanViolation}s (EMPTY when the plan is
 * well-formed), so a caller/test can assert `validateWorld5Plan(plan).length
 * === 0` for the real plan and that a Jumping-containing or non-Flight-terminal
 * plan is flagged. Violations are reported in a stable order; each distinct
 * kind appears at most once.
 *
 * The checks (mirroring endlessMode.validateEndlessPlanModes's "return the
 * offenders" style):
 *   - the plan is non-empty and has EXACTLY ONE finale, which is the LAST entry
 *     (Req 8.8);
 *   - NO pre-finale Sequence uses Jumping (Req 8.6);
 *   - every pre-finale Sequence uses a mode in {flight, zigzag, underwater}
 *     (Req 8.2, 8.4) and does not loop (Req 8.1);
 *   - the Sequence immediately before the finale is FLIGHT (Req 8.2-8.3).
 */
export function validateWorld5Plan(plan: SequenceSpec[]): World5PlanViolation[] {
  const violations: World5PlanViolation[] = [];

  if (plan.length === 0) {
    return ['empty-plan'];
  }

  const finaleIdxs = plan
    .map((spec, i) => (spec.isFinale === true ? i : -1))
    .filter((i) => i >= 0);

  if (finaleIdxs.length === 0) {
    violations.push('missing-finale');
  }
  if (finaleIdxs.length > 1) {
    violations.push('multiple-finales');
  }

  // The finale index used for the terminal/pre-finale checks: the FIRST finale
  // flagged (stable even when the plan is malformed with several).
  const finaleIdx = finaleIdxs.length > 0 ? (finaleIdxs[0] as number) : -1;

  if (finaleIdx >= 0 && finaleIdx !== plan.length - 1) {
    violations.push('finale-not-terminal');
  }

  // The pre-finale chain is everything before the finale (or the whole plan
  // when no finale exists, so a finale-less plan's modes are still checked).
  const prefinaleEnd = finaleIdx >= 0 ? finaleIdx : plan.length;
  let sawJumpingBeforeFinale = false;
  let sawInvalidPrefinaleMode = false;
  let sawPrefinaleLoop = false;
  for (let i = 0; i < prefinaleEnd; i++) {
    const spec = plan[i] as SequenceSpec;
    if (spec.mode === 'jumping') {
      sawJumpingBeforeFinale = true;
    } else if (!PREFINALE_MODE_SET.has(spec.mode)) {
      sawInvalidPrefinaleMode = true;
    }
    if (spec.loops === true) {
      sawPrefinaleLoop = true;
    }
  }
  if (sawJumpingBeforeFinale) violations.push('jumping-before-finale');
  if (sawInvalidPrefinaleMode) violations.push('invalid-prefinale-mode');

  // The Sequence immediately before the finale must be Flight (Req 8.2-8.3).
  if (finaleIdx >= 1) {
    const prev = plan[finaleIdx - 1] as SequenceSpec;
    if (prev.mode !== 'flight') {
      violations.push('prefinale-not-flight');
    }
  } else if (finaleIdx === 0) {
    // A finale as the very first Sequence has no Flight run-up into it.
    violations.push('prefinale-not-flight');
  }

  if (sawPrefinaleLoop) violations.push('prefinale-loops');

  return violations;
}

/**
 * Convenience boolean form of {@link validateWorld5Plan}: true iff the plan has
 * NO violations (well-formed per Req 8.2-8.6/8.8). By construction
 * {@link buildWorld5SequencePlan} always satisfies this; the helper lets
 * callers defensively verify a plan before building a SequenceDirector from it.
 */
export function isValidWorld5Plan(plan: SequenceSpec[]): boolean {
  return validateWorld5Plan(plan).length === 0;
}

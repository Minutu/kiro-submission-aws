// Feature: kino-game
//
// SequenceDirector (design: "Movement & Sequence System > SequenceDirector",
// "Telegraphed, environment-forced transitions", "Water-surface gating";
// Req 4.4-4.7, 5.5-5.7, 5.9, 6.1-6.6, 6.9-6.11, 8.2-8.6).
//
// The SequenceDirector COMPOSES a World out of its `sequencePlan` Sequences and
// decides WHEN a mode transition happens; the MovementStateMachine enforces the
// single-active invariant and gates Underwater↔Flight on the physical
// water-surface crossing event. The two collaborate: the director schedules the
// boundary (and the telegraph that leads it), the machine performs the swap.
//
// Responsibilities:
//   • currentSequence()  — the realized Sequence currently active (Req 4.5-4.6).
//   • tick(scrollDelta, ctx) — advance the scroll distance toward the next
//     scheduled Sequence boundary; emit a TransitionTelegraph when the remaining
//     distance first drops below `balance.telegraphLeadPx` (Req 6.3); drive the
//     actual transition at the boundary (Req 6.1-6.2). Returns the event(s) this
//     step so the scene can render them.
//   • isTransitioning() — true from telegraph through boundary resolution so the
//     scene disables skills (Req 6.4), hides cosmetic layers (Req 6.5), and gives
//     the transition animation render priority (Req 6.6).
//   • requestTransition(kind) — environment-forced entry point ONLY; the player
//     can never call this (Req 6.1-6.2). The director uses it internally; it is
//     exposed so the scene (environment) can force a transition at a boundary.
//
// ENVIRONMENT-FORCED, never player-chosen (Req 6.1-6.2): all transitions here
// are driven by scroll distance (scheduled boundaries) or by the water-surface
// crossing event. There is no API by which a player input selects a mode.
//
// WATER-SURFACE GATING (Req 5.9, 6.9-6.11): a boundary whose swap is
// Underwater↔Flight is "water-gated". The scroll-distance boundary + telegraph
// still LEAD the transition (so the scene can render the approaching surface),
// but the actual mode swap is performed ONLY on the step `ctx.waterSurfaceCrossed`
// is set. Until the crossing event fires, the director keeps the current mode
// and holds at the boundary (the transition stays pending/armed). This mirrors
// `MovementStateMachine.canTransition` which returns true for this pair only
// when the crossing event is present.
//
// PURE / deterministic: no Phaser, no clock, no randomness. tick is a pure
// function of (state, scrollDelta, ctx) + the injected BalanceTable
// (telegraphLeadPx, Req 26.8 — no hardcoded tunables). Enforced Phaser-free by
// test/boundary.core-no-phaser. The optional MovementStateMachine the director
// drives is injected; when omitted the director still reports the composed
// sequence/telegraph/transition decisions (useful for pure tests and scenes
// that drive a single machine themselves).

import type { BalanceTable } from '../config/index.ts';
import type {
  MovementStateMachine,
  MovementContext,
} from './movementStateMachine.ts';
import type {
  MovementMode,
  Sequence,
  SequenceSpec,
  WorldDefinition,
} from './types.ts';

/**
 * A realized Sequence paired with the scroll distance (px) the run travels
 * through it before its boundary. `boundaryPx` is the width of this Sequence's
 * segment; the director counts scroll toward it. A looping plan's final entry
 * cycles back to the first (Req 4.7).
 */
export interface ScheduledSequence {
  sequence: Sequence;
  /** Scroll distance (px) spent in this Sequence before its boundary. */
  boundaryPx: number;
}

/**
 * The cue the scene renders ahead of a transition (Req 6.3). Emitted once, on
 * the step the remaining distance to the next boundary first drops below
 * `balance.telegraphLeadPx`. `kind` tells the scene which animation to play:
 * the spin cue for Flight↔Zigzag (Req 6.7-6.8) or the surface approach for the
 * water-gated Underwater↔Flight pair (Req 6.9-6.10).
 */
export interface TransitionTelegraph {
  type: 'telegraph';
  /** Mode the run is leaving. */
  from: MovementMode;
  /** Mode the run is entering at the boundary. */
  to: MovementMode;
  /** True when the pending swap is Underwater↔Flight (surface-approach cue). */
  waterGated: boolean;
  /** Remaining scroll distance (px) to the boundary when the cue fired. */
  leadPx: number;
}

/**
 * The event emitted on the step the mode actually swaps (Req 6.1-6.2). For a
 * water-gated boundary this fires only once `ctx.waterSurfaceCrossed` is set.
 */
export interface TransitionEvent {
  type: 'transition';
  from: MovementMode;
  to: MovementMode;
  waterGated: boolean;
}

/** What `tick` returns this step: a telegraph, a transition, or nothing. */
export type TickResult = TransitionTelegraph | TransitionEvent | null;

/** Options for {@link createSequenceDirector}. */
export interface SequenceDirectorOptions {
  /**
   * Optional machine the director drives. When present, the director calls
   * `canTransition`/`requestTransition` on it at boundaries (so water gating is
   * enforced by the one authority). When absent, the director still composes
   * and reports decisions; the scene is responsible for driving its own machine.
   */
  machine?: MovementStateMachine;
  /**
   * Explicit per-Sequence boundary distances (px), one per plan entry. When
   * omitted, every Sequence uses `defaultBoundaryPx`.
   */
  boundaryDistancesPx?: number[];
  /** Default boundary distance (px) when a per-Sequence value is not given. */
  defaultBoundaryPx?: number;
}

/** Default scroll distance a Sequence spans before its boundary. */
export const DEFAULT_SEQUENCE_BOUNDARY_PX = 3000;

/** The public surface of the SequenceDirector. */
export interface SequenceDirector {
  /** The realized Sequence currently active (Req 4.5-4.6). */
  currentSequence(): Sequence;

  /** The mode of the current Sequence (convenience). */
  currentMode(): MovementMode;

  /**
   * Advance the run by `scrollDelta` px this step. Drives the telegraph (at
   * `telegraphLeadPx`) and the transition (at the boundary, water-gated when
   * applicable). Returns the event produced this step, or null.
   */
  tick(scrollDelta: number, ctx?: MovementContext): TickResult;

  /**
   * Environment-forced transition to `to` (Req 6.1-6.2). Honors water gating
   * when a machine is attached: if the swap is Underwater↔Flight and the
   * crossing event is absent, the current mode is kept and false is returned.
   * Returns whether the transition was performed.
   */
  requestTransition(to: MovementMode, ctx?: MovementContext): boolean;

  /**
   * True from the telegraph through boundary resolution. While true the scene
   * MUST disable skills (Req 6.4), hide cosmetic layers (Req 6.5), and give the
   * transition animation render priority (Req 6.6).
   */
  isTransitioning(): boolean;

  /** Convenience read of Req 6.4: skills disabled this step. */
  skillsDisabled(): boolean;

  /** Convenience read of Req 6.5: cosmetic layers hidden this step. */
  cosmeticsHidden(): boolean;

  /** Convenience read of Req 6.6: transition animation has render priority. */
  transitionHasRenderPriority(): boolean;

  /** Zero-based index of the current Sequence within the (looping) schedule. */
  currentIndex(): number;

  /** The full realized schedule (read-only), for inspection/tests. */
  schedule(): readonly ScheduledSequence[];
}

/** Realize a {@link Sequence} from a {@link SequenceSpec}, applying defaults. */
export function realizeSequence(spec: SequenceSpec): Sequence {
  return {
    mode: spec.mode,
    isFinale: spec.isFinale ?? false,
    loops: spec.loops ?? false,
  };
}

/** Is the (from -> to) pair the water-gated Underwater↔Flight transition? */
function isWaterGatedPair(from: MovementMode, to: MovementMode): boolean {
  return (
    (from === 'underwater' && to === 'flight') ||
    (from === 'flight' && to === 'underwater')
  );
}

/**
 * Create a {@link SequenceDirector} from a WorldDefinition (or an explicit
 * sequencePlan) composing the World's Sequences and driving telegraphed,
 * environment-forced transitions with water-surface gating.
 *
 * @param plan A WorldDefinition or the raw `sequencePlan` array.
 * @param balance The validated BalanceTable (telegraphLeadPx; Req 26.8).
 * @param options Machine to drive + per-Sequence boundary distances.
 */
export function createSequenceDirector(
  plan: WorldDefinition | SequenceSpec[],
  balance: BalanceTable,
  options: SequenceDirectorOptions = {},
): SequenceDirector {
  const specs: SequenceSpec[] = Array.isArray(plan) ? plan : plan.sequencePlan;
  if (specs.length === 0) {
    throw new Error('SequenceDirector requires a non-empty sequencePlan');
  }

  const defaultBoundaryPx =
    options.defaultBoundaryPx ?? DEFAULT_SEQUENCE_BOUNDARY_PX;

  const scheduled: ScheduledSequence[] = specs.map((spec, i) => ({
    sequence: realizeSequence(spec),
    boundaryPx: options.boundaryDistancesPx?.[i] ?? defaultBoundaryPx,
  }));

  const machine = options.machine;
  const looping = scheduled.some((s) => s.sequence.loops);

  /** Bounds-checked schedule access (tsconfig's noUncheckedIndexedAccess). */
  function at(i: number): ScheduledSequence {
    const entry = scheduled[i];
    if (entry === undefined) {
      throw new Error(`SequenceDirector: schedule index ${i} out of range`);
    }
    return entry;
  }

  // --- mutable run state ----------------------------------------------------
  let index = 0;
  // Scroll accumulated within the current Sequence toward its boundary.
  let scrolledInSegment = 0;
  // Whether the telegraph for the UPCOMING boundary has already been emitted
  // (so it fires exactly once per boundary, Req 6.3).
  let telegraphed = false;
  // Transitioning window: from the telegraph until the boundary swap resolves.
  // While true: skills off, cosmetics hidden, transition animation prioritized.
  let transitioning = false;

  /** Is there a next Sequence after `index` (accounting for looping)? */
  function hasNextBoundary(): boolean {
    if (looping) return true;
    return index < scheduled.length - 1;
  }

  /** The Sequence index that follows `index` (wrapping when looping). */
  function nextIndex(): number {
    if (index < scheduled.length - 1) return index + 1;
    return looping ? 0 : index;
  }

  function currentSequence(): Sequence {
    return at(index).sequence;
  }

  function currentMode(): MovementMode {
    return currentSequence().mode;
  }

  /** Perform the swap at the boundary, honoring water gating via the machine. */
  function performBoundarySwap(ctx?: MovementContext): TransitionEvent | null {
    const from = currentMode();
    const to = at(nextIndex()).sequence.mode;
    const waterGated = isWaterGatedPair(from, to);

    // A boundary whose two Sequences share a mode (e.g. World 1 looping
    // Jumping) is a pure ramp continuation: advance the segment, no swap event.
    if (from === to) {
      index = nextIndex();
      resetSegment();
      transitioning = false;
      return null;
    }

    // Water-gated boundary: hold until the crossing event fires. The telegraph
    // already led the transition; the swap waits on the physical event
    // (Req 5.9, 6.9-6.11). Keep `transitioning` true so the surface-approach
    // cue keeps rendering and skills stay disabled while we wait.
    if (waterGated && ctx?.waterSurfaceCrossed !== true) {
      return null;
    }

    // Drive the one authority when attached; it re-checks gating (defensive).
    if (machine) {
      if (!machine.canTransition(to, ctx)) {
        // Machine refused (missing crossing event) — stay armed at the boundary.
        return null;
      }
      machine.requestTransition(to);
    }

    index = nextIndex();
    resetSegment();
    transitioning = false;
    return { type: 'transition', from, to, waterGated };
  }

  function resetSegment(): void {
    scrolledInSegment = 0;
    telegraphed = false;
  }

  function tick(scrollDelta: number, ctx?: MovementContext): TickResult {
    // Defensive: ignore non-finite / negative deltas (the driver passes a fixed
    // non-negative scroll advance).
    const delta = Number.isFinite(scrollDelta) && scrollDelta > 0 ? scrollDelta : 0;

    // No boundary ahead (terminal Sequence of a non-looping plan): nothing to
    // telegraph or transition; just accrue scroll.
    if (!hasNextBoundary()) {
      scrolledInSegment += delta;
      return null;
    }

    scrolledInSegment += delta;

    const boundaryPx = at(index).boundaryPx;
    const remaining = boundaryPx - scrolledInSegment;
    const leadPx = balance.telegraphLeadPx();

    // At or past the boundary: resolve the transition (water-gated swaps wait on
    // the crossing event; same-mode boundaries just advance).
    if (scrolledInSegment >= boundaryPx) {
      // Entering the boundary zone marks us transitioning if not already (covers
      // the case where leadPx is 0 or the step jumped straight past the lead).
      transitioning = true;
      return performBoundarySwap(ctx);
    }

    // Within the telegraph lead window: emit the cue exactly once (Req 6.3) and
    // enter the transitioning window (skills off / cosmetics hidden, Req 6.4-6.5).
    if (remaining <= leadPx && !telegraphed) {
      telegraphed = true;
      transitioning = true;
      const from = currentMode();
      const to = at(nextIndex()).sequence.mode;
      // A same-mode boundary needs no visible telegraph; still mark it handled.
      if (from === to) {
        return null;
      }
      return {
        type: 'telegraph',
        from,
        to,
        waterGated: isWaterGatedPair(from, to),
        leadPx: Math.max(0, remaining),
      };
    }

    return null;
  }

  function requestTransition(to: MovementMode, ctx?: MovementContext): boolean {
    const from = currentMode();
    if (to === from) return true;

    // Water gating: refuse the swap without the crossing event (Req 6.9-6.11).
    if (isWaterGatedPair(from, to) && ctx?.waterSurfaceCrossed !== true) {
      return false;
    }
    if (machine && !machine.canTransition(to, ctx)) {
      return false;
    }
    if (machine) {
      machine.requestTransition(to);
    }

    // Jump the schedule to the next Sequence matching `to` (environment forcing
    // a known boundary). Prefer the immediate next entry when it matches.
    const target = nextIndex();
    if (at(target).sequence.mode === to) {
      index = target;
    } else {
      const found = scheduled.findIndex((s) => s.sequence.mode === to);
      if (found >= 0) index = found;
    }
    resetSegment();
    transitioning = false;
    return true;
  }

  return {
    currentSequence,
    currentMode,
    tick,
    requestTransition,
    isTransitioning: () => transitioning,
    skillsDisabled: () => transitioning,
    cosmeticsHidden: () => transitioning,
    transitionHasRenderPriority: () => transitioning,
    currentIndex: () => index,
    schedule: () => scheduled,
  };
}

// --- World sequence-plan composition helpers --------------------------------
//
// These produce the per-world `sequencePlan` arrays the design prescribes
// (design: "Per-world sequence composition"). They return SequenceSpec[] so a
// WorldDefinition can embed them directly and a director can be built from them.
// World 1 (Jumping-only) and World 2 (Flight-only) are trivial single-entry
// plans and are produced by the generic helpers below; World 5's scripted
// finale composition is task 11.1 and intentionally NOT built here.

/** World 3 (Memory Jungle): Flight→Zigzag alternating/looping (Req 4.4, 4.7). */
export function composeWorld3SequencePlan(): SequenceSpec[] {
  return [
    { mode: 'flight' },
    // The zigzag leg loops, so the schedule cycles Flight→Zigzag→Flight→…
    // (Req 4.7). The loop flag on the final entry makes the director wrap.
    { mode: 'zigzag', loops: true },
  ];
}

/**
 * World 4 (Ice & Underwater): Flight, Zigzag, Underwater chained and
 * water-gated, with Jumping excluded (Req 5.5-5.8). The Flight→Underwater and
 * Underwater→Flight boundaries are water-surface gated by the director/machine;
 * no Jumping Sequence ever appears.
 */
export function composeWorld4SequencePlan(): SequenceSpec[] {
  return [
    { mode: 'flight' },
    { mode: 'zigzag' },
    { mode: 'flight' },
    { mode: 'underwater' },
    { mode: 'flight' },
  ];
}

/** World 1 (Desert): Jumping only, loops/ramps past 50 (Req 2, 7.6). */
export function composeWorld1SequencePlan(): SequenceSpec[] {
  return [{ mode: 'jumping', loops: true }];
}

/** World 2 (Foundry): Flight only — Flight is the base mode (Req 3.5). */
export function composeWorld2SequencePlan(): SequenceSpec[] {
  return [{ mode: 'flight' }];
}

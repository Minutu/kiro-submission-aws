// Feature: kino-game
//
// UNIT tests for task 10.6 — the FOCUSED opening band-state mapping suite
// (`computeBandStates` + the index convention constants from
// `src/core/openingCinematic.ts`, exercised through the public barrel
// `src/core/index.ts`; design: "Cinematics System (Req 21, 29, 42)" → "Opening
// (21.1, 21.11–21.18)"; Req 21.15).
//
// This is the focused Req 21.15 band-state contract suite. Task 10.2's
// `openingCinematic.unit.test.ts` touches band states in passing while pinning
// the ordered panel CONTENT; THIS file frames the shown/hidden/greyed mapping
// explicitly as the per-band DISPLAY-STATE contract and sweeps the full index
// space — the occupied-band / passed / not-yet-reached invariant, the
// index↔world mapping, and graceful clamping of bad indices.
//
// INDEX CONVENTION (documented single source of truth, Req 21.14): the five
// stacked bands are ordered TOP→BOTTOM as
//     index 0 = TOP    = World 5
//     index 1          = World 4
//     index 2          = World 3
//     index 3          = World 2
//     index 4 = BOTTOM = World 1
// The egg enters at the TOP (index 0 / World 5) and DESCENDS toward the BOTTOM
// (index 4 / World 1), so the egg's band index INCREASES as it falls. For a
// given egg band index, bands ABOVE the egg (smaller index) are already PASSED
// → 'greyed'; the egg's OWN band is 'shown'; bands BELOW (larger index) are NOT
// YET REACHED → 'hidden'.
//
// Pure TypeScript, no Phaser — this logic lives in core precisely so it is
// testable in plain Node with no browser/canvas/DOM.

import { describe, it, expect } from 'vitest';
import {
  computeBandStates,
  worldIdForBandIndex,
  BAND_COUNT,
  BAND_WORLD_IDS_TOP_TO_BOTTOM,
  TOP_BAND_INDEX,
  BOTTOM_BAND_INDEX,
  type BandState,
} from '../src/core/index.ts';

/** Every valid egg band index, top (0 / World 5) → bottom (4 / World 1). */
const ALL_INDICES = Array.from({ length: BAND_COUNT }, (_, i) => i);

describe('computeBandStates — the shown/hidden/greyed display contract (Req 21.15)', () => {
  it('shows the OCCUPIED band, greys PASSED bands above it, hides NOT-YET-REACHED bands below it', () => {
    // Egg at the very top (World 5): only its own band shown, everything below
    // it still hidden, nothing above it to have passed.
    expect(computeBandStates(TOP_BAND_INDEX)).toEqual<BandState[]>([
      'shown',
      'hidden',
      'hidden',
      'hidden',
      'hidden',
    ]);

    // Egg in a MIDDLE band (index 1 / World 4): one passed band above (greyed),
    // its own band shown, the rest below hidden.
    expect(computeBandStates(1)).toEqual<BandState[]>([
      'greyed',
      'shown',
      'hidden',
      'hidden',
      'hidden',
    ]);

    // Egg at the center (index 2 / World 3): two greyed above, shown, two hidden.
    expect(computeBandStates(2)).toEqual<BandState[]>([
      'greyed',
      'greyed',
      'shown',
      'hidden',
      'hidden',
    ]);

    // Egg at the bottom (World 1): every higher band passed (greyed), its own
    // band shown, nothing below it left to reach.
    expect(computeBandStates(BOTTOM_BAND_INDEX)).toEqual<BandState[]>([
      'greyed',
      'greyed',
      'greyed',
      'greyed',
      'shown',
    ]);
  });

  it('returns a length-5 array for every valid egg index', () => {
    for (const egg of ALL_INDICES) {
      expect(computeBandStates(egg)).toHaveLength(BAND_COUNT);
    }
  });

  it('INVARIANT sweep: exactly one shown, all-above greyed, all-below hidden for every index', () => {
    for (const egg of ALL_INDICES) {
      const states = computeBandStates(egg);

      // Exactly one band is 'shown' — the egg's own band, at its index.
      const shownIndices = states
        .map((s, i) => (s === 'shown' ? i : -1))
        .filter((i) => i !== -1);
      expect(shownIndices).toEqual([egg]);

      states.forEach((state, i) => {
        if (i < egg) {
          expect(state).toBe('greyed'); // passed (above the egg)
        } else if (i === egg) {
          expect(state).toBe('shown'); // occupied
        } else {
          expect(state).toBe('hidden'); // not yet reached (below the egg)
        }
      });

      // Counting cross-check: greyed = #above, hidden = #below, shown = 1.
      const greyed = states.filter((s) => s === 'greyed').length;
      const hidden = states.filter((s) => s === 'hidden').length;
      expect(greyed).toBe(egg);
      expect(hidden).toBe(BAND_COUNT - 1 - egg);
    }
  });
});

describe('index ↔ world mapping follows the documented convention (Req 21.14/21.15)', () => {
  it('BAND_WORLD_IDS_TOP_TO_BOTTOM is [5,4,3,2,1] with top=World 5, bottom=World 1', () => {
    expect(BAND_WORLD_IDS_TOP_TO_BOTTOM).toEqual([5, 4, 3, 2, 1]);
    expect(BAND_WORLD_IDS_TOP_TO_BOTTOM).toHaveLength(BAND_COUNT);
    expect(BAND_WORLD_IDS_TOP_TO_BOTTOM[TOP_BAND_INDEX]).toBe(5);
    expect(BAND_WORLD_IDS_TOP_TO_BOTTOM[BOTTOM_BAND_INDEX]).toBe(1);
  });

  it('worldIdForBandIndex maps each band index to its world per the convention', () => {
    expect(ALL_INDICES.map((i) => worldIdForBandIndex(i))).toEqual([5, 4, 3, 2, 1]);
  });

  it('TOP/BOTTOM index constants bracket the valid index range', () => {
    expect(TOP_BAND_INDEX).toBe(0);
    expect(BOTTOM_BAND_INDEX).toBe(BAND_COUNT - 1);
  });
});

describe('out-of-range / non-finite indices clamp gracefully without throwing (Req 21.15)', () => {
  it('negative indices clamp to the TOP band (egg at index 0 / World 5)', () => {
    const top = computeBandStates(TOP_BAND_INDEX);
    expect(() => computeBandStates(-1)).not.toThrow();
    expect(computeBandStates(-1)).toEqual(top);
    expect(computeBandStates(-100)).toEqual(top);
    expect(worldIdForBandIndex(-5)).toBe(5);
  });

  it('indices past the bottom clamp to the BOTTOM band (egg at index 4 / World 1)', () => {
    const bottom = computeBandStates(BOTTOM_BAND_INDEX);
    expect(() => computeBandStates(BAND_COUNT)).not.toThrow();
    expect(computeBandStates(BAND_COUNT)).toEqual(bottom);
    expect(computeBandStates(999)).toEqual(bottom);
    expect(worldIdForBandIndex(999)).toBe(1);
  });

  it('non-finite indices (NaN / Infinity) clamp to the TOP band without throwing', () => {
    // Any non-finite input is treated as index 0 (the top band) by the
    // documented convention — a safe default so the renderer never crashes.
    const top = computeBandStates(TOP_BAND_INDEX);
    expect(() => computeBandStates(Number.NaN)).not.toThrow();
    expect(computeBandStates(Number.NaN)).toEqual(top);
    expect(computeBandStates(Number.POSITIVE_INFINITY)).toEqual(top);
    expect(computeBandStates(Number.NEGATIVE_INFINITY)).toEqual(top);
    expect(worldIdForBandIndex(Number.NaN)).toBe(5);
  });

  it('fractional indices round to the nearest valid band', () => {
    // 1.4 rounds to 1 (World 4), 1.6 rounds to 2 (World 3).
    expect(computeBandStates(1.4)).toEqual(computeBandStates(1));
    expect(computeBandStates(1.6)).toEqual(computeBandStates(2));
  });
});

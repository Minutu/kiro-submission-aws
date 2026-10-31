// Feature: kino-game
//
// UNIT tests for task 10.2 — the PURE opening stacked-band egg-descent
// cinematic CONTENT + the band-state mapping (`src/core/openingCinematic.ts`;
// design: "Cinematics System (Req 21, 29, 42)" → "Opening (21.1, 21.11–21.18)";
// Req 21.1, 21.11, 21.12, 21.13, 21.14, 21.15, 21.16, 21.17).
//
// Two pins:
//   1. `buildOpeningCinematicPanels` emits the opening beats in order — knock →
//      roll → permission gag (using the CONFIG gag text) → ground opens/fall →
//      five-band descent (World 5 → World 1) → World 1 band expands → hatch
//      (walking ghost) → gains Jumping.
//   2. `computeBandStates(eggBandIndex)` — the band-state SINGLE SOURCE OF TRUTH
//      task 10.6 focuses on: occupied band `shown`, not-yet-reached `hidden`,
//      already-passed `greyed`, for several egg indices.
//
// INDEX CONVENTION (documented single source of truth, Req 21.14): the five
// bands are ordered TOP→BOTTOM as index 0 = top = World 5, index 1 = World 4,
// index 2 = World 3, index 3 = World 2, index 4 = bottom = World 1. The egg
// enters at the TOP (index 0 / World 5) and descends DOWNWARD toward the BOTTOM
// (index 4 / World 1), so the egg's band index INCREASES as it falls. Bands
// ABOVE the egg (smaller index) are already PASSED → greyed; the egg's own band
// is shown; bands BELOW (larger index) are NOT YET REACHED → hidden.
//
// Pure TypeScript, no Phaser — this logic lives in core precisely so it is
// testable in plain Node with no browser/canvas/DOM.

import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/config/config.ts';
import {
  buildOpeningCinematicPanels,
  computeBandStates,
  worldIdForBandIndex,
  BAND_COUNT,
  BAND_WORLD_IDS_TOP_TO_BOTTOM,
  TOP_BAND_INDEX,
  BOTTOM_BAND_INDEX,
  OPENING_PANEL_IDS,
  createCinematicPlayer,
  type BandState,
  type CinematicPanel,
  type OpeningBeatKind,
} from '../src/core/index.ts';

/** The config-backed content input used by most tests (real gag text + names). */
function contentInput() {
  return {
    permissionGag: defaultConfig.labels.permissionGag,
    worldNames: {
      world1: defaultConfig.names.worlds.world1,
      world2: defaultConfig.names.worlds.world2,
      world3: defaultConfig.names.worlds.world3,
      world4: defaultConfig.names.worlds.world4,
      world5: defaultConfig.names.worlds.world5,
    },
  };
}

/** Read a panel's beat discriminator from its opaque data bag. */
function beatOf(panel: CinematicPanel): OpeningBeatKind | undefined {
  return panel.data?.['beat'] as OpeningBeatKind | undefined;
}

// ---------------------------------------------------------------------------
// computeBandStates — the band-state SINGLE SOURCE OF TRUTH (Req 21.15-21.16)
// ---------------------------------------------------------------------------

describe('computeBandStates — occupied/passed/not-reached mapping (Req 21.15-21.16)', () => {
  it('egg at the TOP band (index 0 / World 5): occupied shown, all below hidden', () => {
    // No band is passed yet; only the occupied top band shows; the rest are
    // below the egg (not yet reached) → hidden.
    expect(computeBandStates(0)).toEqual<BandState[]>([
      'shown',
      'hidden',
      'hidden',
      'hidden',
      'hidden',
    ]);
  });

  it('egg at a MIDDLE band (index 2 / World 3): above greyed, occupied shown, below hidden', () => {
    expect(computeBandStates(2)).toEqual<BandState[]>([
      'greyed', // World 5 — passed
      'greyed', // World 4 — passed
      'shown', // World 3 — occupied
      'hidden', // World 2 — not yet reached
      'hidden', // World 1 — not yet reached
    ]);
  });

  it('egg one above the bottom (index 3 / World 2)', () => {
    expect(computeBandStates(3)).toEqual<BandState[]>([
      'greyed',
      'greyed',
      'greyed',
      'shown',
      'hidden',
    ]);
  });

  it('egg at the BOTTOM band (index 4 / World 1): every band above is greyed, World 1 shown', () => {
    expect(computeBandStates(4)).toEqual<BandState[]>([
      'greyed',
      'greyed',
      'greyed',
      'greyed',
      'shown',
    ]);
  });

  it('always returns exactly one `shown` band (the occupied one) for every valid index', () => {
    for (let i = TOP_BAND_INDEX; i <= BOTTOM_BAND_INDEX; i += 1) {
      const states = computeBandStates(i);
      expect(states).toHaveLength(BAND_COUNT);
      expect(states.filter((s) => s === 'shown')).toHaveLength(1);
      // The shown band is exactly the occupied index.
      expect(states[i]).toBe('shown');
      // Every band above is greyed; every band below is hidden.
      for (let j = 0; j < BAND_COUNT; j += 1) {
        if (j < i) expect(states[j]).toBe('greyed');
        else if (j > i) expect(states[j]).toBe('hidden');
      }
    }
  });

  it('clamps out-of-range indices to the nearest valid descent position', () => {
    expect(computeBandStates(-5)).toEqual(computeBandStates(0));
    expect(computeBandStates(99)).toEqual(computeBandStates(BOTTOM_BAND_INDEX));
    // Non-finite degrades to the top band rather than throwing.
    expect(computeBandStates(Number.NaN)).toEqual(computeBandStates(0));
  });
});

describe('band index ↔ world id convention (Req 21.14)', () => {
  it('index 0 = top = World 5 … index 4 = bottom = World 1', () => {
    expect(BAND_WORLD_IDS_TOP_TO_BOTTOM).toEqual([5, 4, 3, 2, 1]);
    expect(worldIdForBandIndex(0)).toBe(5);
    expect(worldIdForBandIndex(4)).toBe(1);
    expect(TOP_BAND_INDEX).toBe(0);
    expect(BOTTOM_BAND_INDEX).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// buildOpeningCinematicPanels — ordered opening beats (Req 21.11-21.17)
// ---------------------------------------------------------------------------

describe('buildOpeningCinematicPanels — ordered opening beats (Req 21.1, 21.11-21.17)', () => {
  it('emits the key beats in the required order', () => {
    const panels = buildOpeningCinematicPanels(contentInput());
    const beats = panels.map(beatOf);

    expect(beats).toEqual([
      'henhouse-knock', // Req 21.11
      'egg-rolls', // Req 21.11
      'permission-gag', // Req 21.12
      'ground-opens', // Req 21.13
      'band-descent', // Req 21.14-21.16 (World 5)
      'band-descent', // World 4
      'band-descent', // World 3
      'band-descent', // World 2
      'band-descent', // World 1
      'world1-expand', // Req 21.16
      'hatch-walk', // Req 21.17 (walks first)
      'gains-jumping', // Req 21.17 (then gains Jumping)
    ]);
  });

  it('the permission gag panel uses the CONFIG gag text (Req 21.12)', () => {
    const panels = buildOpeningCinematicPanels(contentInput());
    const gag = panels.find((p) => p.id === OPENING_PANEL_IDS.permissionGag);
    expect(gag).toBeDefined();
    expect(gag?.caption).toBe(defaultConfig.labels.permissionGag);
    expect(gag?.data?.['gagText']).toBe(defaultConfig.labels.permissionGag);
  });

  it('the five descent panels go World 5 (top) → World 1 (bottom) in order', () => {
    const panels = buildOpeningCinematicPanels(contentInput());
    const descent = panels.filter((p) => beatOf(p) === 'band-descent');
    expect(descent).toHaveLength(BAND_COUNT);

    // Band index increases 0..4 (egg descends) and the world id goes 5..1.
    expect(descent.map((p) => p.data?.['eggBandIndex'])).toEqual([0, 1, 2, 3, 4]);
    expect(descent.map((p) => p.data?.['worldId'])).toEqual([5, 4, 3, 2, 1]);

    // Each descent panel carries the matching pure band-state snapshot.
    descent.forEach((p, i) => {
      expect(p.data?.['bandStates']).toEqual(computeBandStates(i));
    });
  });

  it('World 1 descent panel is flagged as the bottom band (precedes the expand)', () => {
    const panels = buildOpeningCinematicPanels(contentInput());
    const world1Descent = panels.find(
      (p) => beatOf(p) === 'band-descent' && p.data?.['worldId'] === 1,
    );
    expect(world1Descent?.data?.['isBottomBand']).toBe(true);
  });

  it('hatch walks FIRST, then a later panel gains Jumping (Req 21.17 ordering)', () => {
    const panels = buildOpeningCinematicPanels(contentInput());
    const walkIdx = panels.findIndex((p) => beatOf(p) === 'hatch-walk');
    const jumpIdx = panels.findIndex((p) => beatOf(p) === 'gains-jumping');

    expect(walkIdx).toBeGreaterThanOrEqual(0);
    expect(jumpIdx).toBeGreaterThan(walkIdx);
    expect(panels[walkIdx]?.data?.['walks']).toBe(true);
    expect(panels[walkIdx]?.data?.['gainsJumping']).toBe(false);
    expect(panels[jumpIdx]?.data?.['gainsJumping']).toBe(true);
  });

  it('threads placeholder-friendly asset keys when provided, omits imageKey otherwise', () => {
    const withArt = buildOpeningCinematicPanels({
      permissionGag: 'denied',
      imageKeys: { 'henhouse-knock': 'opening/henhouse' },
      bandImageKeys: { world1: 'band/desert' },
    });
    const knock = withArt.find((p) => p.id === OPENING_PANEL_IDS.henhouseKnock);
    expect(knock?.imageKey).toBe('opening/henhouse');

    const world1Descent = withArt.find(
      (p) => beatOf(p) === 'band-descent' && p.data?.['worldId'] === 1,
    );
    expect(world1Descent?.imageKey).toBe('band/desert');

    // A beat without a supplied key has no imageKey (placeholder frame).
    const rolls = withArt.find((p) => p.id === OPENING_PANEL_IDS.eggRolls);
    expect(rolls?.imageKey).toBeUndefined();
  });

  it('falls back to "World N" captions when world names are omitted', () => {
    const panels = buildOpeningCinematicPanels({ permissionGag: 'denied' });
    const world5Descent = panels.find(
      (p) => beatOf(p) === 'band-descent' && p.data?.['worldId'] === 5,
    );
    expect(world5Descent?.caption).toContain('World 5');
  });
});

// ---------------------------------------------------------------------------
// Integration with the pure player — the opening sequence plays end-to-end
// ---------------------------------------------------------------------------

describe('opening panels drive the pure CinematicPlayer (Req 21.1, 21.18)', () => {
  it('the player walks every opening panel in order and completes', () => {
    const panels = buildOpeningCinematicPanels(contentInput());
    const player = createCinematicPlayer(panels);

    expect(player.length).toBe(panels.length);
    expect(player.current()?.id).toBe(OPENING_PANEL_IDS.henhouseKnock);

    // Advance through to the end.
    for (let i = 1; i < panels.length; i += 1) {
      const next = player.advance();
      expect(next).not.toBe('done');
    }
    expect(player.advance()).toBe('done');
    expect(player.isComplete()).toBe(true);
  });

  it('is skippable from any panel (Req 21.18)', () => {
    const player = createCinematicPlayer(buildOpeningCinematicPanels(contentInput()));
    player.advance();
    player.skip();
    expect(player.isComplete()).toBe(true);
    expect(player.current()).toBeNull();
  });
});

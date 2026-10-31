// Feature: kino-game
//
// OpeningCinematic — the PURE, Phaser-free CONTENT + band-state math for the
// opening stacked-band egg-descent cinematic (task 10.2; design: "Cinematics
// System (Req 21, 29, 42)" → "Opening (21.1, 21.11–21.18)"; Req 21.1, 21.11,
// 21.12, 21.13, 21.14, 21.15, 21.16, 21.17).
//
// SCOPE / TASK BOUNDARY (10.2): this module is the opening cinematic's CONTENT
// and the band-state SINGLE SOURCE OF TRUTH — NOT any rendering. It builds the
// ordered `CinematicPanel[]` the pure `createCinematicPlayer`
// (`src/core/cinematicSequence.ts`) walks panel-by-panel, covering every opening
// beat in order:
//
//   1. Henhouse + egg knock           (Req 21.11)
//   2. Egg rolls to the button        (Req 21.11)
//   3. Permission-denied gag          (Req 21.12, using `config.labels.permissionGag`)
//   4. Ground opens + egg falls        (Req 21.13)
//   5. Five-band descent, World 5 top → World 1 bottom, one panel per band the
//      egg occupies, with the per-band shown/hidden/greyed states (Req 21.14-21.16)
//   6. World 1 band expands to fill the screen for the landing (Req 21.16)
//   7. Hatch into a walking ghost that then gains Jumping (Req 21.17)
//
// It ALSO owns the PURE band-state mapping `computeBandStates(eggBandIndex)` —
// the single source of truth task 10.6 unit-tests — that maps the egg's current
// band to the five bands' display states (occupied band `shown`, not-yet-reached
// bands `hidden`, already-passed bands `greyed`).
//
// HARD RULE: no module under `src/core/**` may import `phaser` (see
// `src/README.md`). This module imports only the pure CinematicPanel type and
// takes its config values (gag text, world names, asset keys) as plain inputs,
// so it stays unit-testable in plain Node with no browser/canvas/DOM.

import type { CinematicPanel } from './cinematicSequence.ts';

// ---------------------------------------------------------------------------
// Band ordering + state — the SINGLE SOURCE OF TRUTH (Req 21.14-21.16)
// ---------------------------------------------------------------------------

/**
 * The display state of one stacked World band WHILE the egg is falling
 * (Req 21.15):
 *   - `shown`   — the band the egg currently OCCUPIES is fully rendered.
 *   - `hidden`  — a band the egg has NOT YET REACHED is not rendered.
 *   - `greyed`  — a band the egg has ALREADY PASSED is a dark greyed-out
 *                 silhouette.
 */
export type BandState = 'shown' | 'hidden' | 'greyed';

/**
 * INDEX CONVENTION (the documented single source of truth, Req 21.14):
 *
 *   index 0 = TOP band    = World 5
 *   index 1               = World 4
 *   index 2               = World 3
 *   index 3               = World 2
 *   index 4 = BOTTOM band = World 1
 *
 * The egg enters at the TOP (index 0 / World 5) and descends DOWNWARD toward the
 * BOTTOM (index 4 / World 1) — i.e. the egg's band index INCREASES as it falls.
 * So for a given `eggBandIndex`:
 *   - indices  <  eggBandIndex  are bands ABOVE the egg → already PASSED → greyed
 *   - index    == eggBandIndex  is the OCCUPIED band             → shown
 *   - indices  >  eggBandIndex  are bands BELOW the egg → NOT YET REACHED → hidden
 */
export const BAND_COUNT = 5 as const;

/** World ids top→bottom, matching the index convention above (World 5 … World 1). */
export const BAND_WORLD_IDS_TOP_TO_BOTTOM = [5, 4, 3, 2, 1] as const;

/** The top band's index (where the egg enters the descent). */
export const TOP_BAND_INDEX = 0 as const;
/** The bottom band's index (World 1 — where the egg lands and hatches). */
export const BOTTOM_BAND_INDEX = (BAND_COUNT - 1) as 4;

/**
 * Map the egg's current band index to the five bands' display states, top→bottom
 * (Req 21.15-21.16). The returned array is length `BAND_COUNT` (5), index 0 =
 * top = World 5 … index 4 = bottom = World 1.
 *
 * `eggBandIndex` is CLAMPED into `[0, BAND_COUNT - 1]` so an out-of-range input
 * degrades gracefully to the nearest valid descent position (the renderer never
 * crashes on a bad index).
 *
 * @example computeBandStates(0) -> ['shown','hidden','hidden','hidden','hidden']
 * @example computeBandStates(2) -> ['greyed','greyed','shown','hidden','hidden']
 * @example computeBandStates(4) -> ['greyed','greyed','greyed','greyed','shown']
 */
export function computeBandStates(eggBandIndex: number): BandState[] {
  const egg = clampBandIndex(eggBandIndex);
  const states: BandState[] = [];
  for (let i = 0; i < BAND_COUNT; i += 1) {
    if (i < egg) {
      states.push('greyed'); // already passed (above the egg)
    } else if (i === egg) {
      states.push('shown'); // currently occupied
    } else {
      states.push('hidden'); // not yet reached (below the egg)
    }
  }
  return states;
}

/** Clamp an arbitrary number to a valid integer band index in `[0, BAND_COUNT-1]`. */
function clampBandIndex(index: number): number {
  const n = Number.isFinite(index) ? Math.round(index) : 0;
  if (n < 0) return 0;
  if (n > BAND_COUNT - 1) return BAND_COUNT - 1;
  return n;
}

/** The World id (5…1) a band index maps to under the documented convention. */
export function worldIdForBandIndex(index: number): number {
  return BAND_WORLD_IDS_TOP_TO_BOTTOM[clampBandIndex(index)]!;
}

// ---------------------------------------------------------------------------
// Opening cinematic CONTENT — the ordered Comic_Panel sequence (Req 21.11-21.17)
// ---------------------------------------------------------------------------

/**
 * Stable panel ids for the opening beats, so the engine (and tests) can key off
 * a beat without matching caption prose.
 */
export const OPENING_PANEL_IDS = {
  henhouseKnock: 'opening-henhouse-knock',
  eggRolls: 'opening-egg-rolls',
  permissionGag: 'opening-permission-gag',
  groundOpens: 'opening-ground-opens',
  /** Per-band descent panel ids are suffixed with the band index 0..4. */
  bandDescentPrefix: 'opening-band-descent-',
  world1Expand: 'opening-world1-expand',
  hatchWalk: 'opening-hatch-walk',
  gainsJumping: 'opening-gains-jumping',
} as const;

/** A discriminator the engine can switch rendering on (placeholder-friendly). */
export type OpeningBeatKind =
  | 'henhouse-knock'
  | 'egg-rolls'
  | 'permission-gag'
  | 'ground-opens'
  | 'band-descent'
  | 'world1-expand'
  | 'hatch-walk'
  | 'gains-jumping';

/**
 * The config values the opening content reads (Req 21.12 gag text + world names
 * for the band labels + placeholder-friendly Asset_Registry keys). Passed in as
 * plain data so this pure module never imports the config/engine layers; the
 * engine seam (CinematicScene) supplies them from the loaded Config_File.
 *
 * Everything except `permissionGag` is optional with sensible fallbacks so a
 * caller can build the sequence from as little as `{ permissionGag }`.
 */
export interface OpeningCinematicContentInput {
  /** Permission-denied gag text, read from `config.labels.permissionGag` (Req 21.12). */
  readonly permissionGag: string;
  /**
   * World display names keyed `world1`..`world5` (for the band captions). When
   * omitted, bands fall back to `World N`.
   */
  readonly worldNames?: Partial<Record<`world${1 | 2 | 3 | 4 | 5}`, string>>;
  /**
   * Optional Asset_Registry image keys for the beats (placeholder-friendly: a
   * missing/unknown key renders the comic frame as a placeholder). The engine
   * resolves these; this module just threads them onto the panels.
   */
  readonly imageKeys?: Partial<Record<OpeningBeatKind, string>>;
  /**
   * Optional per-world band art keys keyed `world1`..`world5`, used on the band
   * the egg occupies during the descent. Placeholder-friendly.
   */
  readonly bandImageKeys?: Partial<Record<`world${1 | 2 | 3 | 4 | 5}`, string>>;
}

/** Resolve a world's display name, falling back to `World N`. */
function worldName(
  input: OpeningCinematicContentInput,
  worldId: number,
): string {
  const key = `world${worldId}` as `world${1 | 2 | 3 | 4 | 5}`;
  return input.worldNames?.[key] ?? `World ${worldId}`;
}

/**
 * Build ONE descent panel for the egg occupying band `bandIndex` (0=top=World 5
 * … 4=bottom=World 1). Carries the pure band-state snapshot + the occupied
 * world id so the engine renders the stacked bands with the correct
 * shown/hidden/greyed treatment (Req 21.14-21.16) with no rendering logic here.
 */
function buildBandDescentPanel(
  input: OpeningCinematicContentInput,
  bandIndex: number,
): CinematicPanel {
  const worldId = worldIdForBandIndex(bandIndex);
  const bandStates = computeBandStates(bandIndex);
  const key = `world${worldId}` as `world${1 | 2 | 3 | 4 | 5}`;
  const name = worldName(input, worldId);
  const panel: CinematicPanel = {
    id: `${OPENING_PANEL_IDS.bandDescentPrefix}${bandIndex}`,
    caption: `Falling through ${name}…`,
    data: {
      beat: 'band-descent' satisfies OpeningBeatKind,
      eggBandIndex: bandIndex,
      worldId,
      bandStates,
      // World 1 (bottom) is where the band expands to fill the screen next.
      isBottomBand: bandIndex === BOTTOM_BAND_INDEX,
    },
  };
  const img = input.bandImageKeys?.[key];
  return img ? { ...panel, imageKey: img } : panel;
}

/**
 * Build the full, ordered opening Comic_Panel sequence (Req 21.11-21.17).
 *
 * Order (the sequence the pure player walks, Req 21.1):
 *   knock → roll → permission gag (config text) → ground opens/fall → five-band
 *   descent (World 5 → World 1) → World 1 band expands → hatch (walking ghost) →
 *   gains Jumping.
 *
 * All sequencing stays in the player; this only supplies the ordered content.
 */
export function buildOpeningCinematicPanels(
  input: OpeningCinematicContentInput,
): CinematicPanel[] {
  const img = (kind: OpeningBeatKind): string | undefined => input.imageKeys?.[kind];
  const withImage = (panel: CinematicPanel, kind: OpeningBeatKind): CinematicPanel => {
    const key = img(kind);
    return key ? { ...panel, imageKey: key } : panel;
  };

  const panels: CinematicPanel[] = [];

  // 1. Henhouse + egg knock (Req 21.11).
  panels.push(
    withImage(
      {
        id: OPENING_PANEL_IDS.henhouseKnock,
        caption: 'Mama Kino scratches in the data-center henhouse and knocks an egg loose.',
        data: { beat: 'henhouse-knock' satisfies OpeningBeatKind },
      },
      'henhouse-knock',
    ),
  );

  // 2. Egg rolls down the ramp to the button (Req 21.11).
  panels.push(
    withImage(
      {
        id: OPENING_PANEL_IDS.eggRolls,
        caption: 'The egg rolls down the ramp… straight toward the button.',
        data: { beat: 'egg-rolls' satisfies OpeningBeatKind },
      },
      'egg-rolls',
    ),
  );

  // 3. Permission-denied gag using the CONFIG gag text (Req 21.12).
  panels.push(
    withImage(
      {
        id: OPENING_PANEL_IDS.permissionGag,
        caption: input.permissionGag,
        data: {
          beat: 'permission-gag' satisfies OpeningBeatKind,
          gagText: input.permissionGag,
        },
      },
      'permission-gag',
    ),
  );

  // 4. Ground opens + egg falls (Req 21.13).
  panels.push(
    withImage(
      {
        id: OPENING_PANEL_IDS.groundOpens,
        caption: 'The ground splits open and the egg plunges through.',
        data: { beat: 'ground-opens' satisfies OpeningBeatKind },
      },
      'ground-opens',
    ),
  );

  // 5. Five-band descent, World 5 (top) → World 1 (bottom) in order (Req 21.14-21.16).
  for (let bandIndex = TOP_BAND_INDEX; bandIndex <= BOTTOM_BAND_INDEX; bandIndex += 1) {
    panels.push(buildBandDescentPanel(input, bandIndex));
  }

  // 6. World 1 band expands to fill the screen for the landing (Req 21.16).
  panels.push(
    withImage(
      {
        id: OPENING_PANEL_IDS.world1Expand,
        caption: `${worldName(input, 1)} fills the screen as the egg comes in to land.`,
        data: {
          beat: 'world1-expand' satisfies OpeningBeatKind,
          worldId: 1,
          // On expand every higher band is passed (greyed) and World 1 is shown.
          bandStates: computeBandStates(BOTTOM_BAND_INDEX),
        },
      },
      'world1-expand',
    ),
  );

  // 7a. Hatch into a walking ghost (Req 21.17, first phase — walks).
  panels.push(
    withImage(
      {
        id: OPENING_PANEL_IDS.hatchWalk,
        caption: 'The egg cracks — baby Kino emerges as a ghost and starts to walk.',
        data: {
          beat: 'hatch-walk' satisfies OpeningBeatKind,
          walks: true,
          gainsJumping: false,
        },
      },
      'hatch-walk',
    ),
  );

  // 7b. …then gains the Jumping ability (Req 21.17, second phase).
  panels.push(
    withImage(
      {
        id: OPENING_PANEL_IDS.gainsJumping,
        caption: 'Kino finds its footing and gains the Jumping ability!',
        data: {
          beat: 'gains-jumping' satisfies OpeningBeatKind,
          gainsJumping: true,
        },
      },
      'gains-jumping',
    ),
  );

  return panels;
}

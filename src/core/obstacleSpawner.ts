// Feature: kino-game
//
// ObstacleSpawner (design: "Obstacle Generation > Procedural, per-world,
// endless-capable, mode-aware (Req 23, 46)"; "Single-count scoring regardless
// of visual composition (Req 9.6)"; "Fixed-Kino scrolling run (Req 45, 46)").
//
// PURE simulation logic — it produces `Obstacle` DATA and nothing else. No
// rendering, no Phaser, no clocks, no ambient randomness. The one source of
// tunable numbers is the injected `BalanceTable` (Req 26.8): scroll speed and
// inter-obstacle gaps are read through its getters, never hardcoded.
//
// This task (4.5) implements ONLY the World 1 Jumping layout and the fixed-Kino
// scrolling contract:
//
//   • Fixed-Kino scrolling model (Req 45.1-45.2, 45.4): Kino is held at a
//     constant `screenX`; forward progress is simulated by translating the
//     world/obstacles LEFTWARD past Kino at `scrollSpeed`. Kino itself moves
//     only vertically (the jump) — the spawner never moves Kino, it only lays
//     out obstacles in WORLD space along an ever-increasing `scrollX`.
//   • Jumping layout (Req 2.5, 46.1): obstacles REST ON THE GROUND. Each unit's
//     bound rectangle(s) sit with their base on the ground line; a unit may be
//     a single block or a block + visual topper, but it is still ONE scoring
//     unit with ONE `id` and ONE `scoringLineX` (Req 9.6).
//   • Difficulty-scaled gaps (Req 2.5, 46.1, 7.6/23.3 ramp): the horizontal gap
//     between consecutive units starts at `baseGapPx` at low difficulty and
//     narrows toward `minGapPx` as difficulty ramps, and is CLAMPED so it can
//     never fall below `minGapPx`.
//
// Determinism/purity (testability): `spawnWindow` is a pure function of its
// inputs. Obstacle PLACEMENT is derived from a fixed world-space grid (the
// cumulative gap sequence anchored at world x=0), so the same inputs always
// yield the same units with the same stable ids — no injected RNG is needed for
// the deterministic Jumping layout. The grid anchoring also means two windows
// that overlap in world space agree on the obstacles in the overlap (stable ids
// across calls), which is what lets the GameplayScene recycle views safely.
//
// Task 5.1 extends this with the World 2 FLIGHT layout: a FLAPPY-style pair of
// vertical pillars (one from the TOP of the play area, one from the BOTTOM)
// with a navigable vertical GAP between them (Req 3.6, 46.2). The PAIR is ONE
// `Obstacle` — one stable `id`, one `scoringLineX`, and a `bounds` array that
// holds BOTH pillar rectangles — so it credits exactly once per pair
// (Req 3.3, 9.6). The gap CENTER varies per unit via a DETERMINISTIC hash of
// the unit index (no ambient RNG), so the run is not a flat corridor yet the
// layout stays pure and testable. Gap HEIGHT and horizontal spacing scale with
// difficulty through the BalanceTable, and the gap is clamped to stay
// navigable (feasible) at every difficulty.
//
// Task 5.2 extends this with the World 3 ZIGZAG layout. Unlike Jumping/Flight,
// the HAZARD in zigzag is the play-area BOUNDARY itself: the mode bounds the
// corridor with a TOP wall and a BOTTOM wall, and Kino bounces diagonally
// between them; CONTACTING either wall ends the run (Req 4.8, 4.9, 44.4). Those
// walls are static play-area geometry (top at `y = 0`, bottom at `groundY`) the
// GameplayScene enforces as a bounds check — they are NOT emitted as scrollable
// obstacle units. What the spawner emits for zigzag is the stream of SCORING
// "transition point" markers Kino crosses to score (Req 4.2): one `Obstacle`
// per transition point, each with ONE stable `id` and ONE `scoringLineX`, laid
// out at the same difficulty-scaled horizontal spacing as the other modes
// (reusing `gapFor` so density ramps on the same dial). A transition-point
// marker carries a single ZERO-WIDTH-free thin `bounds` rectangle spanning the
// corridor purely as a visual cue; it is NOT a collidable hazard (the walls
// are), so the GameplayScene excludes zigzag markers from the fatal-collision
// path and uses them only for the exactly-once crossing credit (Req 4.2, 9.6).
//
// Task 5.3 extends this with the World 4 UNDERWATER layout. Underwater is the
// INVERSE of Flight: buoyancy pushes Kino continuously upward and the primary
// is a downward impulse (handled by the MovementStateMachine, Req 5.1-5.2).
// What the spawner emits mirrors the Flight pillar-pair shape but with
// underwater SEMANTICS: each unit is ONE `Obstacle` (one stable `id`, one
// `scoringLineX`) whose `bounds` holds TWO rectangles — a `ceiling` obstacle
// hanging from the TOP (bound index 0) and a `floor` obstacle rising from the
// BOTTOM (bound index 1) — separated by a navigable vertical GAP (Req 5.11,
// 5.12, 5.13, 38.2, 46.4). The unit `category` is `'underwater_obstacle'`; the
// GameplayScene picks the `ceiling_underwater_obstacle` art for bound 0 and the
// `floor_underwater_obstacle` art for bound 1. The gap CENTER varies per unit
// via the same deterministic index hash the Flight layout uses (no ambient
// RNG), and the gap HEIGHT scales with difficulty through {@link underwaterGapFor},
// clamped to a feasible floor so the corridor is always navigable. Horizontal
// spacing reuses {@link gapFor} so density ramps on the same dial as every
// other mode.
//
// Later tasks (5.x) chain these Sequences with the water-surface-crossing
// transition; the shapes here stay mode-agnostic so that slots in without
// reworking the Jumping, Flight, Zigzag, or Underwater contract.

import type { BalanceTable } from '../config/index.ts';
import type { MovementMode, Obstacle, Rect, WorldId } from './types.ts';

/**
 * Play-area geometry passed IN so the spawner stays pure (no DOM/canvas). All
 * values are world-space pixels in the y-DOWN convention used by the rest of
 * the core (smaller `y` is higher on screen), matching MovementStateMachine.
 */
export interface PlayArea {
  /** Y of the ground line obstacles rest ON (their base sits here, Req 46.1). */
  groundY: number;
  /**
   * Total play-area height; the max obstacle height clamp for Jumping, and the
   * vertical span the Flight pillar pair is laid out within (the top pillar
   * hangs from `y = 0`, the bottom pillar rises to the ground, Req 3.6, 46.2).
   */
  playHeight: number;
}

/**
 * The difficulty inputs that drive scroll speed and gap width. Kept as plain
 * data so a window is a pure function of it.
 */
export interface Difficulty {
  /**
   * Normalized ramp position in [0, 1]. 0 = easiest (widest gaps, base scroll),
   * 1 = hardest (gaps at the `minGapPx` floor). Values outside [0,1] are
   * clamped. This is the dial the GameplayScene turns as a run progresses
   * (Req 7.6, 23.3).
   */
  ramp: number;
  /**
   * Count of obstacles cleared so far — the discrete driver of the scroll-speed
   * ramp (`base * clamp(1 + rampPerObstacle*cleared, 1, maxMultiplier)`,
   * Req 7.6). Separate from `ramp` so callers can ramp gaps and speed on
   * different schedules if desired. Defaults to 0 when omitted.
   */
  obstaclesCleared?: number;
}

/**
 * A window request. `scrollX` is how far the world has scrolled (world-space x
 * of the LEFT viewport edge increases as the run progresses). `windowWidth` is
 * how far AHEAD of `scrollX` to lay out obstacles (typically viewport width +
 * a lookahead margin so units exist before they scroll on screen).
 */
export interface SpawnWindowOptions {
  /** World-space x of the current scroll position (monotonically increasing). */
  scrollX: number;
  /** How far ahead of `scrollX` to produce units (world-space px). Default 0. */
  windowWidth?: number;
  /**
   * World-space x offset of the FIRST obstacle grid cell from x=0 (default 0).
   * A positive lead-in pushes the whole obstacle field to the right so the run
   * starts with a clear runway and the first unit enters from off the right
   * edge of the screen instead of sitting on top of Kino at spawn. Kept as a
   * pure input so placement stays deterministic (Req 45, 46.1).
   */
  leadInPx?: number;
  /** Active world (World 1 Jumping, 2 Flight, 3 Zigzag, 4 Underwater implemented). */
  world: WorldId;
  /** Active Movement_Mode (`'jumping'`, `'flight'`, `'zigzag'`, `'underwater'`). */
  mode: MovementMode;
  /** Difficulty inputs (gap + scroll-speed ramp). */
  difficulty: Difficulty;
}

/** The public surface of the spawner (design: `ObstacleSpawner`). */
export interface ObstacleSpawner {
  /**
   * Produce every obstacle unit whose `scoringLineX` lies in the world-space
   * window `[scrollX, scrollX + windowWidth]` for the active world/mode:
   *   - World 1 Jumping: ground-resting units (Req 46.1).
   *   - World 2 Flight: top+bottom pillar PAIRS, one `Obstacle` per pair with
   *     two `bounds` rectangles and a navigable gap (Req 3.6, 46.2).
   *   - World 3 Zigzag: "transition point" scoring MARKERS Kino crosses to
   *     score, one `Obstacle` per marker (one `id`, one `scoringLineX`), spaced
   *     at the difficulty-scaled {@link transitionSpacingFor} pitch. The walls
   *     bounding the corridor are the hazard and live in the play-area geometry
   *     the scene enforces, NOT in these units (Req 4.2, 4.8, 4.9, 46.3).
   *   - World 4 Underwater: ceiling+floor obstacle PAIRS, one `Obstacle` per
   *     pair with two `bounds` rectangles (ceiling from the top at bound 0,
   *     floor from the bottom at bound 1) and a navigable gap (Req 5.11, 5.12,
   *     5.13, 38.2, 46.4). The INVERSE of Flight: physics (buoyancy up, impulse
   *     down) is the machine's job; the spawner only lays out the corridor.
   *
   * Pure & deterministic: identical inputs yield identical units with identical
   * stable ids, so overlapping windows agree on shared units (Req 9.6 single
   * `id`/`scoringLineX` per unit).
   */
  spawnWindow(options: SpawnWindowOptions): Obstacle[];
  /**
   * Current scroll speed (px/s) for the given difficulty, read through the
   * BalanceTable: `base * clamp(1 + rampPerObstacle*cleared, 1, maxMultiplier)`
   * (Req 45, 7.6). The world scrolls leftward at this speed; Kino never moves
   * horizontally under normal movement (Req 45.1-45.2).
   */
  scrollSpeed(difficulty: Difficulty): number;
  /**
   * The difficulty-scaled horizontal gap (px) between consecutive Jumping
   * units: `baseGapPx` at `ramp=0`, narrowing linearly toward `minGapPx` at
   * `ramp=1`, and CLAMPED so it never drops below `minGapPx` (Req 2.5, 46.1,
   * 23.3).
   */
  gapFor(difficulty: Difficulty): number;
  /**
   * The difficulty-scaled VERTICAL gap height (px) of a Flight pillar pair:
   * widest (easiest) at `ramp=0`, narrowing toward a tighter — but still
   * navigable — gap at `ramp=1`, and CLAMPED so it never drops below the
   * feasible floor (`FLIGHT_MIN_GAP_PX`, comfortably larger than Kino's body)
   * (Req 3.6 navigable gap, 23.3 ramp). The horizontal spacing between pairs
   * reuses {@link gapFor} so pillar density ramps with the same dial.
   */
  flightGapFor(difficulty: Difficulty): number;
  /**
   * The difficulty-scaled VERTICAL gap height (px) of an Underwater
   * ceiling+floor pair: widest (easiest) at `ramp=0`, narrowing toward a
   * tighter — but still navigable — gap at `ramp=1`, and CLAMPED so it never
   * drops below the feasible floor (`UNDERWATER_MIN_GAP_PX`, comfortably larger
   * than Kino's body) (Req 5.13 navigable gap, 23.3 ramp). The horizontal
   * spacing between pairs reuses {@link gapFor} so pair density ramps with the
   * same dial. Mirrors {@link flightGapFor} since underwater is Flight's
   * inverse.
   */
  underwaterGapFor(difficulty: Difficulty): number;
  /**
   * The difficulty-scaled HORIZONTAL spacing (px) between consecutive Zigzag
   * transition-point markers: the marker footprint plus {@link gapFor}, so the
   * cadence at which Kino crosses transition points (and scores) tightens as
   * the ramp climbs, on the SAME dial as the other modes (Req 4.2, 23.3). The
   * walls bounding the corridor are static geometry, not part of this spacing.
   */
  transitionSpacingFor(difficulty: Difficulty): number;
}

/** Clamp `v` into the inclusive range `[lo, hi]`. */
function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * Default width of a single Jumping obstacle's base block (world-space px).
 * This is layout geometry (the physical footprint of a unit), NOT a tunable
 * balance constant — the balance block owns scroll speed and GAP (the spacing
 * between units), which are the difficulty dials. The footprint is a fixed
 * property of the obstacle asset.
 */
const JUMPING_OBSTACLE_WIDTH_PX = 48;

/**
 * Default base height of a Jumping obstacle block (world-space px), clamped to
 * at most 60% of the play height so a unit is always clearable by a jump. Like
 * the width, this is asset footprint geometry, not a balance tunable.
 */
const JUMPING_OBSTACLE_HEIGHT_PX = 56;

/**
 * Horizontal thickness of a Flight pillar (world-space px). Asset footprint
 * geometry, not a balance tunable (the balance block owns the horizontal
 * SPACING between pairs via `baseGapPx`/`minGapPx`, reused through `gapFor`).
 */
const FLIGHT_PILLAR_WIDTH_PX = 64;

/**
 * Vertical gap height (px) of a Flight pillar pair at the EASIEST difficulty
 * (`ramp=0`). Wide enough to read as a generous Flappy corridor. Layout
 * geometry tied to the asset/mode feel, not a balance scalar.
 */
const FLIGHT_BASE_GAP_PX = 260;

/**
 * The hard floor (px) for the Flight vertical gap at the HARDEST difficulty.
 * Kept comfortably larger than Kino's ~48px body so the corridor is always
 * navigable (feasible) regardless of ramp (Req 3.6). Clamped on read so a bad
 * ramp can never collapse the gap below this.
 */
const FLIGHT_MIN_GAP_PX = 150;

/**
 * Vertical padding (px) kept between the gap and each edge of the play area so
 * the gap center can never be placed so high/low that a pillar vanishes or the
 * corridor is flush against the ceiling/ground. Bounds the hashed center to a
 * sensible interior band.
 */
const FLIGHT_GAP_EDGE_MARGIN_PX = 40;

/**
 * Horizontal thickness (px) of an Underwater obstacle column (ceiling + floor
 * share the same x column). Asset footprint geometry, not a balance tunable
 * (the balance block owns the horizontal SPACING between pairs via
 * `baseGapPx`/`minGapPx`, reused through `gapFor`).
 */
const UNDERWATER_OBSTACLE_WIDTH_PX = 64;

/**
 * Vertical gap height (px) of an Underwater ceiling+floor pair at the EASIEST
 * difficulty (`ramp=0`). Wide enough to read as a generous underwater corridor.
 * Layout geometry tied to the asset/mode feel, not a balance scalar. Mirrors
 * the Flight base gap since underwater is Flight's inverse.
 */
const UNDERWATER_BASE_GAP_PX = 260;

/**
 * The hard floor (px) for the Underwater vertical gap at the HARDEST
 * difficulty. Kept comfortably larger than Kino's ~48px body so the corridor
 * is always navigable (feasible) regardless of ramp (Req 5.13). Clamped on read
 * so a bad ramp can never collapse the gap below this.
 */
const UNDERWATER_MIN_GAP_PX = 150;

/**
 * Vertical padding (px) kept between the gap and each edge of the play area so
 * the gap center can never be placed so high/low that an obstacle vanishes or
 * the corridor is flush against the ceiling/floor. Bounds the hashed center to
 * a sensible interior band.
 */
const UNDERWATER_GAP_EDGE_MARGIN_PX = 40;

/**
 * Horizontal thickness (px) of a Zigzag transition-point MARKER — the thin
 * vertical cue Kino crosses to score (Req 4.2). Asset footprint geometry, not a
 * balance tunable; the balance block owns the horizontal SPACING between
 * markers via `baseGapPx`/`minGapPx` (reused through `gapFor`). Kept slim so a
 * marker reads as a crossing LINE rather than a solid obstacle (the walls, not
 * the markers, are the hazard).
 */
const ZIGZAG_MARKER_WIDTH_PX = 16;

/**
 * Vertical inset (px) kept between a Zigzag marker's visual cue and each wall so
 * the cue reads as spanning the corridor interior without visually merging into
 * the top (`y = 0`) or bottom (`groundY`) wall. Purely visual — the marker is
 * never a collidable hazard.
 */
const ZIGZAG_MARKER_EDGE_INSET_PX = 8;

/**
 * Create an ObstacleSpawner bound to a BalanceTable and play-area geometry.
 *
 * Pure factory: the returned spawner reads tunables through `balance` and lays
 * obstacles out against `playArea`; given the same inputs it is deterministic.
 *
 * @param balance   The validated BalanceTable (scroll speed + gap source).
 * @param playArea  Ground line + play height (passed in to keep the core pure).
 */
export function createObstacleSpawner(
  balance: BalanceTable,
  playArea: PlayArea,
): ObstacleSpawner {
  function gapFor(difficulty: Difficulty): number {
    const base = balance.baseGapPx();
    const min = balance.minGapPx();
    const ramp = clamp(difficulty.ramp, 0, 1);
    // Linearly interpolate base -> min as the ramp climbs, then clamp to the
    // floor so a bad `min >= base` config (or rounding) can never produce a gap
    // below the documented minimum (Req 23.3). `Math.max` is the hard floor.
    const scaled = base + (min - base) * ramp;
    return Math.max(min, scaled);
  }

  function flightGapFor(difficulty: Difficulty): number {
    const ramp = clamp(difficulty.ramp, 0, 1);
    // Interpolate the wide base gap down toward the tight-but-feasible floor as
    // the ramp climbs, then hard-clamp to the floor so it stays navigable
    // regardless of ramp or rounding (Req 3.6, 23.3).
    const scaled =
      FLIGHT_BASE_GAP_PX + (FLIGHT_MIN_GAP_PX - FLIGHT_BASE_GAP_PX) * ramp;
    return Math.max(FLIGHT_MIN_GAP_PX, scaled);
  }

  function underwaterGapFor(difficulty: Difficulty): number {
    const ramp = clamp(difficulty.ramp, 0, 1);
    // Interpolate the wide base gap down toward the tight-but-feasible floor as
    // the ramp climbs, then hard-clamp to the floor so it stays navigable
    // regardless of ramp or rounding (Req 5.13, 23.3). Mirrors flightGapFor
    // since underwater is Flight's inverse.
    const scaled =
      UNDERWATER_BASE_GAP_PX +
      (UNDERWATER_MIN_GAP_PX - UNDERWATER_BASE_GAP_PX) * ramp;
    return Math.max(UNDERWATER_MIN_GAP_PX, scaled);
  }

  function transitionSpacingFor(difficulty: Difficulty): number {
    // Marker footprint + the shared difficulty gap. Reusing `gapFor` means the
    // zigzag crossing cadence tightens on the exact same ramp dial as the
    // Jumping/Flight density (Req 4.2, 23.3), and inherits its `minGapPx` floor
    // so markers never collapse onto each other.
    return ZIGZAG_MARKER_WIDTH_PX + gapFor(difficulty);
  }

  function scrollSpeed(difficulty: Difficulty): number {
    const base = balance.scrollSpeedBase();
    const rampPerObstacle = balance.scrollSpeedRampPerObstacle();
    const maxMultiplier = balance.scrollSpeedMaxMultiplier();
    const cleared = Math.max(0, difficulty.obstaclesCleared ?? 0);
    // Multiplier grows with cleared obstacles, floored at 1 (never slower than
    // base) and capped at maxMultiplier (stays feasible, Req 7.6).
    const multiplier = clamp(1 + rampPerObstacle * cleared, 1, maxMultiplier);
    return base * multiplier;
  }

  /**
   * World-space grid pitch for Jumping units: the obstacle footprint plus the
   * difficulty gap between consecutive units. Anchoring unit `n` at `n * pitch`
   * makes placement a pure function of difficulty + index — deterministic and
   * stable across overlapping windows.
   */
  function pitchFor(difficulty: Difficulty): number {
    return JUMPING_OBSTACLE_WIDTH_PX + gapFor(difficulty);
  }

  /** Build one ground-resting Jumping unit at world-space left edge `x`. */
  function makeJumpingUnit(index: number, x: number): Obstacle {
    const height = Math.min(
      JUMPING_OBSTACLE_HEIGHT_PX,
      playArea.playHeight * 0.6,
    );
    // Rest on the ground: the block's BASE sits on `groundY`, so its top-left y
    // is groundY - height (y-DOWN, smaller y is higher on screen) (Req 46.1).
    const bounds: Rect[] = [
      {
        x,
        y: playArea.groundY - height,
        width: JUMPING_OBSTACLE_WIDTH_PX,
        height,
      },
    ];
    return {
      // Stable id keyed on the grid index: one id per unit regardless of how
      // many visual rectangles `bounds` holds (Req 9.6, 9.1).
      id: `w1-jumping-${index}`,
      category: 'jumping_obstacle',
      mode: 'jumping',
      bounds,
      // Exactly ONE scoring line per unit — the trailing edge of the block, so
      // the unit credits once when fully surpassed (Req 9.6, 2.3).
      scoringLineX: x + JUMPING_OBSTACLE_WIDTH_PX,
      scored: false,
    };
  }

  /**
   * World-space grid pitch for Flight pillar PAIRS: the pillar footprint plus
   * the difficulty horizontal gap (reused from `gapFor` so density ramps on the
   * same dial as Jumping). Anchoring pair `n` at `n * pitch` keeps placement a
   * pure function of difficulty + index.
   */
  function flightPitchFor(difficulty: Difficulty): number {
    return FLIGHT_PILLAR_WIDTH_PX + gapFor(difficulty);
  }

  /**
   * Deterministic pseudo-random fraction in [0, 1) derived purely from the unit
   * `index`. A small integer hash (xorshift-style mixing of the index) gives a
   * well-spread, repeatable value with NO ambient RNG, so the gap center varies
   * per pair while the layout stays a pure function of its inputs. Not
   * cryptographic — just a stable, cheap scrambler for testable placement.
   */
  function hashFraction(index: number): number {
    // Mix the index into a 32-bit unsigned integer, then normalize.
    let h = (index + 1) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    h = Math.imul(h ^ (h >>> 16), 0x45d9f3b) >>> 0;
    h = (h ^ (h >>> 16)) >>> 0;
    return h / 0x100000000;
  }

  /**
   * Build one Flight pillar PAIR at world-space left edge `x`. The pair is ONE
   * `Obstacle` (one id, one `scoringLineX`) whose `bounds` holds BOTH the top
   * pillar (hanging from the ceiling at `y=0`) and the bottom pillar (rising to
   * the ground line), separated by a navigable vertical gap whose CENTER is a
   * deterministic function of `index` and whose HEIGHT scales with difficulty
   * (Req 3.3, 3.6, 9.6, 46.2).
   */
  function makeFlightUnit(
    index: number,
    x: number,
    difficulty: Difficulty,
  ): Obstacle {
    const gapHeight = flightGapFor(difficulty);
    // The gap center is confined to an interior band so a pillar never vanishes
    // and the corridor is never flush with the ceiling/ground.
    const halfGap = gapHeight / 2;
    const bandLo = FLIGHT_GAP_EDGE_MARGIN_PX + halfGap;
    const bandHi = playArea.playHeight - FLIGHT_GAP_EDGE_MARGIN_PX - halfGap;
    // Degenerate geometry guard: if the play area is too short for the gap +
    // margins, center the gap so both pillars stay non-negative.
    const span = bandHi - bandLo;
    const gapCenter =
      span > 0 ? bandLo + hashFraction(index) * span : playArea.playHeight / 2;

    const gapTop = gapCenter - halfGap; // top edge of the navigable corridor
    const gapBottom = gapCenter + halfGap; // bottom edge of the corridor

    // Top pillar hangs from the ceiling (y=0) down to the gap top.
    const topHeight = Math.max(0, gapTop);
    // Bottom pillar rises from the gap bottom to the ground line.
    const bottomHeight = Math.max(0, playArea.groundY - gapBottom);

    const bounds: Rect[] = [
      { x, y: 0, width: FLIGHT_PILLAR_WIDTH_PX, height: topHeight },
      {
        x,
        y: gapBottom,
        width: FLIGHT_PILLAR_WIDTH_PX,
        height: bottomHeight,
      },
    ];

    return {
      // One stable id per PAIR regardless of the two bound rectangles (Req 9.6).
      id: `w2-flight-${index}`,
      category: 'flight_obstacle',
      mode: 'flight',
      bounds,
      // Exactly ONE scoring line per pair — the trailing edge of the pillars —
      // so the pair credits once when surpassed (Req 3.3, 9.6).
      scoringLineX: x + FLIGHT_PILLAR_WIDTH_PX,
      scored: false,
    };
  }

  /**
   * World-space grid pitch for Underwater ceiling+floor PAIRS: the obstacle
   * column footprint plus the difficulty horizontal gap (reused from `gapFor`
   * so density ramps on the same dial as every other mode). Anchoring pair `n`
   * at `n * pitch` keeps placement a pure function of difficulty + index —
   * deterministic and stable across overlapping windows. Mirrors
   * {@link flightPitchFor} since underwater is Flight's inverse.
   */
  function underwaterPitchFor(difficulty: Difficulty): number {
    return UNDERWATER_OBSTACLE_WIDTH_PX + gapFor(difficulty);
  }

  /**
   * Build one Underwater ceiling+floor PAIR at world-space left edge `x`. The
   * pair is ONE `Obstacle` (one id, one `scoringLineX`) whose `bounds` holds
   * BOTH the CEILING obstacle (hanging from the top at `y=0`, bound index 0)
   * and the FLOOR obstacle (rising from the bottom to the ground line, bound
   * index 1), separated by a navigable vertical gap whose CENTER is a
   * deterministic function of `index` and whose HEIGHT scales with difficulty
   * (Req 5.11, 5.12, 5.13, 38.2, 9.6, 46.4).
   *
   * The bound ORDER is contractual: bound[0] is ALWAYS the ceiling obstacle and
   * bound[1] is ALWAYS the floor obstacle, so the GameplayScene can pick the
   * `ceiling_underwater_obstacle` art for bound 0 and the
   * `floor_underwater_obstacle` art for bound 1.
   */
  function makeUnderwaterUnit(
    index: number,
    x: number,
    difficulty: Difficulty,
  ): Obstacle {
    const gapHeight = underwaterGapFor(difficulty);
    // The gap center is confined to an interior band so an obstacle never
    // vanishes and the corridor is never flush with the ceiling/floor.
    const halfGap = gapHeight / 2;
    const bandLo = UNDERWATER_GAP_EDGE_MARGIN_PX + halfGap;
    const bandHi = playArea.playHeight - UNDERWATER_GAP_EDGE_MARGIN_PX - halfGap;
    // Degenerate geometry guard: if the play area is too short for the gap +
    // margins, center the gap so both obstacles stay non-negative.
    const span = bandHi - bandLo;
    const gapCenter =
      span > 0 ? bandLo + hashFraction(index) * span : playArea.playHeight / 2;

    const gapTop = gapCenter - halfGap; // top edge of the navigable corridor
    const gapBottom = gapCenter + halfGap; // bottom edge of the corridor

    // Ceiling obstacle hangs from the top (y=0) down to the gap top.
    const ceilingHeight = Math.max(0, gapTop);
    // Floor obstacle rises from the gap bottom to the ground line.
    const floorHeight = Math.max(0, playArea.groundY - gapBottom);

    const bounds: Rect[] = [
      // bound[0] = CEILING (from the top).
      { x, y: 0, width: UNDERWATER_OBSTACLE_WIDTH_PX, height: ceilingHeight },
      // bound[1] = FLOOR (from the bottom).
      {
        x,
        y: gapBottom,
        width: UNDERWATER_OBSTACLE_WIDTH_PX,
        height: floorHeight,
      },
    ];

    return {
      // One stable id per PAIR regardless of the two bound rectangles (Req 9.6).
      id: `w4-underwater-${index}`,
      // The GameplayScene resolves bound 0 -> ceiling_underwater_obstacle art
      // and bound 1 -> floor_underwater_obstacle art (Req 5.11, 38.2).
      category: 'underwater_obstacle',
      mode: 'underwater',
      bounds,
      // Exactly ONE scoring line per pair — the trailing edge of the column —
      // so the pair credits once when surpassed (Req 5.3, 9.6).
      scoringLineX: x + UNDERWATER_OBSTACLE_WIDTH_PX,
      scored: false,
    };
  }

  /**
   * World-space grid pitch for Zigzag transition-point MARKERS: the marker
   * footprint plus the difficulty horizontal gap (reused from `gapFor` via
   * {@link transitionSpacingFor}). Anchoring marker `n` at `n * pitch` keeps
   * placement a pure function of difficulty + index — deterministic and stable
   * across overlapping windows, exactly like the Jumping/Flight grids.
   */
  function zigzagPitchFor(difficulty: Difficulty): number {
    return transitionSpacingFor(difficulty);
  }

  /**
   * Build one Zigzag "transition point" MARKER at world-space left edge `x`
   * (Req 4.2). The marker is ONE `Obstacle` (one id, one `scoringLineX`) whose
   * single `bounds` rectangle is a thin vertical cue spanning the corridor
   * INTERIOR (inset from both walls). It is a SCORING cue only: Kino scores
   * exactly once on crossing it. The WALLS bounding the corridor — not this
   * marker — are the hazard, and they live in the play-area geometry the scene
   * enforces, so the GameplayScene excludes zigzag markers from the fatal
   * collision path (Req 4.8, 4.9, 44.4).
   */
  function makeZigzagUnit(index: number, x: number): Obstacle {
    // The cue spans from just below the top wall (y = 0) to just above the
    // bottom wall (y = groundY), inset so it never visually merges into either
    // wall. Guard against a degenerate (too-short) play area.
    const top = ZIGZAG_MARKER_EDGE_INSET_PX;
    const height = Math.max(0, playArea.groundY - 2 * ZIGZAG_MARKER_EDGE_INSET_PX);
    const bounds: Rect[] = [
      { x, y: top, width: ZIGZAG_MARKER_WIDTH_PX, height },
    ];
    return {
      // Stable id keyed on the grid index: one id per transition point (Req 9.6).
      id: `w3-zigzag-${index}`,
      // Resolves to `obstacle:world3_zigzag_wall` art in the scene (placeholder
      // fallback); the same key dresses both the corridor walls and the markers.
      category: 'world3_zigzag_wall',
      mode: 'zigzag',
      bounds,
      // Exactly ONE scoring line per transition point — the trailing edge of the
      // cue, so it credits once when Kino crosses it (Req 4.2, 9.6).
      scoringLineX: x + ZIGZAG_MARKER_WIDTH_PX,
      scored: false,
    };
  }

  function spawnWindow(options: SpawnWindowOptions): Obstacle[] {
    const { scrollX, world, mode, difficulty } = options;
    const windowWidth = Math.max(0, options.windowWidth ?? 0);
    const leadInPx = Math.max(0, options.leadInPx ?? 0);

    // Dispatch by world/mode. Worlds 1 Jumping, 2 Flight, 3 Zigzag, and 4
    // Underwater are implemented; any other world/mode (incl. World 4 + Jumping,
    // excluded by Req 5.8) produces no units, keeping the contract total and
    // side-effect-free.
    if (world === 1 && mode === 'jumping') {
      return spawnJumpingWindow(scrollX, windowWidth, difficulty, leadInPx);
    }
    if (world === 2 && mode === 'flight') {
      return spawnFlightWindow(scrollX, windowWidth, difficulty, leadInPx);
    }
    if (world === 3 && mode === 'zigzag') {
      return spawnZigzagWindow(scrollX, windowWidth, difficulty, leadInPx);
    }
    // World 4 is Underwater; Jumping is EXCLUDED from World 4 (Req 5.8), so a
    // world-4 + jumping request falls through to the empty result below.
    if (world === 4 && mode === 'underwater') {
      return spawnUnderwaterWindow(scrollX, windowWidth, difficulty, leadInPx);
    }
    return [];
  }

  /** Lay out the Jumping units intersecting the world-space window. */
  function spawnJumpingWindow(
    scrollX: number,
    windowWidth: number,
    difficulty: Difficulty,
    leadInPx: number,
  ): Obstacle[] {
    const pitch = pitchFor(difficulty);
    if (!Number.isFinite(pitch) || pitch <= 0) {
      return [];
    }

    // Index math runs in GRID space (anchored at x=0); the lead-in shifts the
    // window back so unit `n` lands at `leadInPx + n*pitch` in world space.
    const windowStart = scrollX - leadInPx;
    const windowEnd = scrollX + windowWidth - leadInPx;

    // Unit `n` occupies left edge `n * pitch`; include a unit when ANY part of
    // its footprint intersects the window, so a unit that is partway on screen
    // is not dropped. First index whose right edge is past the window start:
    const firstIndex = Math.max(
      0,
      Math.ceil((windowStart - JUMPING_OBSTACLE_WIDTH_PX) / pitch),
    );
    // Last index whose left edge is before the window end:
    const lastIndex = Math.floor(windowEnd / pitch);

    const units: Obstacle[] = [];
    for (let index = firstIndex; index <= lastIndex; index++) {
      units.push(makeJumpingUnit(index, leadInPx + index * pitch));
    }
    return units;
  }

  /** Lay out the Flight pillar pairs intersecting the world-space window. */
  function spawnFlightWindow(
    scrollX: number,
    windowWidth: number,
    difficulty: Difficulty,
    leadInPx: number,
  ): Obstacle[] {
    const pitch = flightPitchFor(difficulty);
    if (!Number.isFinite(pitch) || pitch <= 0) {
      return [];
    }

    const windowStart = scrollX - leadInPx;
    const windowEnd = scrollX + windowWidth - leadInPx;

    // Pair `n` occupies left edge `n * pitch`; include when any part of its
    // footprint intersects the window (same anchoring rule as Jumping, so
    // overlapping windows agree on shared pairs by stable id).
    const firstIndex = Math.max(
      0,
      Math.ceil((windowStart - FLIGHT_PILLAR_WIDTH_PX) / pitch),
    );
    const lastIndex = Math.floor(windowEnd / pitch);

    const units: Obstacle[] = [];
    for (let index = firstIndex; index <= lastIndex; index++) {
      units.push(makeFlightUnit(index, leadInPx + index * pitch, difficulty));
    }
    return units;
  }

  /** Lay out the Zigzag transition-point markers intersecting the window. */
  function spawnZigzagWindow(
    scrollX: number,
    windowWidth: number,
    difficulty: Difficulty,
    leadInPx: number,
  ): Obstacle[] {
    const pitch = zigzagPitchFor(difficulty);
    if (!Number.isFinite(pitch) || pitch <= 0) {
      return [];
    }

    const windowStart = scrollX - leadInPx;
    const windowEnd = scrollX + windowWidth - leadInPx;

    // Marker `n` occupies left edge `n * pitch`; include when any part of its
    // footprint intersects the window (same anchoring rule as Jumping/Flight,
    // so overlapping windows agree on shared markers by stable id).
    const firstIndex = Math.max(
      0,
      Math.ceil((windowStart - ZIGZAG_MARKER_WIDTH_PX) / pitch),
    );
    const lastIndex = Math.floor(windowEnd / pitch);

    const units: Obstacle[] = [];
    for (let index = firstIndex; index <= lastIndex; index++) {
      units.push(makeZigzagUnit(index, leadInPx + index * pitch));
    }
    return units;
  }

  /** Lay out the Underwater ceiling+floor pairs intersecting the window. */
  function spawnUnderwaterWindow(
    scrollX: number,
    windowWidth: number,
    difficulty: Difficulty,
    leadInPx: number,
  ): Obstacle[] {
    const pitch = underwaterPitchFor(difficulty);
    if (!Number.isFinite(pitch) || pitch <= 0) {
      return [];
    }

    const windowStart = scrollX - leadInPx;
    const windowEnd = scrollX + windowWidth - leadInPx;

    // Pair `n` occupies left edge `n * pitch`; include when any part of its
    // footprint intersects the window (same anchoring rule as Flight, so
    // overlapping windows agree on shared pairs by stable id).
    const firstIndex = Math.max(
      0,
      Math.ceil((windowStart - UNDERWATER_OBSTACLE_WIDTH_PX) / pitch),
    );
    const lastIndex = Math.floor(windowEnd / pitch);

    const units: Obstacle[] = [];
    for (let index = firstIndex; index <= lastIndex; index++) {
      units.push(makeUnderwaterUnit(index, leadInPx + index * pitch, difficulty));
    }
    return units;
  }

  return {
    spawnWindow,
    scrollSpeed,
    gapFor,
    flightGapFor,
    underwaterGapFor,
    transitionSpacingFor,
  };
}

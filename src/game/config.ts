// Minimal rebuild — tuning config for both worlds.
//
// World 1: Chrome-dino style ground runner (jump over ground obstacles).
// World 2: classic Flappy Bird (flap to stay airborne, fly through pipe gaps).
// Values are px and px/second unless noted. Design surface is 960x960.

export const GAME_WIDTH = 960;
export const GAME_HEIGHT = 960;

/**
 * Shared horizontal screen position for Kino across ALL worlds. Kino is always
 * held at this fixed x while the world scrolls past (Req 45). Keeping it in one
 * place guarantees Kino sits in the same spot in every world.
 */
export const KINO_X = 220;

// ---------------------------------------------------------------------------
// World 1 — ground runner
// ---------------------------------------------------------------------------

/** Y of the ground surface (top of the ground strip). Kino rests here. */
export const GROUND_Y = GAME_HEIGHT - 120;

export interface World1Config {
  /** Downward acceleration applied every second while airborne (px/s^2). */
  gravity: number;
  /** Upward velocity set on a jump (px/s). Negative = up. Sets jump height. */
  jumpVelocity: number;

  /** Horizontal speed obstacles travel toward Kino (px/s). */
  scrollSpeed: number;

  /** Base horizontal distance between obstacles (px). */
  spawnSpacing: number;
  /** Random +/- jitter on spacing (px), so obstacles are not metronome-regular. */
  spawnSpacingJitter: number;

  /** Smallest obstacle width/height (px). */
  obstacleMinWidth: number;
  obstacleMaxWidth: number;
  obstacleMinHeight: number;
  obstacleMaxHeight: number;

  /** Kino's fixed x while running. */
  birdX: number;
  /** Kino's size (square-ish body) for drawing + collision (px). */
  birdWidth: number;
  birdHeight: number;
}

export const WORLD1: World1Config = {
  // Easier: a floatier, higher jump with more hang time so the timing window
  // is forgiving.
  gravity: 3200,
  jumpVelocity: -1150,

  // Easier: obstacles approach more slowly.
  scrollSpeed: 300,

  // Easier: more room between obstacles so you always have time to land and
  // line up the next jump.
  spawnSpacing: 680,
  spawnSpacingJitter: 160,

  // Easier: smaller, shorter obstacles that are simpler to clear.
  obstacleMinWidth: 32,
  obstacleMaxWidth: 56,
  obstacleMinHeight: 45,
  obstacleMaxHeight: 105,

  birdX: KINO_X,
  birdWidth: 54,
  birdHeight: 54,
};

// ---------------------------------------------------------------------------
// World 2 — classic Flappy Bird
// ---------------------------------------------------------------------------

export interface World2Config {
  /** Downward acceleration applied every second (px/s^2). Higher = heavier. */
  gravity: number;
  /** Upward velocity set on each flap (px/s). Negative = up. */
  flapVelocity: number;

  /** Horizontal scroll speed of pipes toward the bird (px/s). */
  scrollSpeed: number;

  /** Vertical gap the bird must fly through (px). */
  gapHeight: number;
  /** Base horizontal distance between pipe pairs (px). */
  spawnSpacing: number;
  /** Random +/- jitter added to spacing (px). */
  spawnSpacingJitter: number;
  /** Width of each pipe (px). */
  pipeWidth: number;
  /** Vertical margin kept away from top/ground when randomizing the gap (px). */
  gapEdgeMargin: number;

  /** Bird's fixed x. */
  birdX: number;
  /** Bird collision radius (px). */
  birdRadius: number;
}

export const WORLD2: World2Config = {
  // Classic Flappy feel, tuned on the forgiving side.
  gravity: 2000,
  flapVelocity: -620,

  scrollSpeed: 260,

  gapHeight: 280,
  spawnSpacing: 420,
  spawnSpacingJitter: 100,
  pipeWidth: 90,
  gapEdgeMargin: 110,

  birdX: KINO_X,
  birdRadius: 24,
};

// ---------------------------------------------------------------------------
// World 3 — Zigzag corridor (Geometry-Dash style, Memory Jungle)
// ---------------------------------------------------------------------------
//
// A corridor of fixed width snakes up and down in a v^v^v^ pattern and scrolls
// left toward Kino. Kino is held at the shared KINO_X and moves only
// vertically on a ~30 degree diagonal (up-diagonal or down-diagonal). The
// primary action flips Kino's vertical direction (Req 4.1) so the player keeps
// Kino inside the moving corridor. Touching a corridor wall ends the run
// (Req 4.9). Each corridor zig/zag vertex Kino passes scores +1 (Req 4.2).

export interface World3Config {
  /** Speed the corridor scrolls left toward Kino (px/s). Also Kino's effective
   * horizontal speed relative to the corridor. */
  scrollSpeed: number;
  /** Diagonal angle of both Kino's motion and the corridor, in degrees (~30). */
  diagonalAngleDeg: number;

  /** Vertical opening of the corridor (px) — the gap Kino must stay within. */
  corridorWidth: number;
  /** How far up/down each corridor segment travels before reversing (px). */
  segmentAmplitude: number;
  /** Vertical center the corridor oscillates around. */
  centerY: number;

  /** Kino's collision radius (px). */
  birdRadius: number;
}

export const WORLD3: World3Config = {
  scrollSpeed: 300,
  diagonalAngleDeg: 30,

  // Wider channel so a slightly mistimed flip doesn't instantly clip a wall.
  corridorWidth: 260,
  segmentAmplitude: 200,
  centerY: GAME_HEIGHT / 2,

  birdRadius: 20,
};

// ---------------------------------------------------------------------------
// World 4 — Underwater Buoyancy (reverse Flappy, Ice & Underwater)
// ---------------------------------------------------------------------------
//
// Inverted Flappy Bird. Continuous upward buoyancy pulls Kino toward the
// ceiling between actions (Req 5.1); the primary action applies a DOWNWARD
// impulse (Req 5.2). Kino weaves through underwater obstacle pairs: cave rocks
// rising from the floor and formations hanging from the ceiling, with a gap
// between. Hitting an obstacle, the ceiling, or the floor ends the run.

export interface World4Config {
  /** Continuous upward acceleration (buoyancy) every second (px/s^2). */
  buoyancy: number;
  /** Downward velocity set on each primary action (px/s). Positive = down. */
  diveVelocity: number;

  /** Horizontal scroll speed of obstacles (px/s). */
  scrollSpeed: number;

  /** Vertical gap between the top and bottom obstacles (px). */
  gapHeight: number;
  /** Base horizontal distance between obstacle pairs (px). */
  spawnSpacing: number;
  /** Random +/- jitter added to spacing (px). */
  spawnSpacingJitter: number;
  /** Width of each obstacle column (px). */
  obstacleWidth: number;
  /** Vertical margin kept away from ceiling/floor when randomizing the gap (px). */
  gapEdgeMargin: number;

  /** Thickness of the ceiling and floor bands (px). */
  edgeThickness: number;

  /** Kino collision radius (px). */
  birdRadius: number;
}

export const WORLD4: World4Config = {
  // Reverse of Flappy: buoyancy up, dive down. Tuned forgiving.
  buoyancy: -1500,
  diveVelocity: 560,

  scrollSpeed: 240,

  gapHeight: 300,
  spawnSpacing: 440,
  spawnSpacingJitter: 110,
  obstacleWidth: 90,
  gapEdgeMargin: 80,

  edgeThickness: 40,

  birdRadius: 24,
};

// ---------------------------------------------------------------------------
// Sequence chaining (Worlds 3 & 4) — mode-switching within a single run
// ---------------------------------------------------------------------------
//
// Worlds 3 and 4 chain multiple movement modes in one run (spec Req 4.4-4.7,
// 5.5). A run plays one mode for a random number of points, then transitions
// seamlessly to the next mode in the cycle: the active obstacle opening lines
// up with the mouth of the next mode's obstacle so Kino crosses a single
// continuous opening as the controls switch.

export type MovementMode = 'flight' | 'zigzag' | 'underwater';

/**
 * Per-world visual theme consumed by the shared SequenceRunner. Paths are asset
 * files the runner preloads under unique keys. Colors are hex ints.
 */
export interface WorldTheme {
  /** Unique key prefix so multiple worlds can coexist in the texture cache. */
  keyPrefix: string;
  /** Flight parallax dune layers (far -> near). Any count (3 or more). */
  duneLayers: string[];
  /** Flight pillar sprites (ceiling, ground). */
  flightPillarUp: string;
  flightPillarGround: string;
  /** Zigzag cave backdrop (tiled parallax). */
  caveBg: string;
  /** Underwater backdrop (tiled parallax) + pillars. */
  underwaterBg: string;
  underwaterPillarUp: string;
  underwaterPillarGround: string;
  /** Flight sky gradient: [topColor, bottomColor]. */
  skyTop: number;
  skyBottom: number;
  /** Flight edge-bar colors. */
  flightTopBar: number;
  flightBottomBar: number;
  /** Edge-bar color during zigzag/cave segments. */
  caveBar: number;
  /**
   * When true, the "underwater" mode is REVERSE GRAVITY: it reuses the FLIGHT
   * dunes + pillars flipped vertically (Y), instead of separate underwater art.
   * The flight top/bottom bar colors also swap. (World 5.)
   */
  reverseGravity?: boolean;
  /** When true, draw the zigzag corridor as a laser (bright-red outer glow +
   * white inner core) instead of plain lines. (World 5.) */
  laserCorridor?: boolean;
  /** When true, draw the zigzag corridor walls as blue icicles with an icy
   * gradient (light-cyan tips -> deeper blue base) instead of plain lines.
   * (World 4.) */
  icyCorridor?: boolean;
  /** Optional STATIC background image, its TOP touching the ceiling and NOT
   * scrolled. Shown during flight. */
  moonBg?: string;
  /** Horizontal center of the moon as a fraction of screen width (default 0.72). */
  moonXFrac?: number;
  /** When true, apply a soft blur to the moon image. */
  moonBlur?: boolean;
}

export interface SequenceConfig {
  /** The mode the run starts in. */
  start: MovementMode;
  /** Points scored within a mode before the next transition. */
  segmentPoints: number;
  /**
   * Allowed next modes per current mode. A transition picks randomly among the
   * listed modes (repeats allowed). This enforces adjacency, e.g. underwater
   * is only reachable from cave.
   */
  adjacency: Record<MovementMode, MovementMode[]>;
  /** Visual theme (backgrounds, pillars, colors). */
  theme: WorldTheme;
}

// Adjacency: flight <-> {flight, cave}; cave <-> {flight, cave, underwater};
// underwater <-> {underwater, cave}. (cave === zigzag.)
const CHAIN_ADJACENCY: Record<MovementMode, MovementMode[]> = {
  flight: ['flight', 'zigzag'],
  zigzag: ['flight', 'zigzag', 'underwater'],
  underwater: ['underwater', 'zigzag'],
};

// World 3 has no underwater, so its adjacency excludes it.
const W3_ADJACENCY: Record<MovementMode, MovementMode[]> = {
  flight: ['flight', 'zigzag'],
  zigzag: ['flight', 'zigzag'],
  underwater: ['zigzag'],
};

const WORLD3_THEME: WorldTheme = {
  keyPrefix: 'w3',
  duneLayers: ['assets/world 3/bg-2.png', 'assets/world 3/bg-1.png', 'assets/world 3/bg-0.png'],
  flightPillarUp: 'assets/world 3/pillar-up.png',
  flightPillarGround: 'assets/world 3/pillar-ground.png',
  caveBg: 'assets/world 3/bg-cave.png',
  // World 3 has no underwater; reuse cave/flight assets as harmless fallbacks.
  underwaterBg: 'assets/world 3/bg-cave.png',
  underwaterPillarUp: 'assets/world 3/pillar-up.png',
  underwaterPillarGround: 'assets/world 3/pillar-ground.png',
  skyTop: 0x0b1030,
  skyBottom: 0xe6803a,
  flightTopBar: 0x0a1230,
  flightBottomBar: 0x06160a,
  caveBar: 0x000000, // black (Memory Jungle)
  moonBg: 'assets/world 3/bg-moon-jungle.png',
  moonXFrac: 0.25, // left side
  moonBlur: true,
};

const WORLD4_THEME: WorldTheme = {
  keyPrefix: 'w4',
  duneLayers: ['assets/world 4/bg-2.png', 'assets/world 4/bg-1.png', 'assets/world 4/bg-0.png'],
  flightPillarUp: 'assets/world 4/ice_pillar_up.png',
  flightPillarGround: 'assets/world 4/ice_pillar_down.png',
  caveBg: 'assets/world 4/ice-cave.png',
  underwaterBg: 'assets/world 4/bg-underwater.png',
  underwaterPillarUp: 'assets/world 4/underwater-up-pillar.png',
  underwaterPillarGround: 'assets/world 4/underwater-down-pillar.png',
  // Light blue at bottom, sky blue at top.
  skyTop: 0x4a90d9,
  skyBottom: 0xbfe3f7,
  flightTopBar: 0x16314a,
  flightBottomBar: 0x1a3a4a,
  caveBar: 0x060a1e, // dark dark blue (Ice)
  moonBg: 'assets/world 4/bg-moon-ice.png',
  moonXFrac: 0.8, // right side
  moonBlur: true,
  icyCorridor: true, // zigzag walls render as blue icicles
};

/** World 3: Flight <-> Zigzag (no underwater). */
export const WORLD3_SEQUENCE: SequenceConfig = {
  start: 'flight',
  segmentPoints: 4,
  adjacency: W3_ADJACENCY,
  theme: WORLD3_THEME,
};

/** World 4: Flight / Zigzag / Underwater, adjacency-constrained. */
export const WORLD4_SEQUENCE: SequenceConfig = {
  start: 'flight',
  segmentPoints: 4,
  adjacency: CHAIN_ADJACENCY,
  theme: WORLD4_THEME,
};

const WORLD5_THEME: WorldTheme = {
  keyPrefix: 'w5',
  // Dune layers (far -> near). bg-4 is NOT here — it's the static moon.
  duneLayers: [
    'assets/world 5/bg-3.png',
    'assets/world 5/bg-2.png',
    'assets/world 5/bg-1.png',
    'assets/world 5/bg-0.png',
  ],
  moonBg: 'assets/world 5/bg-4.png',
  flightPillarUp: 'assets/world 5/pillar-up.png',
  flightPillarGround: 'assets/world 5/pillar-down.png',
  caveBg: 'assets/world 5/bg-cave.png',
  // Reverse gravity reuses the flight dunes + pillars flipped vertically, so
  // the "underwater" asset fields just mirror the flight ones.
  underwaterBg: 'assets/world 5/bg-cave.png', // unused for bg (reverse gravity flips flight dunes)
  underwaterPillarUp: 'assets/world 5/pillar-up.png',
  underwaterPillarGround: 'assets/world 5/pillar-down.png',
  // Sky: pink sunset at the bottom rapidly toward red/dark red at the top.
  skyTop: 0x3a0808,    // dark red (top)
  skyBottom: 0xe85a7a, // pink sunset (bottom)
  flightTopBar: 0x1a0620,  // dark red -> blue (night-sky-ish)
  flightBottomBar: 0x200404, // very dark red
  caveBar: 0x120306, // near-black dark red
  reverseGravity: true,
  laserCorridor: true,
  moonXFrac: 0.5, // center
};

/** World 5: full chain, reverse-gravity + laser theme. */
export const WORLD5_SEQUENCE: SequenceConfig = {
  start: 'flight',
  segmentPoints: 4,
  adjacency: CHAIN_ADJACENCY,
  theme: WORLD5_THEME,
};

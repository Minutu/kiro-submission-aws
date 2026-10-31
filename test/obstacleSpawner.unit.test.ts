// Feature: kino-game
//
// UNIT tests for the pure ObstacleSpawner — tasks 4.5 + 5.1 (design: "Obstacle
// Generation"; Req 2.5, 3.3, 3.6, 45.1, 45.2, 45.4, 46.1, 46.2, 9.6, 7.6/23.3).
//
// These pin the concrete contract for the World 1 Jumping layout AND the
// World 2 Flight pillar-pair layout in the fixed-Kino scrolling model:
//   - obstacles rest on the ground (base sits on groundY) (Req 46.1)
//   - inter-obstacle gaps scale with difficulty and never drop below minGapPx
//     (Req 2.5, 46.1, 23.3)
//   - each obstacle has one unique id and a single scoringLineX even with
//     multiple visual bound rectangles (Req 9.6)
//   - scroll speed ramps from base toward base*maxMultiplier (Req 45, 7.6)
//   - spawnWindow is deterministic for identical inputs
//
// Pure TypeScript, no Phaser. A default BalanceTable is used so the documented
// defaults (baseGap 360, minGap 210, scroll base 220, ramp 2.5, maxMult 2.2)
// drive the assertions.

import { describe, it, expect } from 'vitest';
import { createObstacleSpawner } from '../src/core/index.ts';
import type { PlayArea, Difficulty } from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

const balance = createBalanceTable(); // documented defaults

const PLAY_AREA: PlayArea = { groundY: 600, playHeight: 600 };

function makeSpawner() {
  return createObstacleSpawner(balance, PLAY_AREA);
}

/** A window covering world-space [scrollX, scrollX + width] in Jumping/World 1. */
function jumpingWindow(scrollX: number, width: number, difficulty: Difficulty) {
  return {
    scrollX,
    windowWidth: width,
    world: 1 as const,
    mode: 'jumping' as const,
    difficulty,
  };
}

/** A window covering world-space [scrollX, scrollX + width] in Flight/World 2. */
function flightWindow(scrollX: number, width: number, difficulty: Difficulty) {
  return {
    scrollX,
    windowWidth: width,
    world: 2 as const,
    mode: 'flight' as const,
    difficulty,
  };
}

/** A window covering world-space [scrollX, scrollX + width] in Zigzag/World 3. */
function zigzagWindow(scrollX: number, width: number, difficulty: Difficulty) {
  return {
    scrollX,
    windowWidth: width,
    world: 3 as const,
    mode: 'zigzag' as const,
    difficulty,
  };
}

/** A window covering world-space [scrollX, scrollX + width] in Underwater/World 4. */
function underwaterWindow(
  scrollX: number,
  width: number,
  difficulty: Difficulty,
) {
  return {
    scrollX,
    windowWidth: width,
    world: 4 as const,
    mode: 'underwater' as const,
    difficulty,
  };
}

describe('ObstacleSpawner — World 1 Jumping layout (Req 46.1)', () => {
  it('rests every obstacle on the ground (base sits on groundY)', () => {
    const spawner = makeSpawner();
    const units = spawner.spawnWindow(
      jumpingWindow(0, 2000, { ramp: 0 }),
    );
    expect(units.length).toBeGreaterThan(0);
    for (const unit of units) {
      for (const rect of unit.bounds) {
        // y-DOWN: the base of the rect is y + height; it must sit exactly on
        // the ground line, and the top must be above the ground.
        expect(rect.y + rect.height).toBe(PLAY_AREA.groundY);
        expect(rect.y).toBeLessThan(PLAY_AREA.groundY);
        expect(rect.height).toBeGreaterThan(0);
      }
    }
  });

  it('gives each obstacle a single scoringLineX and a stable unique id', () => {
    const spawner = makeSpawner();
    const units = spawner.spawnWindow(
      jumpingWindow(0, 2000, { ramp: 0 }),
    );
    const ids = units.map((u) => u.id);
    // Unique ids — one scoring key per unit (Req 9.6, 9.1).
    expect(new Set(ids).size).toBe(ids.length);
    for (const unit of units) {
      // A single scoring line regardless of how many bound rects exist.
      expect(typeof unit.scoringLineX).toBe('number');
      expect(unit.scored).toBe(false);
      expect(unit.mode).toBe('jumping');
      expect(unit.bounds.length).toBeGreaterThanOrEqual(1);
    }
  });

  it('places scoringLineX at the trailing edge of the unit footprint', () => {
    const spawner = makeSpawner();
    const units = spawner.spawnWindow(
      jumpingWindow(0, 2000, { ramp: 0 }),
    );
    for (const unit of units) {
      const rect = unit.bounds[0]!;
      expect(unit.scoringLineX).toBe(rect.x + rect.width);
    }
  });

  it('returns no units for worlds/modes not implemented', () => {
    const spawner = makeSpawner();
    // World 2 + jumping is not a valid pairing (World 2 is Flight).
    expect(
      spawner.spawnWindow({
        scrollX: 0,
        windowWidth: 2000,
        world: 2,
        mode: 'jumping',
        difficulty: { ramp: 0 },
      }),
    ).toEqual([]);
    // World 1 + flight is not a valid pairing (World 1 is Jumping).
    expect(
      spawner.spawnWindow({
        scrollX: 0,
        windowWidth: 2000,
        world: 1,
        mode: 'flight',
        difficulty: { ramp: 0 },
      }),
    ).toEqual([]);
    // World 3 + flight is not a valid pairing (World 3 zigzag is handled below).
    expect(
      spawner.spawnWindow({
        scrollX: 0,
        windowWidth: 2000,
        world: 3,
        mode: 'flight',
        difficulty: { ramp: 0 },
      }),
    ).toEqual([]);
    // World 4 + jumping is not a valid pairing: Jumping is EXCLUDED from
    // World 4 (Req 5.8), so the spawner emits no units for it.
    expect(
      spawner.spawnWindow({
        scrollX: 0,
        windowWidth: 2000,
        world: 4,
        mode: 'jumping',
        difficulty: { ramp: 0 },
      }),
    ).toEqual([]);
    // World 5 + any implemented mode has no layout yet -> none.
    expect(
      spawner.spawnWindow({
        scrollX: 0,
        windowWidth: 2000,
        world: 5,
        mode: 'flight',
        difficulty: { ramp: 0 },
      }),
    ).toEqual([]);
  });
});

describe('ObstacleSpawner — difficulty-scaled gaps (Req 2.5, 46.1, 23.3)', () => {
  it('uses the base gap at ramp=0 and narrows toward minGap at ramp=1', () => {
    const spawner = makeSpawner();
    const baseGap = spawner.gapFor({ ramp: 0 });
    const hardGap = spawner.gapFor({ ramp: 1 });
    expect(baseGap).toBe(balance.baseGapPx()); // 360
    expect(hardGap).toBe(balance.minGapPx()); // 210
    expect(hardGap).toBeLessThan(baseGap);
  });

  it('is monotonically non-increasing as the ramp climbs', () => {
    const spawner = makeSpawner();
    let prev = Infinity;
    for (let r = 0; r <= 1.0001; r += 0.1) {
      const gap = spawner.gapFor({ ramp: r });
      expect(gap).toBeLessThanOrEqual(prev + 1e-9);
      prev = gap;
    }
  });

  it('never produces a gap below minGapPx, even for out-of-range ramp', () => {
    const spawner = makeSpawner();
    const min = balance.minGapPx();
    for (const ramp of [-5, 0, 0.5, 1, 5, 100]) {
      expect(spawner.gapFor({ ramp })).toBeGreaterThanOrEqual(min);
    }
  });

  it('packs obstacles closer together at higher difficulty', () => {
    const spawner = makeSpawner();
    const easy = spawner.spawnWindow(jumpingWindow(0, 2000, { ramp: 0 }));
    const hard = spawner.spawnWindow(jumpingWindow(0, 2000, { ramp: 1 }));
    // Narrower gaps => more units fit in the same window width.
    expect(hard.length).toBeGreaterThan(easy.length);
  });
});

describe('ObstacleSpawner — scroll speed (Req 45, 7.6)', () => {
  it('equals base when no obstacles cleared', () => {
    const spawner = makeSpawner();
    expect(spawner.scrollSpeed({ ramp: 0 })).toBe(balance.scrollSpeedBase());
    expect(spawner.scrollSpeed({ ramp: 0, obstaclesCleared: 0 })).toBe(
      balance.scrollSpeedBase(),
    );
  });

  it('ramps up with cleared obstacles and caps at base * maxMultiplier', () => {
    const spawner = makeSpawner();
    const base = balance.scrollSpeedBase();
    const cap = base * balance.scrollSpeedMaxMultiplier();

    const some = spawner.scrollSpeed({ ramp: 0, obstaclesCleared: 10 });
    expect(some).toBeGreaterThan(base);
    expect(some).toBeLessThanOrEqual(cap);

    // Far past the cap-reaching count stays clamped at the cap.
    const capped = spawner.scrollSpeed({ ramp: 0, obstaclesCleared: 100000 });
    expect(capped).toBeCloseTo(cap, 6);
  });

  it('never goes below base for a negative cleared count', () => {
    const spawner = makeSpawner();
    expect(
      spawner.scrollSpeed({ ramp: 0, obstaclesCleared: -50 }),
    ).toBe(balance.scrollSpeedBase());
  });
});

describe('ObstacleSpawner — determinism (pure function of inputs)', () => {
  it('produces identical units for identical inputs', () => {
    const spawner = makeSpawner();
    const a = spawner.spawnWindow(jumpingWindow(123, 1500, { ramp: 0.3 }));
    const b = spawner.spawnWindow(jumpingWindow(123, 1500, { ramp: 0.3 }));
    expect(a).toEqual(b);
  });

  it('two spawners built from the same inputs agree', () => {
    const s1 = createObstacleSpawner(balance, PLAY_AREA);
    const s2 = createObstacleSpawner(balance, PLAY_AREA);
    const w = jumpingWindow(500, 1000, { ramp: 0.5 });
    expect(s1.spawnWindow(w)).toEqual(s2.spawnWindow(w));
  });

  it('overlapping windows agree on shared units (stable ids/positions)', () => {
    const spawner = makeSpawner();
    const difficulty = { ramp: 0 };
    const windowA = spawner.spawnWindow(jumpingWindow(0, 1500, difficulty));
    const windowB = spawner.spawnWindow(jumpingWindow(500, 1500, difficulty));

    const byId = new Map(windowA.map((u) => [u.id, u]));
    const shared = windowB.filter((u) => byId.has(u.id));
    // The windows overlap in world space, so there must be shared units.
    expect(shared.length).toBeGreaterThan(0);
    for (const unit of shared) {
      expect(byId.get(unit.id)).toEqual(unit);
    }
  });
});

// ---------------------------------------------------------------------------
// Task 5.1 — World 2 Flight pillar-pair layout (Req 3.3, 3.6, 9.6, 46.2)
//
// The Flight layout produces FLAPPY-style pillar PAIRS: each pair is ONE
// `Obstacle` (one id, one scoringLineX) whose `bounds` holds BOTH a top pillar
// (from the ceiling) and a bottom pillar (to the ground), with a navigable
// vertical gap between them. These tests pin: pair = one unit with two bounds +
// one scoring line (9.6), a navigable gap exists (3.6), the gap height scales
// with difficulty, and the whole layout is deterministic.
// ---------------------------------------------------------------------------

describe('ObstacleSpawner — World 2 Flight layout (Req 3.6, 46.2)', () => {
  it('spawns pairs: each unit is ONE obstacle with TWO bounds and ONE scoringLineX', () => {
    const spawner = makeSpawner();
    const units = spawner.spawnWindow(flightWindow(0, 2000, { ramp: 0 }));
    expect(units.length).toBeGreaterThan(0);

    const ids = units.map((u) => u.id);
    // One scoring key per pair, unique across the window (Req 9.6, 9.1).
    expect(new Set(ids).size).toBe(ids.length);

    for (const unit of units) {
      expect(unit.mode).toBe('flight');
      expect(unit.scored).toBe(false);
      // A pillar PAIR holds exactly two visual rectangles...
      expect(unit.bounds.length).toBe(2);
      // ...but still exactly ONE scoring line (Req 3.3, 9.6).
      expect(typeof unit.scoringLineX).toBe('number');
      // Both pillars share the same x column and the scoring line sits on the
      // trailing edge of that column.
      const [top, bottom] = unit.bounds;
      expect(top!.x).toBe(bottom!.x);
      expect(top!.width).toBe(bottom!.width);
      expect(unit.scoringLineX).toBe(top!.x + top!.width);
    }
  });

  it('places a top pillar from the ceiling and a bottom pillar to the ground', () => {
    const spawner = makeSpawner();
    const units = spawner.spawnWindow(flightWindow(0, 2000, { ramp: 0 }));
    for (const unit of units) {
      const [top, bottom] = unit.bounds;
      // Top pillar hangs from the ceiling (y = 0 downward).
      expect(top!.y).toBe(0);
      expect(top!.height).toBeGreaterThan(0);
      // Bottom pillar's base sits exactly on the ground line.
      expect(bottom!.y + bottom!.height).toBe(PLAY_AREA.groundY);
      expect(bottom!.height).toBeGreaterThan(0);
      // The top pillar ends ABOVE the bottom pillar begins — i.e. a real gap.
      expect(top!.height).toBeLessThan(bottom!.y);
    }
  });

  it('leaves a navigable vertical gap between the pillars (Req 3.6)', () => {
    const spawner = makeSpawner();
    const units = spawner.spawnWindow(flightWindow(0, 3000, { ramp: 0 }));
    for (const unit of units) {
      const [top, bottom] = unit.bounds;
      const gapTop = top!.height; // bottom edge of the top pillar
      const gapBottom = bottom!.y; // top edge of the bottom pillar
      const gap = gapBottom - gapTop;
      // The corridor must be wide enough for Kino's ~48px body to pass.
      expect(gap).toBeGreaterThan(48);
      // The gap must fit inside the play area (no pillar overshoots).
      expect(gapTop).toBeGreaterThanOrEqual(0);
      expect(gapBottom).toBeLessThanOrEqual(PLAY_AREA.groundY);
    }
  });

  it('varies the gap center across pairs (not a flat corridor)', () => {
    const spawner = makeSpawner();
    const units = spawner.spawnWindow(flightWindow(0, 4000, { ramp: 0 }));
    expect(units.length).toBeGreaterThan(2);
    const centers = units.map((u) => {
      const [top, bottom] = u.bounds;
      return (top!.height + bottom!.y) / 2;
    });
    // At least two distinct gap centers => the run is not a flat corridor.
    expect(new Set(centers.map((c) => Math.round(c))).size).toBeGreaterThan(1);
  });
});

describe('ObstacleSpawner — Flight gap difficulty scaling (Req 3.6, 23.3)', () => {
  it('narrows the vertical gap as the ramp climbs but keeps it feasible', () => {
    const spawner = makeSpawner();
    const easy = spawner.flightGapFor({ ramp: 0 });
    const hard = spawner.flightGapFor({ ramp: 1 });
    expect(hard).toBeLessThan(easy);
    // Even at the hardest ramp the gap stays comfortably above Kino's body.
    expect(hard).toBeGreaterThan(48);
  });

  it('is monotonically non-increasing as the ramp climbs', () => {
    const spawner = makeSpawner();
    let prev = Infinity;
    for (let r = 0; r <= 1.0001; r += 0.1) {
      const gap = spawner.flightGapFor({ ramp: r });
      expect(gap).toBeLessThanOrEqual(prev + 1e-9);
      prev = gap;
    }
  });

  it('never collapses the gap below the feasible floor, even out-of-range', () => {
    const spawner = makeSpawner();
    const floor = spawner.flightGapFor({ ramp: 1 });
    for (const ramp of [-5, 0, 0.5, 1, 5, 100]) {
      expect(spawner.flightGapFor({ ramp })).toBeGreaterThanOrEqual(floor);
    }
  });

  it('packs more pillar pairs into the window at higher horizontal difficulty', () => {
    const spawner = makeSpawner();
    const easy = spawner.spawnWindow(flightWindow(0, 3000, { ramp: 0 }));
    const hard = spawner.spawnWindow(flightWindow(0, 3000, { ramp: 1 }));
    // Horizontal spacing reuses gapFor, so a higher ramp => more pairs fit.
    expect(hard.length).toBeGreaterThan(easy.length);
  });
});

describe('ObstacleSpawner — Flight determinism (pure function of inputs)', () => {
  it('produces identical pairs for identical inputs', () => {
    const spawner = makeSpawner();
    const a = spawner.spawnWindow(flightWindow(321, 1800, { ramp: 0.4 }));
    const b = spawner.spawnWindow(flightWindow(321, 1800, { ramp: 0.4 }));
    expect(a).toEqual(b);
  });

  it('two spawners built from the same inputs agree', () => {
    const s1 = createObstacleSpawner(balance, PLAY_AREA);
    const s2 = createObstacleSpawner(balance, PLAY_AREA);
    const w = flightWindow(700, 1200, { ramp: 0.5 });
    expect(s1.spawnWindow(w)).toEqual(s2.spawnWindow(w));
  });

  it('overlapping windows agree on shared pairs (stable ids + geometry)', () => {
    const spawner = makeSpawner();
    const difficulty = { ramp: 0 };
    const windowA = spawner.spawnWindow(flightWindow(0, 1800, difficulty));
    const windowB = spawner.spawnWindow(flightWindow(600, 1800, difficulty));

    const byId = new Map(windowA.map((u) => [u.id, u]));
    const shared = windowB.filter((u) => byId.has(u.id));
    expect(shared.length).toBeGreaterThan(0);
    for (const unit of shared) {
      expect(byId.get(unit.id)).toEqual(unit);
    }
  });
});

// ---------------------------------------------------------------------------
// Task 5.2 — World 3 Zigzag transition-point markers (Req 4.2, 4.8, 9.6, 46.3)
//
// Zigzag bounds the corridor with a top + bottom WALL (enforced by the
// GameplayScene, not emitted as scrollable units). What the spawner emits is
// the stream of SCORING "transition point" markers Kino crosses to score: one
// `Obstacle` per marker, each with ONE stable `id` and ONE `scoringLineX`, at a
// difficulty-scaled horizontal spacing (reusing `gapFor`). These tests pin:
// marker = one unit with one id + one scoringLineX (9.6), spacing scales with
// difficulty (23.3), and the whole layout is deterministic/stable across
// overlapping windows.
// ---------------------------------------------------------------------------

describe('ObstacleSpawner — World 3 Zigzag transition points (Req 4.2, 46.3)', () => {
  it('emits markers with ONE stable id + ONE scoringLineX each', () => {
    const spawner = makeSpawner();
    const units = spawner.spawnWindow(zigzagWindow(0, 2000, { ramp: 0 }));
    expect(units.length).toBeGreaterThan(0);

    const ids = units.map((u) => u.id);
    // Unique ids — one scoring key per transition point (Req 9.6, 9.1).
    expect(new Set(ids).size).toBe(ids.length);

    for (const unit of units) {
      expect(unit.mode).toBe('zigzag');
      expect(unit.scored).toBe(false);
      // A single scoring line per transition point.
      expect(typeof unit.scoringLineX).toBe('number');
      // One visual cue rectangle (not a pair); it is a crossing cue, not a wall.
      expect(unit.bounds.length).toBe(1);
      const cue = unit.bounds[0]!;
      // The scoring line sits on the trailing edge of the cue footprint.
      expect(unit.scoringLineX).toBe(cue.x + cue.width);
    }
  });

  it('spans the corridor interior inset from both walls (cue, not hazard)', () => {
    const spawner = makeSpawner();
    const units = spawner.spawnWindow(zigzagWindow(0, 2000, { ramp: 0 }));
    for (const unit of units) {
      const cue = unit.bounds[0]!;
      // Inset below the top wall (y=0) and above the bottom wall (groundY).
      expect(cue.y).toBeGreaterThan(0);
      expect(cue.y + cue.height).toBeLessThan(PLAY_AREA.groundY);
      expect(cue.height).toBeGreaterThan(0);
    }
  });

  it('uses the world3 zigzag wall category for its markers', () => {
    const spawner = makeSpawner();
    const units = spawner.spawnWindow(zigzagWindow(0, 1500, { ramp: 0 }));
    for (const unit of units) {
      expect(unit.category).toBe('world3_zigzag_wall');
    }
  });
});

describe('ObstacleSpawner — Zigzag spacing difficulty scaling (Req 4.2, 23.3)', () => {
  it('tightens the horizontal spacing as the ramp climbs', () => {
    const spawner = makeSpawner();
    const easy = spawner.transitionSpacingFor({ ramp: 0 });
    const hard = spawner.transitionSpacingFor({ ramp: 1 });
    expect(hard).toBeLessThan(easy);
  });

  it('is monotonically non-increasing as the ramp climbs', () => {
    const spawner = makeSpawner();
    let prev = Infinity;
    for (let r = 0; r <= 1.0001; r += 0.1) {
      const spacing = spawner.transitionSpacingFor({ ramp: r });
      expect(spacing).toBeLessThanOrEqual(prev + 1e-9);
      prev = spacing;
    }
  });

  it('inherits the minGapPx floor so markers never collapse together', () => {
    const spawner = makeSpawner();
    const min = balance.minGapPx();
    for (const ramp of [-5, 0, 0.5, 1, 5, 100]) {
      // Spacing is marker footprint + gapFor; it must stay above the gap floor.
      expect(spawner.transitionSpacingFor({ ramp })).toBeGreaterThan(min);
    }
  });

  it('packs more transition points into the window at higher difficulty', () => {
    const spawner = makeSpawner();
    const easy = spawner.spawnWindow(zigzagWindow(0, 3000, { ramp: 0 }));
    const hard = spawner.spawnWindow(zigzagWindow(0, 3000, { ramp: 1 }));
    expect(hard.length).toBeGreaterThan(easy.length);
  });
});

describe('ObstacleSpawner — Zigzag determinism (pure function of inputs)', () => {
  it('produces identical markers for identical inputs', () => {
    const spawner = makeSpawner();
    const a = spawner.spawnWindow(zigzagWindow(222, 1600, { ramp: 0.4 }));
    const b = spawner.spawnWindow(zigzagWindow(222, 1600, { ramp: 0.4 }));
    expect(a).toEqual(b);
  });

  it('two spawners built from the same inputs agree', () => {
    const s1 = createObstacleSpawner(balance, PLAY_AREA);
    const s2 = createObstacleSpawner(balance, PLAY_AREA);
    const w = zigzagWindow(800, 1400, { ramp: 0.5 });
    expect(s1.spawnWindow(w)).toEqual(s2.spawnWindow(w));
  });

  it('overlapping windows agree on shared markers (stable ids + geometry)', () => {
    const spawner = makeSpawner();
    const difficulty = { ramp: 0 };
    const windowA = spawner.spawnWindow(zigzagWindow(0, 1800, difficulty));
    const windowB = spawner.spawnWindow(zigzagWindow(600, 1800, difficulty));

    const byId = new Map(windowA.map((u) => [u.id, u]));
    const shared = windowB.filter((u) => byId.has(u.id));
    expect(shared.length).toBeGreaterThan(0);
    for (const unit of shared) {
      expect(byId.get(unit.id)).toEqual(unit);
    }
  });
});

// ---------------------------------------------------------------------------
// Task 5.3 — World 4 Underwater ceiling/floor pairs (Req 5.11, 5.12, 5.13,
// 38.2, 46.4, 9.6)
//
// Underwater is the INVERSE of Flight: each unit is ONE `Obstacle` (one id, one
// scoringLineX) whose `bounds` holds TWO rectangles — a CEILING obstacle from
// the top (bound index 0) and a FLOOR obstacle from the bottom (bound index 1)
// — separated by a navigable vertical gap. These tests pin: pair = one unit
// with two bounds + one scoring line (9.6), ceiling-from-top + floor-from-
// bottom placement with a navigable gap (5.11-5.13), difficulty scaling (23.3),
// determinism, and that World 4 + Jumping yields no units at the spawner level
// (5.8).
// ---------------------------------------------------------------------------

describe('ObstacleSpawner — World 4 Underwater layout (Req 5.11-5.13, 46.4)', () => {
  it('spawns pairs: each unit is ONE obstacle with TWO bounds and ONE scoringLineX', () => {
    const spawner = makeSpawner();
    const units = spawner.spawnWindow(underwaterWindow(0, 2000, { ramp: 0 }));
    expect(units.length).toBeGreaterThan(0);

    const ids = units.map((u) => u.id);
    // One scoring key per pair, unique across the window (Req 9.6, 9.1).
    expect(new Set(ids).size).toBe(ids.length);

    for (const unit of units) {
      expect(unit.mode).toBe('underwater');
      expect(unit.category).toBe('underwater_obstacle');
      expect(unit.scored).toBe(false);
      // A ceiling+floor PAIR holds exactly two visual rectangles...
      expect(unit.bounds.length).toBe(2);
      // ...but still exactly ONE scoring line (Req 5.3, 9.6).
      expect(typeof unit.scoringLineX).toBe('number');
      // Both obstacles share the same x column; the scoring line sits on the
      // trailing edge of that column.
      const [ceiling, floor] = unit.bounds;
      expect(ceiling!.x).toBe(floor!.x);
      expect(ceiling!.width).toBe(floor!.width);
      expect(unit.scoringLineX).toBe(ceiling!.x + ceiling!.width);
    }
  });

  it('places a CEILING obstacle from the top (bound 0) and a FLOOR obstacle from the bottom (bound 1)', () => {
    const spawner = makeSpawner();
    const units = spawner.spawnWindow(underwaterWindow(0, 2000, { ramp: 0 }));
    for (const unit of units) {
      const [ceiling, floor] = unit.bounds;
      // Ceiling obstacle hangs from the top (y = 0 downward) — bound index 0.
      expect(ceiling!.y).toBe(0);
      expect(ceiling!.height).toBeGreaterThan(0);
      // Floor obstacle's base sits exactly on the ground line — bound index 1.
      expect(floor!.y + floor!.height).toBe(PLAY_AREA.groundY);
      expect(floor!.height).toBeGreaterThan(0);
      // The ceiling ends ABOVE the floor begins — i.e. a real gap.
      expect(ceiling!.height).toBeLessThan(floor!.y);
    }
  });

  it('leaves a navigable vertical gap between ceiling and floor (Req 5.13)', () => {
    const spawner = makeSpawner();
    const units = spawner.spawnWindow(underwaterWindow(0, 3000, { ramp: 0 }));
    for (const unit of units) {
      const [ceiling, floor] = unit.bounds;
      const gapTop = ceiling!.height; // bottom edge of the ceiling obstacle
      const gapBottom = floor!.y; // top edge of the floor obstacle
      const gap = gapBottom - gapTop;
      // The corridor must be wide enough for Kino's ~48px body to pass.
      expect(gap).toBeGreaterThan(48);
      // The gap must fit inside the play area (no obstacle overshoots).
      expect(gapTop).toBeGreaterThanOrEqual(0);
      expect(gapBottom).toBeLessThanOrEqual(PLAY_AREA.groundY);
    }
  });

  it('varies the gap center across pairs (not a flat corridor)', () => {
    const spawner = makeSpawner();
    const units = spawner.spawnWindow(underwaterWindow(0, 4000, { ramp: 0 }));
    expect(units.length).toBeGreaterThan(2);
    const centers = units.map((u) => {
      const [ceiling, floor] = u.bounds;
      return (ceiling!.height + floor!.y) / 2;
    });
    expect(new Set(centers.map((c) => Math.round(c))).size).toBeGreaterThan(1);
  });

  it('emits NO units for World 4 + Jumping (Jumping excluded, Req 5.8)', () => {
    const spawner = makeSpawner();
    expect(
      spawner.spawnWindow({
        scrollX: 0,
        windowWidth: 2000,
        world: 4,
        mode: 'jumping',
        difficulty: { ramp: 0 },
      }),
    ).toEqual([]);
  });
});

describe('ObstacleSpawner — Underwater gap difficulty scaling (Req 5.13, 23.3)', () => {
  it('narrows the vertical gap as the ramp climbs but keeps it feasible', () => {
    const spawner = makeSpawner();
    const easy = spawner.underwaterGapFor({ ramp: 0 });
    const hard = spawner.underwaterGapFor({ ramp: 1 });
    expect(hard).toBeLessThan(easy);
    // Even at the hardest ramp the gap stays comfortably above Kino's body.
    expect(hard).toBeGreaterThan(48);
  });

  it('is monotonically non-increasing as the ramp climbs', () => {
    const spawner = makeSpawner();
    let prev = Infinity;
    for (let r = 0; r <= 1.0001; r += 0.1) {
      const gap = spawner.underwaterGapFor({ ramp: r });
      expect(gap).toBeLessThanOrEqual(prev + 1e-9);
      prev = gap;
    }
  });

  it('never collapses the gap below the feasible floor, even out-of-range', () => {
    const spawner = makeSpawner();
    const floor = spawner.underwaterGapFor({ ramp: 1 });
    for (const ramp of [-5, 0, 0.5, 1, 5, 100]) {
      expect(spawner.underwaterGapFor({ ramp })).toBeGreaterThanOrEqual(floor);
    }
  });

  it('packs more ceiling/floor pairs into the window at higher horizontal difficulty', () => {
    const spawner = makeSpawner();
    const easy = spawner.spawnWindow(underwaterWindow(0, 3000, { ramp: 0 }));
    const hard = spawner.spawnWindow(underwaterWindow(0, 3000, { ramp: 1 }));
    // Horizontal spacing reuses gapFor, so a higher ramp => more pairs fit.
    expect(hard.length).toBeGreaterThan(easy.length);
  });
});

describe('ObstacleSpawner — Underwater determinism (pure function of inputs)', () => {
  it('produces identical pairs for identical inputs', () => {
    const spawner = makeSpawner();
    const a = spawner.spawnWindow(underwaterWindow(444, 1800, { ramp: 0.4 }));
    const b = spawner.spawnWindow(underwaterWindow(444, 1800, { ramp: 0.4 }));
    expect(a).toEqual(b);
  });

  it('two spawners built from the same inputs agree', () => {
    const s1 = createObstacleSpawner(balance, PLAY_AREA);
    const s2 = createObstacleSpawner(balance, PLAY_AREA);
    const w = underwaterWindow(900, 1200, { ramp: 0.5 });
    expect(s1.spawnWindow(w)).toEqual(s2.spawnWindow(w));
  });

  it('overlapping windows agree on shared pairs (stable ids + geometry)', () => {
    const spawner = makeSpawner();
    const difficulty = { ramp: 0 };
    const windowA = spawner.spawnWindow(underwaterWindow(0, 1800, difficulty));
    const windowB = spawner.spawnWindow(underwaterWindow(600, 1800, difficulty));

    const byId = new Map(windowA.map((u) => [u.id, u]));
    const shared = windowB.filter((u) => byId.has(u.id));
    expect(shared.length).toBeGreaterThan(0);
    for (const unit of shared) {
      expect(byId.get(unit.id)).toEqual(unit);
    }
  });
});

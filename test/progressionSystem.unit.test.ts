// Feature: kino-game
//
// Unit tests for the ProgressionSystem world-unlock + endless-continuation flow
// (task 7.3; design: "World unlock flow (Req 7.1–7.8)", "Difficulty ramp (Req
// 7.6, 23.3)"; Req 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8).
//
// These pin the concrete flow contract:
//   - Req 7.1: crossing the 50-point threshold emits a ONE-TIME unlock intent
//     for the NEXT world — and fires on exactly one tick, never again.
//   - Req 7.2-7.3: the crossing tick emits the ordered message sequence
//     [newWorldUnlocked, endlessStarting].
//   - Req 7.4-7.5: the SAME run continues (phase → endlessContinuation) with NO
//     auto-transition (the system never "moves to" the next world itself).
//   - Req 7.6: `difficulty(obstaclesCleared)` ramps PAST 50 for worlds 1-4 and
//     stays within the ObstacleSpawner's feasible bounds (fed through, the
//     spawner's floors/caps hold).
//   - Req 23.2 / 8.1: the final World 5 has no next world and no endless — the
//     threshold event never fires there.
//   - Req 7.8: `unlockedWorlds` reads the selectable worlds from a save map.
//
// PURE / Phaser-free; all behavior is a deterministic function of inputs.

import { describe, it, expect } from 'vitest';
import {
  createProgressionSystem,
  computeNextWorld,
  unlockedWorlds,
  createObstacleSpawner,
  type WorldId,
} from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

/** A BalanceTable from documented defaults (worldUnlockThreshold = 50). */
function balance() {
  return createBalanceTable();
}

describe('ProgressionSystem — world-unlock threshold event (Req 7.1-7.5)', () => {
  it('emits the next-world unlock + ordered messages exactly once at 50 points', () => {
    const prog = createProgressionSystem(balance(), { world: 1 });
    expect(prog.threshold).toBe(50);
    expect(prog.nextWorld).toBe(2);
    expect(prog.supportsEndless).toBe(true);
    expect(prog.phase()).toBe('preThreshold');

    // Below threshold: no event.
    const before = prog.onScore(49);
    expect(before.justCrossed).toBe(false);
    expect(before.unlock).toBeNull();
    expect(before.messages).toEqual([]);
    expect(prog.phase()).toBe('preThreshold');

    // Crossing tick: one-time unlock of the NEXT world + ordered messages.
    const at = prog.onScore(50);
    expect(at.justCrossed).toBe(true);
    expect(at.unlock).toEqual({ world: 2 });
    // Req 7.2 then 7.3, in order.
    expect(at.messages).toEqual(['newWorldUnlocked', 'endlessStarting']);
    // Req 7.4: the SAME run continues into endless (not a new run / world).
    expect(prog.phase()).toBe('endlessContinuation');
  });

  it('never re-fires the unlock as the score climbs past 50 (Req 7.1, 7.5)', () => {
    const prog = createProgressionSystem(balance(), { world: 3 });
    prog.onScore(50); // crossing

    for (const s of [51, 60, 100, 999]) {
      const ev = prog.onScore(s);
      expect(ev.justCrossed).toBe(false);
      expect(ev.unlock).toBeNull();
      expect(ev.messages).toEqual([]);
      expect(ev.phase).toBe('endlessContinuation');
    }
    expect(prog.phase()).toBe('endlessContinuation');
  });

  it('does NOT auto-transition — it only unlocks, the run stays on the same world (Req 7.5)', () => {
    const prog = createProgressionSystem(balance(), { world: 2 });
    const at = prog.onScore(80);
    // The intent is to UNLOCK world 3, but the run is still world 2.
    expect(at.unlock).toEqual({ world: 3 });
    expect(prog.world).toBe(2);
    expect(prog.phase()).toBe('endlessContinuation');
  });
});

describe('ProgressionSystem — final world has no next / no endless (Req 23.2, 8.1)', () => {
  it('World 5 has no next world and never crosses the threshold', () => {
    const prog = createProgressionSystem(balance(), { world: 5 });
    expect(prog.nextWorld).toBeNull();
    expect(prog.supportsEndless).toBe(false);

    for (const s of [49, 50, 100, 500]) {
      const ev = prog.onScore(s);
      expect(ev.justCrossed).toBe(false);
      expect(ev.unlock).toBeNull();
      expect(ev.messages).toEqual([]);
      expect(ev.phase).toBe('preThreshold');
    }
    expect(prog.phase()).toBe('preThreshold');
  });

  it('computeNextWorld caps at World 5', () => {
    expect(computeNextWorld(1)).toBe(2);
    expect(computeNextWorld(4)).toBe(5);
    expect(computeNextWorld(5)).toBeNull();
  });
});

describe('ProgressionSystem — beyond-50 difficulty ramp stays feasible (Req 7.6)', () => {
  it('ramps gap + speed past the threshold while staying within the spawner bounds', () => {
    const b = balance();
    const prog = createProgressionSystem(b, { world: 1 });
    const spawner = createObstacleSpawner(b, { groundY: 600, playHeight: 600 });

    const minGap = b.minGapPx();
    const baseGap = b.baseGapPx();
    const baseSpeed = b.scrollSpeedBase();
    const maxSpeed = baseSpeed * b.scrollSpeedMaxMultiplier();

    // Sample cleared counts spanning the pre-50 region and well into endless.
    const samples = [0, 10, 30, 60, 120, 240, 1000];

    let prevGap = Infinity;
    let prevSpeed = -Infinity;
    for (const cleared of samples) {
      const d = prog.difficulty(cleared);
      // ramp is a normalized, clamped dial.
      expect(d.ramp).toBeGreaterThanOrEqual(0);
      expect(d.ramp).toBeLessThanOrEqual(1);
      expect(d.obstaclesCleared).toBe(cleared);

      const gap = spawner.gapFor(d);
      const speed = spawner.scrollSpeed(d);

      // Feasible bounds: gap never below the floor nor above the base; speed
      // never below base nor above the cap (Req 7.6 — stays feasible).
      expect(gap).toBeGreaterThanOrEqual(minGap);
      expect(gap).toBeLessThanOrEqual(baseGap + 1e-9);
      expect(speed).toBeGreaterThanOrEqual(baseSpeed - 1e-9);
      expect(speed).toBeLessThanOrEqual(maxSpeed + 1e-9);

      // Monotone: density tightens (gap shrinks) and speed rises as cleared
      // grows — the ramp keeps climbing past 50 (Req 7.6).
      expect(gap).toBeLessThanOrEqual(prevGap + 1e-9);
      expect(speed).toBeGreaterThanOrEqual(prevSpeed - 1e-9);
      prevGap = gap;
      prevSpeed = speed;
    }

    // Density strictly tightened from the start to deep endless (not flat).
    expect(spawner.gapFor(prog.difficulty(240))).toBeLessThan(
      spawner.gapFor(prog.difficulty(0)),
    );
  });
});

describe('ProgressionSystem — unlocked/selectable worlds from a save map (Req 7.8)', () => {
  it('returns discovered worlds in ascending order, ignoring undiscovered/unknown keys', () => {
    const worlds = {
      world1: { discovered: true },
      world2: { discovered: true },
      world3: { discovered: false },
      world4: { discovered: false },
      world5: { discovered: false },
    };
    expect(unlockedWorlds(worlds)).toEqual([1, 2]);

    // After unlocking world 3 (what the scene applies from the unlock intent):
    worlds.world3.discovered = true;
    expect(unlockedWorlds(worlds)).toEqual([1, 2, 3]);
  });

  it('tolerates a sparse / empty map', () => {
    expect(unlockedWorlds({})).toEqual([]);
    expect(unlockedWorlds({ world1: { discovered: true } })).toEqual([1]);
  });
});

describe('ProgressionSystem — threshold override + bad-value fallback', () => {
  it('honors a sane override and ignores a bad one', () => {
    const over = createProgressionSystem(balance(), { world: 1, threshold: 30 });
    expect(over.threshold).toBe(30);
    expect(over.onScore(30).justCrossed).toBe(true);

    const bad = createProgressionSystem(balance(), {
      world: 1,
      threshold: 0,
    });
    // Falls back to the balance default (50).
    expect(bad.threshold).toBe(50);
    expect(bad.onScore(49).justCrossed).toBe(false);
    expect(bad.onScore(50).justCrossed).toBe(true);
  });

  it('ignores non-finite scores without tripping the latch', () => {
    const prog = createProgressionSystem(balance(), { world: 1 });
    expect(prog.onScore(Number.NaN).justCrossed).toBe(false);
    expect(prog.onScore(Number.POSITIVE_INFINITY).justCrossed).toBe(false);
    expect(prog.phase()).toBe('preThreshold');
    // A real crossing still works afterward.
    expect(prog.onScore(50).justCrossed).toBe(true);
  });
});

// Keep the WorldId import meaningful for the type-checker in this file.
const _sampleWorld: WorldId = 1;
void _sampleWorld;

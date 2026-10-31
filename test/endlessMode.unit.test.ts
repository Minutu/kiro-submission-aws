// Feature: kino-game
//
// Unit tests for the EndlessMode module (task 7.8; design: "Endless ability
// restriction (Req 23.7–23.8)", "Difficulty ramp (Req 7.6, 23.3)"; Req 23.1,
// 23.2, 23.3, 23.6, 23.7, 23.8, 23.9).
//
// These pin the concrete endless contract:
//   - Req 23.7-23.8: `allowedEndlessModes(world)` is the abilities learned up
//     to & including that world in STORY ORDER (the cumulative prefix), and a
//     composed endless plan contains ONLY allowed modes — no later-world
//     ability leaks in (the structural guarantee behind Property 9, task 7.9).
//   - Req 23.1/23.2: worlds 1-4 support endless; World 5 does not.
//   - Req 23.3: the endless difficulty ramp (speed/density) and transition
//     frequency increase with progress while staying within feasible bounds.
//   - Req 23.6/23.9: an endless run awards NO story progress/unlocks/perks/
//     cosmetics and offers no perk choices.
//
// Property 9 itself (the endless-ability-restriction property over ALL worlds
// and generated runs) is task 7.9 and is NOT written here.
//
// PURE / Phaser-free; all behavior is a deterministic function of inputs.

import { describe, it, expect } from 'vitest';
import {
  STORY_ABILITY_ORDER,
  supportsEndless,
  allowedEndlessModes,
  allowedEndlessModeSet,
  isEndlessModeAllowed,
  validateEndlessPlanModes,
  buildEndlessSequencePlan,
  endlessBoundaryDistancesPx,
  endlessDifficulty,
  buildEndlessRunConfig,
  endlessAwardsNoStoryProgress,
  createSequenceDirector,
  createObstacleSpawner,
  type WorldId,
  type MovementMode,
} from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

function balance() {
  return createBalanceTable();
}

const WORLDS: WorldId[] = [1, 2, 3, 4, 5];

describe('EndlessMode — ability allow-list in story order (Req 23.7-23.8)', () => {
  it('allowedEndlessModes is the cumulative prefix of the story ability order', () => {
    expect(STORY_ABILITY_ORDER).toEqual([
      'jumping',
      'flight',
      'zigzag',
      'underwater',
    ]);

    expect(allowedEndlessModes(1)).toEqual(['jumping']);
    expect(allowedEndlessModes(2)).toEqual(['jumping', 'flight']);
    expect(allowedEndlessModes(3)).toEqual(['jumping', 'flight', 'zigzag']);
    expect(allowedEndlessModes(4)).toEqual([
      'jumping',
      'flight',
      'zigzag',
      'underwater',
    ]);
    // World 5 introduces no new base ability — the full learned set.
    expect(allowedEndlessModes(5)).toEqual([
      'jumping',
      'flight',
      'zigzag',
      'underwater',
    ]);
  });

  it('is monotone non-decreasing across worlds (later worlds never drop an ability)', () => {
    for (let w = 1 as WorldId; w < 4; w = (w + 1) as WorldId) {
      const here = allowedEndlessModeSet(w);
      const next = allowedEndlessModeSet((w + 1) as WorldId);
      for (const m of here) expect(next.has(m)).toBe(true);
    }
  });

  it('isEndlessModeAllowed matches the allow-list and forbids later-world abilities', () => {
    // World 1 endless: only jumping; flight/zigzag/underwater are forbidden.
    expect(isEndlessModeAllowed(1, 'jumping')).toBe(true);
    for (const m of ['flight', 'zigzag', 'underwater'] as MovementMode[]) {
      expect(isEndlessModeAllowed(1, m)).toBe(false);
    }
    // World 3 endless: jumping/flight/zigzag allowed, underwater (World 4) not.
    expect(isEndlessModeAllowed(3, 'zigzag')).toBe(true);
    expect(isEndlessModeAllowed(3, 'underwater')).toBe(false);
  });

  it('returns fresh copies (mutating the result does not corrupt later calls)', () => {
    const a = allowedEndlessModes(3);
    a.push('underwater');
    expect(allowedEndlessModes(3)).toEqual(['jumping', 'flight', 'zigzag']);
  });
});

describe('EndlessMode — endless support per world (Req 23.1, 23.2)', () => {
  it('supports endless for worlds 1-4 and NOT for World 5', () => {
    expect(supportsEndless(1)).toBe(true);
    expect(supportsEndless(2)).toBe(true);
    expect(supportsEndless(3)).toBe(true);
    expect(supportsEndless(4)).toBe(true);
    expect(supportsEndless(5)).toBe(false);
  });

  it('refuses to build a plan or run config for World 5 (no endless)', () => {
    expect(() => buildEndlessSequencePlan(5)).toThrow();
    expect(() => buildEndlessRunConfig(5)).toThrow();
  });
});

describe('EndlessMode — composed plan contains only allowed modes (Req 23.7-23.8)', () => {
  it('every endless plan (worlds 1-4) passes the allow-list validator (no offenders)', () => {
    for (const w of [1, 2, 3, 4] as WorldId[]) {
      const plan = buildEndlessSequencePlan(w);
      expect(plan.length).toBeGreaterThan(0);
      expect(validateEndlessPlanModes(w, plan)).toEqual([]);

      const allowed = allowedEndlessModeSet(w);
      for (const spec of plan) expect(allowed.has(spec.mode)).toBe(true);

      // A looping plan so the run never ends (endless, Req 23.1).
      expect(plan.some((s) => s.loops)).toBe(true);
    }
  });

  it('World 4 endless excludes Jumping (Req 5.8) while staying within its allow-list', () => {
    const plan = buildEndlessSequencePlan(4);
    expect(plan.some((s) => s.mode === 'jumping')).toBe(false);
    // underwater present + water-gated chaining preserved.
    expect(plan.some((s) => s.mode === 'underwater')).toBe(true);
    expect(validateEndlessPlanModes(4, plan)).toEqual([]);
  });

  it('the validator FLAGS a later-world ability smuggled into a plan', () => {
    // World 1 endless must be Jumping only; a flight/underwater entry is illegal.
    const bad = [{ mode: 'jumping' as MovementMode }, { mode: 'underwater' as MovementMode }];
    expect(validateEndlessPlanModes(1, bad)).toEqual(['underwater']);

    const bad2 = [
      { mode: 'flight' as MovementMode },
      { mode: 'underwater' as MovementMode },
    ];
    // World 3 endless forbids underwater (World 4 ability).
    expect(validateEndlessPlanModes(3, bad2)).toEqual(['underwater']);
  });

  it('a SequenceDirector built from the endless plan only ever reports allowed modes', () => {
    const b = balance();
    for (const w of [1, 2, 3, 4] as WorldId[]) {
      const plan = buildEndlessSequencePlan(w);
      const allowed = allowedEndlessModeSet(w);
      const director = createSequenceDirector(plan, b, {
        defaultBoundaryPx: 1500,
      });
      // Drive the director far enough to cycle through the whole looping plan
      // several times; every mode it reports must be in the allow-list, and no
      // later-world ability can ever surface (structural guarantee / Property 9).
      expect(allowed.has(director.currentMode())).toBe(true);
      for (let i = 0; i < 400; i += 1) {
        const ctx = { waterSurfaceCrossed: true };
        director.tick(200, ctx);
        expect(allowed.has(director.currentMode())).toBe(true);
      }
    }
  });
});

describe('EndlessMode — difficulty + transition-frequency ramp (Req 23.3)', () => {
  it('endlessDifficulty ramps speed up and gaps down, staying within feasible bounds', () => {
    const b = balance();
    const spawner = createObstacleSpawner(b, { groundY: 600, playHeight: 600 });

    const minGap = b.minGapPx();
    const baseGap = b.baseGapPx();
    const baseSpeed = b.scrollSpeedBase();
    const maxSpeed = baseSpeed * b.scrollSpeedMaxMultiplier();

    const samples = [0, 10, 30, 60, 90, 200, 1000];
    let prevGap = Infinity;
    let prevSpeed = -Infinity;
    for (const cleared of samples) {
      const d = endlessDifficulty(cleared);
      expect(d.ramp).toBeGreaterThanOrEqual(0);
      expect(d.ramp).toBeLessThanOrEqual(1);
      expect(d.obstaclesCleared).toBe(cleared);

      const gap = spawner.gapFor(d);
      const speed = spawner.scrollSpeed(d);
      expect(gap).toBeGreaterThanOrEqual(minGap);
      expect(gap).toBeLessThanOrEqual(baseGap + 1e-9);
      expect(speed).toBeGreaterThanOrEqual(baseSpeed - 1e-9);
      expect(speed).toBeLessThanOrEqual(maxSpeed + 1e-9);

      // Monotone with progress: density tightens, speed rises (Req 23.3).
      expect(gap).toBeLessThanOrEqual(prevGap + 1e-9);
      expect(speed).toBeGreaterThanOrEqual(prevSpeed - 1e-9);
      prevGap = gap;
      prevSpeed = speed;
    }

    // Strictly increased from the start to deep endless (not flat).
    expect(spawner.scrollSpeed(endlessDifficulty(200))).toBeGreaterThan(
      spawner.scrollSpeed(endlessDifficulty(0)),
    );
    expect(spawner.gapFor(endlessDifficulty(200))).toBeLessThan(
      spawner.gapFor(endlessDifficulty(0)),
    );
  });

  it('transition frequency increases with progress (segments shrink as ramp climbs)', () => {
    const b = balance();
    const plan = buildEndlessSequencePlan(4);

    const early = endlessBoundaryDistancesPx(plan, endlessDifficulty(0), b);
    const mid = endlessBoundaryDistancesPx(plan, endlessDifficulty(30), b);
    const late = endlessBoundaryDistancesPx(plan, endlessDifficulty(500), b);

    // One boundary distance per plan entry.
    expect(early).toHaveLength(plan.length);
    expect(late).toHaveLength(plan.length);

    // Deeper into the run => shorter segments => MORE frequent transitions.
    expect(mid[0]!).toBeLessThan(early[0]!);
    expect(late[0]!).toBeLessThanOrEqual(mid[0]!);
    expect(late[0]!).toBeLessThan(early[0]!);

    // Feasible floor: a segment always comfortably contains the telegraph lead
    // so a transition can still be announced before it resolves (Req 6.3).
    const lead = b.telegraphLeadPx();
    for (const seg of late) expect(seg).toBeGreaterThanOrEqual(lead);
  });

  it('clamps non-finite / negative cleared counts to the easiest ramp', () => {
    expect(endlessDifficulty(-5)).toEqual({ ramp: 0, obstaclesCleared: 0 });
    expect(endlessDifficulty(Number.NaN).obstaclesCleared).toBe(0);
  });
});

describe('EndlessMode — no story progress / rewards / perks (Req 23.6, 23.9)', () => {
  it('buildEndlessRunConfig pins the no-story-progress contract for every endless world', () => {
    for (const w of [1, 2, 3, 4] as WorldId[]) {
      const cfg = buildEndlessRunConfig(w);
      expect(cfg.world).toBe(w);
      expect(cfg.allowedModes).toEqual(allowedEndlessModes(w));

      // Req 23.6: no story progress, unlocks, perks, or cosmetics.
      expect(cfg.awardsStoryProgress).toBe(false);
      expect(cfg.awardsUnlocks).toBe(false);
      expect(cfg.awardsPerksOrCosmetics).toBe(false);
      // Req 23.9: no perk choices.
      expect(cfg.offersPerkChoices).toBe(false);

      expect(endlessAwardsNoStoryProgress(cfg)).toBe(true);
    }
  });

  it('endlessAwardsNoStoryProgress is false if any story-side-effect flag is permissive', () => {
    const base = buildEndlessRunConfig(1);
    // Simulate a corrupted/misused config to prove the assertion actually checks.
    const leaky = { ...base, awardsUnlocks: true } as unknown as typeof base;
    expect(endlessAwardsNoStoryProgress(leaky)).toBe(false);
  });
});

// Keep the WORLDS constant meaningful for the type-checker.
void WORLDS;

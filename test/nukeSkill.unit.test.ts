// Feature: kino-game
//
// Unit tests for the Nuke skill effect bridge (design: "Active Skill — Nuke";
// Req 35.1, 35.2, 35.3, 35.4, 35.5, 35.6, 35.8). These pin task 6.10's concrete
// contract:
//   - detonate destroys EVERY on-screen obstacle and returns their ids (35.1);
//   - it credits each destroyed Obstacle_Unit EXACTLY ONCE via the ScoringSystem
//     latch, attributing to the obstacle's mode (35.2);
//   - a credit landing while a Score Multiplier is active is worth the active
//     multiplier, snapshotted at credit time (35.3);
//   - an obstacle already credited (e.g. Kino cleared it a frame earlier, or a
//     later pass over the same position) is NOT re-credited (35.4);
//   - an empty field credits/destroys nothing;
//   - a successful Nuke activation resolves straight to cooldown because its
//     active window is 0s, and that cooldown is reducible by the cooldownScale
//     perk source (35.1, 35.5);
//   - activation is disabled while a Transition is in progress (35.6);
//   - the SkillSystem HUD snapshot reports Nuke state for the HUD (35.8).
//
// The bridge is composed with the REAL SkillSystem and REAL ScoringSystem (no
// mocks of either) so the test validates the actual wiring GameplayScene uses.

import { describe, it, expect } from 'vitest';
import {
  createSkillSystem,
  createScoringSystem,
  createScoreMultiplierSource,
  detonate,
  toNukeTargets,
  NUKE_SKILL_ID,
  type NukeTarget,
  type Obstacle,
} from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

function balance() {
  return createBalanceTable();
}

/** A minimal NukeTarget with the given id and mode. */
function target(id: string, mode: NukeTarget['mode'] = 'jumping'): NukeTarget {
  return { id, mode };
}

describe('detonate — destroys the whole field and credits each unit once', () => {
  it('credits every on-screen obstacle exactly once at the active (default 1) multiplier', () => {
    const scoring = createScoringSystem();
    const field = [target('o1'), target('o2', 'flight'), target('o3', 'zigzag')];

    const res = detonate(field, 'jumping', scoring);

    // All three destroyed and all three newly credited.
    expect(res.destroyedIds).toEqual(['o1', 'o2', 'o3']);
    expect(res.creditedIds).toEqual(['o1', 'o2', 'o3']);
    // Default multiplier 1 → one unit each → total 3.
    expect(res.awarded).toBe(3);
    expect(scoring.current()).toBe(3);
    expect(scoring.creditedCount()).toBe(3);
    // Each id latched exactly once.
    for (const id of ['o1', 'o2', 'o3']) {
      expect(scoring.hasCredited(id)).toBe(true);
    }
  });

  it('attributes each Scoring_Event to the obstacle own mode (Req 35.2 / 9.2)', () => {
    const events: Array<{ id: string; mode: string }> = [];
    const scoring = createScoringSystem();
    const field = [target('a', 'flight'), target('b', 'underwater')];

    // Spy via the returned events: re-credit is rejected so we read the live
    // credit path by crediting through detonate and checking attribution.
    detonate(field, 'jumping', {
      credit: (id, mode) => {
        const ev = scoring.credit(id, mode);
        if (ev) events.push({ id: ev.obstacleId, mode: ev.mode });
        return ev;
      },
    });

    expect(events).toEqual([
      { id: 'a', mode: 'flight' },
      { id: 'b', mode: 'underwater' },
    ]);
  });

  it('returns the destroyed ids so the scene can remove their views (Req 35.1)', () => {
    const scoring = createScoringSystem();
    const res = detonate([target('x'), target('y'), target('z')], 'jumping', scoring);
    expect(res.destroyedIds).toEqual(['x', 'y', 'z']);
  });

  it('credits and destroys nothing when the field is empty', () => {
    const scoring = createScoringSystem();
    const res = detonate([], 'jumping', scoring);
    expect(res.destroyedIds).toEqual([]);
    expect(res.creditedIds).toEqual([]);
    expect(res.awarded).toBe(0);
    expect(scoring.current()).toBe(0);
    expect(scoring.creditedCount()).toBe(0);
  });
});

describe('detonate — exactly-once latch (Req 35.4): no double counting', () => {
  it('does NOT re-credit an id Kino later passes over again', () => {
    const scoring = createScoringSystem();

    // Nuke clears the field.
    const res = detonate([target('o1'), target('o2')], 'jumping', scoring);
    expect(res.awarded).toBe(2);
    expect(scoring.current()).toBe(2);

    // Later, Kino "passes" the same cleared positions → re-credit is rejected.
    expect(scoring.credit('o1', 'jumping')).toBeNull();
    expect(scoring.credit('o2', 'jumping')).toBeNull();
    expect(scoring.current()).toBe(2); // unchanged
  });

  it('does NOT re-credit an obstacle already credited before the blast', () => {
    const scoring = createScoringSystem();

    // Kino cleared o1 a frame before the blast.
    scoring.credit('o1', 'jumping');
    expect(scoring.current()).toBe(1);

    // Blast includes o1 (already latched) and a fresh o2.
    const res = detonate([target('o1'), target('o2')], 'jumping', scoring);

    // o1 is still DESTROYED but NOT re-credited; only o2 is newly credited.
    expect(res.destroyedIds).toEqual(['o1', 'o2']);
    expect(res.creditedIds).toEqual(['o2']);
    expect(res.awarded).toBe(1);
    expect(scoring.current()).toBe(2); // 1 (pre) + 1 (o2)
  });

  it('reports a duplicate id in the input as destroyed exactly once', () => {
    const scoring = createScoringSystem();
    const res = detonate([target('dup'), target('dup')], 'jumping', scoring);
    expect(res.destroyedIds).toEqual(['dup']);
    expect(res.creditedIds).toEqual(['dup']);
    expect(res.awarded).toBe(1);
  });
});

describe('detonate — active multiplier at resolve (Req 35.3)', () => {
  it('applies the active Score Multiplier to each Scoring_Event it awards', () => {
    const b = balance();
    const skills = createSkillSystem(b);
    const scoring = createScoringSystem({
      multiplierSource: createScoreMultiplierSource(skills, b),
    });

    // Score Multiplier equipped + active when the Nuke resolves.
    skills.equip('scoreMultiplier');
    skills.activate();
    expect(skills.isActive()).toBe(true);

    const res = detonate([target('o1'), target('o2')], 'jumping', scoring);

    // Each unit worth the factor (default 2) at credit time.
    const factor = b.scoreMultiplierFactor();
    expect(res.awarded).toBe(2 * factor);
    expect(scoring.current()).toBe(2 * factor);
  });
});

describe('Nuke lifecycle via SkillSystem (Req 35.1, 35.5, 35.6, 35.8)', () => {
  it('resolves straight to cooldown on activate (0s active window) — Req 35.1', () => {
    const b = balance();
    const skills = createSkillSystem(b, { initialSkill: NUKE_SKILL_ID });
    expect(skills.state()).toBe('ready');

    const result = skills.activate();
    expect(result.activated).toBe(true);
    // Never lingers in a 0s active state — immediately on cooldown.
    expect(skills.state()).toBe('cooldown');
    expect(skills.isActive()).toBe(false);
    expect(skills.cooldownRemaining()).toBe(b.defaultCooldownS());
  });

  it('cooldown is reducible by a cooldown-reduction perk (cooldownScale) — Req 35.5', () => {
    const b = balance();
    const skills = createSkillSystem(b, {
      initialSkill: NUKE_SKILL_ID,
      cooldownScale: () => 0.5, // a 50% reduction perk
    });

    skills.activate();
    expect(skills.state()).toBe('cooldown');
    // Scaled cooldown applied at the moment the skill entered cooldown.
    expect(skills.cooldownRemaining()).toBe(b.defaultCooldownS() * 0.5);
  });

  it('is disabled while a Transition is in progress — Req 35.6', () => {
    const b = balance();
    const skills = createSkillSystem(b, { initialSkill: NUKE_SKILL_ID });

    const refused = skills.activate({ isTransitioning: true });
    expect(refused.activated).toBe(false);
    expect(refused.reason).toBe('transitioning');
    // Still ready — nothing happened.
    expect(skills.state()).toBe('ready');
  });

  it('reports Nuke state for the HUD — Req 35.8', () => {
    const b = balance();
    const skills = createSkillSystem(b, { initialSkill: NUKE_SKILL_ID });

    const ready = skills.hudSnapshot();
    expect(ready?.id).toBe(NUKE_SKILL_ID);
    expect(ready?.available).toBe(true);
    expect(ready?.state).toBe('ready');

    skills.activate();
    const cooling = skills.hudSnapshot();
    expect(cooling?.state).toBe('cooldown');
    expect(cooling?.available).toBe(false);
    expect(cooling?.cooldownRemaining).toBe(b.defaultCooldownS());
    expect(cooling?.cooldownS).toBe(b.defaultCooldownS());
  });
});

describe('toNukeTargets — narrows Obstacle entities to the minimal shape', () => {
  it('maps id + mode and accepts the result as detonate input', () => {
    const obstacles: Obstacle[] = [
      {
        id: 'ob1',
        category: 'c',
        mode: 'flight',
        bounds: [{ x: 0, y: 0, width: 1, height: 1 }],
        scoringLineX: 0,
        scored: false,
      },
    ];
    const targets = toNukeTargets(obstacles);
    expect(targets).toEqual([{ id: 'ob1', mode: 'flight' }]);

    const scoring = createScoringSystem();
    const res = detonate(targets, 'jumping', scoring);
    expect(res.creditedIds).toEqual(['ob1']);
  });
});

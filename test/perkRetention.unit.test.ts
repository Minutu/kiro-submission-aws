// Feature: kino-game
//
// Unit tests for the PerkSystem retention state machine and the
// cooldown-reduction perk's interaction with the SkillSystem (task 6.13;
// design: "Perk system (Req 10, 11)"; Req 10.4, 10.5, 10.6, 11.4, 12.5).
//
// These pin the concrete run-vs-generation retention contract from task 6.12:
//   - Req 10.4: a perk chosen this run is DISCARDED if the run ends (collision)
//     before reaching the 50-point threshold.
//   - Req 10.5: reaching the threshold BANKS the perk — it is retained for the
//     rest of the generation and carries into the next run of that generation.
//   - Req 10.6 / 11.4: a new generation RESETS all perks (provisional AND
//     retained) while owned cosmetics persist.
//   - Req 12.5: the Reduced Skill Cooldown perk feeds `createSkillSystem({
//     cooldownScale: () => perks.cooldownScale() })` so the equipped skill's
//     cooldown shortens by the configured percentage — with NO change to the
//     SkillSystem.
//
// Pure / Phaser-free. Cosmetic rolls use an injected scripted RNG so the
// behavior is deterministic (Req 26.6).

import { describe, it, expect } from 'vitest';
import {
  createPerkSystem,
  createSkillSystem,
  type PerkSystem,
  type SkillSystem,
  type RandomSource,
} from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

/** A BalanceTable from documented defaults: threshold 50, cooldown 12 s, */
/** speedBoostPct 12, cooldownReductionPct 20, milestones [20, 40]. */
function balance() {
  return createBalanceTable();
}

/**
 * A scripted RNG that always returns 1 — i.e. `random() >= prob` is always
 * true, so `rollCosmetic` NEVER fires a drop. Keeps retention tests free of
 * incidental cosmetic state when the center slot is irrelevant.
 */
const noDropRandom: RandomSource = () => 1;

/**
 * Open the milestone-20 offer and select `id`. Returns the system so callers
 * can chain. Asserts an offer was actually presented (guards the test setup).
 */
function selectPerkAt20(perks: PerkSystem, id: 'speedBoost' | 'cooldownReduction') {
  const offer = perks.onObstacleCleared(20);
  expect(offer).not.toBeNull();
  perks.select(id, false); // never take a cosmetic in these setups
  return perks;
}

/**
 * Tick `sys` with uniform fixed steps until AT LEAST `seconds` have elapsed
 * (the last step may push slightly past, exactly like the fixed-step driver).
 */
function tickSeconds(sys: SkillSystem, seconds: number, step = 1 / 120): void {
  let elapsed = 0;
  while (elapsed < seconds - 1e-9) {
    sys.tick(step);
    elapsed += step;
  }
}

describe('PerkSystem retention — discard before 50 (Req 10.4)', () => {
  it('discards a provisional perk when the run ends before the threshold', () => {
    const perks = createPerkSystem(balance(), { random: noDropRandom });

    selectPerkAt20(perks, 'speedBoost');
    // Applied for the rest of the run immediately (Req 10.3).
    expect(perks.hasPerk('speedBoost')).toBe(true);
    expect(perks.isBanked()).toBe(false);

    // Run never reaches 50 (collision at, say, 37) → onRunEnd discards it.
    perks.onScore(37);
    perks.onRunEnd();

    expect(perks.hasPerk('speedBoost')).toBe(false);
    expect(perks.isBanked()).toBe(false);
    expect(perks.activePerks()).toEqual([]);
    // Reverts to unselected: speed multiplier is back to the neutral 1.
    expect(perks.speedMultiplier()).toBe(1);
  });

  it('a fresh run after a discard starts with no perks and re-arms milestones', () => {
    const perks = createPerkSystem(balance(), { random: noDropRandom });

    selectPerkAt20(perks, 'cooldownReduction');
    perks.onRunEnd(); // never banked → discarded

    perks.startRun();
    expect(perks.activePerks()).toEqual([]);
    expect(perks.hasPerk('cooldownReduction')).toBe(false);
    // Milestone 20 re-arms and offers again next run.
    expect(perks.onObstacleCleared(20)).not.toBeNull();
  });
});

describe('PerkSystem retention — retain at 50 (Req 10.5)', () => {
  it('banks the provisional perk once the run reaches the threshold', () => {
    const perks = createPerkSystem(balance(), { random: noDropRandom });

    selectPerkAt20(perks, 'speedBoost');
    expect(perks.isBanked()).toBe(false);

    perks.onScore(50); // reaches the 50-point gate → bank
    expect(perks.isBanked()).toBe(true);
    expect(perks.hasPerk('speedBoost')).toBe(true);
  });

  it('a banked perk survives onRunEnd (no discard after the threshold)', () => {
    const perks = createPerkSystem(balance(), { random: noDropRandom });

    selectPerkAt20(perks, 'speedBoost');
    perks.onScore(63); // >= 50 banks it
    perks.onRunEnd(); // collision end AFTER banking must NOT discard

    expect(perks.isBanked()).toBe(true);
    expect(perks.hasPerk('speedBoost')).toBe(true);
    expect(perks.activePerks().map((p) => p.id)).toEqual(['speedBoost']);
    // Effect still live: 12% speed boost from config default.
    expect(perks.speedMultiplier()).toBeCloseTo(1.12, 10);
  });

  it('a retained perk carries forward into the next run of the generation', () => {
    const perks = createPerkSystem(balance(), { random: noDropRandom });

    selectPerkAt20(perks, 'cooldownReduction');
    perks.onScore(50); // bank
    perks.onRunEnd();

    // New run, same generation: retained perk persists; this-run state resets.
    perks.startRun();
    expect(perks.hasPerk('cooldownReduction')).toBe(true);
    // Carried perks are already earned, not provisional-pending.
    expect(perks.isBanked()).toBe(false);
    // And ending THIS run before 50 must not strip the already-retained perk.
    perks.onRunEnd();
    expect(perks.hasPerk('cooldownReduction')).toBe(true);
  });
});

describe('PerkSystem retention — reset on new generation (Req 10.6, 11.4)', () => {
  it('resets ALL perks on a new generation while owned cosmetics persist', () => {
    // Seed one owned cosmetic so we can prove cosmetics are NOT reset.
    const perks = createPerkSystem(balance(), {
      random: noDropRandom,
      ownedCosmetics: ['hat-001'],
    });

    selectPerkAt20(perks, 'speedBoost');
    perks.onScore(50); // retain the perk for the generation
    expect(perks.hasPerk('speedBoost')).toBe(true);

    perks.onNewGeneration();

    // All perks gone — provisional AND retained.
    expect(perks.activePerks()).toEqual([]);
    expect(perks.hasPerk('speedBoost')).toBe(false);
    expect(perks.isBanked()).toBe(false);
    expect(perks.speedMultiplier()).toBe(1);
    expect(perks.cooldownScale()).toBe(1);
    // Owned cosmetics are permanent across generations (Req 10.11).
    expect(perks.ownedCosmetics()).toContain('hat-001');
  });
});

describe('PerkSystem cooldown-reduction interaction (Req 12.5)', () => {
  const COOLDOWN_S = 12; // skills.cooldownS.default
  const REDUCTION_PCT = 20; // perks.cooldownReductionPct
  const REDUCED_COOLDOWN_S = COOLDOWN_S * (1 - REDUCTION_PCT / 100); // 9.6 s

  it('cooldownScale is 1 when the perk is not active', () => {
    const perks = createPerkSystem(balance(), { random: noDropRandom });
    expect(perks.cooldownScale()).toBe(1);
  });

  it('cooldownScale becomes 1 - pct/100 while the perk is active', () => {
    const perks = createPerkSystem(balance(), { random: noDropRandom });
    selectPerkAt20(perks, 'cooldownReduction');
    expect(perks.cooldownScale()).toBeCloseTo(0.8, 10);
  });

  it('shortens the equipped skill cooldown via the injected scale seam', () => {
    const bal = balance();
    const perks = createPerkSystem(bal, { random: noDropRandom });
    // Exactly the GameplayScene wiring: SkillSystem reads the live scale.
    const skills = createSkillSystem(bal, {
      cooldownScale: () => perks.cooldownScale(),
    });

    skills.equip('dash');
    selectPerkAt20(perks, 'cooldownReduction'); // perk now ACTIVE

    // Activate and run out the (short) active window so it enters cooldown.
    expect(skills.activate().activated).toBe(true);
    tickSeconds(skills, bal.dashDurationS() + 1 / 120);

    expect(skills.state()).toBe('cooldown');
    // Cooldown entered at the REDUCED length (9.6 s), not the full 12 s.
    expect(skills.cooldownRemaining()).toBeCloseTo(REDUCED_COOLDOWN_S, 6);
  });

  it('uses the FULL cooldown when no cooldown-reduction perk is active', () => {
    const bal = balance();
    const perks = createPerkSystem(bal, { random: noDropRandom });
    const skills = createSkillSystem(bal, {
      cooldownScale: () => perks.cooldownScale(),
    });

    skills.equip('dash'); // no perk selected → scale stays 1
    expect(skills.activate().activated).toBe(true);
    tickSeconds(skills, bal.dashDurationS() + 1 / 120);

    expect(skills.state()).toBe('cooldown');
    expect(skills.cooldownRemaining()).toBeCloseTo(COOLDOWN_S, 6);
  });
});

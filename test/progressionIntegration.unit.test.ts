// Feature: kino-game
//
// CONSOLIDATED progression-flow UNIT tests (task 7.11). Where the per-module
// suites (skillUnlockSchedule.unit, generationTransition.unit, saveState.unit,
// openingCinematicTrigger.unit) pin each pure module in isolation, THIS suite
// ties them together as ONE progression narrative and asserts the task-7.11
// bullets end-to-end:
//
//   1. Req 36.2 — World-first AND generation milestones unlock the seven skills
//      in the FIXED order (secondChance, timeErase, dash, timeSlow,
//      scoreMultiplier, ultraInstinct, nuke): clear worlds 1→5 for the first
//      time, then complete generation 1 then generation 2.
//   2. Req 27.15 — advancing PAST a world marks it left-behind: STORY access is
//      blocked (`canPlayStory` false / `isLeftBehind` true) while EARNED rewards
//      (`unlockedSkills`) stay intact.
//   3. Req 40.1 — a fresh save (`createFirstLaunchState`) IS the First_Launch_
//      State: Generation 1 Junior, no unlocked skills, no unlocked cosmetics,
//      only World 1 discovered, default control bindings (and the opening
//      cinematic plays off a `first-launch` source, Req 40.2).
//
// All three are exercised against pure src/core modules driven by the
// documented default Config_File — no Phaser, no canvas, no localStorage.

import { describe, it, expect } from 'vitest';
import {
  // Skill unlock schedule (task 7.5) — Req 36.2.
  MILESTONE_ORDER,
  unlockSkillForWorldFirstCompletion,
  applyMilestoneToSave,
  skillForMilestone,
  skillRarity,
  // Generation transition (task 7.4) — Req 27.15, 22.x.
  markLeftBehind,
  isLeftBehind,
  canPlayStory,
  advanceGeneration,
  composeGenerationName,
  // Save store / first launch (tasks 7.1, 7.10) — Req 40.1, 40.2.
  createFirstLaunchState,
  shouldPlayOpeningCinematic,
  SAVE_SCHEMA_VERSION,
  DEFAULT_CONTROL_BINDINGS,
  type SaveState,
} from '../src/core/index.ts';
import { defaultConfig } from '../src/config/index.ts';

const cfg = defaultConfig;

/** A brand-new save — the First_Launch_State the whole flow starts from. */
function freshSave(): SaveState {
  return createFirstLaunchState(cfg);
}

/** The fixed skill acquisition order across worlds 1-5 then generations 1-2. */
const FIXED_SKILL_ORDER = [
  'secondChance',
  'timeErase',
  'dash',
  'timeSlow',
  'scoreMultiplier',
  'ultraInstinct',
  'nuke',
] as const;

/**
 * Clear worlds 1→5 for the first time, then complete generation 1 and 2,
 * returning the save after each milestone so a test can assert the growing
 * `unlockedSkills` list at every step. The five world-firsts go through
 * `unlockSkillForWorldFirstCompletion` (the world-number entry point) and the
 * two generation-completes go through `applyMilestoneToSave` — exactly the two
 * surfaces the progression flow uses.
 */
function unlockAllSkillsInOrder(start: SaveState): SaveState[] {
  const steps: SaveState[] = [];
  let save = start;
  for (let world = 1; world <= 5; world++) {
    save = unlockSkillForWorldFirstCompletion(cfg, save, world);
    steps.push(save);
  }
  for (const milestone of ['generation1Complete', 'generation2Complete'] as const) {
    save = applyMilestoneToSave(cfg, save, milestone);
    steps.push(save);
  }
  return steps;
}

describe('Req 36.2 — milestones unlock the seven skills in the fixed order', () => {
  it('clearing worlds 1→5 first-time, then gen-1/gen-2, unlocks skills in fixed order', () => {
    const steps = unlockAllSkillsInOrder(freshSave());

    // After each milestone the unlocked list is the fixed order's prefix.
    steps.forEach((save, i) => {
      expect(save.unlockedSkills).toEqual(FIXED_SKILL_ORDER.slice(0, i + 1));
    });

    // The terminal state holds exactly the seven skills, in order.
    const final = steps[steps.length - 1]!;
    expect(final.unlockedSkills).toEqual([...FIXED_SKILL_ORDER]);
  });

  it('the first five unlocks are the world-firsts (worlds 1-5), the 6th/7th are the generations', () => {
    const steps = unlockAllSkillsInOrder(freshSave());

    // World-first unlocks (indices 0-4).
    expect(steps[0]!.unlockedSkills[0]).toBe('secondChance'); // world 1
    expect(steps[1]!.unlockedSkills[1]).toBe('timeErase'); // world 2
    expect(steps[2]!.unlockedSkills[2]).toBe('dash'); // world 3
    expect(steps[3]!.unlockedSkills[3]).toBe('timeSlow'); // world 4
    expect(steps[4]!.unlockedSkills[4]).toBe('scoreMultiplier'); // world 5

    // Generation unlocks (indices 5-6) are the 6th and 7th skills.
    expect(steps[5]!.unlockedSkills[5]).toBe('ultraInstinct'); // generation 1
    expect(steps[6]!.unlockedSkills[6]).toBe('nuke'); // generation 2
  });

  it('agrees with the config-driven MILESTONE_ORDER schedule (Req 36.1-36.2)', () => {
    // The order the flow produces is exactly the schedule resolved from config,
    // so a config edit re-points the whole flow with no logic change.
    const fromSchedule = MILESTONE_ORDER.map((m) => skillForMilestone(cfg, m));
    expect(fromSchedule).toEqual([...FIXED_SKILL_ORDER]);

    const steps = unlockAllSkillsInOrder(freshSave());
    expect(steps[steps.length - 1]!.unlockedSkills).toEqual(fromSchedule);
  });

  it('every unlocked skill carries a display-only rarity tier (Req 36.4-36.5)', () => {
    const tiers: ReadonlyArray<string> = ['common', 'uncommon', 'rare', 'legendary'];
    const final = unlockAllSkillsInOrder(freshSave())[6]!;
    for (const skill of final.unlockedSkills) {
      expect(tiers).toContain(skillRarity(cfg, skill as never));
    }
  });
});

describe('Req 27.15 — advancing past a world marks it left-behind but keeps rewards', () => {
  it('a left-behind world blocks STORY while its earned skill rewards remain', () => {
    // Earn skills by clearing worlds 1 and 2 (rewards: secondChance, timeErase).
    let save = freshSave();
    save = unlockSkillForWorldFirstCompletion(cfg, save, 1);
    save = unlockSkillForWorldFirstCompletion(cfg, save, 2);
    // Mark world2 as discovered + cleared so canPlayStory would be true but for
    // the left-behind lock (discovery is what makes a world story-playable).
    save = {
      ...save,
      worlds: {
        ...save.worlds,
        world2: { discovered: true, storyCleared: true, leftBehind: false },
      },
    };
    expect(canPlayStory(save, 'world2')).toBe(true);
    const earnedBefore = [...save.unlockedSkills];

    // Advance PAST world2 → it becomes left-behind.
    const after = markLeftBehind(save, 'world2');

    // Story access is now fully blocked for that world (Req 27.15).
    expect(isLeftBehind(after, 'world2')).toBe(true);
    expect(canPlayStory(after, 'world2')).toBe(false);

    // Earned rewards are untouched — the unlock survives the lock (Req 27.16).
    expect(after.unlockedSkills).toEqual(earnedBefore);
    expect(after.unlockedSkills).toEqual(['secondChance', 'timeErase']);

    // Pure: the original save is not mutated.
    expect(isLeftBehind(save, 'world2')).toBe(false);
    expect(canPlayStory(save, 'world2')).toBe(true);
  });
});

describe('combined narrative — unlock in order → advance a generation → rewards kept, story reset', () => {
  it('clears worlds unlocking skills, then advancing the generation keeps skills but resets story', () => {
    // 1) Clear worlds 1-3 in order (secondChance, timeErase, dash) and mark the
    //    worlds discovered + cleared, with world1 left behind as we move on.
    let save = freshSave();
    for (let w = 1; w <= 3; w++) {
      save = unlockSkillForWorldFirstCompletion(cfg, save, w);
      save = {
        ...save,
        worlds: {
          ...save.worlds,
          [`world${w}`]: { discovered: true, storyCleared: true, leftBehind: false },
        },
      };
    }
    save = markLeftBehind(save, 'world1');

    expect(save.unlockedSkills).toEqual(['secondChance', 'timeErase', 'dash']);
    expect(isLeftBehind(save, 'world1')).toBe(true);
    expect(canPlayStory(save, 'world1')).toBe(false);
    expect(composeGenerationName(cfg, save)).toBe('Kino I Junior');

    // 2) Complete the generation → advance into the next one.
    const { save: nextGen, awardedCosmetic } = advanceGeneration(save, cfg, {
      cosmeticPool: ['gen1-cosmetic'],
    });

    // Permanent progress is KEPT: skills carry forward verbatim (Req 22.5).
    expect(nextGen.unlockedSkills).toEqual(['secondChance', 'timeErase', 'dash']);
    // A unique cosmetic was awarded and persisted permanently (Req 22.4).
    expect(awardedCosmetic).toBe('gen1-cosmetic');
    expect(nextGen.unlockedCosmetics).toContain('gen1-cosmetic');
    expect(nextGen.generationCosmeticsAwarded).toContain('gen1-cosmetic');

    // Per-generation STORY state is RESET: storyCleared/leftBehind cleared on
    // every world while permanent discovery is kept greyed (Req 22.3, 32.5).
    for (const id of ['world1', 'world2', 'world3'] as const) {
      expect(nextGen.worlds[id]!.discovered).toBe(true); // greyed, not re-hidden
      expect(nextGen.worlds[id]!.storyCleared).toBe(false);
      expect(nextGen.worlds[id]!.leftBehind).toBe(false);
    }
    // The previously left-behind world is now story-playable again (story reset).
    expect(isLeftBehind(nextGen, 'world1')).toBe(false);
    expect(canPlayStory(nextGen, 'world1')).toBe(true);

    // Generation name advanced one step: Junior → Senior, same iteration (Req 32.3).
    expect(composeGenerationName(cfg, nextGen)).toBe('Kino I Senior');
  });
});

describe('Req 40.1 — a fresh save yields the First_Launch_State', () => {
  it('is Generation 1 Junior, no skills/cosmetics, only World 1 discovered, default bindings', () => {
    const s = freshSave();

    expect(s.schemaVersion).toBe(SAVE_SCHEMA_VERSION);
    expect(s.generation).toEqual({ iteration: 1, suffix: 'Junior' });
    expect(composeGenerationName(cfg, s)).toBe('Kino I Junior');

    // No earned progress yet.
    expect(s.unlockedSkills).toEqual([]);
    expect(s.unlockedCosmetics).toEqual([]);
    expect(s.generationCosmeticsAwarded).toEqual([]);
    expect(s.equippedSkill).toBeNull();
    expect(s.equippedCosmetic).toBeNull();

    // Only World 1 is discovered; worlds 2-5 are not yet available.
    expect(s.worlds.world1?.discovered).toBe(true);
    expect(s.worlds.world1?.storyCleared).toBe(false);
    expect(s.worlds.world1?.leftBehind).toBe(false);
    for (const id of ['world2', 'world3', 'world4', 'world5'] as const) {
      expect(s.worlds[id]?.discovered).toBe(false);
    }

    // Default control bindings (Req 1.6-1.9, 40.1).
    expect(s.controlBindings).toEqual(DEFAULT_CONTROL_BINDINGS);
  });

  it('plays the opening cinematic off a first-launch source (Req 40.2)', () => {
    expect(shouldPlayOpeningCinematic('first-launch')).toBe(true);
    expect(shouldPlayOpeningCinematic('loaded')).toBe(false);
  });
});

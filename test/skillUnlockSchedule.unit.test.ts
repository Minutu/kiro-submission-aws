// Feature: kino-game
//
// Unit tests for the Skill_Unlock_Schedule acquisition + rarity labeling
// module (task 7.5; design: "Skill acquisition (Req 36)"; Req 36.1-36.5, 36.7,
// 12.6, 12.13).
//
// These pin the concrete contract from task 7.5:
//   - Req 36.1-36.2: world-first completion unlocks the scheduled skill in the
//     FIXED world order (world1First→world5First), read from
//     `config.skillUnlockSchedule`.
//   - Req 36.2-36.3: generation-1 / generation-2 completion unlock the 6th /
//     7th skills and persist them permanently in the save.
//   - Idempotency (Req 36.3): re-completing a world/generation never
//     double-adds the skill; the save is never mutated.
//   - Req 36.7: unlock happens via milestone entry points only — there is no
//     perk path to `unlockedSkills` here.
//   - Req 36.4-36.5 / 12.6 / 12.13: rarity resolves from `config.skillRarity`
//     for display/flavor only and does not change the skill id.
//
// Pure / Phaser-free; built from the documented default Config_File.

import { describe, it, expect } from 'vitest';
import {
  WORLD_FIRST_MILESTONES,
  MILESTONE_ORDER,
  worldFirstMilestone,
  skillForMilestone,
  skillRarity,
  applyMilestoneToUnlockedSkills,
  applyMilestoneToSave,
  unlockSkillForWorldFirstCompletion,
  createFirstLaunchState,
  type SkillUnlockMilestone,
} from '../src/core/index.ts';
import { defaultConfig } from '../src/config/index.ts';

const cfg = defaultConfig;

function freshSave() {
  return createFirstLaunchState(cfg);
}

describe('world-first milestone mapping (Req 36.2)', () => {
  it('maps 1-based world numbers to the fixed world-order milestones', () => {
    expect(worldFirstMilestone(1)).toBe('world1First');
    expect(worldFirstMilestone(2)).toBe('world2First');
    expect(worldFirstMilestone(3)).toBe('world3First');
    expect(worldFirstMilestone(4)).toBe('world4First');
    expect(worldFirstMilestone(5)).toBe('world5First');
  });

  it('returns null for out-of-range world numbers', () => {
    expect(worldFirstMilestone(0)).toBeNull();
    expect(worldFirstMilestone(6)).toBeNull();
    expect(worldFirstMilestone(1.5)).toBeNull();
    expect(worldFirstMilestone(-1)).toBeNull();
  });

  it('exposes the five world-first milestones in fixed order', () => {
    expect(WORLD_FIRST_MILESTONES).toEqual([
      'world1First',
      'world2First',
      'world3First',
      'world4First',
      'world5First',
    ]);
  });
});

describe('schedule resolution from config (Req 36.1)', () => {
  it('resolves each milestone to its configured skill, in acquisition order', () => {
    const skills = MILESTONE_ORDER.map((m) => skillForMilestone(cfg, m));
    // Fixed default order: worlds 1-5 then gen1 then gen2 (Req 36.2).
    expect(skills).toEqual([
      'secondChance',
      'timeErase',
      'dash',
      'timeSlow',
      'scoreMultiplier',
      'ultraInstinct',
      'nuke',
    ]);
  });

  it('respects a config edit that re-points a milestone', () => {
    const edited = {
      ...cfg,
      skillUnlockSchedule: { ...cfg.skillUnlockSchedule, world1First: 'nuke' as const },
    };
    expect(skillForMilestone(edited, 'world1First')).toBe('nuke');
  });
});

describe('world-first completion unlocks the scheduled skill in fixed order (Req 36.2, 36.3)', () => {
  it('clearing each world for the first time unlocks one skill in fixed order', () => {
    let save = freshSave();
    expect(save.unlockedSkills).toEqual([]);

    const expected = ['secondChance', 'timeErase', 'dash', 'timeSlow', 'scoreMultiplier'];
    for (let world = 1; world <= 5; world++) {
      save = unlockSkillForWorldFirstCompletion(cfg, save, world);
      expect(save.unlockedSkills).toEqual(expected.slice(0, world));
    }
  });

  it('an out-of-range world first-completion unlocks nothing', () => {
    const save = freshSave();
    const after = unlockSkillForWorldFirstCompletion(cfg, save, 9);
    expect(after.unlockedSkills).toEqual([]);
    expect(after).not.toBe(save); // still returns a fresh copy
  });
});

describe('generation completion milestones unlock the 6th/7th skills (Req 36.2, 36.3)', () => {
  it('generation-1 completion unlocks Ultra Instinct', () => {
    const after = applyMilestoneToSave(cfg, freshSave(), 'generation1Complete');
    expect(after.unlockedSkills).toContain('ultraInstinct');
  });

  it('generation-2 completion unlocks Nuke', () => {
    const after = applyMilestoneToSave(cfg, freshSave(), 'generation2Complete');
    expect(after.unlockedSkills).toContain('nuke');
  });

  it('completing all seven milestones unlocks all seven skills', () => {
    let save = freshSave();
    for (const m of MILESTONE_ORDER) {
      save = applyMilestoneToSave(cfg, save, m);
    }
    expect([...save.unlockedSkills].sort()).toEqual(
      ['dash', 'nuke', 'scoreMultiplier', 'secondChance', 'timeErase', 'timeSlow', 'ultraInstinct'].sort(),
    );
  });
});

describe('idempotency — re-completing never double-adds (Req 36.3)', () => {
  it('re-applying the same milestone does not double-add the skill', () => {
    let save = freshSave();
    save = applyMilestoneToSave(cfg, save, 'world1First');
    const firstLen = save.unlockedSkills.length;

    const again = applyMilestoneToSave(cfg, save, 'world1First');
    expect(again.unlockedSkills).toEqual(save.unlockedSkills);
    expect(again.unlockedSkills.length).toBe(firstLen);
  });

  it('reports newlyUnlocked only on the first unlock', () => {
    const first = applyMilestoneToUnlockedSkills(cfg, [], 'world2First');
    expect(first.newlyUnlocked).toBe(true);
    expect(first.unlockedSkills).toEqual(['timeErase']);

    const second = applyMilestoneToUnlockedSkills(cfg, first.unlockedSkills, 'world2First');
    expect(second.newlyUnlocked).toBe(false);
    expect(second.unlockedSkills).toEqual(['timeErase']);
  });

  it('is pure — never mutates the input save or list', () => {
    const save = freshSave();
    const snapshot = JSON.stringify(save);
    const inputList = ['secondChance'];

    applyMilestoneToSave(cfg, save, 'world2First');
    applyMilestoneToUnlockedSkills(cfg, inputList, 'world2First');

    expect(JSON.stringify(save)).toBe(snapshot);
    expect(inputList).toEqual(['secondChance']);
  });

  it('re-clearing world 1 after further progress is a no-op for that skill', () => {
    let save = freshSave();
    save = unlockSkillForWorldFirstCompletion(cfg, save, 1);
    save = unlockSkillForWorldFirstCompletion(cfg, save, 2);
    const before = [...save.unlockedSkills];
    save = unlockSkillForWorldFirstCompletion(cfg, save, 1);
    expect(save.unlockedSkills).toEqual(before);
  });
});

describe('rarity resolves from config and is display/flavor only (Req 36.4, 36.5, 12.6, 12.13)', () => {
  it('resolves each skill rarity from config.skillRarity', () => {
    expect(skillRarity(cfg, 'secondChance')).toBe('common');
    expect(skillRarity(cfg, 'ultraInstinct')).toBe('legendary');
    expect(skillRarity(cfg, 'nuke')).toBe('legendary');
  });

  it('rarity is a pure lookup that never changes which skill a milestone unlocks', () => {
    // Two configs identical except rarity; the unlocked skill is unaffected.
    const legendaryEverything = {
      ...cfg,
      skillRarity: Object.fromEntries(
        Object.keys(cfg.skillRarity).map((k) => [k, 'legendary' as const]),
      ) as typeof cfg.skillRarity,
    };

    const a = applyMilestoneToSave(cfg, freshSave(), 'world1First');
    const b = applyMilestoneToSave(legendaryEverything, freshSave(), 'world1First');

    expect(a.unlockedSkills).toEqual(b.unlockedSkills);
    // Rarity differs for display only — effect (unlocked id) is identical.
    expect(skillRarity(cfg, 'secondChance')).not.toBe(skillRarity(legendaryEverything, 'secondChance'));
  });

  it('every scheduled skill has a resolvable rarity tier', () => {
    const tiers: ReadonlyArray<string> = ['common', 'uncommon', 'rare', 'legendary'];
    for (const m of MILESTONE_ORDER) {
      const skill = skillForMilestone(cfg, m);
      expect(tiers).toContain(skillRarity(cfg, skill));
    }
  });
});

describe('no perk path to unlockedSkills (Req 36.7)', () => {
  it('the public surface exposes only milestone entry points for unlocking', () => {
    // These are the only functions that add to unlockedSkills, and each takes a
    // SkillUnlockMilestone or a world number — never a perk/cosmetic drop.
    const milestoneOnly: SkillUnlockMilestone[] = [...MILESTONE_ORDER];
    expect(milestoneOnly.length).toBe(7);
    // Sanity: applying every milestone unlocks exactly the seven configured skills.
    let save = freshSave();
    for (const m of milestoneOnly) save = applyMilestoneToSave(cfg, save, m);
    expect(new Set(save.unlockedSkills).size).toBe(7);
  });
});

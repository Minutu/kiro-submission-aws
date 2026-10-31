// Feature: kino-game
//
// UNIT tests for the Info / run-statistics panel view-model (task 9.6; design:
// "Info panel (31)"; Req 20.10, 31.1, 31.2) in src/core/infoPanel.ts.
//
// These pin the concrete Info-panel contract:
//   - Req 31.1: opening Info shows CURRENT-RUN statistics — obstacles cleared,
//     active Perk effects as ±% (Speed Boost "+N%", Reduced Skill Cooldown
//     "-N%"), the equipped Skill, and the current score.
//   - Req 31.2: per-World High_Scores for the CURRENT generation alongside the
//     BEST per-World High_Scores from PAST generations.
//
// Pure / Phaser-free: the module is plain data assembly, so a populated
// Save_Store fixture + scalar run counters fully exercise it.

import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/config/index.ts';
import {
  buildInfoPanelViewModel,
  createFirstLaunchState,
  type Perk,
  type SaveState,
} from '../src/core/index.ts';

/** A fresh First_Launch_State to layer per-test high scores onto. */
function baseSave(): SaveState {
  return createFirstLaunchState(defaultConfig);
}

describe('InfoPanel — current-run statistics (Req 31.1)', () => {
  it('passes obstacles cleared and current score through', () => {
    const vm = buildInfoPanelViewModel({
      obstaclesCleared: 23,
      currentScore: 47,
      activePerks: [],
      equippedSkill: null,
      save: baseSave(),
    });

    expect(vm.obstaclesCleared).toBe(23);
    expect(vm.currentScore).toBe(47);
  });

  it('renders Speed Boost as a POSITIVE percentage (+N%)', () => {
    const perks: Perk[] = [{ id: 'speedBoost', magnitude: 12 }];
    const vm = buildInfoPanelViewModel({
      obstaclesCleared: 0,
      currentScore: 0,
      activePerks: perks,
      equippedSkill: null,
      save: baseSave(),
    });

    expect(vm.perkEffects).toHaveLength(1);
    expect(vm.perkEffects[0]).toMatchObject({ id: 'speedBoost', percent: '+12%' });
  });

  it('renders Reduced Skill Cooldown as a NEGATIVE percentage (-N%)', () => {
    const perks: Perk[] = [{ id: 'cooldownReduction', magnitude: 20 }];
    const vm = buildInfoPanelViewModel({
      obstaclesCleared: 0,
      currentScore: 0,
      activePerks: perks,
      equippedSkill: null,
      save: baseSave(),
    });

    expect(vm.perkEffects[0]).toMatchObject({ id: 'cooldownReduction', percent: '-20%' });
  });

  it('renders multiple active perks in order, each signed', () => {
    const perks: Perk[] = [
      { id: 'speedBoost', magnitude: 12 },
      { id: 'cooldownReduction', magnitude: 20 },
    ];
    const vm = buildInfoPanelViewModel({
      obstaclesCleared: 5,
      currentScore: 5,
      activePerks: perks,
      equippedSkill: null,
      save: baseSave(),
    });

    expect(vm.perkEffects.map((e) => e.percent)).toEqual(['+12%', '-20%']);
  });

  it('reflects the equipped skill id and resolves a display name when given', () => {
    const vm = buildInfoPanelViewModel({
      obstaclesCleared: 0,
      currentScore: 0,
      activePerks: [],
      equippedSkill: 'dash',
      save: baseSave(),
      skillName: (id) => (id === 'dash' ? 'Dash' : id),
    });

    expect(vm.equippedSkill).toEqual({ id: 'dash', name: 'Dash' });
  });

  it('defaults the equipped skill name to its id when no resolver is supplied', () => {
    const vm = buildInfoPanelViewModel({
      obstaclesCleared: 0,
      currentScore: 0,
      activePerks: [],
      equippedSkill: 'nuke',
      save: baseSave(),
    });

    expect(vm.equippedSkill).toEqual({ id: 'nuke', name: 'nuke' });
  });

  it('reports no equipped skill as nulls', () => {
    const vm = buildInfoPanelViewModel({
      obstaclesCleared: 0,
      currentScore: 0,
      activePerks: [],
      equippedSkill: null,
      save: baseSave(),
    });

    expect(vm.equippedSkill).toEqual({ id: null, name: null });
  });

  it('clamps non-finite / negative run counters to 0', () => {
    const vm = buildInfoPanelViewModel({
      obstaclesCleared: Number.NaN,
      currentScore: -5,
      activePerks: [],
      equippedSkill: null,
      save: baseSave(),
    });

    expect(vm.obstaclesCleared).toBe(0);
    expect(vm.currentScore).toBe(0);
  });
});

describe('InfoPanel — per-World high scores, this gen vs past gens (Req 31.2)', () => {
  it('shows this-generation per-world story highs for all five worlds', () => {
    const save = baseSave();
    save.highScores.story.world1 = 120;
    save.highScores.story.world2 = 60;

    const vm = buildInfoPanelViewModel({
      obstaclesCleared: 0,
      currentScore: 0,
      activePerks: [],
      equippedSkill: null,
      save,
    });

    expect(vm.worldHighScores.map((w) => w.world)).toEqual([1, 2, 3, 4, 5]);
    expect(vm.worldHighScores[0]).toMatchObject({ world: 1, currentGeneration: 120 });
    expect(vm.worldHighScores[1]).toMatchObject({ world: 2, currentGeneration: 60 });
    // Untouched worlds default to 0.
    expect(vm.worldHighScores[2]?.currentGeneration).toBe(0);
  });

  it('rolls up the BEST per-world story high across past generations ({ story: { worldN } } shape)', () => {
    const save = baseSave();
    save.highScores.story.world1 = 90; // current gen
    save.highScoreHistoryByGeneration = {
      'Kino I Junior': { story: { world1: 150, world2: 40 } },
      'Kino I Senior': { story: { world1: 110, world2: 200 } },
    };

    const vm = buildInfoPanelViewModel({
      obstaclesCleared: 0,
      currentScore: 0,
      activePerks: [],
      equippedSkill: null,
      save,
    });

    // World 1 best past = max(150, 110) = 150; current gen = 90.
    expect(vm.worldHighScores[0]).toMatchObject({
      currentGeneration: 90,
      bestPastGeneration: 150,
    });
    // World 2 best past = max(40, 200) = 200; current gen = 0.
    expect(vm.worldHighScores[1]).toMatchObject({
      currentGeneration: 0,
      bestPastGeneration: 200,
    });
  });

  it('tolerates a flat { worldN } history shape', () => {
    const save = baseSave();
    save.highScoreHistoryByGeneration = {
      genA: { world3: 77 },
      genB: { world3: 42 },
    };

    const vm = buildInfoPanelViewModel({
      obstaclesCleared: 0,
      currentScore: 0,
      activePerks: [],
      equippedSkill: null,
      save,
    });

    expect(vm.worldHighScores[2]).toMatchObject({ world: 3, bestPastGeneration: 77 });
  });

  it('excludes the current generation key from the past-generation roll-up', () => {
    const save = baseSave();
    save.highScoreHistoryByGeneration = {
      current: { story: { world1: 500 } }, // current gen — must be excluded
      old: { story: { world1: 120 } },
    };

    const vm = buildInfoPanelViewModel({
      obstaclesCleared: 0,
      currentScore: 0,
      activePerks: [],
      equippedSkill: null,
      save,
      currentGenerationKey: 'current',
    });

    // Only the "old" generation counts as past → 120, not 500.
    expect(vm.worldHighScores[0]?.bestPastGeneration).toBe(120);
  });

  it('ignores malformed history entries and non-finite values', () => {
    const save = baseSave();
    save.highScoreHistoryByGeneration = {
      bad1: null as unknown as Record<string, unknown>,
      bad2: [1, 2, 3] as unknown as Record<string, unknown>,
      bad3: { story: { world1: Number.NaN } } as unknown as Record<string, unknown>,
      good: { story: { world1: 64 } },
    };

    const vm = buildInfoPanelViewModel({
      obstaclesCleared: 0,
      currentScore: 0,
      activePerks: [],
      equippedSkill: null,
      save,
    });

    expect(vm.worldHighScores[0]?.bestPastGeneration).toBe(64);
  });

  it('returns 0 past highs when the history is empty', () => {
    const vm = buildInfoPanelViewModel({
      obstaclesCleared: 0,
      currentScore: 0,
      activePerks: [],
      equippedSkill: null,
      save: baseSave(),
    });

    expect(vm.worldHighScores.every((w) => w.bestPastGeneration === 0)).toBe(true);
  });
});

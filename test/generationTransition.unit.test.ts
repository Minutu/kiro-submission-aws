// Feature: kino-game
//
// Unit tests for the GenerationTransition module (task 7.4; design:
// "Left-behind worlds (Req 27.15-27.16)", "Generations (Req 22, 29, 32)";
// Req 27.15-27.16, 22.3-22.5, 32.1-32.3, 32.5).
//
// These pin the task-7.4 contract:
//   - Req 27.15-27.16: marking a world left-behind blocks STORY access but
//     keeps earned rewards valid and leaves Endless as the only return path.
//   - Req 32.3: the generation name advances Junior→Senior (same iteration)
//     then rolls over to the NEXT iteration's Junior.
//   - Req 22.4: a UNIQUE cosmetic is awarded into BOTH unlockedCosmetics and
//     generationCosmeticsAwarded.
//   - Req 22.3 / 22.5 / 32.5: permanent skills + cosmetics are kept, per-
//     generation story state is reset, and discovered worlds stay discovered
//     (greyed) rather than re-hidden.
//
// Pure / Phaser-free; built from the documented default Config_File.

import { describe, it, expect } from 'vitest';
import {
  markLeftBehind,
  isLeftBehind,
  canPlayStory,
  nextGeneration,
  advanceGeneration,
  composeGenerationName,
  formatGenerationName,
  toRoman,
  createFirstLaunchState,
  type SaveState,
} from '../src/core/index.ts';
import { defaultConfig } from '../src/config/index.ts';

const cfg = defaultConfig;

function freshSave(): SaveState {
  return createFirstLaunchState(cfg);
}

/** A save where every world is discovered + story-cleared (end-of-generation). */
function clearedSave(): SaveState {
  const save = freshSave();
  const worlds = { ...save.worlds };
  for (const id of Object.keys(worlds)) {
    worlds[id] = { discovered: true, storyCleared: true, leftBehind: false };
  }
  return { ...save, worlds };
}

describe('Generation_Name composition (Req 32.1-32.2)', () => {
  it('composes the current name from config + save', () => {
    expect(composeGenerationName(cfg, freshSave())).toBe('Kino I Junior');
  });

  it('toRoman handles small and larger iterations', () => {
    expect(toRoman(1)).toBe('I');
    expect(toRoman(3)).toBe('III');
    expect(toRoman(4)).toBe('IV');
    expect(toRoman(2024)).toBe('MMXXIV');
  });

  it('formatGenerationName honors a custom template and drops omitted tokens', () => {
    const name = formatGenerationName(
      'Kino',
      { format: '{base} {roman}' },
      { iteration: 3, suffix: 'Junior' },
    );
    expect(name).toBe('Kino III');
  });
});

describe('left-behind marking blocks story but allows endless (Req 27.15-27.16)', () => {
  it('markLeftBehind sets the flag without touching other fields', () => {
    const save = clearedSave();
    const after = markLeftBehind(save, 'world1');

    expect(isLeftBehind(after, 'world1')).toBe(true);
    // discovery + storyCleared + rewards are untouched (Req 27.16).
    expect(after.worlds.world1?.discovered).toBe(true);
    expect(after.worlds.world1?.storyCleared).toBe(true);
    // pure — input never mutated.
    expect(isLeftBehind(save, 'world1')).toBe(false);
    expect(after).not.toBe(save);
  });

  it('a left-behind world is NOT story-playable (replay/revisit blocked, Req 27.15)', () => {
    const save = markLeftBehind(clearedSave(), 'world2');
    expect(canPlayStory(save, 'world2')).toBe(false);
  });

  it('a discovered, not-left-behind world IS story-playable', () => {
    expect(canPlayStory(clearedSave(), 'world3')).toBe(true);
  });

  it('an undiscovered world is not story-playable', () => {
    const save = freshSave(); // only world1 discovered
    expect(canPlayStory(save, 'world2')).toBe(false);
  });

  it('left-behind does not touch earned rewards/unlocks (Req 27.16)', () => {
    const base = { ...clearedSave(), unlockedSkills: ['secondChance'], unlockedCosmetics: ['hatA'] };
    const after = markLeftBehind(base, 'world1');
    expect(after.unlockedSkills).toEqual(['secondChance']);
    expect(after.unlockedCosmetics).toEqual(['hatA']);
  });

  it('marking an unknown world is a safe no-op copy', () => {
    const save = freshSave();
    const after = markLeftBehind(save, 'worldX');
    expect(after.worlds).toEqual(save.worlds);
    expect(after).not.toBe(save);
  });
});

describe('generation-name advance rule Junior→Senior→next Junior (Req 32.3)', () => {
  const scheme = cfg.names.generationalScheme;

  it('Junior advances to Senior within the same iteration', () => {
    expect(nextGeneration({ iteration: 1, suffix: 'Junior' }, scheme)).toEqual({
      iteration: 1,
      suffix: 'Senior',
    });
  });

  it('Senior rolls over to the next iteration Junior', () => {
    expect(nextGeneration({ iteration: 1, suffix: 'Senior' }, scheme)).toEqual({
      iteration: 2,
      suffix: 'Junior',
    });
  });

  it('produces the documented sequence across several completions', () => {
    let gen = { iteration: 1, suffix: scheme.juniorSuffix };
    const names: string[] = [];
    for (let i = 0; i < 4; i++) {
      names.push(formatGenerationName(cfg.names.baseCharacterName, scheme, gen));
      gen = nextGeneration(gen, scheme);
    }
    expect(names).toEqual([
      'Kino I Junior',
      'Kino I Senior',
      'Kino II Junior',
      'Kino II Senior',
    ]);
  });
});

describe('advanceGeneration awards a unique cosmetic (Req 22.4)', () => {
  it('adds the awarded cosmetic to BOTH unlockedCosmetics and generationCosmeticsAwarded', () => {
    const { save, awardedCosmetic } = advanceGeneration(clearedSave(), cfg, {
      awardCosmetic: 'gen1-crown',
    });
    expect(awardedCosmetic).toBe('gen1-crown');
    expect(save.unlockedCosmetics).toContain('gen1-crown');
    expect(save.generationCosmeticsAwarded).toContain('gen1-crown');
  });

  it('never re-awards an already-awarded id; falls through to the pool', () => {
    const base = { ...clearedSave(), generationCosmeticsAwarded: ['gen1-crown'] };
    const { save, awardedCosmetic } = advanceGeneration(base, cfg, {
      awardCosmetic: 'gen1-crown', // already awarded
      cosmeticPool: ['gen1-crown', 'gen2-halo'],
    });
    expect(awardedCosmetic).toBe('gen2-halo');
    expect(save.generationCosmeticsAwarded).toEqual(['gen1-crown', 'gen2-halo']);
    expect(save.unlockedCosmetics).toContain('gen2-halo');
  });

  it('awards null when no unique cosmetic is available', () => {
    const base = { ...clearedSave(), generationCosmeticsAwarded: ['only'] };
    const { save, awardedCosmetic } = advanceGeneration(base, cfg, {
      cosmeticPool: ['only'],
    });
    expect(awardedCosmetic).toBeNull();
    expect(save.generationCosmeticsAwarded).toEqual(['only']);
    expect(save.unlockedCosmetics).toEqual(base.unlockedCosmetics);
  });

  it('does not duplicate a cosmetic already in unlockedCosmetics', () => {
    const base = { ...clearedSave(), unlockedCosmetics: ['gen1-crown'] };
    const { save } = advanceGeneration(base, cfg, { awardCosmetic: 'gen1-crown' });
    expect(save.unlockedCosmetics.filter((c) => c === 'gen1-crown')).toHaveLength(1);
    expect(save.generationCosmeticsAwarded).toEqual(['gen1-crown']);
  });
});

describe('advanceGeneration advances the name and resets story state (Req 22.3, 22.5, 32.3, 32.5)', () => {
  it('advances Junior→Senior on the first completion', () => {
    const { save } = advanceGeneration(clearedSave(), cfg, { awardCosmetic: 'c1' });
    expect(save.generation).toEqual({ iteration: 1, suffix: 'Senior' });
    expect(composeGenerationName(cfg, save)).toBe('Kino I Senior');
  });

  it('advances Senior→next iteration Junior on the second completion', () => {
    let { save } = advanceGeneration(clearedSave(), cfg, { awardCosmetic: 'c1' });
    ({ save } = advanceGeneration(save, cfg, { awardCosmetic: 'c2' }));
    expect(save.generation).toEqual({ iteration: 2, suffix: 'Junior' });
  });

  it('keeps permanent skills + cosmetics (Req 22.5)', () => {
    const base = {
      ...clearedSave(),
      unlockedSkills: ['secondChance', 'dash'],
      unlockedCosmetics: ['hatA'],
      equippedSkill: 'dash',
      equippedCosmetic: 'hatA',
    };
    const { save } = advanceGeneration(base, cfg, { awardCosmetic: 'gen-reward' });
    expect(save.unlockedSkills).toEqual(['secondChance', 'dash']);
    expect(save.unlockedCosmetics).toEqual(['hatA', 'gen-reward']);
    expect(save.equippedSkill).toBe('dash');
    expect(save.equippedCosmetic).toBe('hatA');
  });

  it('resets per-generation story state: storyCleared and leftBehind cleared (Req 22.3)', () => {
    const base = markLeftBehind(clearedSave(), 'world1');
    const { save } = advanceGeneration(base, cfg, { awardCosmetic: 'c1' });
    for (const w of Object.values(save.worlds)) {
      expect(w.storyCleared).toBe(false);
      expect(w.leftBehind).toBe(false);
    }
  });

  it('greys previously discovered worlds: discovery is kept, not re-hidden (Req 32.5)', () => {
    const base = clearedSave(); // all five discovered
    const { save } = advanceGeneration(base, cfg, { awardCosmetic: 'c1' });
    for (const w of Object.values(save.worlds)) {
      expect(w.discovered).toBe(true);
    }
    // World 1 is the new generation's playable story start.
    expect(canPlayStory(save, 'world1')).toBe(true);
  });

  it('keeps high scores and history (Req 22.5, 28, 31.2)', () => {
    const base: SaveState = {
      ...clearedSave(),
      highScores: { story: { world1: 120 }, endless: { world2: 88 } },
      highScoreHistoryByGeneration: { 'Kino I Junior': { world1: 120 } },
    };
    const { save } = advanceGeneration(base, cfg, { awardCosmetic: 'c1' });
    expect(save.highScores).toEqual({ story: { world1: 120 }, endless: { world2: 88 } });
    expect(save.highScoreHistoryByGeneration).toEqual({ 'Kino I Junior': { world1: 120 } });
  });

  it('is pure — never mutates the input save', () => {
    const base = clearedSave();
    const snapshot = JSON.stringify(base);
    advanceGeneration(base, cfg, { awardCosmetic: 'c1' });
    expect(JSON.stringify(base)).toBe(snapshot);
  });
});

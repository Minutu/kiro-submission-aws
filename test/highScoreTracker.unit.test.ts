// Feature: kino-game
//
// UNIT tests for the task-7.6 high-score tracker (Req 28.1-28.4). Covers:
//   - recordScore increases on a new best and reports updated: true.
//   - recordScore leaves an equal/lower score unchanged and reports
//     updated: false (the monotonic-max rule, Req 28.3; Property 11 — task 7.7
//     — owns the exhaustive property).
//   - story and endless are tracked SEPARATELY per world (Req 28.1-28.2).
//   - getHighScore returns the right value for a (mode, world) and defaults a
//     missing/non-finite entry to 0 (Req 28.4).
//   - recordScore / recordScoreOnSave never mutate their inputs.
//   - highScoreModeForMovement bridges MovementMode / 'endless' to the
//     'story' | 'endless' discriminator, consistent with runEndStats.
//
// Pure TypeScript, no Phaser — mirrors runEndStats.relevantHighScore's reader.

import { describe, it, expect } from 'vitest';
import {
  recordScore,
  recordScoreOnSave,
  getHighScore,
  highScoreModeForMovement,
  type HighScoreState,
  type SaveState,
} from '../src/core/index.ts';
import { relevantHighScore } from '../src/engine/runEndStats.ts';

function makeHighScores(
  story: Record<string, number> = {},
  endless: Record<string, number> = {},
): HighScoreState {
  return { story, endless };
}

describe('recordScore — monotonic per-world/per-mode max (Req 28.3)', () => {
  it('increases on a new best and reports updated: true', () => {
    const hs = makeHighScores({ world1: 10 });
    const res = recordScore(hs, 'story', 1, 42);
    expect(res.updated).toBe(true);
    expect(res.highScore).toBe(42);
    expect(res.highScores.story.world1).toBe(42);
  });

  it('records a new best into an absent world entry (default 0 baseline)', () => {
    const hs = makeHighScores();
    const res = recordScore(hs, 'story', 3, 5);
    expect(res.updated).toBe(true);
    expect(res.highScore).toBe(5);
    expect(res.highScores.story.world3).toBe(5);
  });

  it('does NOT change an equal score and reports updated: false', () => {
    const hs = makeHighScores({ world1: 42 });
    const res = recordScore(hs, 'story', 1, 42);
    expect(res.updated).toBe(false);
    expect(res.highScore).toBe(42);
    expect(res.highScores.story.world1).toBe(42);
  });

  it('does NOT change a lower score and reports updated: false', () => {
    const hs = makeHighScores({ world1: 42 });
    const res = recordScore(hs, 'story', 1, 7);
    expect(res.updated).toBe(false);
    expect(res.highScore).toBe(42);
    expect(res.highScores.story.world1).toBe(42);
  });

  it('treats a non-finite score as no improvement', () => {
    const hs = makeHighScores({ world1: 42 });
    const res = recordScore(hs, 'story', 1, Number.NaN);
    expect(res.updated).toBe(false);
    expect(res.highScore).toBe(42);
  });

  it('never mutates the input maps', () => {
    const hs = makeHighScores({ world1: 10 }, { world1: 3 });
    recordScore(hs, 'story', 1, 99);
    recordScore(hs, 'endless', 1, 99);
    expect(hs.story).toEqual({ world1: 10 });
    expect(hs.endless).toEqual({ world1: 3 });
  });
});

describe('story and endless tracked separately per world (Req 28.1-28.2)', () => {
  it('recording a story score does not touch the endless map for the same world', () => {
    const hs = makeHighScores({ world1: 10 }, { world1: 5 });
    const res = recordScore(hs, 'story', 1, 50);
    expect(res.highScores.story.world1).toBe(50);
    expect(res.highScores.endless.world1).toBe(5);
  });

  it('recording an endless score does not touch the story map for the same world', () => {
    const hs = makeHighScores({ world1: 10 }, { world1: 5 });
    const res = recordScore(hs, 'endless', 1, 80);
    expect(res.highScores.endless.world1).toBe(80);
    expect(res.highScores.story.world1).toBe(10);
  });

  it('keeps each world independent within a mode', () => {
    let hs = makeHighScores();
    hs = recordScore(hs, 'story', 1, 10).highScores;
    hs = recordScore(hs, 'story', 2, 20).highScores;
    expect(getHighScore(hs, 'story', 1)).toBe(10);
    expect(getHighScore(hs, 'story', 2)).toBe(20);
    expect(getHighScore(hs, 'story', 3)).toBe(0);
  });
});

describe('getHighScore — relevant reader with 0 default (Req 28.4)', () => {
  it('reads the story map by world for a story mode', () => {
    const hs = makeHighScores({ world1: 42, world2: 7 });
    expect(getHighScore(hs, 'story', 1)).toBe(42);
    expect(getHighScore(hs, 'story', 2)).toBe(7);
  });

  it('reads the endless map by world for an endless mode', () => {
    const hs = makeHighScores({ world1: 100 }, { world1: 55 });
    expect(getHighScore(hs, 'endless', 1)).toBe(55);
  });

  it('defaults an absent or non-finite entry to 0', () => {
    const hs = makeHighScores({ world1: Number.NaN });
    expect(getHighScore(hs, 'story', 1)).toBe(0); // present but NaN
    expect(getHighScore(hs, 'story', 4)).toBe(0); // absent
    expect(getHighScore(hs, 'endless', 1)).toBe(0); // absent in endless
  });
});

describe('highScoreModeForMovement — bridge to runEndStats (Req 28.1-28.2)', () => {
  it('maps every real movement mode to story', () => {
    expect(highScoreModeForMovement('jumping')).toBe('story');
    expect(highScoreModeForMovement('flight')).toBe('story');
    expect(highScoreModeForMovement('zigzag')).toBe('story');
    expect(highScoreModeForMovement('underwater')).toBe('story');
  });

  it('maps the endless sentinel to endless', () => {
    expect(highScoreModeForMovement('endless')).toBe('endless');
  });

  it('reconciles with runEndStats.relevantHighScore for the same world', () => {
    const hs = makeHighScores({ world1: 42 }, { world1: 55 });
    // A jumping (story) run and getHighScore('story') agree.
    expect(relevantHighScore(hs, 'jumping', 1)).toBe(
      getHighScore(hs, highScoreModeForMovement('jumping'), 1),
    );
    // The endless sentinel and getHighScore('endless') agree.
    expect(relevantHighScore(hs, 'endless' as never, 1)).toBe(
      getHighScore(hs, highScoreModeForMovement('endless'), 1),
    );
  });
});

describe('recordScoreOnSave — folds into a whole SaveState', () => {
  function makeSave(): SaveState {
    return {
      schemaVersion: 1,
      generation: { iteration: 1, suffix: 'Junior' },
      unlockedSkills: [],
      unlockedCosmetics: [],
      equippedSkill: null,
      equippedCosmetic: null,
      controlBindings: { primary: ['SPACE'], skill: ['Q'] },
      settings: { volume: 0.8, muted: false },
      worlds: {},
      highScores: makeHighScores({ world1: 10 }, { world1: 5 }),
      highScoreHistoryByGeneration: {},
      generationCosmeticsAwarded: [],
    };
  }

  it('returns a new save with the updated high score, leaving other fields intact', () => {
    const save = makeSave();
    const res = recordScoreOnSave(save, 'story', 1, 99);
    expect(res.updated).toBe(true);
    expect(res.highScore).toBe(99);
    expect(res.save.highScores.story.world1).toBe(99);
    expect(res.save.generation).toBe(save.generation); // carried by reference
  });

  it('does not touch highScoreHistoryByGeneration (Req 31.2 is task 7.4)', () => {
    const save = makeSave();
    const res = recordScoreOnSave(save, 'endless', 1, 80);
    expect(res.save.highScoreHistoryByGeneration).toEqual({});
  });

  it('never mutates the input save', () => {
    const save = makeSave();
    recordScoreOnSave(save, 'story', 1, 99);
    expect(save.highScores.story.world1).toBe(10);
  });
});

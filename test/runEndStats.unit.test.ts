// Feature: kino-game
//
// UNIT tests for the task-4.7 Run_End_Screen pure stat helpers (Req 39.1).
// Covers:
//   - relevantHighScore reads the story map by world for a story-mode run,
//     defaults a missing/absent world entry to 0, and reads the endless map
//     for an endless-mode run.
//   - formatRunTime renders ms as a one-decimal seconds string and clamps
//     negative/NaN inputs to "0.0s".
//
// Pure TypeScript, no Phaser — these helpers live in `runEndStats.ts`
// precisely so they can be exercised in plain Node without a browser/canvas.

import { describe, it, expect } from 'vitest';
import { relevantHighScore, formatRunTime } from '../src/engine/runEndStats.ts';
import type { HighScoreState } from '../src/engine/saveState.ts';
import type { MovementMode } from '../src/core/index.ts';

function makeHighScores(
  story: Record<string, number> = {},
  endless: Record<string, number> = {},
): HighScoreState {
  return { story, endless };
}

describe('relevantHighScore (Req 39.1)', () => {
  it('reads the story map by world for a story-mode (jumping) run', () => {
    const hs = makeHighScores({ world1: 42, world2: 7 });
    expect(relevantHighScore(hs, 'jumping', 1)).toBe(42);
    expect(relevantHighScore(hs, 'jumping', 2)).toBe(7);
  });

  it('defaults an absent or non-finite world entry to 0', () => {
    const hs = makeHighScores({ world1: Number.NaN });
    // world3 has no entry at all.
    expect(relevantHighScore(hs, 'jumping', 3)).toBe(0);
    // world1 is present but NaN — treated as 0.
    expect(relevantHighScore(hs, 'jumping', 1)).toBe(0);
  });

  it('reads the endless map for an endless-mode run', () => {
    const hs = makeHighScores({ world1: 100 }, { world1: 55 });
    expect(relevantHighScore(hs, 'endless' as MovementMode, 1)).toBe(55);
  });

  it('is read-only: it does not mutate the provided maps', () => {
    const hs = makeHighScores({ world1: 10 });
    relevantHighScore(hs, 'jumping', 1);
    relevantHighScore(hs, 'jumping', 9);
    expect(hs.story).toEqual({ world1: 10 });
    expect(hs.endless).toEqual({});
  });
});

describe('formatRunTime (Req 39.1)', () => {
  it('renders milliseconds as a one-decimal seconds string', () => {
    expect(formatRunTime(4200)).toBe('4.2s');
    expect(formatRunTime(1000)).toBe('1.0s');
    expect(formatRunTime(0)).toBe('0.0s');
    expect(formatRunTime(12345)).toBe('12.3s');
  });

  it('clamps negative and non-finite inputs to "0.0s"', () => {
    expect(formatRunTime(-500)).toBe('0.0s');
    expect(formatRunTime(Number.NaN)).toBe('0.0s');
    expect(formatRunTime(Number.POSITIVE_INFINITY)).toBe('0.0s');
  });
});

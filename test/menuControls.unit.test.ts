// Feature: kino-game
//
// UNIT tests for the bottom-primary-button selection logic (task 9.2; design:
// "bottom primary Start/Continue button (label from config by story position,
// 20.13)"; Req 20.13, 20.14) in src/core/menuControls.ts.
//
// These pin the EXHAUSTIVE, MUTUALLY-EXCLUSIVE 13a–13d label contract:
//   - 13a WHILE position is World 1 AND the story has NOT been started  => `startStory` label.
//   - 13b WHILE position is BEYOND World 1                               => `continueStory` label.
//   - 13c WHILE position is World 1 AND the story HAS been started       => `continueStory` label.
//   - 13d Both label values are read from the Config_File.
// Plus Req 20.14: a press launches the next available story step (the current
// story position), and the top-center Generation pill (Req 20.25) reads the
// composed Generation_Name.
//
// Pure / Phaser-free: a First_Launch_State fixture + per-test world flags fully
// exercise the module.

import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/config/index.ts';
import {
  resolvePrimaryButtonLabel,
  currentStoryPosition,
  hasStartedStory,
  generationPillText,
  createFirstLaunchState,
  formatGenerationName,
  type SaveState,
} from '../src/core/index.ts';

/** A fresh First_Launch_State: World 1 discovered, nothing cleared. */
function baseSave(): SaveState {
  return createFirstLaunchState(defaultConfig);
}

/** Mark a world discovered (and optionally cleared) on a cloned save. */
function discover(
  save: SaveState,
  key: string,
  opts: { cleared?: boolean; leftBehind?: boolean } = {},
): SaveState {
  return {
    ...save,
    worlds: {
      ...save.worlds,
      [key]: {
        discovered: true,
        storyCleared: opts.cleared ?? false,
        leftBehind: opts.leftBehind ?? false,
      },
    },
  };
}

describe('resolvePrimaryButtonLabel — 13a (World 1, story NOT started)', () => {
  it('labels the button with the config startStory value', () => {
    const save = baseSave(); // World 1 discovered, nothing cleared
    const res = resolvePrimaryButtonLabel(save, defaultConfig);

    expect(res.case).toBe('13a');
    expect(res.action).toBe('startStory');
    expect(res.label).toBe(defaultConfig.labels.startStory);
    expect(res.label).toBe('Start Story');
    // Next available story step is World 1 (Req 20.14).
    expect(res.launchWorld).toBe(1);
  });

  it('reports the story as not started and position World 1', () => {
    const save = baseSave();
    expect(currentStoryPosition(save)).toBe(1);
    expect(hasStartedStory(save)).toBe(false);
  });
});

describe('resolvePrimaryButtonLabel — 13b (position BEYOND World 1)', () => {
  it('labels the button with the config continueStory value', () => {
    // World 1 cleared, World 2 discovered => position is World 2.
    let save = baseSave();
    save = discover(save, 'world1', { cleared: true });
    save = discover(save, 'world2');
    const res = resolvePrimaryButtonLabel(save, defaultConfig);

    expect(res.case).toBe('13b');
    expect(res.action).toBe('continueStory');
    expect(res.label).toBe(defaultConfig.labels.continueStory);
    expect(res.label).toBe('Continue Story');
    // The next available story step is the current position (World 2).
    expect(res.launchWorld).toBe(2);
  });

  it('launches the highest discovered-not-left-behind world', () => {
    // Discover through World 4 (World 5 still a silhouette) => position 4.
    let save = baseSave();
    save = discover(save, 'world1', { cleared: true });
    save = discover(save, 'world2', { cleared: true });
    save = discover(save, 'world3', { cleared: true });
    save = discover(save, 'world4');
    const res = resolvePrimaryButtonLabel(save, defaultConfig);

    expect(res.case).toBe('13b');
    expect(res.launchWorld).toBe(4);
  });

  it('ignores a left-behind higher world when computing position', () => {
    // World 2 discovered but LEFT BEHIND, World 1 still current => position 1.
    let save = baseSave();
    save = discover(save, 'world1', { cleared: true });
    save = discover(save, 'world2', { leftBehind: true });
    const res = resolvePrimaryButtonLabel(save, defaultConfig);

    // Position collapses back to World 1; story is started (W1 cleared) => 13c.
    expect(currentStoryPosition(save)).toBe(1);
    expect(res.case).toBe('13c');
  });
});

describe('resolvePrimaryButtonLabel — 13c (World 1, story HAS been started)', () => {
  it('labels the button with the config continueStory value', () => {
    // World 1 cleared but World 2 not yet discovered => position still World 1,
    // story started.
    let save = baseSave();
    save = discover(save, 'world1', { cleared: true });
    const res = resolvePrimaryButtonLabel(save, defaultConfig);

    expect(res.case).toBe('13c');
    expect(res.action).toBe('continueStory');
    expect(res.label).toBe(defaultConfig.labels.continueStory);
    expect(res.label).toBe('Continue Story');
    expect(res.launchWorld).toBe(1);
  });

  it('reports the story as started and position World 1', () => {
    let save = baseSave();
    save = discover(save, 'world1', { cleared: true });
    expect(currentStoryPosition(save)).toBe(1);
    expect(hasStartedStory(save)).toBe(true);
  });
});

describe('resolvePrimaryButtonLabel — 13d (both labels read from Config_File)', () => {
  it('uses whatever label values the config supplies, verbatim', () => {
    const customConfig = {
      ...defaultConfig,
      labels: {
        ...defaultConfig.labels,
        startStory: 'Begin the Tale',
        continueStory: 'Resume the Tale',
      },
    };

    // 13a path reads startStory.
    const started = resolvePrimaryButtonLabel(baseSave(), customConfig);
    expect(started.label).toBe('Begin the Tale');

    // 13c path reads continueStory.
    let continued = baseSave();
    continued = discover(continued, 'world1', { cleared: true });
    const res = resolvePrimaryButtonLabel(continued, customConfig);
    expect(res.label).toBe('Resume the Tale');
  });
});

describe('resolvePrimaryButtonLabel — exhaustiveness', () => {
  it('always resolves to exactly one of the 13a–13c positional cases', () => {
    const configs = [defaultConfig];
    const saves: SaveState[] = [
      baseSave(),
      discover(baseSave(), 'world1', { cleared: true }),
      (() => {
        let s = discover(baseSave(), 'world1', { cleared: true });
        s = discover(s, 'world2');
        return s;
      })(),
    ];
    for (const cfg of configs) {
      for (const save of saves) {
        const res = resolvePrimaryButtonLabel(save, cfg);
        expect(['13a', '13b', '13c']).toContain(res.case);
        // The label is always one of the two config values (Req 20.13d).
        expect([cfg.labels.startStory, cfg.labels.continueStory]).toContain(res.label);
      }
    }
  });
});

describe('generationPillText (Req 20.25)', () => {
  it('composes the current Generation_Name from config + save', () => {
    const save = baseSave();
    const pill = generationPillText(save, defaultConfig);
    const expected = formatGenerationName(
      defaultConfig.names.baseCharacterName,
      defaultConfig.names.generationalScheme,
      save.generation,
    );
    expect(pill).toBe(expected);
    // First launch is Generation 1 Junior => "Kino I Junior" by default scheme.
    expect(pill).toContain('Kino');
  });
});

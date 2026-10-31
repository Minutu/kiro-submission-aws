// Feature: kino-game
//
// INTEGRATED MENU-CONTRACT unit tests (task 9.10). Where the per-module suites
// (treasureMap.unit / menuControls.unit / settingsScreen.unit) pin each pure
// function in isolation, THIS file pins the three MENU behaviors the task calls
// for together, framed as the user-facing contracts the MainMenuScene renders:
//
//   1. MENU LOCK-IN (Req 34.1, 34.3) — scrolling the treasure map snaps to the
//      nearest DISCOVERED world (it locks in, the side glow shows, Play is
//      enabled), while a centered undiscovered silhouette locks NOTHING and
//      DISABLES Play. Via computeMapRows + lockInWorldForScroll.
//
//   2. BOTTOM-BUTTON LABEL 13a–13d (Req 20.13) — the bottom primary button's
//      label resolves across the four exhaustive cases: 13a (World 1, not
//      started) => startStory; 13b (beyond World 1) => continueStory; 13c
//      (World 1, started) => continueStory; 13d both labels read from config.
//      Via resolvePrimaryButtonLabel.
//
//   3. REBINDING conflict + rollback (Req 1.7, 1.9) — a primary<->skill rebind
//      conflict is REJECTED with a naming message and NOT applied; and
//      applyRebindWithPersist ROLLS BACK to the previous binding when the
//      injected persist returns false OR throws. Via rebind +
//      applyRebindWithPersist.
//
// Everything imports the REAL public surface from src/core/index.ts and uses no
// Phaser — the same core the engine MainMenuScene defers to. Small save-state
// builders keep each menu scenario explicit.

import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/config/index.ts';
import {
  // Lock-in (Req 34.1, 34.3)
  computeMapRows,
  lockInWorldForScroll,
  TREASURE_MAP_WORLD_IDS,
  // Bottom-button label 13a–13d (Req 20.13)
  resolvePrimaryButtonLabel,
  // Rebinding conflict + rollback (Req 1.7, 1.9)
  rebind,
  applyRebindWithPersist,
  REBIND_ACTION_LABELS,
  // Save fixture
  createFirstLaunchState,
  type SaveState,
  type WorldKey,
} from '../src/core/index.ts';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const cfg = defaultConfig;

/** A fresh First_Launch_State the menu opens on: World 1 discovered, nothing cleared. */
function freshSave(): SaveState {
  return createFirstLaunchState(cfg);
}

/**
 * Build a save from a per-world discovery/clear spec. Any world not listed is
 * fully undiscovered. Keeps each menu scenario's progress obvious.
 */
function saveWith(
  spec: Partial<
    Record<WorldKey, { discovered?: boolean; storyCleared?: boolean; leftBehind?: boolean }>
  >,
): SaveState {
  const base = freshSave();
  for (const key of TREASURE_MAP_WORLD_IDS) {
    const s = spec[key];
    base.worlds[key] = {
      discovered: s?.discovered ?? false,
      storyCleared: s?.storyCleared ?? false,
      leftBehind: s?.leftBehind ?? false,
    };
  }
  return base;
}

// ===========================================================================
// 1. MENU LOCK-IN — scroll snaps to the nearest discovered world; a silhouette
//    disables Play (Req 34.1, 34.3).
// ===========================================================================

describe('Menu lock-in: scroll snaps to the nearest discovered world (Req 34.1)', () => {
  it('a near-centered discovered world locks in, glows, and enables Play', () => {
    // Worlds 1-3 discovered; the player scrolls the map toward World 3.
    const { rows } = computeMapRows(
      saveWith({
        world1: { discovered: true, storyCleared: true },
        world2: { discovered: true, storyCleared: true },
        world3: { discovered: true },
      }),
    );

    // A scroll offset of 2.1 is NEAREST to row index 2 (World 3) — the snap
    // rounds to it and locks the discovered world in.
    const lock = lockInWorldForScroll(rows, 2.1);

    expect(lock.centeredWorldId).toBe(3);
    expect(lock.lockedInWorldId).toBe(3); // locked in (Req 34.1)
    expect(lock.centeredSelectable).toBe(true);
    expect(lock.showSideGlow).toBe(true); // side glow on (Req 34.1)
    expect(lock.playEnabled).toBe(true); // Play enabled (Req 34.1)
  });

  it('snaps to the NEAREST discovered row as the scroll offset crosses the midpoint', () => {
    const { rows } = computeMapRows(
      saveWith({
        world1: { discovered: true },
        world2: { discovered: true },
      }),
    );

    // Just below the midpoint snaps down to World 1; just above snaps up to
    // World 2 — both discovered, so each locks in with Play enabled.
    const low = lockInWorldForScroll(rows, 0.49);
    expect(low.lockedInWorldId).toBe(1);
    expect(low.playEnabled).toBe(true);

    const high = lockInWorldForScroll(rows, 0.51);
    expect(high.lockedInWorldId).toBe(2);
    expect(high.playEnabled).toBe(true);
  });

  it('clamps an over-scroll to the top discovered world rather than falling off the map', () => {
    const { rows } = computeMapRows(
      saveWith({
        world1: { discovered: true },
        world2: { discovered: true },
        world3: { discovered: true },
        world4: { discovered: true },
        world5: { discovered: true },
      }),
    );
    // Scrolling far past the top clamps onto World 5 (all discovered here).
    const lock = lockInWorldForScroll(rows, 999);
    expect(lock.centeredWorldId).toBe(5);
    expect(lock.lockedInWorldId).toBe(5);
    expect(lock.playEnabled).toBe(true);
  });
});

describe('Menu lock-in: a centered undiscovered silhouette disables Play (Req 34.3)', () => {
  it('centering an undiscovered silhouette locks nothing, hides the glow, and disables Play', () => {
    // First-launch map: only World 1 discovered. World 2 is the next-reveal and
    // Worlds 3-5 are silhouettes.
    const { rows } = computeMapRows(freshSave());

    // Scroll the map so World 3 (a black silhouette) sits at center.
    const lock = lockInWorldForScroll(rows, 2);

    expect(lock.centeredWorldId).toBe(3);
    expect(lock.centeredSelectable).toBe(false);
    expect(lock.lockedInWorldId).toBeNull(); // nothing locks in (Req 34.3)
    expect(lock.showSideGlow).toBe(false); // no glow (Req 34.3)
    expect(lock.playEnabled).toBe(false); // Play disabled (Req 34.3)
  });

  it('the next-reveal world (still a silhouette) also disables Play', () => {
    const { rows } = computeMapRows(freshSave());
    // World 2 (index 1) is the next-reveal — fading in but not yet discovered.
    const lock = lockInWorldForScroll(rows, 1);

    expect(lock.centeredWorldId).toBe(2);
    expect(lock.lockedInWorldId).toBeNull();
    expect(lock.showSideGlow).toBe(false);
    expect(lock.playEnabled).toBe(false);
  });

  it('scrolling from a silhouette back onto a discovered world re-enables Play', () => {
    // World 1 discovered, World 2 a silhouette: scrolling between them flips
    // the Play gate on and off as the lock-in follows the snap.
    const { rows } = computeMapRows(saveWith({ world1: { discovered: true } }));

    const onSilhouette = lockInWorldForScroll(rows, 1);
    expect(onSilhouette.playEnabled).toBe(false);

    const backOnDiscovered = lockInWorldForScroll(rows, 0);
    expect(backOnDiscovered.lockedInWorldId).toBe(1);
    expect(backOnDiscovered.playEnabled).toBe(true);
  });
});

// ===========================================================================
// 2. BOTTOM-BUTTON LABEL — the four exhaustive 13a–13d cases (Req 20.13).
// ===========================================================================

describe('Bottom-button label: 13a–13d resolution (Req 20.13)', () => {
  it('13a — World 1, story NOT started => the config startStory label', () => {
    // First launch: only World 1 discovered, nothing cleared.
    const res = resolvePrimaryButtonLabel(freshSave(), cfg);

    expect(res.case).toBe('13a');
    expect(res.action).toBe('startStory');
    expect(res.label).toBe(cfg.labels.startStory);
    expect(res.launchWorld).toBe(1); // a press launches the next step (Req 20.14)
  });

  it('13b — position BEYOND World 1 => the config continueStory label', () => {
    // World 1 cleared, World 2 discovered => current position is World 2.
    const save = saveWith({
      world1: { discovered: true, storyCleared: true },
      world2: { discovered: true },
    });
    const res = resolvePrimaryButtonLabel(save, cfg);

    expect(res.case).toBe('13b');
    expect(res.action).toBe('continueStory');
    expect(res.label).toBe(cfg.labels.continueStory);
    expect(res.launchWorld).toBe(2);
  });

  it('13c — World 1, story HAS been started => the config continueStory label', () => {
    // World 1 cleared but World 2 not yet discovered => position still World 1,
    // story started.
    const save = saveWith({ world1: { discovered: true, storyCleared: true } });
    const res = resolvePrimaryButtonLabel(save, cfg);

    expect(res.case).toBe('13c');
    expect(res.action).toBe('continueStory');
    expect(res.label).toBe(cfg.labels.continueStory);
    expect(res.launchWorld).toBe(1);
  });

  it('13d — BOTH label values are read verbatim from the Config_File', () => {
    // Swapping the config labels changes the resolved button text with no code
    // change: the start path reads startStory, the continue path reads
    // continueStory.
    const customCfg = {
      ...cfg,
      labels: { ...cfg.labels, startStory: 'Begin the Journey', continueStory: 'Press On' },
    };

    const start = resolvePrimaryButtonLabel(freshSave(), customCfg);
    expect(start.case).toBe('13a');
    expect(start.label).toBe('Begin the Journey');

    const cont = resolvePrimaryButtonLabel(
      saveWith({ world1: { discovered: true, storyCleared: true } }),
      customCfg,
    );
    expect(cont.case).toBe('13c');
    expect(cont.label).toBe('Press On');
  });

  it('the three positional branches partition every story position (exhaustive & exclusive)', () => {
    const scenarios: Array<{ save: SaveState; expected: '13a' | '13b' | '13c' }> = [
      { save: freshSave(), expected: '13a' },
      { save: saveWith({ world1: { discovered: true, storyCleared: true } }), expected: '13c' },
      {
        save: saveWith({
          world1: { discovered: true, storyCleared: true },
          world2: { discovered: true },
        }),
        expected: '13b',
      },
    ];
    for (const { save, expected } of scenarios) {
      const res = resolvePrimaryButtonLabel(save, cfg);
      expect(res.case).toBe(expected);
      // Whatever the branch, the label is always one of the two config values (13d).
      expect([cfg.labels.startStory, cfg.labels.continueStory]).toContain(res.label);
    }
  });
});

// ===========================================================================
// 3. REBINDING — primary<->skill conflict rejected with rollback on persist
//    failure (Req 1.7, 1.9).
// ===========================================================================

describe('Settings rebinding: primary<->skill conflict is rejected with a naming message (Req 1.7)', () => {
  it('rejects rebinding the primary action onto a skill-held control, names it, and applies nothing', () => {
    const save = freshSave();
    // Default skill group holds "Q" + "MOUSE_RIGHT"; try to rebind primary to Q.
    const result = rebind(save, 'primary', 0, 'Q');

    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'conflict') {
      throw new Error('expected a primary<->skill conflict rejection');
    }
    expect(result.conflictingAction).toBe('skill');
    expect(result.conflictingControl).toBe('Q');
    // The message NAMES the occupied control and the action that holds it (Req 1.7).
    expect(result.message).toContain('Q');
    expect(result.message).toContain(REBIND_ACTION_LABELS.skill);
    // The bindings are untouched — nothing was applied.
    expect(save.controlBindings.primary).toEqual(['SPACE', 'MOUSE_LEFT']);
    expect(save.controlBindings.skill).toEqual(['Q', 'MOUSE_RIGHT']);
  });

  it('rejects the symmetric skill-onto-primary conflict too', () => {
    const save = freshSave();
    const result = rebind(save, 'skill', 0, 'MOUSE_LEFT'); // held by primary
    expect(result.ok).toBe(false);
    if (result.ok || result.reason !== 'conflict') {
      throw new Error('expected a skill<->primary conflict rejection');
    }
    expect(result.conflictingAction).toBe('primary');
    expect(result.conflictingControl).toBe('MOUSE_LEFT');
    expect(result.message).toContain(REBIND_ACTION_LABELS.primary);
  });
});

describe('Settings rebinding: rollback keeps the previous binding on persist failure (Req 1.9)', () => {
  it('persists an accepted rebind and keeps the new binding when the write succeeds', () => {
    const prev = freshSave();
    const result = rebind(prev, 'primary', 0, 'ENTER');
    expect(result.ok).toBe(true);

    let persistedWith: SaveState | null = null;
    const outcome = applyRebindWithPersist(prev, result, (s) => {
      persistedWith = s;
      return true;
    });

    expect(outcome.persisted).toBe(true);
    expect(outcome.rolledBack).toBe(false);
    expect(outcome.save.controlBindings.primary).toEqual(['ENTER', 'MOUSE_LEFT']);
    expect(persistedWith).not.toBeNull();
  });

  it('ROLLS BACK to the previous binding when the injected persist returns false', () => {
    const prev = freshSave();
    const result = rebind(prev, 'primary', 0, 'ENTER');

    const outcome = applyRebindWithPersist(prev, result, () => false);

    expect(outcome.persisted).toBe(false);
    expect(outcome.rolledBack).toBe(true);
    // The previous binding remains active and authoritative (Req 1.9).
    expect(outcome.save).toBe(prev);
    expect(outcome.save.controlBindings.primary).toEqual(['SPACE', 'MOUSE_LEFT']);
  });

  it('ROLLS BACK when the injected persist THROWS (storage unavailable)', () => {
    const prev = freshSave();
    const result = rebind(prev, 'skill', 0, 'E');

    const outcome = applyRebindWithPersist(prev, result, () => {
      throw new Error('storage unavailable');
    });

    expect(outcome.persisted).toBe(false);
    expect(outcome.rolledBack).toBe(true);
    expect(outcome.save.controlBindings.skill).toEqual(['Q', 'MOUSE_RIGHT']);
  });

  it('a rejected (conflicting) rebind never reaches persistence', () => {
    const prev = freshSave();
    const result = rebind(prev, 'primary', 0, 'Q'); // conflict with skill
    let persistCalled = false;

    const outcome = applyRebindWithPersist(prev, result, () => {
      persistCalled = true;
      return true;
    });

    expect(persistCalled).toBe(false);
    expect(outcome.persisted).toBe(false);
    expect(outcome.rolledBack).toBe(false);
    expect(outcome.save).toBe(prev);
  });
});

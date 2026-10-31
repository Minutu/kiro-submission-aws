// Feature: kino-game
//
// UNIT tests for the PURE Settings_Screen logic (task 9.7) in
// src/core/settingsScreen.ts. These cover the deterministic volume/rebind/
// rollback/reset behaviors the thin engine SettingsScene defers to:
//   - volume is CLAMPED to [0,1] and the persisted `settings.volume` field is
//     set (Req 20.49, 25.7); mute toggles `settings.muted`.
//   - a primary<->skill CONFLICT is rejected with a message that NAMES the
//     conflicting action + control and does NOT change the bindings (Req 1.7).
//   - a NON-conflicting rebind is applied (Req 1.6, 1.8).
//   - ROLLBACK restores the previous binding when the injected persistFn fails
//     or throws (Req 1.9).
//   - resetToFirstLaunch yields a First_Launch_State equal to
//     createFirstLaunchState (Req 20.51).
//
// Pure TypeScript, no Phaser — core module.

import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/config/index.ts';
import { createFirstLaunchState, type SaveState } from '../src/core/saveStore.ts';
import {
  clampVolume,
  setVolume,
  setMuted,
  rebind,
  applyRebindWithPersist,
  resetToFirstLaunch,
  REBIND_ACTION_LABELS,
} from '../src/core/settingsScreen.ts';

const cfg = defaultConfig;

/** A fresh First_Launch_State to mutate per test (default bindings/settings). */
function fresh(): SaveState {
  return createFirstLaunchState(cfg);
}

describe('clampVolume (Req 20.49, 25.7)', () => {
  it('clamps below 0 to 0 and above 1 to 1', () => {
    expect(clampVolume(-0.5)).toBe(0);
    expect(clampVolume(1.5)).toBe(1);
  });

  it('passes through values inside [0,1]', () => {
    expect(clampVolume(0)).toBe(0);
    expect(clampVolume(0.42)).toBe(0.42);
    expect(clampVolume(1)).toBe(1);
  });

  it('maps non-finite input to 0 defensively', () => {
    // NaN and the infinities are not finite, so they fall back to 0 rather than
    // producing a garbage volume (a defensive floor, Req 20.49/25.7).
    expect(clampVolume(Number.NaN)).toBe(0);
    expect(clampVolume(Number.POSITIVE_INFINITY)).toBe(0);
    expect(clampVolume(Number.NEGATIVE_INFINITY)).toBe(0);
  });
});

describe('setVolume / setMuted (Req 20.49, 25.7)', () => {
  it('sets the persisted volume field, clamped to [0,1]', () => {
    const save = fresh();
    expect(setVolume(save, 0.3).settings.volume).toBe(0.3);
    expect(setVolume(save, 2).settings.volume).toBe(1);
    expect(setVolume(save, -1).settings.volume).toBe(0);
  });

  it('does not mutate the input save (pure)', () => {
    const save = fresh();
    const before = save.settings.volume;
    setVolume(save, 0.1);
    expect(save.settings.volume).toBe(before);
  });

  it('toggles the muted flag without touching volume', () => {
    const save = setVolume(fresh(), 0.5);
    const muted = setMuted(save, true);
    expect(muted.settings.muted).toBe(true);
    expect(muted.settings.volume).toBe(0.5);
  });
});

describe('rebind — conflict rejection (Req 1.7)', () => {
  it('rejects a primary rebind to a control already assigned to the skill action, NAMING it, and does NOT change the bindings', () => {
    const save = fresh();
    // Default skill group holds "Q" + "MOUSE_RIGHT"; rebind primary to Q.
    const result = rebind(save, 'primary', 0, 'Q');
    if (result.ok || result.reason !== 'conflict') {
      throw new Error('expected a conflict rejection');
    }
    expect(result.conflictingAction).toBe('skill');
    expect(result.conflictingControl).toBe('Q');
    // The message names BOTH the control and the occupying action (Req 1.7).
    expect(result.message).toContain('Q');
    expect(result.message).toContain(REBIND_ACTION_LABELS.skill);
    // Nothing applied: the original save is untouched.
    expect(save.controlBindings.primary).toEqual(['SPACE', 'MOUSE_LEFT']);
    expect(save.controlBindings.skill).toEqual(['Q', 'MOUSE_RIGHT']);
  });

  it('rejects a skill rebind to a control already assigned to the primary action', () => {
    const save = fresh();
    const result = rebind(save, 'skill', 0, 'MOUSE_LEFT');
    if (result.ok || result.reason !== 'conflict') {
      throw new Error('expected a conflict rejection');
    }
    expect(result.conflictingAction).toBe('primary');
    expect(result.conflictingControl).toBe('MOUSE_LEFT');
  });

  it('checks the conflict only between primary and skill (same-group reuse is NOT a conflict)', () => {
    const save = fresh();
    // Rebinding primary[0] to its OWN group's other control is not a primary<->
    // skill conflict, so it is applied (Req 1.7 scopes the check to the pair).
    const result = rebind(save, 'primary', 0, 'MOUSE_LEFT');
    expect(result.ok).toBe(true);
  });
});

describe('rebind — accepted (Req 1.6, 1.8)', () => {
  it('applies a non-conflicting rebind and leaves the other group alone', () => {
    const save = fresh();
    const result = rebind(save, 'primary', 0, 'ENTER');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected an accepted rebind');
    expect(result.save.controlBindings.primary).toEqual(['ENTER', 'MOUSE_LEFT']);
    expect(result.save.controlBindings.skill).toEqual(['Q', 'MOUSE_RIGHT']);
    // Input save unchanged (pure).
    expect(save.controlBindings.primary).toEqual(['SPACE', 'MOUSE_LEFT']);
  });

  it('canonicalizes the captured control to uppercase/trimmed form', () => {
    const result = rebind(fresh(), 'primary', 0, '  enter ');
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected an accepted rebind');
    expect(result.save.controlBindings.primary[0]).toBe('ENTER');
  });

  it('rejects an empty/unrecognized control as invalid without applying', () => {
    const result = rebind(fresh(), 'primary', 0, '   ');
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected an invalid rejection');
    expect(result.reason).toBe('invalid');
  });
});

describe('applyRebindWithPersist — persist + rollback (Req 1.8, 1.9)', () => {
  it('persists an accepted rebind when persistFn succeeds', () => {
    const prev = fresh();
    const result = rebind(prev, 'primary', 0, 'ENTER');
    let persistedArg: SaveState | null = null;
    const outcome = applyRebindWithPersist(prev, result, (s) => {
      persistedArg = s;
      return true;
    });
    expect(outcome.persisted).toBe(true);
    expect(outcome.rolledBack).toBe(false);
    expect(outcome.save.controlBindings.primary).toEqual(['ENTER', 'MOUSE_LEFT']);
    expect(persistedArg).not.toBeNull();
  });

  it('ROLLS BACK to the previous binding when persistFn returns false (Req 1.9)', () => {
    const prev = fresh();
    const result = rebind(prev, 'primary', 0, 'ENTER');
    const outcome = applyRebindWithPersist(prev, result, () => false);
    expect(outcome.persisted).toBe(false);
    expect(outcome.rolledBack).toBe(true);
    // The previous binding remains active (Req 1.9).
    expect(outcome.save.controlBindings.primary).toEqual(['SPACE', 'MOUSE_LEFT']);
    expect(outcome.save).toBe(prev);
  });

  it('ROLLS BACK when persistFn throws', () => {
    const prev = fresh();
    const result = rebind(prev, 'skill', 0, 'E');
    const outcome = applyRebindWithPersist(prev, result, () => {
      throw new Error('storage unavailable');
    });
    expect(outcome.rolledBack).toBe(true);
    expect(outcome.save.controlBindings.skill).toEqual(['Q', 'MOUSE_RIGHT']);
  });

  it('is a no-op for a rejected rebind result (keeps previous, no persist)', () => {
    const prev = fresh();
    const result = rebind(prev, 'primary', 0, 'Q'); // conflict
    let called = false;
    const outcome = applyRebindWithPersist(prev, result, () => {
      called = true;
      return true;
    });
    expect(called).toBe(false);
    expect(outcome.persisted).toBe(false);
    expect(outcome.save).toBe(prev);
  });
});

describe('resetToFirstLaunch (Req 20.51)', () => {
  it('yields a First_Launch_State equal to createFirstLaunchState', () => {
    // Mutate a save well away from defaults, then reset.
    let save = setVolume(fresh(), 0.1);
    save = setMuted(save, true);
    save = { ...save, unlockedSkills: ['dash'], controlBindings: { primary: ['ENTER'], skill: ['E'] } };

    const reset = resetToFirstLaunch(save, cfg);
    expect(reset).toEqual(createFirstLaunchState(cfg));
  });
});

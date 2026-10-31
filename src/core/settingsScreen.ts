// Feature: kino-game
//
// The PURE Settings_Screen LOGIC (task 9.7; design: "SettingsScene (overlay) —
// Volume, rebinding, reset-save confirm", "Control rebinding failures (Req 1.7,
// 1.9)"; Req 20.48-20.51, 1.6-1.9, 25.7). Phaser-free so the whole
// volume-clamp / conflict-check / rollback contract is unit-testable in plain
// Node, with the engine SettingsScene (a thin overlay) deferring every DECISION
// to this module.
//
// WHAT LIVES HERE (all pure functions over the Save_Store):
//   - setVolume / setMuted — produce a NEW save with the audio setting changed,
//     volume clamped to [0,1] (Req 20.49, 25.7). Persisting is the engine's job.
//   - rebind — attempt to reconfigure one control, returning a RESULT union:
//     applied (ok) or rejected with a NAMING conflict message (Req 1.6-1.8).
//     The conflict check is ONLY between the primary-action and skill-activation
//     groups (Req 1.7); a non-conflicting rebind is applied, a conflicting one
//     is NOT.
//   - applyRebindWithPersist — model the Req 1.9 ROLLBACK testably: apply an
//     accepted rebind, attempt persistence through an INJECTED persistFn, and on
//     failure restore the PREVIOUS binding so it stays active until persistence
//     succeeds. The injected persistFn keeps this unit-testable with no real
//     storage; the engine binds it to the SaveStore localStorage write.
//   - resetToFirstLaunch — the reset-save state result (Req 20.51). The engine
//     owns the confirmation gate (Req 20.50) and the persist.

import type { ConfigFileData } from '../config/index.ts';
import type { SaveState, ControlBindings } from './saveStore.ts';
import { createFirstLaunchState } from './saveStore.ts';
import { canonicalizeBinding } from './bindings.ts';

/** The two rebindable control groups (Req 1.6): primary-action / skill-activation. */
export type RebindAction = 'primary' | 'skill';

/** Human-readable labels for the two actions, used in the naming message (Req 1.7). */
export const REBIND_ACTION_LABELS: Record<RebindAction, string> = {
  primary: 'primary action',
  skill: 'skill activation',
};

// ---------------------------------------------------------------------------
// Audio settings (Req 20.49, 25.7, 25.8).
// ---------------------------------------------------------------------------

/** Clamp a volume to the valid [0,1] range, mapping NaN to 0 defensively. */
export function clampVolume(volume: number): number {
  if (!Number.isFinite(volume)) return 0;
  if (volume < 0) return 0;
  if (volume > 1) return 1;
  return volume;
}

/**
 * Return a NEW Save_Store with the audio `volume` set, clamped to [0,1] (Req
 * 20.49, 25.7). Pure: the input save is not mutated; persisting the result is
 * the engine's responsibility (Req 25.8).
 */
export function setVolume(save: SaveState, volume: number): SaveState {
  return {
    ...save,
    settings: { ...save.settings, volume: clampVolume(volume) },
  };
}

/**
 * Return a NEW Save_Store with the audio `muted` flag set (Req 25.7). Pure; the
 * engine persists the result (Req 25.8).
 */
export function setMuted(save: SaveState, muted: boolean): SaveState {
  return {
    ...save,
    settings: { ...save.settings, muted },
  };
}

// ---------------------------------------------------------------------------
// Control rebinding (Req 1.6-1.9).
// ---------------------------------------------------------------------------

/**
 * The outcome of a `rebind` attempt — a discriminated union so the caller can
 * never forget to handle the rejection branch.
 *
 *   - `{ ok: true, save }` — the rebind is conflict-free and the returned save
 *     carries the applied binding (NOT yet persisted; see applyRebindWithPersist
 *     / the engine for the Req 1.8 persist + Req 1.9 rollback).
 *   - `{ ok: false, reason: 'conflict', message, conflictingAction,
 *     conflictingControl }` — the new control already belongs to the OTHER
 *     action's group (Req 1.7). The binding is NOT applied; `message` NAMES the
 *     occupied control + action for the Settings_Screen to display.
 *   - `{ ok: false, reason: 'invalid', message }` — the captured control did not
 *     canonicalize to a usable binding (empty); nothing is applied.
 */
export type RebindResult =
  | { ok: true; save: SaveState }
  | {
      ok: false;
      reason: 'conflict';
      message: string;
      conflictingAction: RebindAction;
      conflictingControl: string;
    }
  | { ok: false; reason: 'invalid'; message: string };

/** The action that is NOT the one being rebound (the only one a conflict can be against). */
function otherAction(action: RebindAction): RebindAction {
  return action === 'primary' ? 'skill' : 'primary';
}

/**
 * Attempt to rebind `action`'s binding at `index` to `newBinding`.
 *
 * Conflict rule (Req 1.7): the check is evaluated ONLY against the OTHER of the
 * two bindings (primary vs skill) — never against any unrelated control. If the
 * canonicalized new control already appears in the other group, the rebind is
 * REJECTED with a message that NAMES the occupied control and the action that
 * holds it, and the binding is NOT applied. A control already present elsewhere
 * in the SAME group is allowed (it is not a primary<->skill conflict) and simply
 * collapses on parse.
 *
 * On success the returned save carries the applied binding. Persisting it (Req
 * 1.8) and rolling back on persist failure (Req 1.9) are handled by
 * `applyRebindWithPersist` / the engine.
 */
export function rebind(
  save: SaveState,
  action: RebindAction,
  index: number,
  newBinding: string,
): RebindResult {
  const canonical = canonicalizeBinding(newBinding);
  if (canonical === '') {
    return {
      ok: false,
      reason: 'invalid',
      message: 'That control could not be recognized; the binding was not changed.',
    };
  }

  // Conflict check: ONLY against the other action's group (Req 1.7).
  const other = otherAction(action);
  const otherGroup = save.controlBindings[other].map(canonicalizeBinding);
  if (otherGroup.includes(canonical)) {
    return {
      ok: false,
      reason: 'conflict',
      conflictingAction: other,
      conflictingControl: canonical,
      message: `"${canonical}" is already assigned to the ${REBIND_ACTION_LABELS[other]}. The binding was not changed.`,
    };
  }

  // Apply to a fresh copy of the target group at `index`. An out-of-range index
  // appends, so the UI can add a binding slot without a separate code path.
  const group = [...save.controlBindings[action]];
  if (index < 0 || index >= group.length) {
    group.push(canonical);
  } else {
    group[index] = canonical;
  }

  const controlBindings: ControlBindings = {
    primary: [...save.controlBindings.primary],
    skill: [...save.controlBindings.skill],
    [action]: group,
  };

  return { ok: true, save: { ...save, controlBindings } };
}

/**
 * A persistence side-effect, INJECTED so `applyRebindWithPersist` is pure w.r.t.
 * its inputs and unit-testable with no real storage. The engine binds this to
 * the SaveStore localStorage write; it returns `true` on a successful write,
 * `false` (or throws) on failure.
 */
export type PersistFn = (save: SaveState) => boolean;

/** The outcome of applying an accepted rebind through persistence (Req 1.8-1.9). */
export interface ApplyRebindOutcome {
  /** The save that is now AUTHORITATIVE: the new one if persisted, else the previous. */
  save: SaveState;
  /** Whether the new binding was persisted (and so remains applied). */
  persisted: boolean;
  /**
   * True when persistence FAILED and we rolled back to `previous` (Req 1.9): the
   * previous binding stays active until a persist succeeds.
   */
  rolledBack: boolean;
}

/**
 * Apply an accepted `RebindResult` and attempt to persist it, ROLLING BACK to
 * the previous save if persistence fails (Req 1.8-1.9).
 *
 * Flow:
 *   - If `result` is a rejection, nothing changes: return `previous`,
 *     persisted/rolledBack false (the caller already has the conflict message).
 *   - Otherwise attempt `persistFn(result.save)`. On success the new save is
 *     authoritative and persisted. On a `false` return OR a thrown error, roll
 *     back: the authoritative save is `previous`, so the previous binding
 *     remains active until a later persist succeeds (Req 1.9).
 *
 * `persistFn` is injected so this is fully unit-testable without storage.
 */
export function applyRebindWithPersist(
  previous: SaveState,
  result: RebindResult,
  persistFn: PersistFn,
): ApplyRebindOutcome {
  if (!result.ok) {
    return { save: previous, persisted: false, rolledBack: false };
  }

  let ok: boolean;
  try {
    ok = persistFn(result.save);
  } catch {
    ok = false;
  }

  if (ok) {
    return { save: result.save, persisted: true, rolledBack: false };
  }
  // Persist failed — roll back to the previous binding (Req 1.9).
  return { save: previous, persisted: false, rolledBack: true };
}

// ---------------------------------------------------------------------------
// Reset-save (Req 20.50-20.51).
// ---------------------------------------------------------------------------

/**
 * The reset-save state result: a fresh First_Launch_State (Req 20.51). PURE —
 * it returns the new state only. The engine owns the Req 20.50 CONFIRMATION
 * gate (do not call this until the player confirms) and the subsequent persist
 * that overwrites the stored blob with these defaults.
 */
export function resetToFirstLaunch(_save: SaveState, cfg: ConfigFileData): SaveState {
  return createFirstLaunchState(cfg);
}

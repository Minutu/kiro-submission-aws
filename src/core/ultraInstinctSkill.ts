// Feature: kino-game
//
// Ultra Instinct — the "automatic evasion" active-skill EFFECT (design: "Skill
// effects"; Req 18.1, 18.2). This is the PURE effect for task 6.9; it COMPOSES
// the SkillSystem lifecycle (task 6.1) and the SafeRepositionSolver (task 5.6)
// rather than rewriting either shared module.
//
// Ultra Instinct IS a Protective_Skill (glossary; Req 18): while active it
// prevents an imminent collision from ending the run by REPOSITIONING Kino to a
// safe spot (contrast Second Chance, Req 13, which phases through one hit and is
// NOT a Protective_Skill). Its behavior:
//   - Req 18.1: activating enables automatic evasion for the next 10 s. That
//     10 s window is the SkillSystem's `active` phase for `ultraInstinct`, whose
//     length is `balance.ultraInstinctDurationS()` (default 10 s). This module
//     does not own that timer — it reads the lifecycle so "auto-evading" is true
//     exactly while the equipped skill is `ultraInstinct` AND `active`.
//   - Req 18.2: whenever Kino would be hurt WHILE the window is open, teleport
//     Kino to a safe position along the VERTICAL AXIS. The destination is the
//     SafeRepositionSolver's `reposition({ skill: 'ultraInstinct', ... })`,
//     which resolves to the mode-specific Req 44 rule when one applies and to
//     the generic vertical-axis nearest-clear-y teleport otherwise. The
//     returned placement is guaranteed non-overlapping (Property 6).
//
// Unlike Second Chance (one-shot per window) or Time Erase, Ultra Instinct
// auto-evades CONTINUOUSLY for the whole 10 s window: every imminent-collision
// tick inside the window produces a fresh SafePlacement, and the window is NOT
// consumed or ended early by an evasion. It ends only when the 10 s timer runs
// out (SkillSystem `tick` → active → cooldown).
//
// PURE / deterministic — no Phaser, no randomness, no clock (src/core boundary,
// Req 26.6). The only time source is the SkillSystem it wraps (which advances
// only via `tick`); the only placement authority is the injected solver.

import type { SkillSystem } from './skillSystem.ts';
import type {
  RepositionRequest,
  SafePlacement,
  SafeRepositionSolver,
} from './safeRepositionSolver.ts';

/** The SkillId this effect is bound to. */
const ULTRA_INSTINCT: 'ultraInstinct' = 'ultraInstinct';

/**
 * The per-imminent-collision request GameplayScene hands {@link
 * UltraInstinctSkill.autoEvade}. It is a {@link RepositionRequest} WITHOUT its
 * `skill` field: Ultra Instinct always supplies `skill: 'ultraInstinct'`
 * itself, so the caller cannot ask for the wrong protective rule. Everything
 * else (mode, body, screenX, the frozen field, playArea, …) is the caller's.
 */
export type UltraInstinctEvadeRequest = Omit<RepositionRequest, 'skill'>;

/**
 * The pure Ultra Instinct effect, composed over a {@link SkillSystem} and a
 * {@link SafeRepositionSolver}. It holds no timer of its own: "auto-evading" is
 * derived from the wrapped lifecycle, so the single source of truth for the
 * 10 s window is the SkillSystem's `active` phase (which freezes under pause
 * exactly like every other skill timer).
 */
export interface UltraInstinctSkill {
  /**
   * True exactly while automatic evasion is enabled (Req 18.1): the equipped
   * skill is Ultra Instinct AND it is in its `active` phase. GameplayScene reads
   * this to decide whether an imminent collision should auto-evade instead of
   * ending the run. Flips to false the instant the 10 s window expires.
   */
  isAutoEvading(): boolean;
  /**
   * Resolve an imminent collision by teleporting Kino to safety along the
   * vertical axis (Req 18.2). While auto-evading, forwards `request` to the
   * SafeRepositionSolver with `skill: 'ultraInstinct'` and returns the
   * guaranteed non-overlapping {@link SafePlacement} so GameplayScene teleports
   * Kino there THIS tick. The window is NOT consumed — the next imminent
   * collision within the 10 s window evades again. Returns `null` when not
   * auto-evading (no window, expired, or a different skill equipped) so the
   * caller resolves the collision normally.
   */
  autoEvade(request: UltraInstinctEvadeRequest): SafePlacement | null;
}

/**
 * Create an Ultra Instinct effect bound to `skills` and `solver`. Pure factory:
 * behavior depends only on the wrapped SkillSystem's observable lifecycle, the
 * injected solver, and the ordered `autoEvade` calls it receives.
 */
export function createUltraInstinctSkill(
  skills: SkillSystem,
  solver: SafeRepositionSolver,
): UltraInstinctSkill {
  function isAutoEvading(): boolean {
    // Auto-evading ⇔ Ultra Instinct is the equipped skill AND its 10 s window
    // is active. The lifecycle IS the source of truth: window expiry ends
    // `active` via `tick`, flipping `isActive()` (and thus this) to false, with
    // no separate flag needed (Req 18.1).
    return skills.equipped() === ULTRA_INSTINCT && skills.isActive();
  }

  function autoEvade(
    request: UltraInstinctEvadeRequest,
  ): SafePlacement | null {
    // No window → caller resolves the collision normally (fatal hit). This also
    // covers a different skill equipped or the window already expired.
    if (!isAutoEvading()) return null;

    // Teleport to the solver's guaranteed-clear placement. `skill` is forced to
    // 'ultraInstinct' so the solver resolves to the mode-specific Req 44 rule
    // when one applies and to the generic vertical-axis teleport otherwise
    // (Req 18.2). The window is left intact — evasion repeats for the full 10 s.
    return solver.reposition({ ...request, skill: ULTRA_INSTINCT });
  }

  return { isAutoEvading, autoEvade };
}

// ── GameplayScene seam (Req 18.1, 18.2) ────────────────────────────────────
// The pure core owns only the auto-evading STATE and the placement lookup.
// GameplayScene wires it like:
//
//   const ui = createUltraInstinctSkill(skillSystem, safeRepositionSolver);
//   // on a would-be-fatal (imminent) collision, BEFORE ending the run:
//   const placement = ui.autoEvade({
//     mode, body: kinoBodyRect, screenX: kinoFixedX,
//     field: frozenObstacleSnapshot, playArea, contactedObstacleId,
//   });
//   if (placement) {
//     teleportKinoBodyTo(placement.x, placement.y); // Req 18.2 vertical teleport
//     // (the window stays open — the next imminent hit evades again, Req 18.1)
//   } else {
//     // not auto-evading → resolve the hit as a normal, fatal collision
//   }
//
// Applying the teleport (sprite move, dust puff, etc.) is engine-layer and
// lives in GameplayScene; this module stays Phaser-free.

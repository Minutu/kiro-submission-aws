// Feature: kino-game
//
// Second Chance — the "survive one hit" active-skill EFFECT (design: "Skill
// effects" table, Req 13.1–13.4). This is the PURE effect state machine for
// task 6.4; it composes with the SkillSystem lifecycle (task 6.1) rather than
// rewriting it.
//
// Second Chance is NOT a Protective_Skill for the safe-reposition rules
// (Req 44): it does not reposition Kino, it PHASES THROUGH exactly one
// collision (glossary; design "SAFE-REPOSITION ALGORITHM"). Its behavior:
//   - Req 13.1: activating arms a protective WINDOW for up to 3 s. The window
//     is the SkillSystem's `active` phase for `secondChance`, whose length is
//     `balance.secondChanceWindowS()` (default 3 s, ≤3 s). This module does not
//     own that timer — it reads the lifecycle so "armed" is true exactly while
//     the equipped skill is `secondChance` AND `active`.
//   - Req 13.2: a collision while armed phases through (the run continues),
//     consumes the protection, and ends the window IMMEDIATELY (the SkillSystem
//     collapses active → cooldown via `endActiveEarly`).
//   - Req 13.3: a SECOND collision in the SAME window — after the protection is
//     consumed — is NOT phased through; it resolves as a normal (fatal) hit.
//     Because consuming ends the window, the skill is no longer `active`, so it
//     is no longer armed and `consumeOnCollision` returns false.
//   - Req 13.4: the angel halo fades out when Second Chance resolves. The pure
//     core owns only the armed/consumed STATE; the engine (GameplayScene) reads
//     `isArmed()` to show/hide the halo and `onResolved` to kick off the
//     fade-out. See the "halo render seam" note at the bottom.
//
// PURE / deterministic — no Phaser, no randomness, no clock (src/core boundary,
// Req 26.6). The only time source is the SkillSystem it wraps, which itself
// advances only via `tick`.

import type { SkillSystem } from './skillSystem.ts';

/** The SkillId this effect is bound to. */
const SECOND_CHANCE: 'secondChance' = 'secondChance';

/** Why a would-be-fatal collision was (or was not) phased through. */
export type SecondChanceOutcome =
  | 'phased' // armed → phased through this one collision, now consumed
  | 'not-armed' // no protective window active (never armed, expired, or consumed)
  | 'wrong-skill'; // the equipped skill is not Second Chance

/** Result of asking Second Chance to resolve a would-be-fatal collision. */
export interface SecondChanceCollisionResult {
  /** True ONLY when this collision was phased through (survived). */
  phasedThrough: boolean;
  /** The specific reason, for HUD/telemetry and tests. */
  outcome: SecondChanceOutcome;
}

/** Construction options for {@link createSecondChanceSkill}. */
export interface SecondChanceOptions {
  /**
   * Fired when Second Chance RESOLVES — i.e. a collision was phased through and
   * the protection was consumed (Req 13.4). The engine layer uses this to start
   * the angel-halo fade-out. Not fired on a non-armed collision or on plain
   * window expiry (expiry is observable via `isArmed()` flipping to false).
   */
  onResolved?: () => void;
}

/**
 * The pure Second Chance effect, composed over a {@link SkillSystem}. It does
 * not hold its own timer: "armed" is derived from the wrapped lifecycle, so the
 * single source of truth for the ≤3 s window is the SkillSystem's `active`
 * phase (which freezes under pause exactly like every other skill timer).
 */
export interface SecondChanceSkill {
  /**
   * True exactly while the protective window is active and UNCONSUMED (Req
   * 13.1): the equipped skill is Second Chance AND it is in its `active` phase.
   * The engine reads this to render the angel halo. Flips to false the instant
   * the protection is consumed (Req 13.2) or the window expires (Req 13.3).
   */
  isArmed(): boolean;
  /**
   * Resolve a would-be-fatal collision against Second Chance (Req 13.2, 13.3).
   * When armed: phase through this ONE collision, consume the protection, end
   * the window immediately (SkillSystem active → cooldown) and fire
   * `onResolved`; returns `phasedThrough: true`. When not armed (no window, or
   * already consumed/expired, or a different skill equipped): returns
   * `phasedThrough: false` so the caller resolves the hit normally.
   */
  consumeOnCollision(): SecondChanceCollisionResult;
}

/**
 * Create a Second Chance effect bound to `skills`. Pure factory: behavior
 * depends only on the wrapped SkillSystem's observable lifecycle and the
 * ordered `consumeOnCollision` calls it receives.
 */
export function createSecondChanceSkill(
  skills: SkillSystem,
  options: SecondChanceOptions = {},
): SecondChanceSkill {
  const { onResolved } = options;

  function isArmed(): boolean {
    // Armed ⇔ Second Chance is the equipped skill AND its window is active.
    // Consuming calls `endActiveEarly` (→ cooldown) and expiry ends `active`
    // via `tick`; both flip `isActive()` to false, so this needs no separate
    // "consumed" flag — the lifecycle IS the source of truth (Req 13.1, 13.3).
    return skills.equipped() === SECOND_CHANCE && skills.isActive();
  }

  function consumeOnCollision(): SecondChanceCollisionResult {
    if (skills.equipped() !== SECOND_CHANCE) {
      return { phasedThrough: false, outcome: 'wrong-skill' };
    }
    if (!skills.isActive()) {
      // No protective window: never armed, already consumed, or expired. The
      // caller must resolve this as a normal hit (Req 13.3).
      return { phasedThrough: false, outcome: 'not-armed' };
    }

    // Armed: phase through this one collision (run continues), consume the
    // protection, and end the window immediately (Req 13.2). Ending the active
    // window flips `isArmed()` to false, so the very NEXT collision in the same
    // run resolves normally (Req 13.3).
    skills.endActiveEarly();
    onResolved?.(); // halo fade-out seam (Req 13.4)
    return { phasedThrough: true, outcome: 'phased' };
  }

  return { isArmed, consumeOnCollision };
}

// ── Halo render seam for GameplayScene (Req 13.4) ──────────────────────────
// The pure core owns only the armed/consumed STATE. GameplayScene wires it like:
//
//   const sc = createSecondChanceSkill(skillSystem, {
//     onResolved: () => halo.fadeOut(),   // Req 13.4: fade the angel halo
//   });
//   // each frame: if (sc.isArmed()) halo.showFollowing(kino); // Req 13.1 halo
//   // on a would-be-fatal collision, BEFORE ending the run:
//   //   if (sc.consumeOnCollision().phasedThrough) { /* survive, keep running */ }
//   //   else { /* resolve the hit as a normal, fatal collision */ }
//
// Rendering the halo sprite + fade tween is engine-layer and lives in
// GameplayScene; this module stays Phaser-free.

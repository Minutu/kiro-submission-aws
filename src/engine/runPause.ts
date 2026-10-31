// Feature: kino-game
//
// Pure, Phaser-free run-pause controller (task 6.3). Extracted from
// GameplayScene so the pause STATE LOGIC — "paused freezes everything, resume
// continues from the held values" (Req 7.10-7.13) — stays testable in plain
// Node without a browser/canvas. GameplayScene (the Phaser scene) owns the HUD
// pause control, the PauseScene overlay launch, and the update-loop gate; this
// module owns the single source of truth for whether the run is paused and the
// mechanism that freezes the simulation.
//
// WHY THIS FREEZES EVERYTHING (the pause-freezes-timers invariant, Req 7.10-7.12):
// the entire run advances off the fixed-timestep driver's `advance` callback —
// movement physics, the leftward scroll (obstacle progression), scoring, AND
// (when wired) SkillSystem.tick which decrements `cooldownRemaining` /
// `effectRemaining`. The driver has NO wall clock: it only advances state when
// `step()` earns a fixed tick, and a FROZEN driver earns none (it returns early,
// leaving its accumulator untouched — see src/core/fixedTimestep.ts). So calling
// `driver.setFrozen(true)` is sufficient to halt gameplay, movement, obstacle
// progression, and every skill timer AT THEIR CURRENT VALUES with no per-system
// pause code. Resume (`setFrozen(false)`) continues from exactly those held
// values because nothing was ever mutated while paused (Req 7.12, 7.13).
//
// The controller ALSO exposes a `paused` flag so the scene's `update()` can
// short-circuit (skip input, the driver step, and rendering) while paused — a
// belt-and-braces guard so nothing advances even if a future caller stepped the
// driver directly. Freezing the driver is the authority; the flag mirrors it.
//
// Lives in the engine layer but imports NO Phaser.

/**
 * The minimal view of the fixed-timestep driver this controller needs: the
 * freeze/unfreeze switch and a read of the current frozen state. GameplayScene's
 * `FixedTimestepDriver` satisfies this structurally, and a plain fake satisfies
 * it in tests — keeping the controller decoupled from the concrete driver and
 * from Phaser.
 */
export interface Freezable {
  /** Freeze (true) or unfreeze (false) the driver's accumulation. */
  setFrozen(frozen: boolean): void;
  /** Whether the driver is currently frozen. */
  isFrozen(): boolean;
}

/**
 * Controls the paused state of a run by freezing/unfreezing the fixed-timestep
 * driver (which halts movement, obstacle progression, scoring, and all skill
 * timers together) and tracking a `paused` flag the scene's update loop gates
 * on. Pure and idempotent: pausing a paused run or resuming a running run is a
 * no-op, so repeated HUD presses or doubled key events never corrupt state.
 */
export interface RunPauseController {
  /** Whether the run is currently paused. */
  isPaused(): boolean;

  /**
   * Pause the run: freeze the driver so NOTHING advances (Req 7.10) — movement,
   * obstacle progression, and skill cooldown/effect timers all hold at their
   * current values (Req 7.11). Idempotent. Returns true if this call changed
   * the state (was running → now paused), false if it was already paused.
   */
  pause(): boolean;

  /**
   * Resume the run: unfreeze the driver so it continues from the held values
   * and the paused run state (Req 7.12, 7.13). Idempotent. Returns true if this
   * call changed the state (was paused → now running), false if already running.
   */
  resume(): boolean;

  /**
   * Toggle between paused and running. Returns the new paused state (true if now
   * paused). Convenience for a single pause/resume key.
   */
  toggle(): boolean;
}

/**
 * Create a {@link RunPauseController} over a {@link Freezable} driver.
 *
 * The controller's `paused` flag and the driver's frozen state are kept in
 * lock-step: `pause()` sets the flag and freezes the driver; `resume()` clears
 * the flag and unfreezes. The driver's `isFrozen()` is the ultimate authority on
 * whether ticks run, so even if the flag and the driver ever diverged, a frozen
 * driver still advances nothing.
 *
 * @param driver The run's fixed-timestep driver (freeze is the freeze-everything
 *               mechanism). May start already frozen; the controller seeds its
 *               `paused` flag from the driver's current state.
 */
export function createRunPauseController(driver: Freezable): RunPauseController {
  // Seed from the driver so a run constructed with `frozen: true` reads as
  // paused from the first query (keeps the flag and the driver consistent).
  let paused = driver.isFrozen();

  function pause(): boolean {
    if (paused) return false;
    paused = true;
    driver.setFrozen(true);
    return true;
  }

  function resume(): boolean {
    if (!paused) return false;
    paused = false;
    driver.setFrozen(false);
    return true;
  }

  function toggle(): boolean {
    if (paused) {
      resume();
    } else {
      pause();
    }
    return paused;
  }

  return {
    isPaused: () => paused,
    pause,
    resume,
    toggle,
  };
}

// Feature: kino-game
//
// UNIT tests for the run-pause controller + the pause-freezes-everything
// mechanism (task 6.3; Req 7.9-7.13).
//
// GameplayScene (Phaser, browser-bound) owns the HUD pause control and the
// PauseScene overlay launch, which the project's test harness cannot
// instantiate. The DECIDABLE pause logic is extracted into the pure, Phaser-free
// `createRunPauseController` (src/engine/runPause.ts) exactly so it is testable
// in plain Node, mirroring the project's world1Slice approach.
//
// These tests cover:
//   - Req 7.10: pausing freezes the driver so nothing advances (and the
//     controller reports paused).
//   - Req 7.11: while paused, skill cooldown/effect timers hold at their current
//     values — proven by stepping a FROZEN real driver that drives a real
//     SkillSystem.tick and asserting the timers do not move.
//   - Req 7.12/7.13: resume unfreezes so the driver advances again and timers
//     continue from exactly the held values.
//   - Idempotence: double pause / double resume are no-ops (so doubled HUD +
//     key events cannot corrupt state).
//   - Toggle + seeding from an already-frozen driver.

import { describe, it, expect } from 'vitest';
import {
  createRunPauseController,
  type Freezable,
} from '../src/engine/runPause.ts';
import {
  createFixedTimestepDriver,
  createSkillSystem,
} from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

// --- a minimal fake Freezable recording freeze calls ------------------------

function makeFakeDriver(initialFrozen = false): Freezable & {
  calls: boolean[];
} {
  let frozen = initialFrozen;
  const calls: boolean[] = [];
  return {
    calls,
    setFrozen(next: boolean) {
      frozen = next;
      calls.push(next);
    },
    isFrozen: () => frozen,
  };
}

// ---------------------------------------------------------------------------
// 1) pause() / resume() drive the driver's freeze switch (Req 7.10, 7.12)
// ---------------------------------------------------------------------------

describe('RunPauseController — freezes/unfreezes the driver (Req 7.10, 7.12)', () => {
  it('starts running (not paused) over a running driver', () => {
    const driver = makeFakeDriver(false);
    const ctrl = createRunPauseController(driver);
    expect(ctrl.isPaused()).toBe(false);
    expect(driver.isFrozen()).toBe(false);
  });

  it('pause() freezes the driver and reports paused', () => {
    const driver = makeFakeDriver(false);
    const ctrl = createRunPauseController(driver);

    expect(ctrl.pause()).toBe(true); // changed running -> paused
    expect(ctrl.isPaused()).toBe(true);
    expect(driver.isFrozen()).toBe(true);
    expect(driver.calls).toEqual([true]);
  });

  it('resume() unfreezes the driver and reports running', () => {
    const driver = makeFakeDriver(false);
    const ctrl = createRunPauseController(driver);
    ctrl.pause();

    expect(ctrl.resume()).toBe(true); // changed paused -> running
    expect(ctrl.isPaused()).toBe(false);
    expect(driver.isFrozen()).toBe(false);
    expect(driver.calls).toEqual([true, false]);
  });

  it('is idempotent: double pause / double resume are no-ops (Req 7.10, 7.12)', () => {
    const driver = makeFakeDriver(false);
    const ctrl = createRunPauseController(driver);

    expect(ctrl.pause()).toBe(true);
    expect(ctrl.pause()).toBe(false); // already paused — no state change
    expect(driver.calls).toEqual([true]); // freeze called only once

    expect(ctrl.resume()).toBe(true);
    expect(ctrl.resume()).toBe(false); // already running — no state change
    expect(driver.calls).toEqual([true, false]); // unfreeze called only once
  });

  it('toggle() flips state and returns the new paused value', () => {
    const driver = makeFakeDriver(false);
    const ctrl = createRunPauseController(driver);

    expect(ctrl.toggle()).toBe(true); // now paused
    expect(driver.isFrozen()).toBe(true);
    expect(ctrl.toggle()).toBe(false); // now running
    expect(driver.isFrozen()).toBe(false);
  });

  it('seeds its paused flag from an already-frozen driver', () => {
    const driver = makeFakeDriver(true);
    const ctrl = createRunPauseController(driver);
    expect(ctrl.isPaused()).toBe(true);
    // resume() from the seeded-paused state unfreezes.
    expect(ctrl.resume()).toBe(true);
    expect(driver.isFrozen()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 2) The invariant: pausing freezes EVERYTHING, incl. skill timers (Req 7.11)
//    and resume continues from the held values (Req 7.12, 7.13).
//
// This wires a REAL fixed-timestep driver to a REAL SkillSystem exactly the way
// GameplayScene does — SkillSystem.tick is called ONLY from the driver's advance
// callback — and uses the controller to freeze/unfreeze the driver. It proves
// the structural guarantee the design relies on: a frozen driver runs no ticks,
// so the skill cooldown timer does not advance while paused, and continues from
// the held value on resume.
// ---------------------------------------------------------------------------

describe('Pause freezes skill timers; resume continues from held values (Req 7.11-7.13)', () => {
  const balance = createBalanceTable(); // documented defaults

  /**
   * Build the GameplayScene-style wiring: a real driver whose advance callback
   * drives a real SkillSystem's `tick`, and a pause controller over that driver.
   * The skill is put on cooldown so it has a live, decrementing timer.
   */
  function makeRun() {
    const driver = createFixedTimestepDriver<boolean>();
    const skills = createSkillSystem(balance, { initialSkill: 'nuke' });
    // Nuke has a zero-length effect, so activate() resolves it immediately into
    // COOLDOWN — giving us a live, decrementing cooldown timer to observe across
    // the pause (cooldownRemaining > 0).
    skills.activate();
    const ctrl = createRunPauseController(driver);

    /** One rendered frame: advance real time `dt` s, ticking skills per step. */
    function frame(dt: number): void {
      driver.step(dt, false, (fixedDt) => {
        skills.tick(fixedDt);
      });
    }

    return { driver, skills, ctrl, frame };
  }

  it('skill cooldown advances while running, HOLDS while paused, continues on resume', () => {
    const { skills, ctrl, frame } = makeRun();

    expect(skills.state()).toBe('cooldown');
    const start = skills.cooldownRemaining();
    expect(start).toBeGreaterThan(0);

    // Run for a bit: the cooldown ticks DOWN (driver not frozen).
    frame(0.1);
    const afterRunning = skills.cooldownRemaining();
    expect(afterRunning).toBeLessThan(start);

    // PAUSE: freeze the driver. Now "rendered frames" keep arriving (we keep
    // calling frame), but the frozen driver runs NO ticks, so skills.tick is
    // never called and the cooldown HOLDS at its current value (Req 7.11).
    expect(ctrl.pause()).toBe(true);
    const heldAtPause = skills.cooldownRemaining();

    frame(0.1);
    frame(0.5);
    frame(1.0);
    expect(skills.cooldownRemaining()).toBe(heldAtPause); // unchanged across pause

    // RESUME: unfreeze. The cooldown continues FROM the held value (Req 7.12-
    // 7.13) — it does not jump as if the paused time had elapsed, and it is
    // still below where it was when we paused.
    expect(ctrl.resume()).toBe(true);
    frame(0.1);
    const afterResume = skills.cooldownRemaining();
    expect(afterResume).toBeLessThan(heldAtPause);
    expect(afterResume).toBeGreaterThanOrEqual(heldAtPause - 0.1 - 1e-6);
  });

  it('a frozen driver advances no simulation time at all while paused (Req 7.10)', () => {
    const { driver, ctrl, frame } = makeRun();

    ctrl.pause();
    let ticks = 0;
    driver.step(2.0, false, () => {
      ticks += 1;
    });
    expect(ticks).toBe(0); // frozen → zero ticks regardless of elapsed time

    // Sanity: once resumed, a frame DOES run ticks again.
    ctrl.resume();
    let resumedTicks = 0;
    driver.step(0.05, false, () => {
      resumedTicks += 1;
    });
    expect(resumedTicks).toBeGreaterThan(0);

    void frame; // referenced for parity with the other test's wiring
  });
});

// Feature: kino-game, Property 7: Pause freezes skill timers
//
// Property test for task 6.2 (design: "Active skill lifecycle", "The
// fixed-timestep driver", runPause controller).
//
// Validates: Requirements 7.10, 7.11, 7.12
//   - 7.10: pausing pauses gameplay, movement, obstacle progression, skill
//           cooldown timers, and active skill-effect timers.
//   - 7.11: while paused, the Game holds skill cooldown/effect timers at their
//           current values and SHALL NOT advance them.
//   - 7.12: on resume, timers resume FROM their held values (they do not jump
//           as if the paused wall-time had elapsed).
//
// The systems are wired EXACTLY as GameplayScene wires them:
//   - a real fixed-timestep driver whose `advance` callback calls
//     `skills.tick(fixedDt)` — the skill timers advance ONLY from that callback;
//   - a real SkillSystem (`createSkillSystem`) holding a skill in a decrementing
//     timer state;
//   - a real pause controller (`createRunPauseController`) that freezes the
//     driver on pause() and unfreezes on resume().
//
// There is no pause-specific code in SkillSystem: the guarantee is structural.
// A frozen driver runs zero `advance` callbacks, so `skills.tick` is never
// called while paused and the timers hold. This property proves that across
// arbitrary interleavings of running and paused frames with random deltas:
//   (a) any single frame taken while PAUSED leaves the live timer unchanged
//       (Req 7.10, 7.11), and
//   (b) over the whole sequence the timer's total decrease equals the simulated
//       time of ONLY the running frames (within one fixed step of
//       quantization), never counting paused time — i.e. resume continues from
//       the held value rather than skipping ahead (Req 7.12).

import { describe, it, expect } from 'vitest';
import fc from 'fast-check';
import {
  createFixedTimestepDriver,
  createSkillSystem,
  type SkillId,
} from '../src/core/index.ts';
import { createRunPauseController } from '../src/engine/runPause.ts';
import { createBalanceTable } from '../src/config/index.ts';

const FIXED = 1 / 120;

// A per-frame rendered delta in a realistic range (0..~250 ms), never NaN.
const frameDtArb = fc.double({ min: 0, max: 0.25, noNaN: true });

// A frame plan: a real delta plus whether the player holds pause this frame.
// Modeling pause as a desired per-frame state (rather than toggles) lets the
// controller's idempotent pause()/resume() coalesce repeats, exactly like a
// real player holding/releasing a pause control across rendered frames.
const frameArb = fc.record({
  dt: frameDtArb,
  wantPaused: fc.boolean(),
});
const framesArb = fc.array(frameArb, { minLength: 1, maxLength: 200 });

// Skills whose lifecycle has a timed, decrementing ACTIVE effect window we can
// observe (so activate() enters `active` with effectRemaining > 0). Excludes
// Nuke (instantaneous, 0 s effect) which would resolve straight to cooldown.
const timedSkills: SkillId[] = [
  'timeSlow',
  'scoreMultiplier',
  'ultraInstinct',
  'dash',
  'secondChance',
  'timeErase',
];

describe('Property 7: Pause freezes skill timers (Req 7.10, 7.11, 7.12)', () => {
  // --- (a) a PAUSED frame never advances the live timer (Req 7.10, 7.11) and
  // --- (b) total decrease counts ONLY running-frame simulated time (Req 7.12).
  it('holds skill timers while paused and resumes from the held value', () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...timedSkills),
        framesArb,
        (skillId, frames) => {
          const balance = createBalanceTable();

          // GameplayScene-style wiring: the driver's advance callback is the
          // ONLY thing that ticks the skill lifecycle.
          const driver = createFixedTimestepDriver<void>();
          const skills = createSkillSystem(balance, { initialSkill: skillId });
          const ctrl = createRunPauseController(driver);

          // Put the skill into a live, decrementing timer state. activate()
          // enters `active` for the (timed) effect window; as the sequence runs
          // it will naturally fall through into `cooldown` — both phases are
          // driven purely by tick(), so both are frozen by pause the same way.
          const result = skills.activate();
          expect(result.activated).toBe(true);
          expect(skills.isActive()).toBe(true);
          expect(skills.effectRemaining()).toBeGreaterThan(0);

          /**
           * The single live "timer" we track: effectRemaining while active,
           * otherwise cooldownRemaining. Both only ever count DOWN via tick and
           * both are held by pause, so a combined view lets one sequence span
           * the active→cooldown handoff without special-casing.
           */
          const liveTimer = (): number =>
            skills.isActive()
              ? skills.effectRemaining()
              : skills.cooldownRemaining();

          /** One rendered frame, GameplayScene-style: step the driver, which
           * ticks the skill once per earned fixed step. Returns the simulated
           * seconds actually advanced this frame (0 while frozen). */
          function frame(dt: number): number {
            const r = driver.step(dt, undefined, () => {
              skills.tick(FIXED);
            });
            return r.simulatedS;
          }

          // Running total of simulated time spent in NON-paused frames only.
          // The timer's total decrease must equal this (within quantization),
          // never the paused wall-time (Req 7.12).
          let runningSimTotal = 0;
          const startTimer = liveTimer();

          for (const f of frames) {
            // Drive the controller to the desired pause state. Idempotent, so
            // repeats across frames are harmless (mirrors a held control).
            if (f.wantPaused) {
              ctrl.pause();
            } else {
              ctrl.resume();
            }

            const before = liveTimer();
            const paused = ctrl.isPaused();

            const simulated = frame(f.dt);

            const after = liveTimer();

            if (paused) {
              // (a) Req 7.10/7.11: a paused frame freezes the driver, so no
              // tick runs and the live timer is byte-for-byte unchanged.
              expect(simulated).toBe(0);
              expect(after).toBe(before);
            } else {
              // A running frame may advance the timer; accumulate ONLY the
              // simulated time of running frames for the global check below.
              runningSimTotal += simulated;
            }
          }

          // (b) Req 7.12: the live timer continued from its held values across
          // every pause, so its total decrease reflects ONLY running-frame
          // simulated time — never paused time. Once the timer bottoms out
          // (effect ended and, possibly, cooldown ended → ready), further
          // running time is absorbed by phase handoffs, so the decrease is
          // bounded by running time and is non-negative.
          const endTimer = liveTimer();
          const totalDecrease = startTimer - endTimer;

          // Never negative: these timers only count down (per phase) and never
          // increase from a tick.
          expect(totalDecrease).toBeGreaterThanOrEqual(-1e-9);

          // The decrease is covered by the running simulated time. It can be
          // LESS than runningSimTotal when running time crossed into a new
          // phase (active→cooldown resets to the full cooldown, or cooldown→
          // ready floors at 0) — that extra running time is simply absorbed,
          // not charged to paused time. The ceiling is what matters for the
          // "no paused time counted" guarantee: the decrease can exceed the
          // running total by at most one fixed step of in-flight quantization.
          expect(totalDecrease).toBeLessThanOrEqual(runningSimTotal + FIXED + 1e-9);
        },
      ),
      { numRuns: 200 },
    );
  });

  // A focused, stronger variant that stays within a SINGLE phase so the
  // decrease equals the running simulated time EXACTLY (up to one fixed step),
  // not merely bounded. Short deltas + a long-effect skill keep us in `active`.
  it('timer decrease equals ONLY running-frame simulated time within one phase', () => {
    fc.assert(
      fc.property(
        fc.array(
          fc.record({
            dt: fc.double({ min: 0, max: 0.03, noNaN: true }),
            wantPaused: fc.boolean(),
          }),
          { minLength: 1, maxLength: 120 },
        ),
        (frames) => {
          const balance = createBalanceTable();
          const driver = createFixedTimestepDriver<void>();
          // ultraInstinct has the longest timed effect window among skills, so
          // a bounded sequence of <=120 frames of <=30 ms stays inside `active`.
          const skills = createSkillSystem(balance, { initialSkill: 'ultraInstinct' });
          const ctrl = createRunPauseController(driver);

          skills.activate();
          const start = skills.effectRemaining();

          let runningSimTotal = 0;

          for (const f of frames) {
            if (f.wantPaused) ctrl.pause();
            else ctrl.resume();

            const paused = ctrl.isPaused();
            const before = skills.effectRemaining();
            const r = driver.step(f.dt, undefined, () => skills.tick(FIXED));
            const after = skills.effectRemaining();

            if (paused) {
              expect(r.simulatedS).toBe(0);
              expect(after).toBe(before);
            } else {
              runningSimTotal += r.simulatedS;
            }
          }

          // Guard: only assert exact equality if we never left the active phase
          // (the effect never fully elapsed). If it did, the bounded check in
          // the first test already covers it.
          if (skills.isActive()) {
            const decrease = start - skills.effectRemaining();
            // Equal to the running simulated time, up to the sub-step residue
            // held in the driver's accumulator (< one fixed step).
            expect(Math.abs(decrease - runningSimTotal)).toBeLessThan(FIXED + 1e-9);
          }
        },
      ),
      { numRuns: 200 },
    );
  });
});

// Feature: kino-game
//
// UNIT tests for the graceful-degradation ladder (task 12.3; design: "graceful
// degradation ladder sheds cost in order: (1) reduce particle counts, then (2)
// reduce parallax layer detail, then (3) drop non-essential visual effects";
// Req 26.4, 26.9).
//
// The ladder steps DOWN under sustained over-budget frames, back UP under
// sustained headroom, clamps at both ends, and uses hysteresis so it does not
// flap. Deterministic: we feed exact frame-time sequences.

import { describe, it, expect } from 'vitest';
import {
  createDegradationLadder,
  qualitySettingsForLevel,
  QualityLevel,
  MAX_QUALITY_LEVEL,
  DEFAULT_FRAME_BUDGET_MS,
} from '../src/core/index.ts';

/** Feed `frames` consecutive frames of `ms` into the ladder. */
function feed(ladder: ReturnType<typeof createDegradationLadder>, ms: number, frames: number): void {
  for (let i = 0; i < frames; i++) ladder.sample(ms);
}

describe('degradation ladder', () => {
  it('starts at full quality with everything on', () => {
    const ladder = createDegradationLadder();
    expect(ladder.level()).toBe(QualityLevel.Full);
    const s = ladder.settings();
    expect(s.particleScale).toBe(1);
    expect(s.parallaxScale).toBe(1);
    expect(s.nonEssentialEffects).toBe(true);
  });

  it('steps down one rung after sustained over-budget frames', () => {
    const ladder = createDegradationLadder({ downSustainFrames: 10 });
    const overBudget = DEFAULT_FRAME_BUDGET_MS + 10;

    // Just under the sustain window: no step yet.
    feed(ladder, overBudget, 9);
    expect(ladder.level()).toBe(QualityLevel.Full);

    // Crossing the window steps down exactly one rung (particles first).
    ladder.sample(overBudget);
    expect(ladder.level()).toBe(QualityLevel.ReduceParticles);
  });

  it('walks the full ladder down in order under continued overload, clamped at the bottom', () => {
    const ladder = createDegradationLadder({ downSustainFrames: 5 });
    const overBudget = DEFAULT_FRAME_BUDGET_MS + 20;

    feed(ladder, overBudget, 5);
    expect(ladder.level()).toBe(QualityLevel.ReduceParticles);
    feed(ladder, overBudget, 5);
    expect(ladder.level()).toBe(QualityLevel.ReduceParallax);
    feed(ladder, overBudget, 5);
    expect(ladder.level()).toBe(QualityLevel.DropEffects);

    // Clamped: cannot go below the most-degraded level no matter how long.
    feed(ladder, overBudget, 50);
    expect(ladder.level()).toBe(MAX_QUALITY_LEVEL);
  });

  it('recovers UP under sustained headroom, clamped at full', () => {
    const ladder = createDegradationLadder({ downSustainFrames: 3, upSustainFrames: 4, initialLevel: QualityLevel.DropEffects });
    const fast = 4; // well under the up threshold

    feed(ladder, fast, 4);
    expect(ladder.level()).toBe(QualityLevel.ReduceParallax);
    feed(ladder, fast, 4);
    expect(ladder.level()).toBe(QualityLevel.ReduceParticles);
    feed(ladder, fast, 4);
    expect(ladder.level()).toBe(QualityLevel.Full);

    // Clamped at the top: more headroom cannot over-upgrade.
    feed(ladder, fast, 20);
    expect(ladder.level()).toBe(QualityLevel.Full);
  });

  it('does not flap in the hysteresis band between thresholds', () => {
    const ladder = createDegradationLadder({
      downThresholdMs: 16,
      upThresholdMs: 12,
      downSustainFrames: 3,
      upSustainFrames: 3,
    });
    // A frame time strictly between up (12) and down (16) holds the level.
    feed(ladder, 14, 100);
    expect(ladder.level()).toBe(QualityLevel.Full);
  });

  it('requires a fresh sustain window for each successive down-step (no cascade in one burst)', () => {
    const ladder = createDegradationLadder({ downSustainFrames: 4 });
    const overBudget = DEFAULT_FRAME_BUDGET_MS + 5;
    // Exactly one window => exactly one step.
    feed(ladder, overBudget, 4);
    expect(ladder.level()).toBe(QualityLevel.ReduceParticles);
    // One more frame alone does not trigger the next step.
    ladder.sample(overBudget);
    expect(ladder.level()).toBe(QualityLevel.ReduceParticles);
  });

  it('reset returns to full (or a given level) and clears the counters', () => {
    const ladder = createDegradationLadder({ downSustainFrames: 2 });
    feed(ladder, DEFAULT_FRAME_BUDGET_MS + 5, 2);
    expect(ladder.level()).toBe(QualityLevel.ReduceParticles);

    ladder.reset();
    expect(ladder.level()).toBe(QualityLevel.Full);
    // Counters cleared: a single over-budget frame after reset does not step.
    ladder.sample(DEFAULT_FRAME_BUDGET_MS + 5);
    expect(ladder.level()).toBe(QualityLevel.Full);
  });

  it('ignores non-finite / negative frame times', () => {
    const ladder = createDegradationLadder({ downSustainFrames: 1 });
    ladder.sample(Number.NaN);
    ladder.sample(-5);
    ladder.sample(Number.POSITIVE_INFINITY);
    expect(ladder.level()).toBe(QualityLevel.Full);
  });

  it('qualitySettingsForLevel sheds cost in the documented order', () => {
    const full = qualitySettingsForLevel(QualityLevel.Full);
    const p = qualitySettingsForLevel(QualityLevel.ReduceParticles);
    const pp = qualitySettingsForLevel(QualityLevel.ReduceParallax);
    const drop = qualitySettingsForLevel(QualityLevel.DropEffects);

    // Particles shed first.
    expect(p.particleScale).toBeLessThan(full.particleScale);
    expect(p.parallaxScale).toBe(full.parallaxScale);
    expect(p.nonEssentialEffects).toBe(true);

    // Then parallax detail.
    expect(pp.parallaxScale).toBeLessThan(p.parallaxScale);
    expect(pp.nonEssentialEffects).toBe(true);

    // Then non-essential effects dropped entirely.
    expect(drop.nonEssentialEffects).toBe(false);
    expect(drop.particleScale).toBe(0);
    expect(drop.parallaxScale).toBe(0);
  });
});

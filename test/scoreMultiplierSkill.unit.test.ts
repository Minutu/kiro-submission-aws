// Feature: kino-game
//
// Unit tests for the Score Multiplier skill bridge (design: "Active Skill —
// Score Multiplier"; Req 17.1, 17.2). These pin task 6.8's concrete contract:
// the injected MultiplierSource returns the configured factor WHILE the Score
// Multiplier skill is equipped + active and 1 otherwise; a credit inside the
// active window is worth `factor` while a credit before/after is worth 1; and
// the multiplier reflects AT CREDIT TIME (reading the live skill state each
// credit). The HUD value helper (Req 17.2) is pinned too.
//
// The bridge is composed with the REAL SkillSystem and REAL ScoringSystem (no
// mocks of either) so the test validates the actual wiring GameplayScene uses.

import { describe, it, expect } from 'vitest';
import {
  createSkillSystem,
  createScoringSystem,
  createScoreMultiplierSource,
  scoreMultiplierHudValue,
  isScoreMultiplierActive,
  SCORE_MULTIPLIER_SKILL_ID,
  type ScoreMultiplierSkillView,
} from '../src/core/index.ts';
import { createBalanceTable } from '../src/config/index.ts';

function balance() {
  return createBalanceTable();
}

/** Tick a skill system in small whole steps until `seconds` have elapsed. */
function tickSeconds(
  sys: { tick(dt: number): void },
  seconds: number,
  step = 1 / 120,
): void {
  let elapsed = 0;
  while (elapsed < seconds - 1e-9) {
    sys.tick(step);
    elapsed += step;
  }
}

describe('createScoreMultiplierSource — returns factor only while active', () => {
  it('returns the configured factor while Score Multiplier is equipped + active, else 1', () => {
    const b = balance();
    const skills = createSkillSystem(b);
    const source = createScoreMultiplierSource(skills, b);

    // Nothing equipped → 1.
    expect(source()).toBe(1);

    // Equipped but ready (not active) → 1.
    skills.equip('scoreMultiplier');
    expect(skills.state()).toBe('ready');
    expect(source()).toBe(1);

    // Active → the configured factor (default 2).
    skills.activate();
    expect(skills.isActive()).toBe(true);
    expect(source()).toBe(b.scoreMultiplierFactor());
    expect(source()).toBe(2);

    // After the active window ends (now on cooldown) → back to 1.
    tickSeconds(skills, b.scoreMultiplierDurationS() + 1 / 120);
    expect(skills.state()).toBe('cooldown');
    expect(source()).toBe(1);
  });

  it('returns 1 when a DIFFERENT skill is active (not Score Multiplier)', () => {
    const b = balance();
    const skills = createSkillSystem(b);
    const source = createScoreMultiplierSource(skills, b);

    skills.equip('timeSlow');
    skills.activate();
    expect(skills.isActive()).toBe(true);
    // A different active skill must NOT trigger the score multiplier.
    expect(source()).toBe(1);
  });
});

describe('isScoreMultiplierActive — predicate', () => {
  it('is true only when Score Multiplier is the equipped skill and active', () => {
    const b = balance();
    const skills = createSkillSystem(b);

    expect(isScoreMultiplierActive(skills)).toBe(false); // none equipped
    skills.equip('scoreMultiplier');
    expect(isScoreMultiplierActive(skills)).toBe(false); // equipped, ready
    skills.activate();
    expect(isScoreMultiplierActive(skills)).toBe(true); // equipped, active
  });

  it('exposes the watched skill id', () => {
    expect(SCORE_MULTIPLIER_SKILL_ID).toBe('scoreMultiplier');
  });
});

describe('ScoringSystem wiring — credit worth factor inside window, 1 outside', () => {
  it('credits `factor` during the active window and 1 before / after', () => {
    const b = balance();
    const skills = createSkillSystem(b);
    const scoring = createScoringSystem({
      multiplierSource: createScoreMultiplierSource(skills, b),
    });
    skills.equip('scoreMultiplier');

    // BEFORE activation: credit is worth the unit 1.
    const before = scoring.credit('o-before', 'jumping');
    expect(before?.creditedValue).toBe(1);
    expect(before?.multiplierAtCredit).toBe(1);

    // DURING the active window: credit is worth the factor (default 2).
    skills.activate();
    const during = scoring.credit('o-during', 'jumping');
    expect(during?.multiplierAtCredit).toBe(b.scoreMultiplierFactor());
    expect(during?.creditedValue).toBe(b.scoreMultiplierFactor());

    // AFTER the window (skill now on cooldown): back to 1.
    tickSeconds(skills, b.scoreMultiplierDurationS() + 1 / 120);
    expect(skills.state()).toBe('cooldown');
    const after = scoring.credit('o-after', 'jumping');
    expect(after?.creditedValue).toBe(1);
    expect(after?.multiplierAtCredit).toBe(1);

    // Running total = 1 (before) + factor (during) + 1 (after).
    expect(scoring.current()).toBe(2 + b.scoreMultiplierFactor());
  });

  it('reflects the multiplier AT CREDIT TIME, not when the window opened', () => {
    const b = balance();
    const skills = createSkillSystem(b);
    const scoring = createScoringSystem({
      multiplierSource: createScoreMultiplierSource(skills, b),
    });
    skills.equip('scoreMultiplier');
    skills.activate();

    // A credit partway through the active window still snapshots the factor.
    tickSeconds(skills, b.scoreMultiplierDurationS() / 2);
    expect(skills.isActive()).toBe(true);
    const mid = scoring.credit('o-mid', 'flight');
    expect(mid?.multiplierAtCredit).toBe(b.scoreMultiplierFactor());

    // End the window, then credit: the multiplier is read fresh (now 1),
    // proving it is applied at credit time rather than latched at open.
    tickSeconds(skills, b.scoreMultiplierDurationS());
    expect(skills.isActive()).toBe(false);
    const afterWindow = scoring.credit('o-afterwindow', 'flight');
    expect(afterWindow?.multiplierAtCredit).toBe(1);
  });

  it('activeMultiplier() reflects the live window (HUD source via ScoringSystem)', () => {
    const b = balance();
    const skills = createSkillSystem(b);
    const scoring = createScoringSystem({
      multiplierSource: createScoreMultiplierSource(skills, b),
    });
    skills.equip('scoreMultiplier');

    expect(scoring.activeMultiplier()).toBe(1);
    skills.activate();
    expect(scoring.activeMultiplier()).toBe(b.scoreMultiplierFactor());
  });
});

describe('scoreMultiplierHudValue — HUD seam (Req 17.2)', () => {
  it('shows the factor while active and 1 otherwise', () => {
    const b = balance();
    const skills = createSkillSystem(b);

    expect(scoreMultiplierHudValue(skills, b)).toBe(1); // none equipped
    skills.equip('scoreMultiplier');
    expect(scoreMultiplierHudValue(skills, b)).toBe(1); // ready
    skills.activate();
    expect(scoreMultiplierHudValue(skills, b)).toBe(b.scoreMultiplierFactor()); // active
  });

  it('works against a minimal ScoreMultiplierSkillView fake', () => {
    const b = balance();
    let active = false;
    const fake: ScoreMultiplierSkillView = {
      equipped: () => 'scoreMultiplier',
      isActive: () => active,
    };
    expect(scoreMultiplierHudValue(fake, b)).toBe(1);
    active = true;
    expect(scoreMultiplierHudValue(fake, b)).toBe(b.scoreMultiplierFactor());
  });
});

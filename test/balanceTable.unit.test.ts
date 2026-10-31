// Feature: kino-game
//
// UNIT tests for BalanceTable — the single choke point for NUMERIC RANGE
// validation of the tunable `balance` block (Req 47.2, 47.4, 26.8). Covers
// task 2.5's second bullet:
//   - Out-of-range/missing balance value → documented default + warning (Req 47.2)
//
// Pure TypeScript, no Phaser. console.warn is spied to assert the single
// developer warning per offending read, and restored after each test.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { createBalanceTable, defaultConfig } from '../src/config/index.ts';
import type { BalanceConfig } from '../src/config/index.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Deep clone of the default balance block, safe to mutate per test. */
function cloneBalance(): BalanceConfig {
  return structuredClone(defaultConfig.balance);
}

describe('BalanceTable value validation (Req 47.2)', () => {
  it('substitutes the documented default + warns for an out-of-range value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const balance = cloneBalance();
    // Documented range for jump.impulse is [350, 700], default 520.
    balance.movement.jump.impulse = 9999;

    const table = createBalanceTable(balance);
    expect(table.jumpImpulse()).toBe(520);
    expect(warn).toHaveBeenCalledTimes(1);
    const msg = String(warn.mock.calls[0]?.[0]);
    expect(msg).toContain('[KINO][BalanceTable]');
    expect(msg).toContain('outside the documented range');
  });

  it('substitutes the default + warns for a value below the range', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const balance = cloneBalance();
    balance.movement.jump.impulse = 10; // below min 350

    const table = createBalanceTable(balance);
    expect(table.jumpImpulse()).toBe(520);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('substitutes the default + warns for a missing value', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const balance = cloneBalance();
    // Remove the value entirely.
    delete (balance.movement.jump as Partial<typeof balance.movement.jump>)
      .impulse;

    const table = createBalanceTable(balance);
    expect(table.jumpImpulse()).toBe(520);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      'missing or not a finite number',
    );
  });

  it('substitutes the default + warns for NaN and Infinity', () => {
    const warnNaN = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const nanBalance = cloneBalance();
    nanBalance.movement.jump.gravity = NaN;
    expect(createBalanceTable(nanBalance).jumpGravity()).toBe(1600);
    expect(warnNaN).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();

    const warnInf = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const infBalance = cloneBalance();
    infBalance.movement.flight.impulse = Infinity;
    expect(createBalanceTable(infBalance).flightImpulse()).toBe(300);
    expect(warnInf).toHaveBeenCalledTimes(1);
  });

  it('returns an in-range value as-is with no warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const balance = cloneBalance();
    balance.movement.jump.impulse = 600; // within [350, 700]

    const table = createBalanceTable(balance);
    expect(table.jumpImpulse()).toBe(600);
    expect(warn).not.toHaveBeenCalled();
  });

  it('accepts inclusive range boundaries without warning', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const balance = cloneBalance();
    balance.movement.jump.impulse = 350; // exact min
    balance.movement.jump.gravity = 2200; // exact max

    const table = createBalanceTable(balance);
    expect(table.jumpImpulse()).toBe(350);
    expect(table.jumpGravity()).toBe(2200);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('BalanceTable typed getters resolve documented defaults', () => {
  it('returns the documented defaults when given the default balance block', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const table = createBalanceTable(defaultConfig.balance);

    expect(table.jumpImpulse()).toBe(520);
    expect(table.jumpGravity()).toBe(1600);
    expect(table.scrollSpeedBase()).toBe(220);
    expect(table.worldUnlockThreshold()).toBe(50);
    expect(table.timeSlowFactor()).toBe(0.5);
    expect(table.cosmeticDropProbability()).toBe(0.35);
    expect(table.telegraphLeadPx()).toBe(500);

    // Default balance is fully valid, so nothing warns.
    expect(warn).not.toHaveBeenCalled();
  });

  it('resolves per-mode hitbox scales, falling back to default via the getter', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const table = createBalanceTable(defaultConfig.balance);

    expect(table.hitboxScale('default')).toBe(0.7);
    expect(table.hitboxScale('jumping')).toBe(0.72);
    expect(table.hitboxScale('flight')).toBe(0.68);
    expect(table.hitboxScale('zigzag')).toBe(0.75);
    expect(table.hitboxScale('underwater')).toBe(0.68);
    expect(warn).not.toHaveBeenCalled();
  });

  it('uses the default balance block when none is supplied', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const table = createBalanceTable();
    expect(table.jumpImpulse()).toBe(520);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('BalanceTable.perkObstacleMilestones (Req 10.1-10.2)', () => {
  it('returns the configured milestones when valid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const balance = cloneBalance();
    balance.difficulty.perkObstacleMilestones = [15, 30, 45];

    const table = createBalanceTable(balance);
    expect(table.perkObstacleMilestones()).toEqual([15, 30, 45]);
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to the documented default [20, 40] + warns when invalid', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const balance = cloneBalance();
    // Contains a non-positive / non-finite entry -> structurally invalid.
    balance.difficulty.perkObstacleMilestones = [0, -5] as number[];

    const table = createBalanceTable(balance);
    expect(table.perkObstacleMilestones()).toEqual([20, 40]);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain(
      'perkObstacleMilestones',
    );
  });

  it('falls back to [20, 40] + warns for an empty or non-array value', () => {
    const warnEmpty = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const emptyBalance = cloneBalance();
    emptyBalance.difficulty.perkObstacleMilestones = [];
    expect(createBalanceTable(emptyBalance).perkObstacleMilestones()).toEqual([
      20, 40,
    ]);
    expect(warnEmpty).toHaveBeenCalledTimes(1);

    vi.restoreAllMocks();

    const warnNonArray = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const nonArrayBalance = cloneBalance();
    (nonArrayBalance.difficulty as any).perkObstacleMilestones = 'nope';
    expect(
      createBalanceTable(nonArrayBalance).perkObstacleMilestones(),
    ).toEqual([20, 40]);
    expect(warnNonArray).toHaveBeenCalledTimes(1);
  });

  it('returns a defensive copy of the milestones array', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const table = createBalanceTable(defaultConfig.balance);
    const first = table.perkObstacleMilestones();
    first.push(999);
    expect(table.perkObstacleMilestones()).toEqual([20, 40]);
  });
});

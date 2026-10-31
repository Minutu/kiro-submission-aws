// Feature: kino-game
//
// Sample UNIT test — proves the Vitest harness runs and asserts correctly.
// Replaced/expanded by real core unit tests in later tasks; kept minimal here.

import { describe, it, expect } from 'vitest';

/** Trivial pure helper exercised purely to prove the harness works. */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

describe('test harness (sample unit)', () => {
  it('runs a basic assertion', () => {
    expect(1 + 1).toBe(2);
  });

  it('clamps within bounds', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-3, 0, 10)).toBe(0);
    expect(clamp(42, 0, 10)).toBe(10);
  });
});

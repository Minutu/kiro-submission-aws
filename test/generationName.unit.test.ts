// Feature: kino-game
//
// UNIT tests for the Phaser-free Generation_Name composition used by the
// minimal MainMenuScene (task 4.4) to render the current generation label
// (Req 32.1-32.2, 20.35). Covers the roman-numeral conversion and the template
// substitution against the config scheme + live Save_Store generation.
//
// Pure TypeScript, no Phaser — matches the Node-only test environment.

import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/config/index.ts';
import { createFirstLaunchState } from '../src/engine/saveState.ts';
import { toRoman, formatGenerationName } from '../src/engine/generationName.ts';

describe('toRoman', () => {
  it('converts small generation iterations correctly', () => {
    expect(toRoman(1)).toBe('I');
    expect(toRoman(3)).toBe('III');
    expect(toRoman(4)).toBe('IV');
    expect(toRoman(9)).toBe('IX');
    expect(toRoman(14)).toBe('XIV');
  });

  it('converts larger values with the subtractive table', () => {
    expect(toRoman(40)).toBe('XL');
    expect(toRoman(90)).toBe('XC');
    expect(toRoman(2024)).toBe('MMXXIV');
  });

  it('falls back to the arabic form for non-positive / non-finite input', () => {
    expect(toRoman(0)).toBe('0');
    expect(toRoman(-5)).toBe('-5');
    expect(toRoman(Number.NaN)).toBe('NaN');
  });
});

describe('formatGenerationName', () => {
  const scheme = defaultConfig.names.generationalScheme;
  const base = defaultConfig.names.baseCharacterName;

  it('composes "Kino III Junior" style names from iteration + suffix', () => {
    expect(
      formatGenerationName(base, scheme, { iteration: 3, suffix: 'Junior' }),
    ).toBe('Kino III Junior');
    expect(
      formatGenerationName(base, scheme, { iteration: 4, suffix: 'Senior' }),
    ).toBe('Kino IV Senior');
  });

  it('renders the First_Launch_State as Generation 1 Junior', () => {
    const save = createFirstLaunchState(defaultConfig);
    expect(formatGenerationName(base, scheme, save.generation)).toBe(
      'Kino I Junior',
    );
  });

  it('honors a user-edited template and drops omitted tokens cleanly', () => {
    const custom = { format: '{suffix} {base}-{roman}' };
    expect(
      formatGenerationName('Kino', custom, { iteration: 2, suffix: 'Senior' }),
    ).toBe('Senior Kino-II');

    const baseOnly = { format: '{base}' };
    expect(
      formatGenerationName('Kino', baseOnly, { iteration: 7, suffix: 'Junior' }),
    ).toBe('Kino');
  });
});

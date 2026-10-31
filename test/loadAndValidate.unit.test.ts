// Feature: kino-game
//
// UNIT tests for ConfigFile.loadAndValidate — the STRUCTURAL guard that turns
// an untrusted raw Config_File into a complete `ConfigFileData` without ever
// throwing (Req 47.1, 47.3, 33.6). Covers task 2.5's first bullet:
//   - Malformed config → defaults + warning, no crash (Req 47.1)
//
// Pure TypeScript, no Phaser. console.warn is spied so we can assert the
// developer warnings fire, and restored after each test to stay deterministic.

import { describe, it, expect, vi, afterEach } from 'vitest';
import { loadAndValidate, defaultConfig } from '../src/config/index.ts';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('loadAndValidate (Req 47.1, 47.3, 33.6)', () => {
  it('returns defaults, warns, and does not throw on a malformed JSON string', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    let result!: ReturnType<typeof loadAndValidate>;
    // The whole point: an unparseable string must never crash the boot path.
    expect(() => {
      result = loadAndValidate('{ this is : not valid JSON ]');
    }).not.toThrow();

    expect(result).toEqual(defaultConfig);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('[KINO][ConfigFile]');
  });

  it('returns defaults + warning for a structurally-invalid object (missing keys)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Present but missing almost every required top-level key.
    const result = loadAndValidate({ names: {} });

    expect(result).toEqual(defaultConfig);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('structurally invalid');
  });

  it('returns defaults + warning when a required value has the wrong type', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Clone defaults but corrupt one deep primitive's type (number -> string).
    const corrupt = structuredClone(defaultConfig);
    (corrupt.balance.movement.jump as unknown as Record<string, unknown>).impulse =
      'not-a-number';

    const result = loadAndValidate(corrupt);

    expect(result).toEqual(defaultConfig);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0]?.[0])).toContain('structurally invalid');
  });

  it('merges a valid partial config over the defaults, keeping omitted keys', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    // Start from a complete clone (structurally valid) and change two values.
    const partial = structuredClone(defaultConfig);
    partial.names.baseCharacterName = 'Nova';
    partial.balance.movement.jump.impulse = 480;

    const result = loadAndValidate(partial);

    // Overridden values win...
    expect(result.names.baseCharacterName).toBe('Nova');
    expect(result.balance.movement.jump.impulse).toBe(480);
    // ...and untouched values still resolve from defaults.
    expect(result.labels.play).toBe(defaultConfig.labels.play);
    expect(result.balance.movement.jump.gravity).toBe(
      defaultConfig.balance.movement.jump.gravity,
    );
    // A structurally valid config is not a problem, so no warning.
    expect(warn).not.toHaveBeenCalled();
  });

  it('parses a valid JSON string and merges it over defaults', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const partial = structuredClone(defaultConfig);
    partial.labels.play = 'GO';
    const result = loadAndValidate(JSON.stringify(partial));

    expect(result.labels.play).toBe('GO');
    expect(result.labels.retry).toBe(defaultConfig.labels.retry);
    expect(warn).not.toHaveBeenCalled();
  });

  it('returns defaults silently for undefined and null (normal first-boot path)', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    expect(loadAndValidate(undefined)).toEqual(defaultConfig);
    expect(loadAndValidate(null)).toEqual(defaultConfig);
    expect(loadAndValidate()).toEqual(defaultConfig);

    expect(warn).not.toHaveBeenCalled();
  });
});

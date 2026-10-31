// Feature: kino-game
//
// UNIT tests for AssetRegistry — the single choke point mapping config asset
// keys to real loaded art or geometric placeholder descriptors (Req 24.1,
// 24.2, 24.4, 24.10, 33.7). Covers task 2.5's third bullet:
//   - Empty path / missing key / simulated load error → placeholder
//     (Req 24.10, 33.7)
//
// Pure TypeScript, no Phaser. The registry is built from a deep clone of the
// default config so tests can set specific configured paths deterministically.

import { describe, it, expect } from 'vitest';
import { AssetRegistry } from '../src/assets/index.ts';
import { defaultConfig } from '../src/config/index.ts';
import type { ConfigFileData } from '../src/config/index.ts';

/** A fresh, independently mutable copy of the default config per test. */
function freshConfig(): ConfigFileData {
  return structuredClone(defaultConfig);
}

describe('AssetRegistry blank-path fallback (Req 24.10, 33.7)', () => {
  it('resolves a blank configured path straight to a placeholder', () => {
    // Default worldBackgrounds are all "" (blank) -> placeholder from boot.
    const registry = AssetRegistry.fromConfig(freshConfig());

    const resolved = registry.resolve('background:world1');
    expect(resolved.source).toBe('placeholder');
    expect(resolved.placeholder).toBeDefined();
    expect(resolved.real).toBeUndefined();
    expect(registry.hasReal('background:world1')).toBe(false);
  });

  it('treats a whitespace-only configured path as blank', () => {
    const cfg = freshConfig();
    cfg.worldBackgrounds.world1 = '   \t  ';

    const registry = AssetRegistry.fromConfig(cfg);
    expect(registry.resolve('background:world1').source).toBe('placeholder');
    expect(registry.hasReal('background:world1')).toBe(false);
    // A blank path is never queued for loading.
    expect(
      registry.pendingLoads().some((p) => p.key === 'background:world1'),
    ).toBe(false);
  });

  it('throws when resolving an unknown/missing key', () => {
    const registry = AssetRegistry.fromConfig(freshConfig());
    expect(registry.has('does:not:exist')).toBe(false);
    expect(() => registry.resolve('does:not:exist')).toThrow(
      /unknown asset key/,
    );
  });
});

describe('AssetRegistry load lifecycle (Req 24.10)', () => {
  it('starts a real configured path pending, then markLoaded makes it real', () => {
    const cfg = freshConfig();
    // Default audio.jump ships a real path "assets/jump.wav".
    const registry = AssetRegistry.fromConfig(cfg);

    // Before loading it resolves to a placeholder but is queued as pending.
    expect(registry.resolve('audio:jump').source).toBe('placeholder');
    expect(registry.hasReal('audio:jump')).toBe(false);
    expect(registry.pendingLoads().some((p) => p.key === 'audio:jump')).toBe(
      true,
    );

    registry.markLoaded('audio:jump');

    const resolved = registry.resolve('audio:jump');
    expect(resolved.source).toBe('real');
    expect(resolved.real).toBe('assets/jump.wav');
    expect(resolved.placeholder).toBeUndefined();
    expect(registry.hasReal('audio:jump')).toBe(true);
  });

  it('falls back to a placeholder when a real path fails to load', () => {
    const cfg = freshConfig();
    const registry = AssetRegistry.fromConfig(cfg);

    // Simulate the loader reporting an error for a real, pending path.
    registry.markFailed('audio:jump');

    const resolved = registry.resolve('audio:jump');
    expect(resolved.source).toBe('placeholder');
    expect(resolved.placeholder).toBeDefined();
    expect(registry.hasReal('audio:jump')).toBe(false);
  });

  it('keeps a blank path on its placeholder even if markLoaded is called', () => {
    const registry = AssetRegistry.fromConfig(freshConfig());
    registry.markLoaded('background:world1'); // blank path, nothing queued
    expect(registry.resolve('background:world1').source).toBe('placeholder');
    expect(registry.hasReal('background:world1')).toBe(false);
  });
});

describe('AssetRegistry placeholder palette tinting (Req 24.1, 24.2)', () => {
  it('tints a world-scoped obstacle placeholder from the world palette', () => {
    const registry = AssetRegistry.fromConfig(freshConfig());

    const resolved = registry.resolve('obstacle:world1_ground_obstacle');
    expect(resolved.source).toBe('placeholder');
    const placeholder = resolved.placeholder!;
    // world1 obstacle tint from the default palette.
    expect(placeholder.tint).toBe(
      defaultConfig.colorPalettes.world1.obstacles,
    );
    expect(placeholder.world).toBe('world1');
    expect(placeholder.category).toBe('obstacle');
    expect(placeholder.kind).toBe('rect');
  });

  it('tints a world-scoped background placeholder from the world palette', () => {
    const registry = AssetRegistry.fromConfig(freshConfig());

    const resolved = registry.resolve('background:world2');
    const placeholder = resolved.placeholder!;
    expect(placeholder.tint).toBe(
      defaultConfig.colorPalettes.world2.background,
    );
    expect(placeholder.world).toBe('world2');
    expect(placeholder.category).toBe('background');
  });

  it('exposes all registered keys and membership', () => {
    const registry = AssetRegistry.fromConfig(freshConfig());
    const keys = registry.keys();
    expect(keys.length).toBeGreaterThan(0);
    expect(registry.has('obstacle:world1_ground_obstacle')).toBe(true);
    expect(keys).toContain('background:world2');
  });
});

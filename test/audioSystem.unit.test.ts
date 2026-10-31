// Feature: kino-game
//
// UNIT tests for the PURE audio STATE / POLICY logic (task 12.1) in
// src/core/audioSystem.ts. These cover the deterministic autoplay-gate,
// effective-gain, and sound-event-catalog behaviors the thin engine
// AudioManager defers to (Req 25.1-25.9):
//
//   - AUTOPLAY GATE (Req 25.9): before `onUserInteraction()` every non-muted
//     request QUEUES and nothing is "played"; on the first interaction the
//     queued events FLUSH in order; later requests return 'play' immediately.
//   - MUTE (Req 25.7): a muted request is 'suppressed'; `effectiveGain` is 0.
//   - EFFECTIVE GAIN (Req 25.7-25.8): `effectiveGain(volume, muted)` is
//     `muted ? 0 : clamp(volume)` and clamps out-of-range volume to [0,1].
//   - EVENT CATALOG (Req 25.1-25.5): each movement mode + evolution / collision
//     / UI / mentor reaction / per-world music maps to a DISTINCT entry.
//
// Pure TypeScript, no Phaser / WebAudio — core module.

import { describe, it, expect } from 'vitest';
import {
  createAudioPolicy,
  createAudioCatalog,
  effectiveGain,
  AUDIO_WORLD_IDS,
  type AudioEvent,
} from '../src/core/audioSystem.ts';

describe('effectiveGain (Req 25.7-25.8)', () => {
  it('is the clamped volume when not muted', () => {
    expect(effectiveGain(0.5, false)).toBe(0.5);
    expect(effectiveGain(1, false)).toBe(1);
    expect(effectiveGain(0, false)).toBe(0);
  });

  it('is 0 when muted regardless of volume', () => {
    expect(effectiveGain(1, true)).toBe(0);
    expect(effectiveGain(0.3, true)).toBe(0);
  });

  it('clamps out-of-range volume into [0,1]', () => {
    expect(effectiveGain(5, false)).toBe(1);
    expect(effectiveGain(-2, false)).toBe(0);
    expect(effectiveGain(Number.NaN, false)).toBe(0);
  });
});

describe('autoplay gate (Req 25.9)', () => {
  it('starts locked by default', () => {
    const policy = createAudioPolicy();
    expect(policy.isUnlocked()).toBe(false);
  });

  it('queues non-muted requests before the first interaction and plays nothing', () => {
    const policy = createAudioPolicy({ settings: { volume: 1, muted: false } });

    expect(policy.requestPlay('move:jumping')).toBe('queued');
    expect(policy.requestPlay('collision')).toBe('queued');
    expect(policy.queued()).toEqual(['move:jumping', 'collision']);
    expect(policy.isUnlocked()).toBe(false);
  });

  it('flushes queued events in request order on the first interaction', () => {
    const policy = createAudioPolicy({ settings: { volume: 1, muted: false } });

    policy.requestPlay('move:flight');
    policy.requestPlay('ui');
    policy.requestPlay('evolution');

    const flushed = policy.onUserInteraction();
    expect(policy.isUnlocked()).toBe(true);
    expect(flushed).toEqual(['move:flight', 'ui', 'evolution']);
    // The queue is drained after the flush.
    expect(policy.queued()).toEqual([]);
  });

  it('plays immediately after unlock and does not re-queue', () => {
    const policy = createAudioPolicy({ settings: { volume: 0.8, muted: false } });
    policy.onUserInteraction();

    expect(policy.requestPlay('move:zigzag')).toBe('play');
    expect(policy.requestPlay('music:world2')).toBe('play');
    expect(policy.queued()).toEqual([]);
  });

  it('a second interaction after unlock flushes nothing (idempotent)', () => {
    const policy = createAudioPolicy();
    policy.requestPlay('ui');
    expect(policy.onUserInteraction()).toEqual(['ui']);
    expect(policy.onUserInteraction()).toEqual([]);
  });
});

describe('mute (Req 25.7)', () => {
  it('suppresses requests when muted, before or after unlock', () => {
    const policy = createAudioPolicy({ settings: { volume: 1, muted: true } });

    // Before unlock: suppressed (not queued), so it is never dropped later.
    expect(policy.requestPlay('collision')).toBe('suppressed');
    expect(policy.queued()).toEqual([]);

    policy.onUserInteraction();
    expect(policy.requestPlay('collision')).toBe('suppressed');
  });

  it('suppresses when volume is zero even if not explicitly muted', () => {
    const policy = createAudioPolicy({ settings: { volume: 0, muted: false } });
    policy.onUserInteraction();
    expect(policy.requestPlay('ui')).toBe('suppressed');
    expect(policy.gain()).toBe(0);
  });

  it('reflects a later setSettings change', () => {
    const policy = createAudioPolicy({ settings: { volume: 1, muted: false } });
    policy.onUserInteraction();
    expect(policy.requestPlay('ui')).toBe('play');

    policy.setSettings({ volume: 1, muted: true });
    expect(policy.requestPlay('ui')).toBe('suppressed');
    expect(policy.gain()).toBe(0);

    policy.setSettings({ volume: 0.5, muted: false });
    expect(policy.requestPlay('ui')).toBe('play');
    expect(policy.gain()).toBe(0.5);
  });

  it('drops muted events that were queued before unlock (none sound on flush)', () => {
    // Queue while audible, then mute before interacting: flush returns nothing.
    const policy = createAudioPolicy({ settings: { volume: 1, muted: false } });
    policy.requestPlay('move:jumping');
    policy.setSettings({ volume: 1, muted: true });
    expect(policy.onUserInteraction()).toEqual([]);
  });
});

describe('sound-event catalog (Req 25.1-25.5)', () => {
  it('maps each movement mode to a distinct sfx entry (Req 25.1)', () => {
    const catalog = createAudioCatalog();
    const moves: AudioEvent[] = [
      'move:jumping',
      'move:flight',
      'move:zigzag',
      'move:underwater',
    ];
    const keys = moves.map((m) => catalog[m].assetKey);
    // All four keys are distinct and tagged as one-shot sfx.
    expect(new Set(keys).size).toBe(4);
    for (const m of moves) {
      expect(catalog[m].kind).toBe('sfx');
    }
  });

  it('maps evolution / collision / UI / mentor to distinct sfx (Req 25.2-25.4, 25.6)', () => {
    const catalog = createAudioCatalog();
    const singles: AudioEvent[] = ['evolution', 'collision', 'ui', 'mentorReaction'];
    const keys = singles.map((s) => catalog[s].assetKey);
    expect(new Set(keys).size).toBe(4);
    for (const s of singles) {
      expect(catalog[s].kind).toBe('sfx');
    }
  });

  it('maps every world to a distinct looping music entry (Req 25.5)', () => {
    const catalog = createAudioCatalog();
    const keys = AUDIO_WORLD_IDS.map((w) => catalog[`music:${w}`].assetKey);
    expect(new Set(keys).size).toBe(AUDIO_WORLD_IDS.length);
    for (const w of AUDIO_WORLD_IDS) {
      expect(catalog[`music:${w}`].kind).toBe('music');
    }
  });

  it('every logical event resolves to a distinct asset key overall', () => {
    const catalog = createAudioCatalog();
    const allKeys = Object.values(catalog).map((e) => e.assetKey);
    expect(new Set(allKeys).size).toBe(allKeys.length);
  });

  it('exposes the catalog through the policy cueFor', () => {
    const policy = createAudioPolicy();
    expect(policy.cueFor('move:underwater').assetKey).toBe('audio:underwater');
    expect(policy.cueFor('music:world3').kind).toBe('music');
  });
});

describe('initial settings clamp', () => {
  it('clamps an out-of-range initial volume from the Save_Store', () => {
    const policy = createAudioPolicy({ settings: { volume: 9, muted: false } });
    expect(policy.settings().volume).toBe(1);
    expect(policy.gain()).toBe(1);
  });
});

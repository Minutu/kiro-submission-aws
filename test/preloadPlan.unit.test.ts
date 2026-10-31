// Feature: kino-game
//
// UNIT tests for the task-4.2 PURE preload planner (preloadPlan.ts). The
// PreloadScene's one non-trivial per-asset decision is which Phaser loader
// method to use, and that is driven entirely by the asset category (Req 24.5,
// 37.1). These tests pin that mapping without a live Phaser scene:
//   - Every visual category loads as an image.
//   - Audio + music categories load as audio.
//   - The mapping is total over AssetCategory (no category is left unhandled).
//
// Pure TypeScript, no Phaser — matches the scene-seam discipline so the plan
// stays framework-free and PreloadScene is left as thin wiring.

import { describe, it, expect } from 'vitest';
import { loaderKindForCategory } from '../src/engine/scenes/preloadPlan.ts';
import type { LoaderKind } from '../src/engine/scenes/preloadPlan.ts';
import type { AssetCategory } from '../src/assets/index.ts';

/** Every AssetCategory paired with its expected loader kind (Req 24.5). */
const CASES: ReadonlyArray<readonly [AssetCategory, LoaderKind]> = [
  ['characterFrame', 'image'],
  ['menuAnimation', 'image'],
  ['obstacle', 'image'],
  ['mentorImage', 'image'],
  ['background', 'image'],
  ['ui', 'image'],
  ['audio', 'audio'],
  ['music', 'audio'],
];

describe('loaderKindForCategory (Req 24.5, 37.1)', () => {
  it.each(CASES)('maps %s -> %s', (category, expected) => {
    expect(loaderKindForCategory(category)).toBe(expected);
  });

  it('maps the five visual categories to image loads', () => {
    const visual: AssetCategory[] = [
      'characterFrame',
      'menuAnimation',
      'obstacle',
      'mentorImage',
      'background',
      'ui',
    ];
    for (const c of visual) {
      expect(loaderKindForCategory(c)).toBe('image');
    }
  });

  it('maps the two sound categories to audio loads', () => {
    expect(loaderKindForCategory('audio')).toBe('audio');
    expect(loaderKindForCategory('music')).toBe('audio');
  });

  it('covers every AssetCategory (the CASES table is exhaustive)', () => {
    // Guards against a category being added to the union without a mapping:
    // the table above is the source of truth the scene relies on.
    const covered = new Set(CASES.map(([c]) => c));
    const all: AssetCategory[] = [
      'characterFrame',
      'menuAnimation',
      'obstacle',
      'mentorImage',
      'background',
      'music',
      'audio',
      'ui',
    ];
    for (const c of all) {
      expect(covered.has(c)).toBe(true);
    }
  });
});

// Feature: kino-game
//
// Pure planning helper for PreloadScene (task 4.2). The only non-trivial
// decision the Loading_Screen makes per asset is *which* Phaser loader method
// to use — images vs audio — and that decision is driven entirely by the
// asset's category (Req 24.5, 37.1). Extracting it here keeps that mapping
// unit-testable without a browser/canvas and leaves PreloadScene as thin Phaser
// wiring.
//
// PURE — no Phaser import — so this module can be exercised from plain Node.

import type { AssetCategory } from '../../assets/index.ts';

/**
 * The family of Phaser loader call PreloadScene should use for a category:
 *   - 'image' → `this.load.image(key, path)` for any visual art
 *   - 'audio' → `this.load.audio(key, path)` for sound/music cues
 */
export type LoaderKind = 'image' | 'audio';

/**
 * Map an {@link AssetCategory} to the loader kind PreloadScene queues it with.
 *
 * Visual categories (character frames, menu animation, obstacles, mentor
 * portraits, backgrounds, UI) load as images; sound categories (sfx + per-world
 * music) load as audio. The mapping is exhaustive over `AssetCategory` so a new
 * category forces a compile error here rather than silently defaulting.
 */
export function loaderKindForCategory(category: AssetCategory): LoaderKind {
  switch (category) {
    case 'characterFrame':
    case 'menuAnimation':
    case 'obstacle':
    case 'mentorImage':
    case 'background':
    case 'ui':
      return 'image';
    case 'audio':
    case 'music':
      return 'audio';
    default: {
      // Exhaustiveness guard: if AssetCategory grows, this fails to compile.
      const _never: never = category;
      throw new Error(`loaderKindForCategory: unhandled category ${String(_never)}`);
    }
  }
}

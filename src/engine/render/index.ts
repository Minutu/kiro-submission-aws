// Feature: kino-game
//
// Render components — barrel / public surface.
//
// This folder holds the engine-layer renderers (Phaser allowed) plus the pure,
// Phaser-free helpers they consume. KinoRenderer (task 8.1) draws base Kino
// independently and overlays equipped Cosmetic layers positioned by the pure
// `cosmeticAnchors` table; ParallaxBackground / ObstacleView / HUD land in
// later tasks.

// KinoRenderer (Phaser) — base Kino + render-only cosmetic layers (Req 19).
export { KinoRenderer, KINO_BODY_WIDTH, KINO_BODY_HEIGHT } from './KinoRenderer.ts';
export type { KinoRendererOptions, BodyRect } from './KinoRenderer.ts';

// Pure cosmetic anchor table (Phaser-free; unit-testable offset lookup).
export {
  cosmeticAnchor,
  isFrameForMode,
  defaultFrameForMode,
  MODE_FRAMES,
  DEFAULT_ANCHOR,
} from './cosmeticAnchors.ts';
export type { AnimationFrame, AnchorOffset } from './cosmeticAnchors.ts';

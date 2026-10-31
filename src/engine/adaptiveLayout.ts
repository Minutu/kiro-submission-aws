// Feature: kino-game
//
// Adaptive_Layout wiring (engine layer; task 9.9; design: "Adaptive scaling
// (26.10–26.12)"; Req 26.10, 26.11, 26.12).
//
// This is the THIN Phaser seam over the pure `computeLayout` math in
// `src/core/adaptiveLayout.ts`. It subscribes to the Scale Manager `resize`
// event and, on each screen-size change, recomputes the aspect-preserving
// centered "contain" layout of the fixed squarish DESIGN surface
// (`DESIGN_WIDTH`/`DESIGN_HEIGHT`, the desktop-style target) into the actual
// viewport, then hands the layout to a scene-supplied `apply` callback so the
// scene repositions AND rescales its UI + gameplay elements proportionally
// (Req 26.10, 26.12) without stretching (Req 26.11).
//
// The ENGINE layer keeps the math out: all it does is read the actual size off
// the Scale Manager, delegate to the pure `computeLayout`, and route the result
// to the scene. Core never imports from here (the boundary rule).

import type Phaser from 'phaser';
import {
  computeLayout,
  type AdaptiveLayout,
  type Size,
} from '../core/adaptiveLayout.ts';
import { DESIGN_WIDTH, DESIGN_HEIGHT } from './scenes/BootScene.ts';

/** The fixed squarish DESIGN surface the game renders at (desktop-style). */
export const DESIGN_SIZE: Size = { width: DESIGN_WIDTH, height: DESIGN_HEIGHT };

/** Receives the recomputed layout whenever the screen size changes. */
export type ApplyLayoutFn = (layout: AdaptiveLayout) => void;

/** Handle for an installed resize subscription; call `destroy` to detach. */
export interface AdaptiveLayoutController {
  /** The most recently computed layout (also pushed to `apply`). */
  readonly current: AdaptiveLayout;
  /** Recompute from the Scale Manager's current size and re-apply now. */
  refresh(): void;
  /** Detach the resize listener (call on scene shutdown). */
  destroy(): void;
}

/**
 * Compute the Adaptive_Layout for a Scale Manager's current display size
 * against the fixed DESIGN surface. Pure delegation to `core.computeLayout`;
 * exposed so scenes can query a layout without installing a listener.
 */
export function layoutForScale(
  scale: Phaser.Scale.ScaleManager,
  design: Size = DESIGN_SIZE,
): AdaptiveLayout {
  const actual: Size = {
    width: scale.displaySize.width,
    height: scale.displaySize.height,
  };
  return computeLayout(design, actual);
}

/**
 * Install an Adaptive_Layout controller on a scene: subscribe to the Scale
 * Manager `resize` event, recompute the centered contain layout on every
 * screen-size change, and push it to `apply` so the scene repositions and
 * rescales its elements (Req 26.10-26.12). Applies once immediately so the
 * scene lays out correctly on its first frame, and auto-detaches on scene
 * shutdown.
 */
export function installAdaptiveLayout(
  scene: Phaser.Scene,
  apply: ApplyLayoutFn,
  design: Size = DESIGN_SIZE,
): AdaptiveLayoutController {
  const scale = scene.scale;
  let current = layoutForScale(scale, design);

  const recompute = (): void => {
    current = layoutForScale(scale, design);
    apply(current);
  };

  const onResize = (): void => recompute();
  scale.on('resize', onResize);

  const destroy = (): void => {
    scale.off('resize', onResize);
  };

  // Detach automatically when the scene shuts down so the listener does not
  // outlive the scene it repositions.
  scene.events.once('shutdown', destroy);
  scene.events.once('destroy', destroy);

  // Apply once now so the scene is laid out before its first rendered frame.
  apply(current);

  return {
    get current() {
      return current;
    },
    refresh: recompute,
    destroy,
  };
}

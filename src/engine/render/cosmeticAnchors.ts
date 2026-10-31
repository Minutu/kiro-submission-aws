// Feature: kino-game
//
// Cosmetic anchor table — the PURE, Phaser-free offset lookup that drives
// KinoRenderer's layered cosmetic rendering (design: "Cosmetics & Layered
// Rendering", Req 19.2-19.4). It answers ONE question: for a given
// `(movementMode, animationFrame)` pose, where does an equipped Cosmetic layer
// sit relative to base Kino's origin?
//
// WHY A PURE MODULE: the offset math is the testable heart of layered
// rendering. Keeping it out of the Phaser class means the "cosmetic layers
// reposition per pose" contract (Req 19.3) is unit-testable in plain Node with
// no canvas, while the KinoRenderer Phaser class simply consumes
// `cosmeticAnchor(mode, frame)` and applies the returned offset to each child
// sprite. This module stays Phaser-free by construction.
//
// SINGLE SOURCE OF TRUTH FOR FRAME KEYS: the `AnimationFrame` union, the
// `MODE_FRAMES` table, and the `isFrameForMode` / `defaultFrameForMode` helpers
// now live in the PURE core module `src/core/animationFrames.ts` so the task-8.3
// frame-cycle logic (also pure) can share them without reaching into
// `src/engine/**` (which the core↔engine boundary forbids). This file RE-EXPORTS
// them so KinoRenderer and the existing cosmetic-anchor tests keep importing
// everything from `cosmeticAnchors.ts` unchanged — the public API is preserved.
//
// COORDINATE CONTRACT: offsets are in Kino-local pixels, measured from base
// Kino's render origin (its sprite origin). `+x` is right, `+y` is DOWN (Phaser
// screen convention). A hat therefore sits ABOVE the body with a NEGATIVE `y`.
// KinoRenderer adds this offset to base Kino's on-screen position to place each
// cosmetic child; it never bakes a combined sprite (Req 19.4).

import type { MovementMode } from '../../core/types.ts';
import {
  type AnimationFrame,
  type AnchorOffset,
  MODE_FRAMES,
  isFrameForMode,
  defaultFrameForMode,
} from '../../core/animationFrames.ts';

// Re-export the pure frame-key surface so existing importers of this module
// (KinoRenderer, cosmeticAnchors.unit.test.ts, the engine barrel) are unchanged.
export {
  type AnimationFrame,
  type AnchorOffset,
  MODE_FRAMES,
  isFrameForMode,
  defaultFrameForMode,
};

/**
 * Per-frame cosmetic (hat) anchors measured from base Kino's origin. Values are
 * intentionally hand-authored pose offsets, not computed, so an artist / the
 * Config_File can tune where the hat rides for each pose later. The nominal
 * body is treated as ~48px (matches GameplayScene's `KINO_BODY_*`); a hat rides
 * near the top of the head (`y` ~ -26) and drifts slightly with the pose:
 *
 *   - run-step-right/left  — small horizontal sway matching the walk cycle.
 *   - jump arc             — the hat lags on the way up, centers at apex, and
 *                            leads on the way down.
 *   - fly-up/apex/down     — pitch shifts the hat forward/back a little.
 *   - zigzag-up/down       — the pointed arrow form tilts the hat diagonally.
 *   - spin-1/2             — transition cue; cosmetics are hidden here anyway
 *                            (Req 6.5), so these are nominal centered values.
 *   - crawl-step-right/left — low, forward-leaning finale crawl.
 *
 * The precise numbers do not affect collision (cosmetics are render-only, Req
 * 19.6); they only position the transparent layer (Req 19.2-19.3). The CONTRACT
 * the unit tests pin is: every (mode, frame) resolves to a finite offset, and
 * distinct poses within a mode generally yield distinct offsets so the layer
 * visibly repositions per pose (Req 19.3).
 */
const COSMETIC_ANCHORS: Readonly<Record<AnimationFrame, AnchorOffset>> = {
  // jumping — ground walk cycle + airborne arc.
  'run-step-right': { x: 2, y: -26 },
  'run-step-left': { x: -2, y: -26 },
  'jump-go-up': { x: -1, y: -28 },
  'jump-apex': { x: 0, y: -29 },
  'jump-go-down': { x: 1, y: -27 },
  // flight (reused by underwater) — pitch-driven drift.
  'fly-up': { x: -3, y: -27 },
  'fly-apex': { x: 0, y: -26 },
  'fly-down': { x: 3, y: -25 },
  // zigzag — diagonal arrow form tilts the hat.
  'zigzag-up': { x: -4, y: -28 },
  'zigzag-down': { x: 4, y: -24 },
  // spin transition cue — cosmetics hidden during transitions (Req 6.5).
  'spin-1': { x: 0, y: -26 },
  'spin-2': { x: 0, y: -26 },
  // crawl — low, forward-leaning finale.
  'crawl-step-right': { x: 4, y: -18 },
  'crawl-step-left': { x: -4, y: -18 },
};

/**
 * A safe fallback anchor used when a caller passes a `(mode, frame)` pair the
 * table does not recognize (defensive — the lookup must never throw mid-render
 * or hand back `undefined`, since a missing offset would snap a hat to Kino's
 * origin). Centered on the nominal head position.
 */
export const DEFAULT_ANCHOR: AnchorOffset = { x: 0, y: -26 };

/**
 * THE anchor-table lookup (design: "cosmetic anchor table", Req 19.2-19.3).
 * Returns the Kino-local offset at which an equipped Cosmetic layer sits for the
 * given pose. Total and pure: any input resolves to a finite offset
 * ({@link DEFAULT_ANCHOR} when the frame is unknown), never throwing.
 *
 * KinoRenderer calls this every time the pose changes and applies the result to
 * each cosmetic child sprite — the mechanism by which "no unique combined
 * sprite" is needed (Req 19.4): the base and each hat are independent layers
 * stitched together purely by this offset.
 *
 * @param _mode The active Movement_Mode. Accepted for API symmetry and future
 *              per-mode anchor variation; the current table keys on `frame`
 *              alone because each frame already belongs to exactly one mode
 *              (except the flight frames shared with underwater, which share an
 *              anchor by design — Req 30.9).
 * @param frame The current Animation_Frame.
 */
export function cosmeticAnchor(_mode: MovementMode, frame: AnimationFrame): AnchorOffset {
  return COSMETIC_ANCHORS[frame] ?? DEFAULT_ANCHOR;
}

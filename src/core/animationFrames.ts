// Feature: kino-game
//
// Animation_Frame keys — the PURE, Phaser-free single source of truth for every
// named Animation_Frame a pose can take (config `animationFrames`, Req
// 30.7-30.12, 33.9-33.14) and the mode<->frame legality those keys obey (Req
// 30.9's "underwater reuses flight frames").
//
// WHY THIS LIVES IN src/core: the frame-SELECTION logic (task 8.3,
// `animationFrameCycle.ts`) is pure and must stay Phaser-free so it can be
// unit-tested in plain Node (enforced by test/boundary.core-no-phaser.test.ts).
// The cycle needs the `AnimationFrame` union and `MODE_FRAMES`, and the
// cosmetic anchor table in `src/engine/render/cosmeticAnchors.ts` needs the SAME
// keys. Because `src/engine/**` is off-limits to core, the keys cannot live
// under engine. So they live HERE, and `cosmeticAnchors.ts` re-exports them as a
// shim to preserve its existing public API (KinoRenderer and the existing tests
// keep importing from `cosmeticAnchors.ts` unchanged).

import type { MovementMode } from './types.ts';

/**
 * The Animation_Frame keys a pose can take, union-typed across every mode
 * (config `animationFrames`, Req 33.9-33.14). Underwater reuses the flight
 * frames (Req 30.9, 33.11), so it has no keys of its own here. `spin-1/2` are
 * the Flight<->Zigzag transition cue frames (Req 30.11) — cosmetics are hidden
 * during transitions (Req 6.5), but the table still defines anchors for them so
 * the lookup is total. `crawl-step-*` are the World 5 finale crawl frames (Req
 * 30.12).
 */
export type AnimationFrame =
  // jumping (Req 30.7, 30.13)
  | 'run-step-right'
  | 'run-step-left'
  | 'jump-go-up'
  | 'jump-apex'
  | 'jump-go-down'
  // flight — reused by underwater (Req 30.8, 30.9)
  | 'fly-up'
  | 'fly-apex'
  | 'fly-down'
  // zigzag (Req 30.10)
  | 'zigzag-up'
  | 'zigzag-down'
  // spin transition cue (Req 30.11)
  | 'spin-1'
  | 'spin-2'
  // crawl — W5 finale (Req 30.12)
  | 'crawl-step-right'
  | 'crawl-step-left';

/** A 2-D offset in Kino-local pixels (`+x` right, `+y` down). */
export interface AnchorOffset {
  readonly x: number;
  readonly y: number;
}

/**
 * Which Animation_Frame set each Movement_Mode draws with. This is the single
 * source of truth for "underwater reuses flight frames" (Req 30.9) and the one
 * place both the frame cycle (task 8.3) and the cosmetic anchor table ask "is
 * this frame legal for this mode?". Keeping it in pure core keeps the
 * mode<->frame contract unit-testable without Phaser.
 */
export const MODE_FRAMES: Readonly<Record<MovementMode, readonly AnimationFrame[]>> = {
  jumping: ['run-step-right', 'run-step-left', 'jump-go-up', 'jump-apex', 'jump-go-down'],
  flight: ['fly-up', 'fly-apex', 'fly-down'],
  // Underwater_Buoyancy has no frames of its own — it REUSES the flight frames
  // (Req 30.9, 33.11). The anchor table (engine) mirrors that reuse too.
  underwater: ['fly-up', 'fly-apex', 'fly-down'],
  zigzag: ['zigzag-up', 'zigzag-down'],
};

/**
 * True iff `frame` is a legal Animation_Frame for `mode` (per {@link
 * MODE_FRAMES}). Underwater accepts the flight frames (Req 30.9). Used by
 * KinoRenderer to validate pose updates, by the frame cycle, and by tests to
 * pin the mode<->frame contract.
 */
export function isFrameForMode(mode: MovementMode, frame: AnimationFrame): boolean {
  return MODE_FRAMES[mode]?.includes(frame) ?? false;
}

/**
 * The default resting frame for a mode — the frame a renderer starts a pose on
 * before the first animation tick (the frame cycle in `animationFrameCycle.ts`
 * drives it thereafter). Jumping rests on the right walk step; flight/underwater
 * on apex; zigzag on the up leg.
 */
export function defaultFrameForMode(mode: MovementMode): AnimationFrame {
  switch (mode) {
    case 'jumping':
      return 'run-step-right';
    case 'flight':
    case 'underwater':
      return 'fly-apex';
    case 'zigzag':
      return 'zigzag-up';
    default:
      return 'fly-apex';
  }
}

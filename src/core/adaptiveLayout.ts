// Feature: kino-game
//
// Adaptive_Layout math — the PURE, Phaser-free layout computation (task 9.9;
// design: "Adaptive scaling (26.10–26.12)"; Req 26.10, 26.11, 26.12).
//
// The Game renders at a fixed squarish DESIGN resolution (the desktop-style
// target, 960x960 — see `DESIGN_WIDTH`/`DESIGN_HEIGHT`), then FITS that design
// surface into whatever ACTUAL viewport the player gives it (desktop or tablet)
// WITHOUT stretching: it picks the single largest uniform scale that keeps the
// whole design surface visible (a "contain"/letterbox fit) and CENTERS the
// result, leaving equal letterbox bars on the one axis that has slack.
//
// This module owns ONLY the math so it stays property-testable with no browser,
// canvas, or Phaser. `src/engine` subscribes to the Scale Manager resize event
// and APPLIES the result (repositions/rescales UI + gameplay elements). All
// coordinates are in pixels.
//
// Contract (chosen for clean property-testability):
//   - `computeLayout(design, actual)` returns one uniform `scale` =
//     min(actual.w/design.w, actual.h/design.h) (aspect-preserving contain fit,
//     Req 26.11-26.12), the `scaledWidth`/`scaledHeight` of the fitted design
//     surface, and the `offsetX`/`offsetY` that CENTER it in the actual viewport
//     (equal bars; one axis is 0 when that axis is the tight one).
//   - `mapPoint` / `mapRect` map a point/rect from DESIGN space into ACTUAL
//     screen space using that layout: `actual = design * scale + offset`
//     (rects also scale their width/height), so every UI + gameplay element
//     repositions AND rescales proportionally on a screen-size change (Req
//     26.10, 26.12) and nothing stretches (one scale for both axes, Req 26.11).
//
// Purity/determinism: pure functions of their inputs — same design + actual
// always yields the same layout. No module state, no Phaser, no DOM.

/** A width/height size in pixels. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** A point in pixels. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** An axis-aligned rectangle in pixels (top-left origin). */
export interface LayoutRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * The computed Adaptive_Layout: a single uniform `scale`, the centered
 * letterbox `offsetX`/`offsetY`, and the `scaledWidth`/`scaledHeight` of the
 * fitted design surface inside the actual viewport.
 */
export interface AdaptiveLayout {
  /** Uniform scale applied to BOTH axes (aspect-preserving, no stretch). */
  readonly scale: number;
  /** Horizontal letterbox offset that centers the surface (0 when tight). */
  readonly offsetX: number;
  /** Vertical letterbox offset that centers the surface (0 when tight). */
  readonly offsetY: number;
  /** Width of the fitted design surface in actual pixels (design.w * scale). */
  readonly scaledWidth: number;
  /** Height of the fitted design surface in actual pixels (design.h * scale). */
  readonly scaledHeight: number;
}

/**
 * Compute the aspect-preserving, centered "contain" fit of a `design` surface
 * into an `actual` viewport (Req 26.10-26.12).
 *
 * The scale is the largest uniform factor that keeps the whole design surface
 * visible: `min(actual.w / design.w, actual.h / design.h)`. The fitted surface
 * is centered, so the axis with slack gets equal letterbox bars and the tight
 * axis gets a zero offset.
 *
 * Guards: non-finite or non-positive `design` dimensions fall back to scale 0
 * (nothing to fit); a non-positive `actual` dimension clamps that axis's scale
 * contribution to 0 so the result stays finite. When `actual === design`, the
 * result is scale 1 with zero offsets.
 */
export function computeLayout(design: Size, actual: Size): AdaptiveLayout {
  // A degenerate design surface has no defined fit — return an empty layout
  // rather than dividing by zero.
  if (
    !isFinitePositive(design.width) ||
    !isFinitePositive(design.height)
  ) {
    return { scale: 0, offsetX: 0, offsetY: 0, scaledWidth: 0, scaledHeight: 0 };
  }

  const availW = isFinitePositive(actual.width) ? actual.width : 0;
  const availH = isFinitePositive(actual.height) ? actual.height : 0;

  const scaleX = availW / design.width;
  const scaleY = availH / design.height;
  // Uniform scale = the tighter axis; this is the "contain" fit that preserves
  // aspect ratio and never stretches (one factor drives both axes).
  const scale = Math.min(scaleX, scaleY);

  const scaledWidth = design.width * scale;
  const scaledHeight = design.height * scale;

  // Center the fitted surface: half the leftover space on each side. The tight
  // axis has (avail - scaled) == 0, so its offset is 0; the slack axis splits
  // its remainder into equal bars.
  const offsetX = (availW - scaledWidth) / 2;
  const offsetY = (availH - scaledHeight) / 2;

  return { scale, offsetX, offsetY, scaledWidth, scaledHeight };
}

/**
 * Map a point from DESIGN space into ACTUAL screen space under `layout`:
 * `actual = design * scale + offset`. Repositions AND rescales proportionally
 * (Req 26.10, 26.12).
 */
export function mapPoint(point: Point, layout: AdaptiveLayout): Point {
  return {
    x: point.x * layout.scale + layout.offsetX,
    y: point.y * layout.scale + layout.offsetY,
  };
}

/**
 * Map a rectangle from DESIGN space into ACTUAL screen space under `layout`:
 * the top-left corner is mapped like a point and the size is scaled by the same
 * uniform factor, so the rect repositions AND rescales without stretching
 * (Req 26.10-26.12).
 */
export function mapRect(rect: LayoutRect, layout: AdaptiveLayout): LayoutRect {
  return {
    x: rect.x * layout.scale + layout.offsetX,
    y: rect.y * layout.scale + layout.offsetY,
    width: rect.width * layout.scale,
    height: rect.height * layout.scale,
  };
}

/** True for a real, finite, strictly-positive dimension. */
function isFinitePositive(n: number): boolean {
  return Number.isFinite(n) && n > 0;
}

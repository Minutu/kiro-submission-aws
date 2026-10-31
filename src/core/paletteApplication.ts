// Feature: kino-game
//
// The PURE, Phaser-free PALETTE APPLICATION / OVERLAY RESOLVER (task 12.2c;
// design: "Visual Direction"; Req 27.13-27.14, 38.3-38.6). This is the single
// source of truth for the ELEMENT-LEVEL color treatment each World applies to
// its three render targets — the background, the obstacles, and Kino — plus the
// overlay/tint defaults declared in the Config_File (Req 38.3).
//
// WHY PURE: a World's Color_Palette is element-level, not background-only
// (Req 27.13-27.14): background, obstacles, and Kino each carry a base color,
// and zero or more OVERLAYS composite a tint on top of a TARGET under a gate
// condition. The GameplayScene (engine) renders the result, but the DECISION of
// which overlays are active for a given render context, how they composite onto
// each target, and the ATOMIC obstacles+kino coupling (Req 38.4-38.6) is pure
// color/boolean logic that must be deterministic and unit-testable without a
// browser or canvas. So that logic lives here; the engine only applies it.
//
// KEY CONTRACTS (Req 38.4-38.7):
//   - An overlay applies ONLY when its `appliesWhen` gate is active in the
//     render context, or ALWAYS when it declares no gate (Req 38.4, 38.7).
//   - The atomic "obstacles+kino" overlay (World 4's underwater blue) applies
//     to obstacles AND Kino TOGETHER — both or neither — so the resolver emits
//     the SAME overlay state for both targets; it is REMOVED from both the
//     instant its gate goes false (Req 38.4-38.6). Modeling it as one shared
//     target resolution guarantees the two can never fall out of sync.
//
// Color compositing (hex parse + per-channel alpha blend) is deterministic and
// lives here too so the engine and tests share one implementation.
//
// HARD RULE (enforced by test/boundary.core-no-phaser.test.ts): no `phaser`
// import, directly or transitively. Pure data + pure functions only.

import type { ColorPalette, PaletteOverlay } from '../config/index.ts';

/**
 * The three element-level targets a Color_Palette treats independently
 * (Req 27.13-27.14). An overlay's `target` string is one of these, or the
 * ATOMIC pair token {@link ATOMIC_OBSTACLES_KINO_TARGET}.
 */
export type PaletteTarget = 'background' | 'obstacles' | 'kino';

/** The three element-level targets, in a stable order. */
export const PALETTE_TARGETS: readonly PaletteTarget[] = ['background', 'obstacles', 'kino'];

/**
 * The ATOMIC overlay target token: an overlay with this `target` tints
 * obstacles AND Kino TOGETHER (both or neither), never one without the other
 * (Req 38.4). The config declares World 4's `underwaterBlue` with this target.
 */
export const ATOMIC_OBSTACLES_KINO_TARGET = 'obstacles+kino';

/**
 * The render context: which gate conditions are currently active. An overlay
 * whose `appliesWhen` names a key that is `true` here is active; an overlay
 * with no `appliesWhen` is ALWAYS active regardless of context (Req 38.4,
 * 38.7). e.g. `{ underwaterSequence: true }` activates World 4's underwater
 * blue overlay. A missing/false key means the gate is NOT active.
 */
export type RenderContext = Readonly<Record<string, boolean>>;

/** A resolved RGB color as its three 0..255 channel components. */
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/**
 * One overlay as it applies to a target: the overlay's identity plus its
 * resolved tint color and alpha. The engine composites `tint` over the
 * target's base color at `alpha`. Kept as the parsed {@link Rgb} tint plus the
 * original hex so the engine can use whichever it prefers.
 */
export interface ResolvedOverlay {
  /** The overlay's config name (e.g. "underwaterBlue", "lavaGlow"). */
  name: string;
  /** The overlay's declared target token (e.g. "background", "obstacles+kino"). */
  target: string;
  /** The overlay tint as a parsed RGB color. */
  tint: Rgb;
  /** The overlay tint as its original hex string (e.g. "#1E6FB0"). */
  tintHex: string;
  /** Overlay alpha, clamped to [0,1]. */
  alpha: number;
}

/**
 * The resolved treatment for ONE element target: its base element color plus
 * the ORDERED list of active overlays to composite on top (first→last). The
 * {@link color} is the final composited RGB (base with every active overlay
 * blended in order) for callers that want a single flat color; {@link overlays}
 * is the raw active-overlay list for callers (like the engine) that composite
 * onto live art themselves.
 */
export interface TargetTreatment {
  /** The target's base element color from the palette (parsed). */
  base: Rgb;
  /** The base color's original hex string. */
  baseHex: string;
  /** Active overlays to composite on `base`, in application order. */
  overlays: ResolvedOverlay[];
  /** `base` with every active overlay composited in order — the final color. */
  color: Rgb;
}

/**
 * The full resolved palette application for a World in a render context: one
 * {@link TargetTreatment} per element target (Req 27.13-27.14). The atomic
 * obstacles+kino overlay, when active, appears IDENTICALLY in BOTH
 * `obstacles.overlays` and `kino.overlays` (Req 38.4); when its gate is false
 * it is absent from both (Req 38.5-38.6).
 */
export interface PaletteApplication {
  background: TargetTreatment;
  obstacles: TargetTreatment;
  kino: TargetTreatment;
}

/** Clamp a value into [0,1]; non-finite => 0. */
function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Clamp/round a channel value into an integer in [0,255]. */
function clampChannel(v: number): number {
  if (!Number.isFinite(v)) return 0;
  const r = Math.round(v);
  if (r < 0) return 0;
  if (r > 255) return 255;
  return r;
}

/**
 * Parse a `#RRGGBB` (or `RRGGBB`) hex color into an {@link Rgb}. Tolerates a
 * missing leading `#` and surrounding whitespace; a malformed value degrades to
 * black so the resolver can never produce NaN channels. PURE and deterministic.
 */
export function parseHexColor(hex: string): Rgb {
  const cleaned = (hex ?? '').replace('#', '').trim();
  const parsed = Number.parseInt(cleaned, 16);
  if (!Number.isFinite(parsed) || Number.isNaN(parsed) || cleaned.length < 6) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: (parsed >> 16) & 0xff,
    g: (parsed >> 8) & 0xff,
    b: parsed & 0xff,
  };
}

/** Render an {@link Rgb} back to an uppercase `#RRGGBB` hex string. PURE. */
export function rgbToHex(rgb: Rgb): string {
  const r = clampChannel(rgb.r);
  const g = clampChannel(rgb.g);
  const b = clampChannel(rgb.b);
  const n = (r << 16) | (g << 8) | b;
  return `#${n.toString(16).toUpperCase().padStart(6, '0')}`;
}

/**
 * Alpha-composite `overlay` over `base` at `alpha` in [0,1] — per-channel
 * linear interpolation, `out = base + (overlay - base) * alpha`. Deterministic
 * and exact at the endpoints: `alpha` 0 returns `base` UNCHANGED (no tint) and
 * `alpha` 1 returns `overlay` (full tint) — the two boundary contracts the
 * engine relies on for "overlay removed" vs "overlay fully applied" (Req
 * 38.5-38.6). PURE; non-finite `alpha` degrades to 0 (no change).
 */
export function compositeColor(base: Rgb, overlay: Rgb, alpha: number): Rgb {
  const a = clamp01(alpha);
  return {
    r: clampChannel(base.r + (overlay.r - base.r) * a),
    g: clampChannel(base.g + (overlay.g - base.g) * a),
    b: clampChannel(base.b + (overlay.b - base.b) * a),
  };
}

/**
 * Is this overlay ACTIVE in the given render context? An overlay with no
 * `appliesWhen` gate is ALWAYS active; a gated overlay is active ONLY when its
 * gate key is `true` in the context (a missing or false key => inactive). This
 * is the single gate predicate behind Req 38.4/38.7. PURE.
 */
export function isOverlayActive(overlay: PaletteOverlay, context: RenderContext): boolean {
  if (overlay.appliesWhen === undefined || overlay.appliesWhen === '') return true;
  return context[overlay.appliesWhen] === true;
}

/** Resolve a config overlay to the parsed {@link ResolvedOverlay} shape. */
function resolveOverlay(overlay: PaletteOverlay): ResolvedOverlay {
  return {
    name: overlay.name,
    target: overlay.target,
    tint: parseHexColor(overlay.tint),
    tintHex: overlay.tint,
    alpha: clamp01(overlay.alpha),
  };
}

/**
 * Does this overlay's `target` apply to the given element target? A plain
 * target matches by equality; the ATOMIC `obstacles+kino` token matches BOTH
 * `obstacles` AND `kino` so an atomic overlay resolves identically for the two
 * (Req 38.4). The `background` target never matches the atomic pair. PURE.
 */
function overlayAppliesToTarget(overlayTarget: string, target: PaletteTarget): boolean {
  if (overlayTarget === ATOMIC_OBSTACLES_KINO_TARGET) {
    return target === 'obstacles' || target === 'kino';
  }
  return overlayTarget === target;
}

/**
 * List the overlays ACTIVE for a render context, in config order (Req 38.4).
 * An overlay is included when {@link isOverlayActive} holds for it; a gated
 * overlay is omitted when its gate is inactive. The returned list drives both
 * the per-target resolution and any engine-side "what is active now" query so
 * there is ONE active-set definition. PURE and deterministic.
 */
export function activeOverlays(
  palette: ColorPalette,
  context: RenderContext,
): ResolvedOverlay[] {
  const out: ResolvedOverlay[] = [];
  for (const overlay of palette.overlays) {
    if (isOverlayActive(overlay, context)) out.push(resolveOverlay(overlay));
  }
  return out;
}

/**
 * Resolve ONE element target's treatment: its base palette color plus the
 * active overlays whose target matches this element, composited in config order
 * (Req 27.13-27.14, 38.3-38.4). The atomic obstacles+kino overlay matches BOTH
 * obstacles and kino, so calling this for each yields the SAME overlay state on
 * both — the atomic coupling (Req 38.4). PURE.
 */
function resolveTarget(
  baseHex: string,
  target: PaletteTarget,
  active: readonly ResolvedOverlay[],
): TargetTreatment {
  const base = parseHexColor(baseHex);
  const overlays = active.filter((o) => overlayAppliesToTarget(o.target, target));
  let color = base;
  for (const o of overlays) color = compositeColor(color, o.tint, o.alpha);
  return { base, baseHex, overlays, color };
}

/**
 * Resolve a World's full element-level palette application for a render context
 * (Req 27.13-27.14, 38.3-38.6). Returns the background / obstacles / Kino
 * treatments, each with its base element color and the ordered active overlays
 * composited on top. The overlay/tint DEFAULTS come straight from the World's
 * ColorPalette (Req 38.3). The atomic obstacles+kino overlay resolves
 * IDENTICALLY into both `obstacles` and `kino` when its gate is active, and is
 * absent from both when it is not (Req 38.4-38.6). PURE and deterministic — the
 * same palette + context always yields the same application.
 */
export function resolvePaletteApplication(
  palette: ColorPalette,
  context: RenderContext = {},
): PaletteApplication {
  const active = activeOverlays(palette, context);
  return {
    background: resolveTarget(palette.background, 'background', active),
    obstacles: resolveTarget(palette.obstacles, 'obstacles', active),
    kino: resolveTarget(palette.kino, 'kino', active),
  };
}

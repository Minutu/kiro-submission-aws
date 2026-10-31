// Feature: kino-game
//
// PURE binding vocabulary + parse — the SINGLE SOURCE OF TRUTH for how a stored
// control-binding string is classified into a device (keyboard vs mouse) and
// the mouse-button vocabulary the stored `MOUSE_*` tokens draw from (Req
// 1.2-1.5, 22.7).
//
// WHY THIS LIVES IN src/core: the binding-string classification is pure and
// Phaser-free, and the task-9.7 Settings_Screen rebinding LOGIC (also pure,
// also in core) needs it to classify a captured control and to NAME a
// conflicting control in a rejection message (Req 1.7). The core↔engine
// boundary forbids core importing from `src/engine/**`, so the parse moved HERE
// and `src/engine/input/bindings.ts` RE-EXPORTS it as a shim — exactly how task
// 8.3 relocated the Animation_Frame keys into `src/core/animationFrames.ts` and
// re-exported them from `src/engine/render/cosmeticAnchors.ts`. Every existing
// importer of `src/engine/input/bindings.ts` keeps working unchanged.

/** A binding string resolves to one of these device kinds. */
export type BindingKind = 'keyboard' | 'mouse';

/** Mouse buttons we recognize, matched to Phaser pointer button indices. */
export type MouseButton = 'left' | 'right' | 'middle';

/** Parsed form of a single binding string. */
export type ParsedBinding =
  | { kind: 'keyboard'; /** Phaser KeyCodes key name, e.g. "SPACE", "Q". */ key: string }
  | { kind: 'mouse'; button: MouseButton };

/**
 * The two logical actions the player can trigger. Both the keyboard and the
 * mouse binding for a group map onto the same action, identically (Req 1.2-1.5).
 */
export type InputAction = 'primary' | 'skill';

/**
 * The mouse-binding vocabulary. Stored strings use the `MOUSE_*` prefix so a
 * binding is unambiguously a pointer button and never collides with a key name.
 */
export const MOUSE_TOKENS: Record<string, MouseButton> = {
  MOUSE_LEFT: 'left',
  MOUSE_RIGHT: 'right',
  MOUSE_MIDDLE: 'middle',
};

/** Phaser pointer button index for each recognized mouse button. */
export const MOUSE_BUTTON_INDEX: Record<MouseButton, number> = {
  left: 0,
  middle: 1,
  right: 2,
};

/**
 * Canonicalize a binding token to the stored UPPERCASE, trimmed form (matching
 * the defaults and Phaser KeyCodes names). Returns `''` for empty / non-string
 * input so callers can reject it. This is the one place that decides what two
 * binding strings count as the SAME physical control, so the conflict check
 * (Req 1.7) and the parser agree on equality.
 */
export function canonicalizeBinding(token: string): string {
  if (typeof token !== 'string') return '';
  return token.trim().toUpperCase();
}

/**
 * Parse one binding string into its device-classified form, or `null` if the
 * token is empty or unrecognized. Parsing is case-insensitive and trims
 * surrounding whitespace so hand-edited saves stay forgiving; the canonical
 * stored form is UPPERCASE (matching the defaults and Phaser KeyCodes names).
 *
 * Any `MOUSE_*` token classifies as a mouse button; every other non-empty token
 * is treated as a keyboard key name (e.g. "SPACE", "Q", "ENTER"). We do not
 * validate the key against Phaser's KeyCodes table here — unknown key names
 * simply never fire, which is harmless and keeps this module Phaser-free. The
 * Settings_Screen rebinding UI (task 9.7) is responsible for only offering
 * valid, conflict-free keys.
 */
export function parseBinding(token: string): ParsedBinding | null {
  const normalized = canonicalizeBinding(token);
  if (normalized === '') return null;

  const mouse = MOUSE_TOKENS[normalized];
  if (mouse !== undefined) {
    return { kind: 'mouse', button: mouse };
  }
  return { kind: 'keyboard', key: normalized };
}

/**
 * Parse an array of binding strings for one action, dropping any that fail to
 * parse. Duplicate parses (e.g. the same key listed twice) are collapsed so a
 * malformed save cannot register two handlers for the same physical control.
 */
export function parseBindings(tokens: readonly string[]): ParsedBinding[] {
  const seen = new Set<string>();
  const out: ParsedBinding[] = [];
  for (const token of tokens ?? []) {
    const parsed = parseBinding(token);
    if (!parsed) continue;
    const dedupeKey =
      parsed.kind === 'mouse' ? `mouse:${parsed.button}` : `key:${parsed.key}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    out.push(parsed);
  }
  return out;
}

/** The parsed bindings for both actions, derived from a Save_Store snapshot. */
export interface ParsedControlBindings {
  primary: ParsedBinding[];
  skill: ParsedBinding[];
}

/** The shape read from `save.controlBindings` (mirrors ControlBindings). */
export interface ControlBindingsInput {
  primary: readonly string[];
  skill: readonly string[];
}

/**
 * Parse a whole `controlBindings` block (as read from the Save_Store) into the
 * device-classified bindings `InputManager` attaches handlers for. Pure: given
 * the same strings it always yields the same parse, so a test can assert the
 * mapping without any Phaser scene.
 */
export function parseControlBindings(
  bindings: ControlBindingsInput,
): ParsedControlBindings {
  return {
    primary: parseBindings(bindings.primary),
    skill: parseBindings(bindings.skill),
  };
}

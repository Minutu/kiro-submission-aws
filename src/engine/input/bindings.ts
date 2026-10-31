// Feature: kino-game
//
// Binding parsing + the per-frame input-intent model (task 4.3).
//
// SINGLE SOURCE OF TRUTH FOR THE BINDING VOCABULARY + PARSE: the `BindingKind`
// / `MouseButton` / `ParsedBinding` / `InputAction` types, the `MOUSE_*` token
// vocabulary, `MOUSE_BUTTON_INDEX`, and the `parseBinding` / `parseBindings` /
// `parseControlBindings` functions now live in the PURE core module
// `src/core/bindings.ts` so the task-9.7 Settings_Screen rebinding LOGIC (also
// pure, also in core) can classify a captured control and NAME a conflicting
// control in a rejection message (Req 1.7) without reaching into `src/engine/**`
// (the core↔engine boundary forbids that). This file RE-EXPORTS them so every
// existing importer (`InputManager`, the input barrel, inputBindings.unit.test)
// keeps importing the parse from here unchanged — same discipline as task 8.3's
// `cosmeticAnchors.ts` re-export of the core Animation_Frame keys.
//
// This module stays Phaser-free so the parse and the intent edge-trigger logic
// can be unit-tested in plain Node without a canvas. The Phaser wiring that
// turns live key/pointer events into these intents lives in `InputManager.ts`.
//
// Control bindings are stored in the Save_Store as plain strings (design
// `controlBindings`, Req 1.6-1.9, 22.7):
//
//   primary: ["SPACE", "MOUSE_LEFT"]   // Req 1.2 (spacebar) + 1.3 (left mouse)
//   skill:   ["Q",     "MOUSE_RIGHT"]  // Req 1.5 (Q key)   + 1.4 (right mouse)
//
// Both bindings in a group trigger the SAME action identically (Req 1.2-1.5).

import {
  type BindingKind,
  type MouseButton,
  type ParsedBinding,
  type InputAction,
  type ParsedControlBindings,
  type ControlBindingsInput,
  MOUSE_TOKENS,
  MOUSE_BUTTON_INDEX,
  canonicalizeBinding,
  parseBinding,
  parseBindings,
  parseControlBindings,
} from '../../core/bindings.ts';

// Re-export the pure binding surface so existing importers of this module are
// unchanged — the public API (types + functions) is preserved verbatim.
export {
  type BindingKind,
  type MouseButton,
  type ParsedBinding,
  type InputAction,
  type ParsedControlBindings,
  type ControlBindingsInput,
  MOUSE_TOKENS,
  MOUSE_BUTTON_INDEX,
  canonicalizeBinding,
  parseBinding,
  parseBindings,
  parseControlBindings,
};

// ---------------------------------------------------------------------------
// Per-frame intent model
//
// This stays in the engine input layer (it is the frame-boundary edge model the
// Phaser `InputManager` produces), not in core — core has no notion of a
// rendered frame.
// ---------------------------------------------------------------------------

/**
 * The edge-triggered input snapshot the fixed-step loop reads each rendered
 * frame (Req 26.2: respond within one rendered frame). `*Pressed` is true when
 * the action was newly pressed since the last frame boundary — a rising edge —
 * so a single physical press produces exactly one primary/skill action no
 * matter how many fixed sub-steps run that frame.
 */
export interface InputIntents {
  /** Primary action newly pressed this frame (spacebar / left mouse, Req 1.2-1.3). */
  primaryPressed: boolean;
  /** Skill activation newly pressed this frame (Q / right mouse, Req 1.4-1.5). */
  skillPressed: boolean;
}

/** An all-false intent snapshot (no input this frame). */
export function emptyIntents(): InputIntents {
  return { primaryPressed: false, skillPressed: false };
}

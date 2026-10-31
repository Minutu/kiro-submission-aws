// Feature: kino-game
//
// CinematicSequence — the PURE, Phaser-free, config-driven player STATE machine
// behind every scripted cinematic (task 10.1; design: "Cinematics System (Req
// 21, 29, 42)" → "CinematicScene plays scripted, skippable sequences driven by
// config-supplied content"; Req 21.3, 21.18, 21.21).
//
// This is the reusable SEQUENCING heart the Phaser `CinematicScene`
// (src/engine/scenes/CinematicScene.ts) defers to: given an ordered array of
// Comic_Panel descriptors (the CONTENT comes from the Config_File / the specific
// cinematic tasks 10.2–10.5), it exposes a deterministic panel-by-panel player —
// `current()`, `advance()`, `skip()`, `isComplete()`, `index`. It owns NO
// rendering, timing, or input; it is a plain state machine over a panels array
// so the sequencing logic is unit-testable in plain Node with no browser,
// canvas, or DOM (the core↔engine boundary, Req 26.6).
//
// HARD RULE: no module under `src/core/**` may import `phaser` (see
// `src/README.md`); this module imports nothing Phaser-adjacent.

/**
 * A single Comic_Panel descriptor — the comic-book-style framed illustration a
 * cinematic advances through panel-by-panel (Req 21.21; glossary "Comic_Panel":
 * "A single framed illustration shown during a cinematic").
 *
 * This is the MINIMAL, generic shape the player sequences over. The specific
 * cinematics (opening egg-descent 10.2, mentor cutscene 10.3, world-completion
 * 10.4, final/credits 10.5) and the Config_File populate the actual content;
 * every field except an identifying/key hint is optional so a caller can drive
 * the player from as little as `[{}, {}, {}]` (three blank panels) while the
 * content tasks fill in captions, art, and layout. Keeping it open-ended keeps
 * this framework config-agnostic — it never inspects the fields, it only walks
 * the array.
 */
export interface CinematicPanel {
  /**
   * Optional stable id for a panel (useful for tests, analytics, or a specific
   * cinematic to key rendering off). The player never requires it.
   */
  readonly id?: string;
  /**
   * Optional Asset_Registry key for the panel's framed illustration. Resolved
   * (placeholder-friendly) by the engine scene, never by this pure player.
   */
  readonly imageKey?: string;
  /** Optional caption / narration text shown with the panel (comic-book style). */
  readonly caption?: string;
  /**
   * Optional free-form content bag the specific cinematics (10.2–10.5) attach
   * their own data to (speaker-swap layout, band index, egg label, ...). The
   * player treats it as opaque.
   */
  readonly data?: Readonly<Record<string, unknown>>;
}

/** Back-compat / design-vocabulary alias for a Comic_Panel. */
export type ComicPanel = CinematicPanel;

/**
 * The pure cinematic player — a config-driven, SKIPPABLE, panel-by-panel state
 * machine over a fixed `panels` array (Req 21.3, 21.18, 21.21).
 *
 * Semantics:
 *   - Starts positioned on panel 0 (`index === 0`) for a non-empty sequence.
 *   - `advance()` steps to the next panel in order and returns it, or returns
 *     `'done'` and marks the player complete when it steps past the last panel.
 *   - `skip()` immediately completes from ANY index (the single skippable
 *     affordance shared by every cinematic — Req 21.3, 21.18, 21.21).
 *   - Advancing past the end (or advancing/skipping once already complete) is a
 *     no-op that stays complete (idempotent) — a double input never under/over
 *     runs the sequence.
 *   - An EMPTY panels array is immediately complete (`current()` is `null`), so
 *     a generic/empty cinematic plays nothing and hands straight back — exactly
 *     what BootScene's first-boot routing needs before the opening-cinematic
 *     CONTENT (task 10.2) exists.
 */
export interface CinematicPlayer {
  /** The current panel, or `null` when the sequence is empty or complete. */
  current(): CinematicPanel | null;
  /**
   * Advance to the next panel. Returns the new current panel, or the string
   * `'done'` once the sequence has run past its last panel (and on every call
   * thereafter). Idempotent once complete.
   */
  advance(): CinematicPanel | 'done';
  /**
   * Skip the rest of the sequence — complete immediately from any index
   * (Req 21.3, 21.18, 21.21). Idempotent.
   */
  skip(): void;
  /** Whether the sequence has finished (walked to the end or been skipped). */
  isComplete(): boolean;
  /**
   * The current 0-based panel index. For a running sequence this is in
   * `[0, length)`; once complete it is `length` (past the last panel), and for
   * an empty sequence it is `0` (== length) and the player is already complete.
   */
  readonly index: number;
  /** The total number of panels in the sequence (never changes). */
  readonly length: number;
}

/**
 * Create a pure cinematic player over a snapshot of `panels`.
 *
 * The panels array is COPIED defensively so later caller mutation cannot change
 * the player's sequence mid-play (determinism). The player holds only a cursor
 * (`index`) and a `complete` latch; it never mutates the panels themselves.
 *
 * @param panels Ordered Comic_Panel descriptors (from the Config_File / the
 *   specific cinematic task). An empty array yields an already-complete player.
 */
export function createCinematicPlayer(
  panels: readonly CinematicPanel[] = [],
): CinematicPlayer {
  // Defensive snapshot: freeze a copy so the sequence is immutable for the
  // player's lifetime regardless of what the caller does with the input array.
  const seq: readonly CinematicPanel[] = Object.freeze([...panels]);
  const length = seq.length;

  // Cursor into `seq`. For a non-empty sequence it starts at 0 (panel 0). An
  // empty sequence starts at 0 which already equals `length`, i.e. complete.
  let index = 0;
  // One-way completion latch: set when we walk past the last panel or skip.
  let complete = length === 0;

  const current = (): CinematicPanel | null => {
    if (complete || index >= length) return null;
    return seq[index] ?? null;
  };

  const advance = (): CinematicPanel | 'done' => {
    // Already finished (end reached or skipped): stay complete, report done.
    if (complete) return 'done';

    // Step to the next panel.
    index += 1;

    if (index >= length) {
      // Walked past the last panel — the sequence is now complete.
      index = length;
      complete = true;
      return 'done';
    }
    return seq[index] as CinematicPanel;
  };

  const skip = (): void => {
    // Complete immediately from any index (Req 21.3, 21.18, 21.21). Park the
    // cursor at the end so `index` reads consistently as `length` when complete.
    complete = true;
    index = length;
  };

  const isComplete = (): boolean => complete;

  return {
    current,
    advance,
    skip,
    isComplete,
    get index() {
      return index;
    },
    get length() {
      return length;
    },
  };
}

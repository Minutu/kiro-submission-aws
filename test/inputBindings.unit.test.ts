// Feature: kino-game
//
// UNIT tests for the task-4.3 PURE binding parser + intent model (bindings.ts).
// Covers the binding-string vocabulary the InputManager attaches handlers from,
// without needing a live Phaser scene:
//   - SPACE / Q classify as keyboard keys (Req 1.2, 1.5).
//   - MOUSE_LEFT / MOUSE_RIGHT classify as mouse buttons (Req 1.3, 1.4).
//   - The default Save_Store bindings parse to the expected primary/skill split.
//   - Parsing is forgiving (case/whitespace) and dedupes, and the mouse button
//     indices match Phaser's left/middle/right ordering.
//
// Pure TypeScript, no Phaser — matches the saveState seam discipline so the
// parse stays framework-free and task 9.7's rebinding UI can reuse it.

import { describe, it, expect } from 'vitest';
import {
  parseBinding,
  parseBindings,
  parseControlBindings,
  emptyIntents,
  MOUSE_BUTTON_INDEX,
} from '../src/engine/input/bindings.ts';
import { DEFAULT_CONTROL_BINDINGS } from '../src/engine/saveState.ts';

describe('parseBinding (Req 1.2-1.5)', () => {
  it('classifies SPACE and Q as keyboard keys', () => {
    expect(parseBinding('SPACE')).toEqual({ kind: 'keyboard', key: 'SPACE' });
    expect(parseBinding('Q')).toEqual({ kind: 'keyboard', key: 'Q' });
  });

  it('classifies MOUSE_LEFT / MOUSE_RIGHT / MOUSE_MIDDLE as mouse buttons', () => {
    expect(parseBinding('MOUSE_LEFT')).toEqual({ kind: 'mouse', button: 'left' });
    expect(parseBinding('MOUSE_RIGHT')).toEqual({ kind: 'mouse', button: 'right' });
    expect(parseBinding('MOUSE_MIDDLE')).toEqual({ kind: 'mouse', button: 'middle' });
  });

  it('is case-insensitive and trims whitespace, normalizing to uppercase', () => {
    expect(parseBinding('  space ')).toEqual({ kind: 'keyboard', key: 'SPACE' });
    expect(parseBinding('mouse_right')).toEqual({ kind: 'mouse', button: 'right' });
  });

  it('returns null for empty / non-string tokens', () => {
    expect(parseBinding('')).toBeNull();
    expect(parseBinding('   ')).toBeNull();
    // @ts-expect-error exercising the runtime guard for non-string input
    expect(parseBinding(undefined)).toBeNull();
  });
});

describe('parseBindings', () => {
  it('drops unparseable tokens and dedupes repeated controls', () => {
    const parsed = parseBindings(['SPACE', '', 'SPACE', 'MOUSE_LEFT', 'mouse_left']);
    expect(parsed).toEqual([
      { kind: 'keyboard', key: 'SPACE' },
      { kind: 'mouse', button: 'left' },
    ]);
  });
});

describe('parseControlBindings (default Save_Store bindings)', () => {
  it('splits the default bindings into primary = SPACE + left mouse, skill = Q + right mouse', () => {
    const parsed = parseControlBindings(DEFAULT_CONTROL_BINDINGS);
    // Primary: spacebar (Req 1.2) + left mouse (Req 1.3) — identical effect.
    expect(parsed.primary).toEqual([
      { kind: 'keyboard', key: 'SPACE' },
      { kind: 'mouse', button: 'left' },
    ]);
    // Skill: Q (Req 1.5) + right mouse (Req 1.4) — identical effect.
    expect(parsed.skill).toEqual([
      { kind: 'keyboard', key: 'Q' },
      { kind: 'mouse', button: 'right' },
    ]);
  });

  it('reflects rebound strings so task 9.7 only needs to rewrite bindings', () => {
    const parsed = parseControlBindings({
      primary: ['ENTER', 'MOUSE_LEFT'],
      skill: ['SHIFT', 'MOUSE_RIGHT'],
    });
    expect(parsed.primary[0]).toEqual({ kind: 'keyboard', key: 'ENTER' });
    expect(parsed.skill[0]).toEqual({ kind: 'keyboard', key: 'SHIFT' });
  });
});

describe('mouse button indices (Phaser ordering)', () => {
  it('maps left=0, middle=1, right=2', () => {
    expect(MOUSE_BUTTON_INDEX).toEqual({ left: 0, middle: 1, right: 2 });
  });
});

describe('emptyIntents', () => {
  it('is an all-false per-frame snapshot', () => {
    expect(emptyIntents()).toEqual({ primaryPressed: false, skillPressed: false });
  });
});

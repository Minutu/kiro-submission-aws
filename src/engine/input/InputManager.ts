// Feature: kino-game
//
// InputManager — the Phaser input → intent translator (task 4.3).
//
// Responsibility (and ONLY this): turn live keyboard/pointer presses into the
// two logical actions — primary (Req 1.2 spacebar, 1.3 left mouse) and skill
// (Req 1.4 right mouse, 1.5 Q) — and expose them as edge-triggered "just
// pressed this frame" intents the GameplayScene's fixed-step loop reads so it
// responds within one rendered frame (Req 26.2). It is intentionally decoupled
// from gameplay: it knows nothing about Movement_Modes, skills, or scoring. It
// produces intent; GameplayScene (task 4.6) decides what the intent means.
//
// Bindings are READ from the Save_Store (`save.controlBindings`, Req 1.6-1.9)
// and classified by the pure parser in `bindings.ts`, so every control is
// already rebindable: task 9.7's settings UI only needs to rewrite those
// strings and rebuild an InputManager (or call `rebind`). Conflict detection
// and the rebinding UI itself are explicitly out of scope here (task 9.7).
//
// Edge-trigger model: a key/pointer "down" sets a pending flag. The flag is
// cleared when the loop consumes it (`consumePrimaryPressed` / snapshot +
// `clearFrame`), so one physical press yields exactly one action regardless of
// how many fixed sub-steps the driver runs that frame. Holding the button does
// NOT auto-repeat — it must be released and pressed again, matching a classic
// one-button arcade feel (Req 1 user story).
//
// ENGINE layer: importing Phaser here is allowed (src/README.md).

import Phaser from 'phaser';
import {
  parseControlBindings,
  MOUSE_BUTTON_INDEX,
  emptyIntents,
  type ControlBindingsInput,
  type InputAction,
  type InputIntents,
  type MouseButton,
  type ParsedBinding,
  type ParsedControlBindings,
} from './bindings.ts';

export type { InputIntents, InputAction } from './bindings.ts';

/** Minimal view of `save.controlBindings` the manager needs. */
export type InputBindingsSource = ControlBindingsInput;

/**
 * Attaches primary/skill input handling to a single Phaser.Scene, reading its
 * bindings from the Save_Store. Create one per gameplay scene, read its intents
 * each frame, and `destroy()` it (or rely on the scene `shutdown` hook) when the
 * scene ends.
 */
export class InputManager {
  private readonly scene: Phaser.Scene;

  /** Device-classified bindings for both actions (from the Save_Store). */
  private bindings: ParsedControlBindings;

  /** Live Phaser key objects, kept so we can both poll and remove them. */
  private keyObjects: Phaser.Input.Keyboard.Key[] = [];

  /** Rising-edge pending flags, set on "down", cleared on consume. */
  private pendingPrimary = false;
  private pendingSkill = false;

  /** Bound pointer handler so add/remove use the same function reference. */
  private readonly onPointerDown: (pointer: Phaser.Input.Pointer) => void;

  /** Optional per-action callbacks (fired on the rising edge). */
  private primaryCallbacks: Array<() => void> = [];
  private skillCallbacks: Array<() => void> = [];

  private destroyed = false;

  /**
   * @param scene    The scene to attach to (its input/keyboard plugins are used).
   * @param bindings The Save_Store control bindings (`save.controlBindings`).
   */
  constructor(scene: Phaser.Scene, bindings: InputBindingsSource) {
    this.scene = scene;
    this.bindings = parseControlBindings(bindings);
    this.onPointerDown = (pointer) => this.handlePointerDown(pointer);

    this.attach();

    // Clean up automatically when the scene shuts down so a scene restart does
    // not leak duplicate listeners (Req: attach + clean up on shutdown).
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    scene.events.once(Phaser.Scenes.Events.DESTROY, this.destroy, this);
  }

  // -------------------------------------------------------------------------
  // Attach / detach
  // -------------------------------------------------------------------------

  private attach(): void {
    // Keyboard: register a Key object per keyboard binding and listen for its
    // rising edge. The keyboard plugin is absent in headless contexts, so guard.
    const keyboard = this.scene.input.keyboard;
    if (keyboard) {
      this.registerKeys('primary', this.bindings.primary, keyboard);
      this.registerKeys('skill', this.bindings.skill, keyboard);
    }

    // Mouse/pointer: a single POINTER_DOWN handler inspects which button fired
    // and matches it to the primary/skill mouse bindings. Right-click needs the
    // context menu suppressed (BootScene already did this; re-assert defensively).
    this.scene.input.mouse?.disableContextMenu();
    this.scene.input.on(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown);
  }

  private registerKeys(
    action: InputAction,
    bindings: readonly ParsedBinding[],
    keyboard: Phaser.Input.Keyboard.KeyboardPlugin,
  ): void {
    for (const binding of bindings) {
      if (binding.kind !== 'keyboard') continue;
      // addKey accepts a KeyCodes name like "SPACE" / "Q". Unknown names throw
      // in some Phaser versions, so guard so a hand-edited save can't break boot.
      let key: Phaser.Input.Keyboard.Key | undefined;
      try {
        key = keyboard.addKey(binding.key, /* enableCapture */ true, /* emitOnRepeat */ false);
      } catch {
        key = undefined;
      }
      if (!key) continue;
      key.on(Phaser.Input.Keyboard.Events.DOWN, () => this.trigger(action));
      this.keyObjects.push(key);
    }
  }

  private handlePointerDown(pointer: Phaser.Input.Pointer): void {
    const button = pointerButton(pointer);
    if (button === null) return;
    if (this.bindingMatchesMouse(this.bindings.primary, button)) {
      this.trigger('primary');
    }
    // Not `else`: in the (misconfigured) case the same button is bound to both,
    // both fire — the parser already dedupes within an action, and conflict
    // prevention across actions is task 9.7's job, not this translator's.
    if (this.bindingMatchesMouse(this.bindings.skill, button)) {
      this.trigger('skill');
    }
  }

  private bindingMatchesMouse(
    bindings: readonly ParsedBinding[],
    button: MouseButton,
  ): boolean {
    return bindings.some((b) => b.kind === 'mouse' && b.button === button);
  }

  // -------------------------------------------------------------------------
  // Edge trigger
  // -------------------------------------------------------------------------

  private trigger(action: InputAction): void {
    if (this.destroyed) return;
    if (action === 'primary') {
      this.pendingPrimary = true;
      for (const cb of this.primaryCallbacks) cb();
    } else {
      this.pendingSkill = true;
      for (const cb of this.skillCallbacks) cb();
    }
  }

  // -------------------------------------------------------------------------
  // Per-frame read API
  // -------------------------------------------------------------------------

  /**
   * Returns true at most once per physical press: true if primary was pressed
   * since the last consume, then clears the flag. This is the preferred read
   * path for the fixed-step loop — call it once per rendered frame and thread
   * the result into the driver's `inputs` (Req 26.2).
   */
  consumePrimaryPressed(): boolean {
    const pressed = this.pendingPrimary;
    this.pendingPrimary = false;
    return pressed;
  }

  /** Returns true at most once per skill press, then clears the flag. */
  consumeSkillPressed(): boolean {
    const pressed = this.pendingSkill;
    this.pendingSkill = false;
    return pressed;
  }

  /**
   * Non-consuming peek at both actions, then clears both flags. Use when the
   * loop wants a single immutable snapshot for the frame (e.g. to pass the same
   * `InputIntents` into every fixed sub-step this frame). Equivalent to calling
   * both `consume*` once and bundling the result.
   */
  snapshot(): InputIntents {
    return {
      primaryPressed: this.consumePrimaryPressed(),
      skillPressed: this.consumeSkillPressed(),
    };
  }

  /** Peek without clearing (diagnostics/tests). Prefer `snapshot`/`consume*`. */
  peek(): InputIntents {
    if (this.destroyed) return emptyIntents();
    return {
      primaryPressed: this.pendingPrimary,
      skillPressed: this.pendingSkill,
    };
  }

  /** Clear both pending flags without reading (e.g. on pause/resume reset). */
  clearFrame(): void {
    this.pendingPrimary = false;
    this.pendingSkill = false;
  }

  // -------------------------------------------------------------------------
  // Optional event-callback API
  // -------------------------------------------------------------------------

  /** Register a callback fired on each primary rising edge. Returns an unsubscribe. */
  onPrimary(cb: () => void): () => void {
    this.primaryCallbacks.push(cb);
    return () => {
      this.primaryCallbacks = this.primaryCallbacks.filter((c) => c !== cb);
    };
  }

  /** Register a callback fired on each skill rising edge. Returns an unsubscribe. */
  onSkill(cb: () => void): () => void {
    this.skillCallbacks.push(cb);
    return () => {
      this.skillCallbacks = this.skillCallbacks.filter((c) => c !== cb);
    };
  }

  // -------------------------------------------------------------------------
  // Rebinding seam (task 9.7) + teardown
  // -------------------------------------------------------------------------

  /**
   * Re-read bindings from an updated Save_Store block and re-attach handlers.
   * This is the SEAM for task 9.7: after the settings UI validates a rebind and
   * persists it, it calls `rebind(save.controlBindings)` to apply the new
   * controls live without recreating the scene. Pending presses are cleared so
   * a stale edge from the old binding cannot leak across the swap.
   */
  rebind(bindings: InputBindingsSource): void {
    if (this.destroyed) return;
    this.detachHandlers();
    this.bindings = parseControlBindings(bindings);
    this.clearFrame();
    this.attach();
  }

  /** The currently-applied parsed bindings (diagnostics/tests). */
  getBindings(): ParsedControlBindings {
    return { primary: [...this.bindings.primary], skill: [...this.bindings.skill] };
  }

  /** Remove all live handlers without tearing down the manager (used by rebind). */
  private detachHandlers(): void {
    for (const key of this.keyObjects) {
      key.removeAllListeners();
      this.scene.input.keyboard?.removeKey(key, /* destroy */ true);
    }
    this.keyObjects = [];
    this.scene.input.off(Phaser.Input.Events.POINTER_DOWN, this.onPointerDown);
  }

  /** Detach every handler and release references. Idempotent. */
  destroy(): void {
    if (this.destroyed) return;
    this.destroyed = true;
    this.detachHandlers();
    this.primaryCallbacks = [];
    this.skillCallbacks = [];
    this.scene.events.off(Phaser.Scenes.Events.SHUTDOWN, this.destroy, this);
    this.scene.events.off(Phaser.Scenes.Events.DESTROY, this.destroy, this);
  }
}

/** Map a Phaser pointer's active button to our MouseButton, or null if unmapped. */
function pointerButton(pointer: Phaser.Input.Pointer): MouseButton | null {
  for (const [name, index] of Object.entries(MOUSE_BUTTON_INDEX) as Array<
    [MouseButton, number]
  >) {
    if (pointer.button === index) return name;
  }
  return null;
}

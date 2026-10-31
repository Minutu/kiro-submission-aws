// Feature: kino-game
//
// Input mapping barrel (task 4.3).
//
// Public surface GameplayScene (task 4.6) uses to translate player input into
// the primary-action / skill-activation intents the fixed-step loop reads:
//
//   const input = new InputManager(this, getBootContext(this).save.controlBindings);
//   // each frame:
//   const intents = input.snapshot();          // edge-triggered this-frame booleans
//   // or: if (input.consumePrimaryPressed()) { ... }
//
// The pure parser/intent model is exported too so tests (and task 9.7's
// rebinding UI) can reason about binding strings without a Phaser scene.

export { InputManager } from './InputManager.ts';
export type { InputBindingsSource } from './InputManager.ts';

export {
  parseBinding,
  parseBindings,
  parseControlBindings,
  emptyIntents,
  MOUSE_BUTTON_INDEX,
} from './bindings.ts';
export type {
  BindingKind,
  MouseButton,
  ParsedBinding,
  ParsedControlBindings,
  ControlBindingsInput,
  InputAction,
  InputIntents,
} from './bindings.ts';

// Feature: kino-game
//
// Generation_Name composition (Req 32.1-32.2, 20.11, 20.15, 20.35) — re-export
// shim.
//
// The pure composition (`toRoman` + `formatGenerationName`) now lives in
// `src/core/generationTransition.ts`, alongside the generation-advance rule
// that reuses it (task 7.4). It stays Phaser-free there, so moving it into core
// keeps the roman-numeral + template logic unit-testable in plain Node AND lets
// the core generation-transition logic reuse ONE implementation without the
// engine depending on core-internal duplication.
//
// This module is kept as a thin re-export so every existing engine import
// (MainMenuScene's header pill, run-end, cinematic title cards) continues to
// work unchanged.

export { toRoman, formatGenerationName } from '../core/generationTransition.ts';

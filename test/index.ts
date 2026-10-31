// Feature: kino-game
//
// Test folder barrel.
//
// Property-based tests (fast-check, 100+ iterations each) and unit tests for the
// simulation core live here. Each property test is tagged:
//   // Feature: kino-game, Property {n}: {text}
//
// The test runner (Vitest, single-run via `npm test`) and the fast-check harness
// are wired up (task 1.3). A sample unit test (`sample.unit.test.ts`), a sample
// property test (`sample.property.test.ts`, 100+ iterations), and the automated
// core↔engine boundary check (`boundary.core-no-phaser.test.ts`) live alongside
// this barrel. This barrel marks the folder and documents the convention.

export {};

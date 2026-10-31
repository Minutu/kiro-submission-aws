---
inclusion: always
---

# KINO Coding Standards

Adapted for the KINO spec (Phaser 3 + TypeScript). These standards serve the architecture in `.kiro/specs/kino-game/design.md`. Where a generic game pattern would conflict with that design, the design wins.

## Language & project conventions

- TypeScript, strict mode. Prefer explicit types on public interfaces; let inference handle locals.
- Two layers, enforced:
  - `src/core/` — the pure simulation core. MUST NOT import `phaser`. Deterministic, unit/property testable.
  - `src/engine/` — Phaser scenes, renderers, input, audio. May import core; core never imports engine.
- No hardcoded tuning constants in gameplay logic. All numeric tunables come from the `BalanceTable` (fed by `Config_File.balance`). No magic numbers in physics/scoring/spawn code.
- No hardcoded asset paths or user-facing strings in gameplay logic. Resolve assets via `AssetRegistry.resolve(key)`; read names/labels from `Config_File`.

## Naming conventions

- Classes / types: PascalCase and aligned to the design's component names — `MovementStateMachine`, `SequenceDirector`, `ScoringSystem`, `CollisionSystem`, `SafeRepositionSolver`, `SkillSystem`, `PerkSystem`, `ProgressionSystem`, `SaveStore`, `AssetRegistry`, `BalanceTable`, `KinoRenderer`, `ParallaxBackground`, `ObstacleView`.
- Do NOT introduce competing names the design does not use (e.g. no `WallObstacle`, no monolithic `GameEngine`). Obstacles are the single `Obstacle` entity keyed by `Obstacle_Category`.
- Enums/union types: `MovementMode = "jumping" | "flight" | "zigzag" | "underwater"`. Use these exact string ids everywhere.
- Methods: camelCase verbs (`applyPrimary`, `requestTransition`, `spawnWindow`, `credit`, `reposition`).
- Config keys: keep the exact kebab-case Animation_Frame keys (`run-step-right`, `fly-apex`, `spin-1`, `crawl-step-left`, `menu-equip-jiggle`) and Obstacle_Category keys (`ceiling_underwater_obstacle`, `floor_underwater_obstacle`).
- Scenes: `BootScene`, `PreloadScene`, `MainMenuScene`, `CinematicScene`, `GameplayScene`, `PerkSelectScene`, `InventoryScene`, `SettingsScene`, `PauseScene`, `RunEndScene`.

## Function & module patterns

- Pure functions for all correctness-critical logic (scoring credit, collision overlap, reposition, save serialize/deserialize). Given the same inputs they return the same outputs — this is what the property tests rely on.
- The physics step is pure: `step(state, dt, primaryPressed, balance) -> newState`. No reads of wall-clock time or global mutable state inside the step.
- Keep side effects (rendering, audio, localStorage writes) in the engine layer, not the core.
- One responsibility per module; cross-system communication goes through the event bus (see game-architecture.md), not direct scene-to-scene calls.

## Performance guidelines (see also design "Performance & Optimization Guidelines")

- Zero per-frame allocation on the hot path: no `new`, array literals, or closures created each tick. Reuse scratch vectors and pre-allocated structures.
- Object pooling for obstacle views and particles: acquire on spawn, release (never destroy) when scrolled off-screen. On release, RESET every field — including the `scored` latch — so a recycled obstacle cannot corrupt exactly-once scoring.
- Fixed-timestep simulation decoupled from render; cap catch-up steps per frame to avoid a spiral-of-death.
- Pack sprites/animation frames into texture atlases so draws batch from one bound texture.
- Prefer AABB overlap for collision (the shared routine in `CollisionSystem`); avoid per-pixel checks.

## Testing expectations

- Correctness-critical core modules ship with their mapped property test (see tasks.md Phases 3/5/6/7). Property tests run 100+ iterations via fast-check and are tagged `// Feature: kino-game, Property {n}: {text}`.
- Core tests never require a browser/canvas (that is the whole point of the core/engine split).

## Error handling

- Config: malformed `Config_File` -> fall back to built-in defaults + developer warning, never crash (Req 47).
- Balance: missing/out-of-range value -> documented default + warning, via `BalanceTable` as the single choke point.
- Assets: missing/failed path -> placeholder via `AssetRegistry`, gameplay unaffected.
- Save: unreadable/invalid -> `First_Launch_State` in memory without clobbering the stored blob until next successful write.

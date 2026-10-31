---
inclusion: always
---

# KINO Game Architecture Standards

Adapted to the KINO design. The game is NOT a single flappy-bird loop; it is five worlds composed of chained Sequences across four movement modes, with a scripted World 5 finale. Architecture reflects that.

## Two-layer rule (non-negotiable)

- Simulation core (`src/core/`): pure, Phaser-independent, deterministic. Owns movement, scoring, collision, safe-reposition, progression, persistence serialization.
- Render/engine layer (`src/engine/`): Phaser scenes, sprites, input, audio. Drives the core each fixed step and renders its output.
- Dependency direction is one-way: engine -> core. The core importing Phaser is a defect.

## Modular systems (match the design's component names)

- `SequenceDirector` — composes a World from Sequences; the only authority that requests environment-forced transitions.
- `MovementStateMachine` — exactly one active `MovementMode` at a time; owns per-mode physics.
- `ObstacleSpawner` — procedural, per-world, mode-aware, endless-capable; emits the single `Obstacle` entity.
- `ScoringSystem` — exactly-once, mode-attributed, multiplier-at-credit.
- `CollisionSystem` — shared AABB; per-mode body-only hitboxes.
- `SafeRepositionSolver` — Time Erase / Ultra Instinct safe placement.
- `SkillSystem`, `PerkSystem`, `ProgressionSystem`, `SaveStore`, `AssetRegistry`, `BalanceTable`.

Each system is independently constructable and testable. No system reaches into another's internal state; they interact through method calls and events.

## Game loop / state driving

- Phaser owns the raw loop via scenes. Do NOT hand-roll a monolithic `GameEngine`.
- `GameplayScene.update(time, delta)` accumulates delta and advances the core in FIXED steps (default 1/120 s), then renders an interpolated frame.
- Time Slow scales the step rate uniformly (Kino + obstacles). Pause halts accumulation entirely so all timers freeze.

## State management

- Scene-level state = Phaser scene stack. Overlays (`PerkSelectScene`, `InventoryScene`, `SettingsScene`, `PauseScene`, `RunEndScene`) are launched in parallel and PAUSE the scene beneath (this is what makes pause genuinely freeze the sim and skill timers).
- Run state lives in the core (movement state, score, obstacle field, skill/perk timers). It is transient and reset per generation.
- Persistent state lives in `SaveStore` (skills, cosmetics, equipped selections, bindings, settings, world discovery/clear/left-behind, high scores, generation name).
- Never resurrect per-generation run fields from the save; abilities are re-learned each generation via mentor/evolution.

## Event handling patterns

- Use a lightweight typed event bus for cross-system signals: `transition:telegraph`, `transition:begin/end`, `score:changed`, `obstacle:cleared`, `collision:fatal`, `skill:activated`, `perk:offered/selected`, `world:unlocked`, `run:ended`, `generation:completed`.
- Input is normalized to two intents before reaching gameplay: `primaryAction` (spacebar == left click) and `skillActivate` (right click == Q). Systems subscribe to intents, not raw keycodes, so rebinding is centralized.
- During a Transition: skills are disabled and cosmetic layers hidden — enforced centrally (subscribers check `isTransitioning`), not per-system ad hoc.

## World / Sequence composition

- A `WorldDefinition` holds its `sequencePlan`, `endlessEnabled` (false for World 5), and `allowedEndlessModes` (abilities up to and including that world).
- World 1: [Jumping]. World 2: [Flight]. World 3: [Flight -> Zigzag] looping. World 4: [Flight, Zigzag, Underwater] chained, water-gated, no Jumping. World 5: chained modes -> Flight into the scripted crawl->run->jump finale.
- Endless mode constructs the `SequenceDirector` with the world's `allowedEndlessModes` allow-list so later-world abilities are structurally impossible to schedule.

# Implementation Plan: KINO

## Overview

This plan converts the KINO design into incremental, test-driven coding tasks. The implementation language is **TypeScript** on **Phaser 3**, matching the design's interface signatures and its named property-testing library (**fast-check**). Every task is scoped to writing, modifying, or testing code.

The build order delivers a **playable vertical slice first** (scaffold → config/asset foundation → simulation core → single World 1 run end-to-end) and then layers the remaining systems. The codebase is split into a Phaser-independent **simulation core** (pure, property-testable) and a **render/engine layer** (Phaser scenes, sprites, input, audio), exactly as the design prescribes.

Property-based tests validate the 11 correctness properties against the simulation core; each runs a minimum of 100 iterations and is tagged `// Feature: kino-game, Property {n}: {text}`. The core correctness tests — all 11 property-based tests and the key correctness unit tests — are required. Only the sample test harness, the manual/integration profiling pass, and a small number of non-correctness convenience tests remain optional (marked `*`) and may be skipped for a minimal playable submission.

Minimal playable submission = Phases 1–4 (scaffold, config/asset foundation, simulation core, World 1 vertical slice). Phases 5–12 complete the full competition scope.

## Tasks

- [x] 1. Project scaffold and tooling
  - [x] 1.1 Initialize Phaser 3 + TypeScript project with dev-serve and build
    - Create `package.json`, pin exact versions of `phaser`, `typescript`, a bundler/dev server (e.g. Vite), and `fast-check`
    - Add `tsconfig.json`, dev-serve script and production build script, and an `index.html` host page with the game canvas mount point
    - Create `src/` entry (`src/main.ts`) that boots an empty Phaser `Game` so the app runs in the browser
    - _Requirements: 26.1_

  - [x] 1.2 Establish directory structure separating simulation core from render layer
    - Create `src/core/` (pure, Phaser-independent modules) and `src/engine/` (Phaser scenes, renderers, input, audio)
    - Create `src/config/`, `src/assets/` (registry), and `test/` folders
    - Add an index/barrel per folder and a README note documenting the core-vs-engine boundary (core imports no Phaser)
    - _Requirements: 26.6, 24.4_

  - [x] 1.3 Wire up the test runner and fast-check
    - Configure a TS-aware test runner with a single-run (non-watch) command
    - Add a sample property test using fast-check (100+ iterations) and a sample unit test to prove the harness works
    - Add an ESLint/boundary check (or test) asserting `src/core/**` does not import `phaser`
    - _Requirements: 26.6_

- [x] 2. Config and asset foundation
  - [x] 2.1 Implement the Config_File module with grouped, self-documenting balance sub-sections
    - Create the single user-editable config module in `src/config/` matching the design schema (`names`, `labels`, `animationFrames`, `menuEquipJiggle`, `obstacleCategories`, `colorPalettes`, `mentorImages`, `mentorDialogue`, `mentorSymbols`, `worldBackgrounds`, `worldMusic`, `audio`, `starterAssets`, `cinematics`, `evolutionStyle`, `skillUnlockSchedule`, `skillRarity`, `cosmeticRarityColors`, `balance`)
    - Structure `balance` into labeled sub-sections (`movement`, `difficulty`, `skills`, `perks`, `hitboxes`, `transitions`) with inline unit/default/sensible-range comments per value
    - Declare all per-mode Animation_Frame keys (jumping: run-step-right/left, jump-go-up/apex/go-down; flight: fly-up/apex/down reused by underwater; zigzag: zigzag-up/down; spin: spin-1/2; crawl: crawl-step-right/left) and the `menu-equip-jiggle` key
    - Declare every Obstacle_Category key across all worlds (incl. `ceiling_underwater_obstacle`, `floor_underwater_obstacle`) following a consistent naming convention
    - Wire starter asset paths: `assets/ghosty.png`, `assets/jump.wav`, `assets/game_over.wav`, `img/example-ui.png`
    - _Requirements: 33.1, 33.2, 33.3, 33.4, 33.5, 33.9, 33.10, 33.11, 33.12, 33.13, 33.14, 33.15, 24.7, 24.9, 24.11, 38.1_

  - [x] 2.2 Implement ConfigFile.loadAndValidate with structural fallback to defaults
    - Implement built-in complete default config set
    - Implement `loadAndValidate()` that guards parsing; on unparseable/structurally-invalid config, fall back to the full default set and emit a developer warning rather than crashing
    - _Requirements: 47.1, 47.3, 33.6_

  - [x] 2.3 Implement BalanceTable with range validation and defaulting
    - Build `BalanceTable` from `Config_File.balance`; expose typed getters
    - On read, if a value is missing or outside its documented range, substitute the documented default and emit a developer warning (single choke point for Req 47.2)
    - Ensure gameplay modules consume tunables only through `BalanceTable` (no hardcoded constants)
    - _Requirements: 47.2, 47.3, 47.4, 26.8, 11.5, 15.2, 16.2, 41.1, 41.2_

  - [x] 2.4 Implement Asset_Registry with placeholder fallback
    - Implement `AssetRegistry.fromConfig(cfg)` walking every asset-bearing key recording `{ key, configuredPath, placeholderFactory }`
    - Implement `resolve(key)` as the single choke point returning the real asset when available else a geometric placeholder factory tinted from the world palette; implement `hasReal(key)`
    - Provide placeholder factories (geometric shapes/tones) per asset category and per-world distinguishable environment/obstacle placeholders
    - _Requirements: 24.1, 24.2, 24.4, 24.5, 24.8, 24.10, 33.7, 33.8, 33.16, 43.5_

  - [x] 2.5 Write unit tests for config/balance/asset validation and fallback
    - Malformed config → defaults + warning, no crash (Req 47.1)
    - Out-of-range/missing balance value → documented default + warning (Req 47.2)
    - Empty path / missing key / simulated load error → placeholder (Req 24.10, 33.7)
    - _Requirements: 47.1, 47.2, 24.10, 33.7_

- [x] 3. Simulation core — the testable heart
  - [x] 3.1 Define core runtime entity types and the fixed-timestep driver contract
    - Define `MovementMode`, `MovementState`, `Obstacle`, `ScoringEvent`, `Skill`, `Perk`, `WorldDefinition`, `Sequence` types in `src/core/`
    - Implement a pure fixed-timestep accumulator/driver (default 1/120 s) with a per-frame catch-up step cap, exposing `step(dt, inputs)` and a time-scale hook (for Time Slow) and a frozen (paused) mode
    - _Requirements: 26.2, 26.9, 9.1, 16.1_

  - [x] 3.2 Implement MovementStateMachine with exactly-one-active enforcement
    - Implement `active()`, `applyPrimary(ctx)`, `step(dt)` per-mode physics (jump impulse/gravity, flight impulse/gravity, underwater inverted impulse/buoyancy, zigzag ~±30° diagonal) reading values from BalanceTable
    - Implement `requestTransition(to)` atomically setting the single active mode and clearing all other mode flags; expose a test hook `activeModes()`
    - Implement `canTransition(to, ctx)` gating Underwater↔Flight on `ctx.waterSurfaceCrossed`
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.5, 4.1, 4.8, 5.1, 5.2, 6.1, 6.2, 6.11, 5.10_

  - [x] 3.3 Write property test — exactly one active Movement_Mode per Sequence
    - **Property 4: Exactly one active Movement_Mode per Sequence**
    - **Validates: Requirements 4.5, 4.6, 5.6, 5.7, 8.4, 8.5**

  - [x] 3.4 Write property test — zigzag direction alternation
    - **Property 10: Zigzag direction alternation**
    - **Validates: Requirements 4.1, 4.8**

  - [x] 3.5 Implement ScoringSystem with exactly-once latch, attribution, and multiplier-at-credit
    - Implement `credit(obstacleId, mode)` using a one-way `scored` latch; snapshot `multiplierAtCredit` at credit time; `creditedValue = 1 * multiplierAtCredit`; attribute to the active mode at the moment of clearing
    - Implement `current()`, `activeMultiplier()`; treat >1 event / non-unit base / wrong-mode attribution as an invalid scoring result (guarded)
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.6, 2.3, 2.4, 3.3, 3.4, 4.2, 4.3, 5.3, 5.4_

  - [x] 3.6 Write property test — exactly-once, unit-valued scoring
    - **Property 1: Exactly-once, unit-valued scoring**
    - **Validates: Requirements 9.1, 9.6, 2.3, 2.4, 3.3, 3.4, 4.2, 4.3, 5.3, 5.4, 35.4**

  - [x] 3.7 Write property test — scoring attributed to active mode at clearing
    - **Property 2: Scoring attributed to the active mode at clearing**
    - **Validates: Requirements 9.2, 9.3**

  - [x] 3.8 Write property test — multiplier applied at credit time
    - **Property 3: Multiplier applied at credit time**
    - **Validates: Requirements 9.4, 17.1**

  - [x] 3.9 Implement CollisionSystem with consistent body-only per-mode hitboxes
    - Implement `hitbox(mode)` derived only from Kino's body sprite, scaled by `balance.hitbox.scale.<mode>` (fair, < 1)
    - Implement a single shared AABB overlap routine used across all modes; `check(kino, obstacles, mode)` excludes every cosmetic layer
    - _Requirements: 26.7, 41.1, 41.2, 41.3, 41.4, 41.5, 44.13_

- [x] 4. Vertical slice — first end-to-end playable (World 1)
  - [x] 4.1 Implement BootScene: config load, asset registry build, save load/first-launch, scale/input managers
    - Read Config_File via `loadAndValidate`, build Asset_Registry, load Save_Store or create First_Launch_State, register Scale Manager (FIT, squarish) and input manager
    - _Requirements: 33.6, 24.8, 40.1, 26.10_

  - [x] 4.2 Implement PreloadScene (Loading_Screen) with progress and per-asset placeholder fallback
    - Queue every non-empty configured path in the Phaser loader; on load complete or error mark the key real/placeholder; show a loading progress bar
    - Enable menu entry once every required asset resolves to real art or placeholder (placeholder counts as loaded)
    - _Requirements: 37.1, 37.2, 37.3, 37.4, 37.5_

  - [x] 4.3 Implement input mapping for primary action and skill activation
    - Map spacebar and left mouse to primary action (identical); right mouse and Q to skill activation (identical); respond within one rendered frame
    - Read bindings from Save_Store control bindings
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 26.2_

  - [x] 4.4 Implement minimal MainMenuScene with a Start/Play entry to World 1
    - Render a Start control and a Play control that launches World 1 (minimal; full menu built in Phase 9)
    - Display the player's Kino and the generation name (minimal)
    - _Requirements: 20.1, 20.7, 20.32, 20.35_

  - [x] 4.5 Implement ObstacleSpawner for Jumping and the fixed-Kino scrolling run
    - Implement `spawnWindow(scrollX, world, mode, difficulty)` producing ground-resting Jumping obstacles with difficulty-scaled gaps; each obstacle has one `id` and one `scoringLineX` even with multiple visual elements
    - Hold Kino at fixed `screenX`; scroll background + obstacles leftward at `scrollSpeed`; Kino moves only vertically (jump)
    - _Requirements: 2.5, 45.1, 45.2, 45.4, 46.1_

  - [x] 4.6 Implement GameplayScene driving the core each fixed step with Jumping HUD and death flow
    - Drive fixed-timestep core: movement, scoring on `scoringLineX` crossing Kino's `screenX`, collision check; render Kino run/jump frames, obstacles entering from right, ground at bottom
    - Render score at top of HUD and a Menu control; on fatal ground-obstacle collision end the run
    - _Requirements: 2.1, 2.2, 2.3, 9.5, 44.1, 44.3, 20.39, 20.40, 20.41_

  - [x] 4.7 Implement RunEndScene with Retry/Menu and World 1 collision→menu return
    - On collision show Run_End_Screen with final score, relevant High_Score, obstacles cleared, run time; Retry restarts same world/mode, Menu returns to main menu
    - _Requirements: 39.1, 39.2, 39.3, 7.7_

  - [x] 4.8 Write unit tests for the World 1 slice wiring
    - Jumping obstacle credits exactly one point on clear; ground collision ends the run and routes to Run_End_Screen
    - _Requirements: 2.3, 44.3, 39.1_

- [x] 5. Remaining movement modes, transitions, and safe-reposition
  - [x] 5.1 Implement Flight mode run (World 2) with pillar obstacles
    - Flight physics (upward impulse, continuous gravity); spawn top+bottom vertical pillars with a gap, render ground; fixed-Kino scrolling; one scoring unit per pillar pair
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6, 44.5, 46.2_

  - [x] 5.2 Implement Zigzag mode (World 3) with walls, bounce, spin/arrow transition
    - Zigzag diagonal bounce between top/bottom walls; score on crossing a transition point; wall contact ends run (no protective skill); Flight→Zigzag spin telegraph + pointed arrow form, reverse spin back to flight on segment end
    - _Requirements: 4.1, 4.2, 4.8, 4.9, 6.7, 6.8, 44.4, 46.3_

  - [x] 5.3 Implement Underwater_Buoyancy mode (World 4) with Transition_Pane and categorized obstacles
    - Inverted buoyancy (continuous upward, downward impulse); render Transition_Pane at water surface; `ceiling_underwater_obstacle` from top and `floor_underwater_obstacle` from bottom with a navigable gap; reuse flight frames
    - Apply atomic blue underwater overlay to obstacles + Kino together while underwater; remove immediately when underwater condition becomes false
    - Exclude Jumping from World 4
    - _Requirements: 5.1, 5.2, 5.3, 5.8, 5.11, 5.12, 5.13, 38.2, 38.4, 38.7, 46.4_

  - [x] 5.4 Implement SequenceDirector with environment-forced, telegraphed transitions and water-surface gating
    - Compose a world from `sequencePlan`; track scroll distance to next boundary and emit a `TransitionTelegraph` at `telegraph.leadPx`; disable skills and hide cosmetic layers during transitions; give transition animation render priority
    - Drive Underwater↔Flight transitions only on water-surface crossing event; keep current mode if the crossing event did not fire
    - Compose World 3 (Flight→Zigzag alternating/looping) and World 4 (Flight, Zigzag, Underwater chained, water-gated, no Jumping)
    - _Requirements: 4.4, 4.5, 4.6, 4.7, 5.5, 5.6, 5.7, 5.9, 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.9, 6.10, 6.11_

  - [x] 5.5 Write property test — water-surface gating of Underwater↔Flight
    - **Property 5: Water-surface gating of Underwater↔Flight**
    - **Validates: Requirements 5.9, 5.10, 6.9, 6.10, 6.11**

  - [x] 5.6 Implement SafeRepositionSolver for all modes
    - Operate on the current frozen obstacle-field snapshot; validate every placement with the collision AABB routine; fall back to a monotonic terminating scan so output never overlaps
    - Jumping: place directly right of and clear of the obstacle at ground level; Flight/Underwater: nearest non-overlapping gap center at fixed `screenX`; Zigzag: clear interior on the diagonal maximizing clearance from the contacted wall, returning directional control to the player; Ultra Instinct: nearest clear y on the vertical axis
    - Apply mode-specific rule as sole placement rule, overriding generic Time Erase / Ultra Instinct placement for that mode
    - _Requirements: 14.3, 18.2, 44.7, 44.8, 44.9, 44.10, 44.11, 44.12_

  - [x] 5.7 Write property test — safe reposition never overlaps
    - **Property 6: Safe reposition never overlaps**
    - **Validates: Requirements 14.3, 18.2, 44.7, 44.8, 44.9, 44.10, 44.11, 44.12**

- [x] 6. Skills and perks
  - [x] 6.1 Implement SkillSystem lifecycle with single-equip, silent-defer, and pause-frozen timers
    - Track `cooldownRemaining`/`effectRemaining` ticked only from the fixed-step driver (halts under pause); silent defer when not ready; disable activation during transitions; single equipped skill (unequip previous)
    - Display equipped skill icon/availability/cooldown/effect duration on the run HUD (bottom-right)
    - _Requirements: 12.2, 12.3, 12.4, 12.15, 12.16, 7.10, 7.11, 7.12_

  - [x] 6.2 Write property test — pause freezes skill timers
    - **Property 7: Pause freezes skill timers**
    - **Validates: Requirements 7.10, 7.11, 7.12**

  - [x] 6.3 Implement pause control and run pause behavior
    - Provide a pause control that freezes gameplay, movement, obstacle progression, and skill cooldown/effect timers; resume continues from held values and paused run state
    - _Requirements: 7.9, 7.10, 7.11, 7.12, 7.13_

  - [x] 6.4 Implement the Second Chance skill
    - Arm a ≤3 s protective window; on collision within the window phase through exactly one collision, consume the skill, and end the window immediately; render the protective halo with a fade-out
    - _Requirements: 13.1, 13.2, 13.3, 13.4_

  - [x] 6.5 Implement the Time Erase skill
    - Arm a 4 s window; on an imminent collision prevent it and safely reposition Kino via the SafeRepositionSolver, then continue the run (per-mode reposition rules, incl. Req 44.x, handled by the solver task)
    - _Requirements: 14.1, 14.2, 14.4_

  - [x] 6.6 Implement the Dash skill
    - Apply a mode-dependent burst: horizontal burst for Jumping/Flight/Underwater; burst along the current diagonal for Zigzag
    - _Requirements: 15.1, 15.3, 15.4, 45.3_

  - [x] 6.7 Implement the Time Slow skill
    - Slow both Kino and obstacle progression by one consistent time-scale factor via the fixed-step time-scale hook
    - _Requirements: 16.1_

  - [x] 6.8 Implement the Score Multiplier skill
    - Double credited scoring events for 10 s (multiplier applied at credit time); reflect the active multiplier in the HUD
    - _Requirements: 17.1, 17.2_

  - [x] 6.9 Implement the Ultra Instinct skill
    - Provide 10 s of automatic evasion that teleports Kino to safety along the vertical axis via the SafeRepositionSolver
    - _Requirements: 18.1, 18.2_

  - [x] 6.10 Implement the Nuke skill
    - Destroy all on-screen obstacles and credit each destroyed unit exactly once with the active multiplier via the exactly-once latch (no re-credit if Kino later passes the same unit), then enter cooldown; disable Nuke during transitions; make its cooldown reducible by perks; show Nuke state in the HUD
    - _Requirements: 35.1, 35.2, 35.3, 35.4, 35.5, 35.6, 35.8_

  - [x] 6.11 Write unit tests for Nuke and protective skills
    - Nuke destroys on-screen obstacles and credits each once with the active multiplier; Second Chance phases through one hit then resolves; Time Erase repositions to a non-overlapping spot
    - _Requirements: 35.2, 35.4, 13.2, 14.3_

  - [x] 6.12 Implement PerkSystem with two-choice selection, cosmetic drop, and retention model
    - Present exactly two perk choices at obstacles 20 and 40; apply selected perk for the rest of the run; no perk choices in endless
    - Optional random unowned cosmetic in center slot flanked by the two perks, colored by rarity, persisted permanently when obtained
    - Retention: discard perks if run ends before 50 points (revert to unselected/locked); retain on reaching 50 for rest of generation; reset all perks on new generation
    - Implement Reduced Skill Cooldown and Speed Boost passive effects; store perks separately from skills; read percentages/probabilities/rarity from config
    - _Requirements: 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 10.7, 10.8, 10.9, 10.10, 10.11, 11.1, 11.2, 11.3, 11.4, 11.5, 12.5_

  - [x] 6.13 Write unit tests for perk retention and cooldown-reduction interaction
    - Discard before 50 / retain at 50 / reset next generation; cooldown-reduction perk reduces equipped skill cooldown
    - _Requirements: 10.4, 10.5, 10.6, 11.4, 12.5_

- [x] 7. Progression and persistence
  - [x] 7.1 Implement SaveStore schema, serialize/deserialize round-trip, and error handling
    - Implement `kino.save.v1` JSON schema with `schemaVersion`; pure inverse `serialize`/`deserialize`; on unreadable/invalid/unknown-version data return First_Launch_State in memory without clobbering the stored blob until next successful write; attempt migration for known older versions
    - Persist permanent fields (skills, cosmetics, equipped selections, bindings, settings, world discovery/clear/left-behind, high scores, cross-generation history); never resurrect per-generation run fields
    - _Requirements: 22.1, 22.2, 22.6, 22.7, 40.1, 28.1, 28.2_

  - [x] 7.2 Write property test — persistence round-trip
    - **Property 8: Persistence round-trip**
    - **Validates: Requirements 22.6, 22.7, 28.1, 28.2**

  - [x] 7.3 Implement ProgressionSystem world-unlock flow and endless continuation
    - At 50 points: mark next world unlocked, hover Kino + "new world unlocked" message, then "endless starting" message, then continue the same run endlessly with ramping difficulty; no auto-transition; on collision end run → menu with next world unlocked and selectable; choose any unlocked world
    - Ramp speed/density beyond 50 (worlds 1–4) while staying feasible
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.8_

  - [x] 7.4 Implement left-behind worlds and generation transitions
    - Mark advanced-past story worlds `leftBehind` (block story replay/revisit; keep earned rewards valid; endless-only return)
    - On generation complete: award a unique cosmetic, advance Junior→Senior then next iteration's Junior, reset abilities/perks/run state while keeping skills/cosmetics; grey previously discovered worlds; compose Generation_Name from config scheme
    - _Requirements: 27.15, 27.16, 22.3, 22.4, 22.5, 32.1, 32.2, 32.3, 32.5_

  - [x] 7.5 Implement Skill_Unlock_Schedule acquisition and rarity labeling
    - Unlock skills via world-first completion (fixed list order matched to world order) and generation-1/generation-2 completion; persist permanently; never via perk drops; assign rarity tier (display/flavor only, no effect change)
    - _Requirements: 36.1, 36.2, 36.3, 36.4, 36.5, 36.7, 12.6, 12.13_

  - [x] 7.6 Implement high-score tracking per world and mode
    - Persist story and endless high scores separately per world; update/persist only when exceeded; expose relevant high score for menu/run-end
    - _Requirements: 28.1, 28.2, 28.3, 28.4_

  - [x] 7.7 Write property test — high score is the monotonic per-world/per-mode maximum
    - **Property 11: High score is the monotonic per-world/per-mode maximum**
    - **Validates: Requirements 28.1, 28.2, 28.3**

  - [x] 7.8 Implement Endless_Mode with ability restriction and no story progress
    - Support endless for worlds 1–4 (procedural), none for world 5; ramp speed/density/config difficulty/transition frequency; construct SequenceDirector with `allowedEndlessModes` allow-list so later-world abilities are structurally impossible; block all story progress and award no story rewards/perks/cosmetics; no perk choices
    - _Requirements: 23.1, 23.2, 23.3, 23.6, 23.7, 23.8, 23.9_

  - [x] 7.9 Write property test — endless ability restriction
    - **Property 9: Endless ability restriction**
    - **Validates: Requirements 23.7, 23.8**

  - [x] 7.10 Implement First_Launch_State initialization and opening-cinematic trigger
    - On no existing save: initialize Generation 1 Junior, no skills, no cosmetics, only World 1 available, default bindings; trigger the opening cinematic
    - _Requirements: 40.1, 40.2_

  - [x] 7.11 Write unit tests for skill unlock schedule and left-behind/first-launch state
    - World-first and generation milestones unlock the correct skill in fixed order; advancing a world marks it left-behind; fresh save yields First_Launch_State
    - _Requirements: 36.2, 27.15, 40.1_

- [x] 8. Cosmetics and layered rendering
  - [x] 8.1 Implement KinoRenderer base + cosmetic layers (render-only)
    - Draw base Kino from a single sprite independent of cosmetics; render each equipped cosmetic as a separate transparent layer offset per `(movementMode, animationFrame)` from an anchor table; no unique combined sprite required
    - Position cosmetic layers correctly per animation/mode; hide cosmetic layers during transitions; exclude all cosmetic layers from collision
    - _Requirements: 19.1, 19.2, 19.3, 19.4, 19.6, 6.5_

  - [x] 8.2 Implement single-equip cosmetic persistence
    - Equipping a cosmetic sets the single equipped cosmetic and unequips any previous; persist unlocked and random-drop cosmetics permanently across generations
    - _Requirements: 19.5, 19.7, 10.11_

  - [x] 8.3 Implement the Animation_Frame cycles per mode
    - Jumping ground walk cycle (run-step-right/left) when grounded; jump frames (jump-go-up/apex/go-down) airborne; flight frames (fly-up/apex/down) reused underwater; zigzag frames; spin cycle (spin-1/2) during transition; crawl cycle (crawl-step-right/left) and run cycle in finale
    - _Requirements: 30.4, 30.5, 30.7, 30.8, 30.9, 30.10, 30.11, 30.12, 30.13, 30.14, 30.15_

- [x] 9. Full UI / menu
  - [x] 9.1 Implement the vertical treasure-map with lock-in, glow, and scrolling
    - Vertical scroll with World 1 at bottom and higher worlds stacked up; next reveal fading in at top; one checkpoint per world; Kino location marker; completed/discovered greyed, undiscovered black silhouettes
    - Scroll snaps center to nearest discovered world = Locked_In_World with side glow; centered undiscovered silhouette shows no glow, locks nothing, indicates unselectable, disables/ignores Play
    - _Requirements: 20.2, 20.3, 20.4, 20.5, 20.6, 20.18, 20.19, 20.20, 20.21, 20.22, 20.27, 20.28, 34.1, 34.2, 34.3_

  - [x] 9.2 Implement menu controls, generation pill, and bottom primary button
    - Stats top-left (Info panel), Settings top-right, Generation pill top-center, Cosmetics left of Kino + Skills right of Kino, replay control + Generation_Name header, large Play control
    - Bottom primary Start/Continue button labeled from config by story position (13a–13d cases); launch next story step on press
    - _Requirements: 20.11, 20.13, 20.14, 20.15, 20.16, 20.23, 20.24, 20.25, 20.26, 20.32_

  - [x] 9.3 Implement endless-mode triangle triggers on world panels
    - Right-side triangle per world; greyed/locked until cleared, active after; selecting it shows the "outside story progression" confirmation
    - _Requirements: 20.29, 20.30, 20.31, 23.4, 23.5_

  - [x] 9.4 Implement the Inventory_Panel (tabbed Cosmetics/Skills grid with preview)
    - Lower-half tabbed Cosmetics/Skills view with active tab indicated; Kino fixed upper area; equipped item previewed above Kino with highlight; scrollable grid; locked skills and unowned cosmetics greyed non-selectable; select owned item to equip (single-select) + update preview; rarity-by-color for skills and cosmetics
    - Open Cosmetics/Skills controls fade other menu elements and customize/equip in place
    - _Requirements: 12.1, 12.7, 12.8, 12.9, 12.10, 12.11, 12.12, 12.14, 19.7, 20.8, 20.9, 20.17, 20.42, 20.43, 20.44, 20.45, 20.46, 20.47, 36.6_

  - [x] 9.5 Implement the menu equip jiggle animation
    - On equipping a cosmetic or skill in the menu, play the jello bob jiggle from the `menu-equip-jiggle` config key (placeholder fallback); menu-only, distinct from gameplay frames
    - _Requirements: 43.1, 43.2, 43.3, 43.4, 43.5_

  - [x] 9.6 Implement the Info / run-statistics panel
    - On opening Info: show obstacles cleared, active perk effects as ±%, equipped skill, current score; show per-world high scores for current generation alongside best past-generation high scores
    - _Requirements: 20.10, 31.1, 31.2_

  - [x] 9.7 Implement the Settings_Screen with volume, rebinding (conflict + rollback), and reset-save
    - Volume control, control rebinding, reset-save option; persist changed settings
    - Rebinding conflict only between primary and skill bindings: reject with naming message and do not apply; roll back to previous binding if persistence fails
    - Reset-save requires confirmation; on confirm reset Save_Store to First_Launch_State
    - _Requirements: 20.48, 20.49, 20.50, 20.51, 1.6, 1.7, 1.8, 1.9, 25.7_

  - [x] 9.8 Implement the Play-button expand transition and Kino glide-to-start
    - On Play: expand the Play control as an upward color fill until it covers the screen; then fade in HUD controls and world background; glide the persistent Kino sprite from menu position to the fixed run start position and stabilize
    - Continue Story expands to full screen, keeps Kino placed, glides Kino to start
    - _Requirements: 20.12, 20.36, 20.37, 20.38_

  - [x] 9.9 Implement Adaptive_Layout resize behavior
    - Reposition and rescale UI and gameplay elements proportionally on screen-size change; squarish desktop-style target usable across desktop/tablet sizes
    - _Requirements: 26.10, 26.11, 26.12_

  - [x] 9.10 Write unit tests for menu lock-in, button-label cases, and rebinding
    - Scroll snaps to nearest discovered world and silhouette disables Play; bottom-button label resolves 13a–13d; rebinding conflict rejected with rollback on persist failure
    - _Requirements: 34.1, 34.3, 20.13, 1.7, 1.9_

- [x] 10. Cinematics
  - [x] 10.1 Implement CinematicScene framework (skippable, config-driven)
    - Scripted, skippable sequence player driven by config content; Comic_Panel panel-by-panel advancement in comic-book style
    - _Requirements: 21.3, 21.18, 21.21_

  - [x] 10.2 Implement the opening stacked-band egg-descent cinematic
    - Mama Kino knocks an egg in a data-center henhouse; egg rolls to the button; permission-denied gag using config gag text; ground opens and egg falls; five stacked horizontal bands (World 5 top → World 1 bottom) with occupied band shown, not-yet-reached hidden, passed greyed silhouettes; World 1 band expands to fill screen for landing + hatch into walking ghost that gains Jumping
    - _Requirements: 21.1, 21.11, 21.12, 21.13, 21.14, 21.15, 21.16, 21.17_

  - [x] 10.3 Implement mentor cutscene with speaker-swap dialogue and Evolution
    - Animated world background behind dialogue; speaker-swap layout (active speaker sprite + chatbox, other greyed in corner, alternating); five themed mentors with names/symbols from config; Evolution (electric-zap/glow/burst default); World 1 egg-crack into ghost hatchling, worlds 2–5 subtle evolve; Kino remains evolved for that world for the generation
    - Skip mentor cutscene on same-generation retry (restart control or menu Continue/Play) when already evolved
    - _Requirements: 21.2, 21.4, 21.5, 29.1, 29.2, 29.3, 29.4, 29.5, 29.6, 29.7, 29.8, 29.9, 29.10, 29.11, 29.12, 42.1, 42.2, 42.3, 42.4, 42.5, 42.6, 39.4_

  - [x] 10.4 Implement world-completion cinematic and silhouette dissolve
    - Short world-completion cinematic then return to menu; dissolve the newly unlocked world's silhouette to reveal it; on new generation render previously discovered worlds greyed rather than black
    - _Requirements: 21.6, 21.7, 21.10_

  - [x] 10.5 Implement the final comic-panel ending and credits/bloopers
    - On jumping through the portal barrier present the final Comic_Panel sequence (reunion → start family → knock next egg to loop); advance Junior→Senior same iteration; label next egg with next iteration + Junior; then credits with blooper-style outtakes referencing creator/inspiration; all skippable
    - _Requirements: 21.8, 21.9, 21.19, 21.20, 32.3, 32.4_

  - [x] 10.6 Write unit test for opening band-state mapping
    - Given the egg's band index, bands are shown/hidden/greyed correctly
    - _Requirements: 21.15_

- [x] 11. World 5 finale
  - [x] 11.1 Compose World 5 sequence plan with Flight leading into the finale
    - Chain Flight/Zigzag/Underwater sequences with environment-forced telegraphed transitions; exactly one mode active before the finale; make the sequence immediately before the finale a Flight sequence; Jumping available only in the finale
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.5, 8.6_

  - [x] 11.2 Implement the scripted auto-controlled finale (crawl → run → jump)
    - At finale start disable Flight and descend Kino to the ground; take automatic control; drive crawl locomotion (crawl-step cycle) then running (run-step cycle) rightward to the portal barrier (sanctioned horizontal-movement exception); keep Jumping unavailable until the barrier; at the barrier enable the final jump that carries Kino through into the final cinematic
    - _Requirements: 8.7, 8.8, 8.9, 8.10, 8.11, 8.12, 8.13, 8.14, 8.15, 45.5_

- [~] 12. Audio, theming, performance, and polish
  - [x] 12.1 Implement the audio system with autoplay-safe start and persisted volume
    - Distinct sounds per movement action (jumping/flight/zigzag/underwater), evolution, collision, UI, per-world music, mentor reactions; volume/mute control persisted; start audio only after first user interaction (queue/no-op before); reuse decoded buffers
    - _Requirements: 25.1, 25.2, 25.3, 25.4, 25.5, 25.6, 25.7, 25.8, 25.9_

  - [x] 12.2a Implement visual direction and per-world parallax
    - Apply the comic-book aesthetic (thick outlines, cel-shading, halftone, exaggerated expressions) and saturated per-world palettes with strong contrast; build multi-layer parallax per world; apply to both placeholder and final art
    - _Requirements: 30.1, 30.2, 30.3, 30.6_

  - [x] 12.2b Implement per-world environment elements
    - Build per-world environment elements: W1 desert highway/Route 53 signs/cacti/rocks/tumbleweeds; W2 mountains/lava rocks/pipes/compute structures; W3 jungle/vines/caves/paths; W4 icebergs/icy structures/water surface/underwater + icy surface before water; W5 data center/security infra/barriers/restricted zones; render AWS references as in-world flavor
    - _Requirements: 27.1, 27.2, 27.3, 27.4, 27.5, 27.6, 27.7, 27.8, 27.9, 27.10, 27.11, 27.12_

  - [x] 12.2c Implement palette application and overlays
    - Apply each world's Color_Palette element-level treatment (background/obstacles/Kino) and overlay/tint defaults from config
    - _Requirements: 27.13, 27.14, 38.3, 38.5, 38.6_

  - [x] 12.3 Implement performance/optimization pass
    - Object pooling for obstacle views and particles (acquire on spawn, release off-screen, sized to worst-case on-screen count); recycle core `Obstacle` data resetting every field incl. the `scored` latch; texture atlases for batched draw calls; off-screen culling; zero per-frame allocation on the hot path; cap history/log buffers
    - 60 fps target with a graceful degradation ladder (reduce particles → parallax detail → non-essential effects) scoped to active gameplay; render transitions smoothly; load assets efficiently
    - _Requirements: 26.3, 26.4, 26.5, 26.9_

  - [~] 12.4 Profile and verify performance/feel (manual/integration)
    - Profile 60 fps under load with graceful degradation; verify audio starts only after first interaction; verify adaptive layout across sizes; review transition smoothness and collision fairness against tunable Balance Table defaults
    - _Requirements: 26.9, 25.9, 26.10, 26.11, 26.12, 6.3, 41.1_

- [~] 13. Final checkpoint
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Core correctness tests are required: all 11 property-based tests (3.3, 3.4, 3.6, 3.7, 3.8, 5.5, 5.7, 6.2, 7.2, 7.7, 7.9) and the key correctness unit tests (2.5 config/balance/asset validation+fallback, 4.8 World 1 slice wiring, 6.11 Nuke/protective skills, 6.13 perk retention/cooldown, 7.11 skill-unlock/left-behind/first-launch, 9.10 menu lock-in/label/rebinding).
- Tasks still marked with `*` are optional and can be skipped for a faster minimal playable submission: the sample test harness (1.3), the opening band-state convenience test (10.6), and the manual/integration profiling + feel pass (12.4). All non-test tasks remain required.
- Minimal playable submission is delivered by Phases 1–4; Phases 5–12 complete the full competition scope. The build order front-loads a playable World 1 vertical slice, then layers systems.
- Each task references specific requirement sub-clauses for traceability; together the tasks cover every requirement 1–47.
- Property-based tests (fast-check, 100+ iterations each) map one-to-one to the 11 correctness properties: P1 scoring exactly-once (3.6), P2 mode attribution (3.7), P3 multiplier-at-credit (3.8), P4 one-active-mode (3.3), P5 water-gating (5.5), P6 safe-reposition (5.7), P7 pause-freezes-timers (6.2), P8 persistence round-trip (7.2), P9 endless ability restriction (7.9), P10 zigzag alternation (3.4), P11 high-score max (7.7).
- The simulation core stays Phaser-independent so every property test runs without a browser/canvas.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2"] },
    { "id": 2, "tasks": ["1.3", "2.1"] },
    { "id": 3, "tasks": ["2.2", "2.4"] },
    { "id": 4, "tasks": ["2.3", "2.5", "3.1"] },
    { "id": 5, "tasks": ["3.2", "3.5", "3.9"] },
    { "id": 6, "tasks": ["3.3", "3.4", "3.6", "3.7", "3.8", "4.1", "4.5"] },
    { "id": 7, "tasks": ["4.2", "4.3", "4.4", "4.6"] },
    { "id": 8, "tasks": ["4.7", "5.1", "5.2", "5.3"] },
    { "id": 9, "tasks": ["4.8", "5.4", "5.6"] },
    { "id": 10, "tasks": ["5.5", "5.7", "6.1", "6.3"] },
    { "id": 11, "tasks": ["6.2", "6.4", "6.5", "6.6", "6.7", "6.8", "6.9", "6.10", "6.12"] },
    { "id": 12, "tasks": ["6.11", "6.13", "7.1"] },
    { "id": 13, "tasks": ["7.2", "7.3", "7.5", "7.6", "7.8"] },
    { "id": 14, "tasks": ["7.4", "7.7", "7.9", "7.10"] },
    { "id": 15, "tasks": ["7.11", "8.1", "8.3"] },
    { "id": 16, "tasks": ["8.2", "9.1", "9.6", "9.7", "9.9"] },
    { "id": 17, "tasks": ["9.2", "9.4", "9.8", "12.1"] },
    { "id": 18, "tasks": ["9.3", "9.5", "9.10", "10.1"] },
    { "id": 19, "tasks": ["10.2", "10.3", "10.4"] },
    { "id": 20, "tasks": ["10.5", "10.6", "11.1"] },
    { "id": 21, "tasks": ["11.2", "12.2a", "12.2b", "12.2c"] },
    { "id": 22, "tasks": ["12.3"] },
    { "id": 23, "tasks": ["12.4"] }
  ]
}
```

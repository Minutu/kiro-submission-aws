// Feature: kino-game
//
// Simulation core — barrel / public surface.
//
// This folder holds the PURE, Phaser-independent simulation modules: movement
// state, scoring, collision, safe-reposition, progression, and persistence
// serialization. Everything here must be deterministic and property-testable
// without a browser or canvas.
//
// HARD RULE: no module under `src/core/**` may import `phaser` (directly or
// transitively). See `src/README.md` for the core-vs-engine boundary.
//
// Re-export core modules from this barrel as they are implemented
// (SequenceDirector, MovementStateMachine, ScoringSystem, CollisionSystem,
// SafeRepositionSolver, SkillSystem, PerkSystem, ProgressionSystem, SaveStore).

// Runtime entity types (design: "Data Models > Runtime entities").
export type {
  Rect,
  MovementMode,
  VerticalDir,
  MovementState,
  Obstacle,
  ScoringEvent,
  SkillState,
  Skill,
  PerkId,
  Perk,
  Sequence,
  SequenceSpec,
  WorldId,
  WorldDefinition,
  SkillId,
} from './types.ts';

// The fixed-timestep driver (design: "The fixed-timestep driver").
export {
  createFixedTimestepDriver,
  DEFAULT_FIXED_DELTA_S,
  DEFAULT_MAX_CATCH_UP_STEPS,
} from './fixedTimestep.ts';
export type {
  FixedTimestepDriver,
  FixedTimestepOptions,
  StepResult,
  AdvanceFn,
} from './fixedTimestep.ts';

// The consistent, fair, body-only collision basis (design: "Consistent, fair
// hitboxes (Req 26.7, 41)").
export {
  createCollisionSystem,
  aabbOverlap,
} from './collisionSystem.ts';
export type {
  CollisionSystem,
  CollisionResult,
  KinoBody,
} from './collisionSystem.ts';

// The Movement_Mode state machine (design: "Movement_Mode state machine";
// Req 2-6). Exactly one active mode per Sequence.
export {
  createMovementStateMachine,
  ALL_MODES,
} from './movementStateMachine.ts';
export type {
  MovementStateMachine,
  MovementStateMachineOptions,
  MovementContext,
} from './movementStateMachine.ts';

// The ScoringSystem (design: "Collision & Scoring > Scoring_Event mechanism"; Req 9).
export { createScoringSystem } from './scoringSystem.ts';
export type {
  ScoringSystem,
  ScoringSystemOptions,
  ScoringResult,
  Invalid,
  RejectionReason,
  MultiplierSource,
} from './scoringSystem.ts';

// The ObstacleSpawner (design: "Obstacle Generation"; Req 23, 46, 45, 9.6).
// World 1 Jumping layout + World 2 Flight pillar-pair layout + World 3 Zigzag
// transition-point markers + World 4 Underwater ceiling/floor pairs + the
// fixed-Kino scrolling-speed/gap contract.
export { createObstacleSpawner } from './obstacleSpawner.ts';
export type {
  ObstacleSpawner,
  PlayArea,
  Difficulty,
  SpawnWindowOptions,
} from './obstacleSpawner.ts';

// The SafeRepositionSolver — "THE hard problem" (design: "SAFE-REPOSITION
// ALGORITHM (hardest problem) — Req 14, 18, 44"). Protective-skill reposition
// into a guaranteed non-overlapping spot, per-mode, on the frozen field.
export { createSafeRepositionSolver } from './safeRepositionSolver.ts';
export type {
  SafeRepositionSolver,
  SafePlacement,
  RepositionRequest,
  RepositionPlayArea,
  ProtectiveSkill,
} from './safeRepositionSolver.ts';

// The SequenceDirector — composes a World from its Sequences and drives
// telegraphed, environment-forced transitions with water-surface gating
// (design: "Telegraphed, environment-forced transitions", "Water-surface
// gating"; Req 4.4-4.7, 5.5-5.7, 5.9, 6.1-6.6, 6.9-6.11). Includes the World 3
// (Flight→Zigzag looping) and World 4 (Flight/Zigzag/Underwater, water-gated,
// no Jumping) plan composers.
export {
  createSequenceDirector,
  realizeSequence,
  DEFAULT_SEQUENCE_BOUNDARY_PX,
  composeWorld1SequencePlan,
  composeWorld2SequencePlan,
  composeWorld3SequencePlan,
  composeWorld4SequencePlan,
} from './sequenceDirector.ts';
export type {
  SequenceDirector,
  SequenceDirectorOptions,
  ScheduledSequence,
  TransitionTelegraph,
  TransitionEvent,
  TickResult,
} from './sequenceDirector.ts';

// The SkillSystem — active-skill lifecycle, timers, equip, and activation
// gating (design: "Active skill lifecycle (Req 12, 13–18, 35)", "Single
// equipped Skill (Req 12.15)"; Req 12.2, 12.3, 12.4, 12.15, 12.16, 7.10-7.12).
// Single-equip (unequip previous), silent-defer when not ready, activation
// disabled during transitions, and timers that advance ONLY via `tick(dt)` so
// they freeze structurally under pause (the driver stops calling `tick`). The
// per-skill EFFECT behaviors land in later tasks (6.4-6.10) via the activation
// hooks; this provides the lifecycle framework and HUD snapshot seam.
export { createSkillSystem } from './skillSystem.ts';
export type {
  SkillSystem,
  SkillSystemOptions,
  SkillActivationContext,
  ActivationResult,
  DeferReason,
  SkillHudSnapshot,
} from './skillSystem.ts';

// The Time Slow skill effect (design: "Skill effects > Time Slow"; Req 16.1).
// Pure composition seam between the SkillSystem lifecycle and the fixed-step
// driver's uniform time-scale hook: slows Kino + obstacle progression together
// by one consistent factor for the active window, restoring real time on end.
export { createTimeSlowEffect } from './timeSlowSkill.ts';
export type { TimeSlowEffect, TimeScaleHook } from './timeSlowSkill.ts';

// The Dash effect — the pure, mode-dependent burst behind the Dash skill
// (design: "Skill effect summary > Dash"; Req 15.1, 15.3, 15.4, 45.3). A
// horizontal burst for Jumping/Flight/Underwater and a burst along the current
// diagonal for Zigzag, carrying `dashDistancePx` over `dashDurationS`. Composes
// with the SkillSystem `active` window via `onActivate`/`onEffectEnd`; the
// GameplayScene applies the per-tick displacement to Kino's position while the
// Dash effect is active (the sanctioned horizontal/diagonal exception to the
// fixed-`screenX` Scrolling_Model, Req 45.3).
export {
  computeDashBurst,
  dashDisplacement,
  createDashEffect,
} from './dashSkill.ts';
export type {
  DashBurst,
  DashDisplacement,
  DashEffect,
} from './dashSkill.ts';

// The Second Chance skill EFFECT — "survive one hit" (design: "Skill effects";
// Req 13.1–13.4). A pure state machine composed over the SkillSystem lifecycle:
// armed exactly while `secondChance` is `active`; `consumeOnCollision()` phases
// through EXACTLY ONE collision, consumes the protection, and ends the window
// immediately (active → cooldown). GameplayScene reads `isArmed()` for the
// angel halo and `onResolved` for its fade-out (Req 13.4). Phaser-free.
export { createSecondChanceSkill } from './secondChanceSkill.ts';
export type {
  SecondChanceSkill,
  SecondChanceOptions,
  SecondChanceCollisionResult,
  SecondChanceOutcome,
} from './secondChanceSkill.ts';

// The PerkSystem — two-choice perk selection, optional center cosmetic drop,
// and the run-vs-generation retention model (design: "Perk system (Req 10,
// 11)"; Req 10.1-10.11, 11.1-11.5, 12.5). PURE and stored SEPARATELY from the
// SkillSystem (Req 11.3): it exposes `cooldownScale()` (Reduced Skill Cooldown,
// Req 11.1/12.5) and `speedMultiplier()` (Speed Boost, Req 11.2) for
// GameplayScene to wire — the cooldown scale feeds the SkillSystem's existing
// injectable `cooldownScale` seam with NO change to skillSystem.ts. The
// cosmetic roll uses an injectable seeded PRNG (never Math.random) so offers
// and retention are deterministic and property-testable.
export { createPerkSystem } from './perkSystem.ts';
export type {
  PerkSystem,
  PerkSystemOptions,
  PerkOffer,
  PerkChoice,
  PerkSelectionResult,
  CosmeticOffer,
  CosmeticDef,
  CosmeticRarity,
  CosmeticRarityColors,
  RandomSource,
} from './perkSystem.ts';

// The Score Multiplier skill bridge (design: "Active Skill — Score Multiplier";
// Req 17.1, 17.2). A small PURE composition: a MultiplierSource getter that
// returns the configured factor (default 2) WHILE Score Multiplier is equipped
// and active, else 1 — injected into the ScoringSystem so a credit inside the
// active window doubles AT CREDIT TIME (Req 17.1). `scoreMultiplierHudValue`
// exposes the same value for the HUD to reflect the active multiplier (Req 17.2).
export {
  createScoreMultiplierSource,
  scoreMultiplierHudValue,
  isScoreMultiplierActive,
  SCORE_MULTIPLIER_SKILL_ID,
} from './skills/scoreMultiplier.ts';
export type { ScoreMultiplierSkillView } from './skills/scoreMultiplier.ts';

// The Time Erase skill EFFECT — "undo an imminent collision" (design: "Skill
// effects" + "SAFE-REPOSITION ALGORITHM"; Req 14.1, 14.2, 14.4). A pure state
// machine composed over the SkillSystem lifecycle AND the SafeRepositionSolver:
// armed exactly while `timeErase` is `active` (4 s window, Req 14.1);
// `onImminentCollision()` PREVENTS the collision, repositions Kino to a
// guaranteed non-overlapping spot via the solver (per-mode rules Req 44.7-44.12,
// Property 6), ends the window immediately (active → cooldown), and returns the
// SafePlacement so GameplayScene moves Kino and continues the run (Req 14.2,
// 14.4). Unlike Second Chance (phase-through), Time Erase repositions. Phaser-free.
export { createTimeEraseSkill } from './timeEraseSkill.ts';
export type {
  TimeEraseSkill,
  TimeEraseOptions,
  TimeEraseCollision,
  TimeEraseCollisionResult,
  TimeEraseOutcome,
} from './timeEraseSkill.ts';

// The Ultra Instinct skill EFFECT — "automatic evasion" (design: "Skill
// effects"; Req 18.1, 18.2). A pure composition over the SkillSystem lifecycle
// and the SafeRepositionSolver: auto-evading EXACTLY while `ultraInstinct` is
// equipped AND `active` (the 10 s window, Req 18.1); `autoEvade(request)`
// forwards an imminent collision to the solver with `skill: 'ultraInstinct'`
// and returns the guaranteed non-overlapping vertical-axis SafePlacement so
// GameplayScene teleports Kino there (Req 18.2), repeating for the FULL window
// (the evasion never consumes/ends it); returns null when not active so the
// caller resolves the hit normally. Phaser-free.
export { createUltraInstinctSkill } from './ultraInstinctSkill.ts';
export type {
  UltraInstinctSkill,
  UltraInstinctEvadeRequest,
} from './ultraInstinctSkill.ts';

// The Nuke skill EFFECT — "clear the screen, score it all" (design: "Active
// Skill — Nuke"; Req 35.1, 35.2, 35.3, 35.4, 35.5, 35.6, 35.8). A pure bridge
// over the existing SkillSystem lifecycle + ScoringSystem latch — NOT a rewrite
// of either shared module. `detonate(onScreenObstacles, activeMode, scoring)`
// destroys every on-screen Obstacle_Unit and credits each EXACTLY ONCE at the
// active multiplier by delegating to ScoringSystem.credit (the one-way latch
// handles Req 35.4's "no re-credit if Kino later passes it" and the
// at-credit-time multiplier handles Req 35.2/35.3). It returns the destroyed
// ids for GameplayScene to remove, plus a scoring summary. The SkillSystem owns
// cooldown (Nuke's 0s active window resolves straight to cooldown on activate,
// reducible via cooldownScale — Req 35.1, 35.5), the transition-disable
// (Req 35.6), and the HUD snapshot (Req 35.8). Phaser-free.
export {
  detonate,
  toNukeTargets,
  NUKE_SKILL_ID,
} from './skills/nuke.ts';
export type { NukeTarget, NukeResult } from './skills/nuke.ts';

// The Save_Store — the authoritative versioned `kino.save.v1` schema, the PURE
// inverse serialize/deserialize (design: "Property 8: Persistence round-trip";
// Req 22.6, 22.7, 28.1, 28.2), schema validation, version migration, and the
// localStorage read/write wrapper with the no-clobber error-handling rule
// (design: "Unreadable or invalid Save_Store (Req 22, 40)"; Req 40.1). PURE and
// Phaser-free: the only fields it persists are PERMANENT (unlocked skills /
// cosmetics, equipped selections, bindings, settings, generation, world
// discovery/clear/left-behind, per-world/per-mode high scores, cross-generation
// history — Req 22.1-22.2); per-generation RUN fields are not in the schema, so
// the round-trip never resurrects them (Req 22.7). The engine seam
// (`src/engine/saveState.ts`) re-exports this and keeps BootScene working.
export {
  SAVE_STORAGE_KEY,
  SAVE_SCHEMA_VERSION,
  DEFAULT_CONTROL_BINDINGS,
  createFirstLaunchState,
  isValidSaveState,
  serialize,
  deserialize,
  createSaveStore,
  shouldPlayOpeningCinematic,
} from './saveStore.ts';
export type {
  SaveState,
  GenerationState,
  WorldProgressState,
  ControlBindings,
  SettingsState,
  HighScoreState,
  SaveStore,
  SaveStoreLoadResult,
  SaveSource,
  SaveReadStorage,
  SaveWriteStorage,
} from './saveStore.ts';

// The Skill_Unlock_Schedule acquisition + rarity labeling (task 7.5; design:
// "Skill acquisition (Req 36)"; Req 36.1-36.5, 36.7, 12.6, 12.13). PURE and
// Phaser-free, config-driven: `skillForMilestone` / `worldFirstMilestone` read
// the fixed world-order milestone→SkillId mapping from
// `config.skillUnlockSchedule` (Req 36.1-36.2); `applyMilestoneToUnlockedSkills`
// / `applyMilestoneToSave` fold a reached milestone into the save's PERMANENT
// `unlockedSkills` list IDEMPOTENTLY (no double-unlock, never via a perk path —
// Req 36.3, 36.7, 22.1); `skillRarity` resolves a skill's tier from
// `config.skillRarity` for DISPLAY/FLAVOR only, with no gameplay effect
// (Req 36.4-36.5, 12.6, 12.13).
export {
  WORLD_FIRST_MILESTONES,
  MILESTONE_ORDER,
  worldFirstMilestone,
  skillForMilestone,
  skillRarity,
  applyMilestoneToUnlockedSkills,
  applyMilestoneToSave,
  unlockSkillForWorldFirstCompletion,
} from './skillUnlockSchedule.ts';
export type {
  SkillUnlockMilestone,
  MilestoneUnlockResult,
} from './skillUnlockSchedule.ts';

// The ProgressionSystem — the WORLD-UNLOCK + ENDLESS-CONTINUATION flow for a
// single STORY run (task 7.3; design: "World unlock flow (Req 7.1–7.8)",
// "Difficulty ramp (Req 7.6, 23.3)"; Req 7.1-7.6, 7.8). A PURE, deterministic
// state machine keyed on the run SCORE: preThreshold → thresholdReached (emits
// a ONE-TIME next-world unlock intent + the ordered [newWorldUnlocked,
// endlessStarting] message sequence, Req 7.1-7.3) → endlessContinuation (the
// SAME run keeps going, Req 7.4, with NO auto-transition, Req 7.5). Its
// `difficulty(obstaclesCleared)` ramps speed AND density PAST the 50-point
// threshold for worlds 1-4 while staying within the ObstacleSpawner's feasible
// bounds (Req 7.6), `computeNextWorld` caps at World 5 (no next world / no
// endless, Req 23.2), and `unlockedWorlds` reads the selectable worlds from a
// Save_Store `worlds` map (Req 7.8). It does NOT fold in high-score tracking
// (task 7.6), the skill-unlock schedule (task 7.5), or endless ability
// restriction (task 7.8) — those are their own modules. The GameplayScene
// applies the save mutation + persistence and renders the messages.
export {
  createProgressionSystem,
  computeNextWorld,
  unlockedWorlds,
} from './progressionSystem.ts';
export type {
  ProgressionSystem,
  ProgressionSystemOptions,
  ProgressionPhase,
  ProgressionMessageId,
  ProgressionEvent,
  WorldUnlockIntent,
} from './progressionSystem.ts';

// High-score tracking per world and mode (task 7.6; design: "Save round-trip
// (Req 22.6–22.7, 28)"; Req 28.1-28.4, Property 11). PURE and Phaser-free. The
// stored High_Score is the monotonic per-world/per-mode MAXIMUM: `recordScore`
// returns a NEW highScores map whose (mode, world) entry is max(existing,
// score) and reports `updated` ONLY when the value strictly increased (Req
// 28.3); story and endless are tracked SEPARATELY per world (Req 28.1-28.2);
// `getHighScore` reads the relevant value for the menu/run-end screen,
// defaulting to 0 (Req 28.4). The run's MODE is an explicit 'story'|'endless'
// discriminator (NOT MovementMode); `highScoreModeForMovement` bridges a
// Movement_Mode / the 'endless' sentinel to it, keeping this module consistent
// with `runEndStats.relevantHighScore`. `recordScoreOnSave` folds a run score
// into a whole SaveState; it deliberately leaves `highScoreHistoryByGeneration`
// (Req 31.2) to the task-7.4 generation-transition flow.
export {
  recordScore,
  recordScoreOnSave,
  getHighScore,
  highScoreModeForMovement,
} from './highScoreTracker.ts';
export type {
  HighScoreMode,
  RecordScoreResult,
  RecordScoreOnSaveResult,
} from './highScoreTracker.ts';

// The EndlessMode module — the standalone high-score mode for completed worlds
// (task 7.8; design: "Endless ability restriction (Req 23.7–23.8)", "Difficulty
// ramp (Req 7.6, 23.3)"; Req 23.1, 23.2, 23.3, 23.6, 23.7, 23.8, 23.9). PURE and
// Phaser-free. Owns the ENDLESS ABILITY ALLOW-LIST (`allowedEndlessModes` — the
// abilities learned up to & including a world in STORY ORDER, Req 23.7-23.8),
// endless SUPPORT (`supportsEndless` — worlds 1-4 yes, World 5 no, Req 23.1-23.2),
// a restricted procedural LOOPING sequence plan (`buildEndlessSequencePlan` —
// drawn only from the allow-list so a SequenceDirector built from it can NEVER
// schedule a later-world ability, the structural guarantee behind Property 9),
// a structural VALIDATOR (`validateEndlessPlanModes` — returns offending modes,
// empty when clean), the endless DIFFICULTY ramp (`endlessDifficulty` +
// `endlessBoundaryDistancesPx` — speed/density/config difficulty and transition
// frequency all ramp with progress while staying feasible, Req 23.3), and the
// NO-STORY-PROGRESS contract (`buildEndlessRunConfig` /
// `endlessAwardsNoStoryProgress` — an endless run awards no story progress,
// unlocks, perks, or cosmetics and offers no perk choices, Req 23.6, 23.9). It
// does NOT own endless high-score tracking (task 7.6) or the map-screen endless
// control/confirmation UI (Req 23.4-23.5, engine concern).
// The GenerationTransition — the PURE save-side coordination of the two
// generational lifecycle events (task 7.4; design: "Left-behind worlds (Req
// 27.15-27.16)", "Generations (Req 22, 29, 32)"; Req 27.15-27.16, 22.3-22.5,
// 32.1-32.3, 32.5). PURE and Phaser-free. It owns (1) LEFT-BEHIND marking —
// advancing PAST a story world sets `leftBehind` (`markLeftBehind`), which fully
// locks STORY access (`canPlayStory`/`isLeftBehind`) while keeping earned
// rewards valid and leaving Endless the only return path (Req 27.15-27.16); and
// (2) the GENERATION ADVANCE — `advanceGeneration` awards a UNIQUE per-generation
// cosmetic to BOTH `unlockedCosmetics` + `generationCosmeticsAwarded` (Req 22.4),
// steps the Generation_Name one hop along Junior→Senior→next-iteration-Junior
// (`nextGeneration`, Req 32.3), resets per-generation STORY state (clears
// `storyCleared`/`leftBehind` while KEEPING permanent greyed discovery, Req 22.3,
// 32.5), and preserves all permanent skills/cosmetics/bindings/settings/high
// scores (Req 22.5). The pure Generation_Name composition (`toRoman`,
// `formatGenerationName`, `composeGenerationName`) lives here so core + engine
// share one implementation; `src/engine/generationName.ts` re-exports it.
export {
  toRoman,
  formatGenerationName,
  composeGenerationName,
  nextGeneration,
  markLeftBehind,
  isLeftBehind,
  canPlayStory,
  advanceGeneration,
} from './generationTransition.ts';
export type {
  AdvanceGenerationOptions,
  AdvanceGenerationResult,
} from './generationTransition.ts';

export {
  STORY_ABILITY_ORDER,
  supportsEndless,
  allowedEndlessModes,
  allowedEndlessModeSet,
  isEndlessModeAllowed,
  validateEndlessPlanModes,
  buildEndlessSequencePlan,
  endlessBoundaryDistancesPx,
  endlessDifficulty,
  buildEndlessRunConfig,
  endlessAwardsNoStoryProgress,
} from './endlessMode.ts';
export type { EndlessRunConfig } from './endlessMode.ts';

// The Animation_Frame key surface — the PURE single source of truth for every
// named frame a pose can take and the mode<->frame legality (Req 30.7-30.12,
// 33.9-33.14). Moved into core so the frame-cycle selection (task 8.3) can share
// the keys without reaching into `src/engine/**` (the core↔engine boundary
// forbids that). `src/engine/render/cosmeticAnchors.ts` re-exports these so the
// Phaser-side anchor table and KinoRenderer keep their existing API.
export {
  MODE_FRAMES,
  isFrameForMode,
  defaultFrameForMode,
} from './animationFrames.ts';
export type { AnimationFrame, AnchorOffset } from './animationFrames.ts';

// The Animation_Frame CYCLE — the PURE, Phaser-free frame-selection state
// machine (task 8.3; design: "Visual Direction"; Req 30.4-30.5, 30.7-30.15). A
// total, deterministic function of (mode, elapsed/tick, grounded,
// verticalVelocity, zigzagDirection, transitionActive, finalePhase) that returns
// the current frame per the per-mode cycles plus the two overrides (transition
// spin, World-5 finale crawl→run). KinoRenderer calls `selectAnimationFrame`
// each tick and feeds the result to `setPose`. Jumping grounded = ground walk
// cycle, airborne = jump arc; flight = pitch arc, reused unchanged by underwater
// (Req 30.9); zigzag = diagonal leg direction; spin-1/2 while transitioning (Req
// 30.11); crawl then run in the finale (Req 30.14-30.15).
export {
  selectAnimationFrame,
  DEFAULT_FRAME_DURATION_MS,
  APEX_VELOCITY_EPSILON,
} from './animationFrameCycle.ts';
export type {
  FrameCycleInput,
  FinalePhase,
} from './animationFrameCycle.ts';

// The CosmeticInventory — the PURE, Phaser-free cosmetic equip/unlock algebra
// over the `kino.save.v1` Save_Store (task 8.2; design: "Perk system (Req 10,
// 11)", "Save_Store schema (Req 22, 28, 40)"; Req 19.5, 19.7, 10.11). Operates
// on the two PERMANENT cosmetic save fields (`unlockedCosmetics`,
// `equippedCosmetic`): `equip` sets the SINGLE equipped cosmetic and unequips
// any previous (Req 19.7), rejecting unowned cosmetics as a no-op (they are
// non-selectable); `unlock` / `recordRandomDrop` add to the permanent owned set
// idempotently (Req 19.5, 10.11); `unequip` clears the selection; and the
// `isUnlocked` / `equippedCosmetic` / `unlockedCosmetics` queries read them.
// Cosmetics persist permanently across generations because these functions only
// ADD to the owned set and never clear it — `advanceGeneration` carries the
// fields forward and the Property 8 round-trip preserves them exactly.
export {
  isUnlocked,
  equippedCosmetic,
  unlockedCosmetics,
  unlock,
  recordRandomDrop,
  equip,
  unequip,
} from './cosmeticInventory.ts';

// The Adaptive_Layout math — the PURE, Phaser-free layout computation (task
// 9.9; design: "Adaptive scaling (26.10–26.12)"; Req 26.10, 26.11, 26.12).
// Fits a fixed squarish DESIGN resolution (the desktop-style target) into any
// ACTUAL desktop/tablet viewport with ONE uniform aspect-preserving scale and
// a centered letterbox offset (contain fit — nothing stretches, Req 26.11),
// then maps design-space points/rects into actual screen space so every UI +
// gameplay element repositions AND rescales proportionally on a screen-size
// change (Req 26.10, 26.12). `src/engine` subscribes to the Scale Manager
// resize event and APPLIES the result; this module owns only the math.
export { computeLayout, mapPoint, mapRect } from './adaptiveLayout.ts';
export type {
  Size,
  Point,
  LayoutRect,
  AdaptiveLayout,
} from './adaptiveLayout.ts';

// The PURE treasure-map STATE logic (task 9.1; design: "UI / Menu > Treasure
// map (20.2, 20.27–20.28, 34)"; Req 20.2-20.6, 20.18-20.22, 20.27-20.28,
// 34.1-34.3). Phaser-free single source of truth for the vertical map rows and
// the World-selection LOCK-IN: `computeMapRows(save)` orders one row per World
// (World 1 bottom → World 5 top, Req 20.27) with each row's display state
// (greyed for completed/discovered, next-reveal fading in at top, black
// silhouette for undiscovered), one checkpoint per world, and the Kino location
// marker; `lockInWorldForScroll(rows, scrollCenter)` snaps the map center to
// the nearest row and resolves the Locked_In_World + side glow + Play
// enablement — a centered discovered world locks in with glow and Play enabled
// (Req 34.1-34.2), a centered undiscovered silhouette locks nothing, shows no
// glow, is flagged unselectable, and disables Play (Req 34.3). The MainMenuScene
// renders the rows and feeds its scroll offset back in; it never decides
// selection itself.
export {
  TREASURE_MAP_WORLD_IDS,
  computeMapRows,
  lockInWorldForScroll,
  computeTreasureMap,
} from './treasureMap.ts';
export type {
  WorldKey,
  MapRowDisplayState,
  MapRow,
  MapLayout,
  LockInResult,
} from './treasureMap.ts';

// The InfoPanel view-model — the PURE assembly of the menu's Info /
// run-statistics panel (task 9.6; design: "Info panel (31)"; Req 20.10, 31.1,
// 31.2). PURE and Phaser-free: `buildInfoPanelViewModel` reads the current-run
// counters (obstacles cleared, current score), the active Perks (rendered as
// signed ±% strings — Speed Boost "+N%", Reduced Skill Cooldown "-N%", matching
// how perkSystem applies them), the equipped Skill id (with an optional
// id→name resolver the engine backs with the Config_File labels), and the
// Save_Store's high-score state — returning per-World this-generation High_Scores
// (`highScores.story`, Req 28.1) alongside the BEST per-World High_Scores rolled
// up across PAST generations from `highScoreHistoryByGeneration` (Req 31.2). It
// returns a plain serializable view-model and does NO rendering; the engine
// (MainMenuScene / a thin panel component) renders it verbatim.
export { buildInfoPanelViewModel } from './infoPanel.ts';
export type {
  InfoPanelViewModel,
  InfoPanelInput,
  InfoPanelPerkEffect,
  InfoPanelEquippedSkill,
  InfoPanelWorldHighScore,
} from './infoPanel.ts';

// The PURE binding vocabulary + parse (task 9.7; design: "Input mapping (1)";
// Req 1.2-1.5, 22.7). The SINGLE SOURCE OF TRUTH for classifying a stored
// control-binding string as a keyboard key or a `MOUSE_*` pointer button and
// for the mouse-button vocabulary. Moved into core so the Settings_Screen
// rebinding LOGIC (also pure) can classify a captured control and NAME a
// conflicting control without reaching into `src/engine/**` (the core↔engine
// boundary forbids that). `src/engine/input/bindings.ts` RE-EXPORTS these as a
// shim, so every existing engine importer is unchanged — same discipline as
// task 8.3's Animation_Frame key relocation.
export {
  MOUSE_TOKENS,
  MOUSE_BUTTON_INDEX,
  canonicalizeBinding,
  parseBinding,
  parseBindings,
  parseControlBindings,
} from './bindings.ts';
export type {
  BindingKind,
  MouseButton,
  ParsedBinding,
  InputAction,
  ParsedControlBindings,
  ControlBindingsInput,
} from './bindings.ts';

// The PURE Settings_Screen logic (task 9.7; design: "SettingsScene (overlay)",
// "Control rebinding failures (Req 1.7, 1.9)"; Req 20.48-20.51, 1.6-1.9, 25.7).
// Phaser-free decisions the thin engine SettingsScene overlay defers to:
// `setVolume`/`setMuted` produce a new save with volume clamped to [0,1] (Req
// 20.49, 25.7); `rebind` attempts a reconfiguration and returns a RESULT union
// — applied, or REJECTED with a naming conflict message when the new control
// collides with the OTHER of the primary/skill bindings (and ONLY those, Req
// 1.7), never applying a rejected rebind; `applyRebindWithPersist` models the
// Req 1.9 rollback — it applies an accepted rebind, attempts an INJECTED persist,
// and on failure restores the previous binding so it stays active until persist
// succeeds; `resetToFirstLaunch` yields a fresh First_Launch_State for the
// confirmed reset-save (Req 20.51, the engine owns the Req 20.50 confirm gate).
export {
  clampVolume,
  setVolume,
  setMuted,
  rebind,
  applyRebindWithPersist,
  resetToFirstLaunch,
  REBIND_ACTION_LABELS,
} from './settingsScreen.ts';
export type {
  RebindAction,
  RebindResult,
  PersistFn,
  ApplyRebindOutcome,
} from './settingsScreen.ts';

// The MenuControls primary-button logic (task 9.2; design: "Menu controls
// (20.23–20.26), bottom primary Start/Continue button (label from config by
// story position, 20.13)"; Req 20.11, 20.13, 20.14, 20.15, 20.25, 20.26). PURE
// and Phaser-free SINGLE SOURCE OF TRUTH for the bottom primary button: given a
// Save_Store and the Config_File labels, `resolvePrimaryButtonLabel` returns the
// label + action + the World a press launches, covering the exhaustive,
// mutually-exclusive 13a–13d cases — 13a (World 1, story not started) => the
// config `startStory` label; 13b (position beyond World 1) and 13c (World 1,
// story started) => the config `continueStory` label; 13d => both label values
// always read from the config. `currentStoryPosition` / `hasStartedStory` are
// the two pure reads that partition story position; `generationPillText` reuses
// the existing `formatGenerationName` for the top-center Generation pill (Req
// 20.25) without duplicating the Generation_Name composition. The MainMenuScene
// renders the resolved label and, on press, calls `launchWorld` (Req 20.14).
export {
  resolvePrimaryButtonLabel,
  currentStoryPosition,
  hasStartedStory,
  generationPillText,
} from './menuControls.ts';
export type {
  PrimaryButtonAction,
  PrimaryButtonResolution,
} from './menuControls.ts';

// The PURE audio STATE / POLICY logic (task 12.1; design: "Audio"; Req
// 25.1-25.9). Phaser-free and WebAudio-free so the autoplay gate, the
// sound-event catalog, and the effective-gain computation are all unit-testable
// in plain Node, with the engine AudioManager (`src/engine/audio/AudioManager`)
// deferring every DECISION here. `createAudioPolicy(settings)` is the gate +
// catalog state machine: `requestPlay(event)` returns 'play' | 'queued' |
// 'suppressed' (muted) — before the first `onUserInteraction()` every non-muted
// request QUEUES (Req 25.9) and nothing sounds, and on unlock the queued events
// FLUSH in order; `effectiveGain(volume, muted)` is `muted ? 0 : clampVolume`
// reusing the Settings clamp (Req 25.7-25.8); `createAudioCatalog` maps each
// movement mode (jumping/flight/zigzag/underwater, Req 25.1) + evolution /
// collision / UI / mentor reaction / per-world music (Req 25.2-25.6) to a
// DISTINCT Asset_Registry key. Volume/mute originate in the Save_Store
// SettingsState and are changed by `settingsScreen.setVolume`/`setMuted`; this
// module only READS them.
export {
  createAudioPolicy,
  createAudioCatalog,
  effectiveGain,
  AUDIO_WORLD_IDS,
} from './audioSystem.ts';
export type {
  AudioEvent,
  AudioPolicy,
  AudioPolicyOptions,
  AudioCueEntry,
  AudioPlaybackKind,
  PlayDecision,
  MusicWorldId,
} from './audioSystem.ts';

// The Inventory_Panel view-model + selection algebra (task 9.4; design: "UI /
// Menu > Inventory_Panel (12.8–12.14, 19, 20.42–20.47, 43)"; Req 12.7-12.14,
// 19.7, 20.44-20.47, 36.6). PURE and Phaser-free SINGLE SOURCE OF TRUTH for the
// panel STATE: `buildInventoryViewModel(save, config, tab, options?)` returns a
// tab's ordered grid — each item carrying id/label/rarity/color plus
// owned/equipped/selectable (selectable iff owned, so locked skills + unowned
// cosmetics render greyed non-selectable, Req 12.11/20.46) — along with the
// equipped id and the preview id (the equipped item of that type, previewed
// above Kino, Req 20.9/20.17/20.43). `equipItem(save, tab, id)` is the single
// pure write: it equips an OWNED item SINGLE-SELECT (Req 12.15/19.7) — delegating
// COSMETICS to `cosmeticInventory.equip` (reused, not duplicated) and mirroring
// the same rule onto `Save_Store.equippedSkill` for SKILLS — and no-ops on a
// non-selectable item. Rarity colors come from `config.cosmeticRarityColors` for
// BOTH skills and cosmetics so a shared tier shares one color (Req 12.14/36.6),
// and the skills catalog + rarity are derived from `skillUnlockSchedule`
// (`MILESTONE_ORDER`/`skillForMilestone`/`skillRarity`). The InventoryScene
// renders the view-model and calls `equipItem` on a selection; it decides none
// of the selection rules itself.
export {
  buildInventoryViewModel,
  equipItem,
  isOwned,
  equippedId,
  skillCatalogOrder,
  rarityColor,
} from './inventoryPanel.ts';
export type {
  InventoryTab,
  InventoryItem,
  InventoryViewModel,
  CosmeticCatalogEntry,
  InventoryViewModelOptions,
} from './inventoryPanel.ts';

// The Play-button expand transition MATH (task 9.8; design: "Play-button expand
// transition (Req 20.36–20.38, 20.12)"; Req 20.12, 20.36, 20.37, 20.38). PURE
// and Phaser-free: the reusable, deterministic math behind the Play/Continue-
// Story launch choreography that the engine MainMenuScene drives with tweens.
// `computeGlide(from, to, t)` / `glideScalar(from, to, t)` are the eased
// (smoothstep) clamped interpolations Kino's glide-to-start and the upward
// color-fill rise follow — exactly `from` at t=0, `to` at t=1, monotonic
// between; `easeInOut` is the shared easing. `computeRunStartPosition(screen)`
// derives where Kino must stabilize for the run from the SAME fixed-Kino
// geometry GameplayScene uses (left third, resting on the ground strip) so the
// glide ends exactly where the run seeds Kino with no hand-off jump.
// `resolvePlayTransitionTiming(config)` resolves the three ordered phase
// durations (expand → fade → glide) with safe defaults + a total. The engine
// owns the Phaser tween/particle wiring; this module owns only the math.
export {
  easeInOut,
  computeGlide,
  glideScalar,
  computeRunStartPosition,
  resolvePlayTransitionTiming,
  DEFAULT_RUN_START_GEOMETRY,
  DEFAULT_PLAY_TRANSITION_TIMING,
} from './playTransition.ts';
export type {
  TransitionPoint,
  TransitionScreen,
  RunStartGeometry,
  PlayTransitionTiming,
  PlayTransitionTimingConfig,
} from './playTransition.ts';

// The CinematicSequence player (task 10.1; design: "Cinematics System (Req 21,
// 29, 42)"; Req 21.3, 21.18, 21.21). PURE and Phaser-free SINGLE SOURCE OF
// TRUTH for cinematic SEQUENCING: `createCinematicPlayer(panels)` is a
// deterministic, config-driven, SKIPPABLE, panel-by-panel state machine over an
// ordered Comic_Panel array (the CONTENT comes from the Config_File / the
// specific cinematic tasks 10.2–10.5, never from this framework). It exposes
// `current()` (the panel, or null when empty/complete), `advance()` (next panel
// or `'done'` at the end), `skip()` (complete immediately from any index —
// Req 21.3/21.18/21.21), `isComplete()`, and the `index`/`length` cursor. It
// starts on panel 0, walks panels in order, treats advancing past the end and a
// double skip as idempotent no-ops, and treats an EMPTY panels array as
// immediately complete — so the generic CinematicScene (and BootScene's
// first-boot routing to 'Cinematic') resolves and hands back even before the
// opening-cinematic content lands. The engine CinematicScene renders the
// current panel comic-book style and defers ALL sequencing here.
export { createCinematicPlayer } from './cinematicSequence.ts';
export type {
  CinematicPanel,
  ComicPanel,
  CinematicPlayer,
} from './cinematicSequence.ts';

// The endless-mode TRIANGLE-TRIGGER activation read (task 9.3; design: "UI /
// Menu > Treasure map", "Endless Mode (Req 23.4-23.5)"; Req 20.29-20.31, 23.4).
// PURE and Phaser-free. `isEndlessTriangleActive(save, worldKey)` reports
// whether a World panel's right-side Endless_Mode triangle (Req 20.29) is
// ACTIVE (that world's story is CLEARED — Req 20.31, 23.4) vs greyed/LOCKED
// (not yet cleared — Req 20.30). The SAME `storyCleared` gate is folded PER ROW
// into `MapRow.endlessUnlocked` by `computeMapRows`, so the MainMenuScene can
// read the active/locked state straight off the row it already renders OR ask
// this standalone question for a single world. Whether a cleared world actually
// SUPPORTS an endless run (worlds 1-4, not World 5) stays with
// `endlessMode.supportsEndless` — this helper only governs the trigger's
// active/locked visual + interactivity.
export { isEndlessTriangleActive } from './treasureMap.ts';

// The menu equip jiggle MATH — the PURE, Phaser-free "jello bob" equip-feedback
// curve + config/timing resolution (task 9.5; design: "Cosmetics & Layered
// Rendering (Req 19, 43)"; Req 43.1, 43.2, 43.3, 43.4, 43.5). MENU-ONLY and
// DISTINCT from the gameplay Animation_Frame cycles (it does NOT reuse
// `animationFrameCycle`'s per-mode selection, Req 43.3). `jelloBob(t)` is the
// squash-and-stretch curve over normalized time t in [0,1] — NEUTRAL (identity)
// at t=0 and t=1 so the item rests (Req 43.3) and a visible bob in between (Req
// 43.1-43.2); `resolveEquipJiggleConfig(config)` reads the "menu-equip-jiggle"
// asset key with the documented placeholder fallback when it is missing/empty
// (Req 43.4-43.5) plus the brief default timing. The engine InventoryScene plays
// the tween over `durationMs` on the equipped-item preview; this module owns
// only the math.
export {
  resolveEquipJiggleConfig,
  jelloBob,
  EQUIP_JIGGLE_PLACEHOLDER_KEY,
  DEFAULT_EQUIP_JIGGLE_DURATION_MS,
  DEFAULT_EQUIP_JIGGLE_BOBS,
  DEFAULT_EQUIP_JIGGLE_AMPLITUDE,
  NEUTRAL_JELLO_TRANSFORM,
} from './equipJiggle.ts';
export type {
  EquipJiggleConfig,
  JelloTransform,
  ResolveEquipJiggleOptions,
} from './equipJiggle.ts';

// The OpeningCinematic CONTENT + band-state math (task 10.2; design: "Cinematics
// System (Req 21, 29, 42)" → "Opening (21.1, 21.11–21.18)"; Req 21.1, 21.11,
// 21.12, 21.13, 21.14, 21.15, 21.16, 21.17). PURE and Phaser-free. It supplies
// the opening cinematic's ORDERED Comic_Panel sequence the pure
// `createCinematicPlayer` walks — henhouse + egg knock (21.11), egg rolls to the
// button (21.11), the permission-denied gag using `config.labels.permissionGag`
// (21.12), ground opens + egg falls (21.13), the five-band descent World 5 top →
// World 1 bottom (21.14-21.16), World 1 band expands for the landing (21.16),
// and the hatch into a walking ghost that then gains Jumping (21.17) —
// via `buildOpeningCinematicPanels(input)`, taking its config values (gag text,
// world names, placeholder-friendly asset keys) as plain inputs so it never
// imports the config/engine layers. It ALSO owns the band-state SINGLE SOURCE OF
// TRUTH `computeBandStates(eggBandIndex)` (task 10.6's focused test target): a
// pure map from the egg's band index to the five bands' states top→bottom —
// occupied band `shown`, not-yet-reached `hidden`, already-passed `greyed` (Req
// 21.15-21.16) — under the documented convention index 0 = top = World 5 …
// index 4 = bottom = World 1, egg index INCREASING as it descends. The engine
// CinematicScene resolves these panels for OPENING_CINEMATIC_ID and renders them.
export {
  computeBandStates,
  worldIdForBandIndex,
  buildOpeningCinematicPanels,
  BAND_COUNT,
  BAND_WORLD_IDS_TOP_TO_BOTTOM,
  TOP_BAND_INDEX,
  BOTTOM_BAND_INDEX,
  OPENING_PANEL_IDS,
} from './openingCinematic.ts';
export type {
  BandState,
  OpeningBeatKind,
  OpeningCinematicContentInput,
} from './openingCinematic.ts';

// The WorldCompletionCinematic CONTENT + silhouette-reveal / cross-generation
// greying STATE (task 10.4; design: "Cinematics System (Req 21, 29, 42)"; Req
// 21.6, 21.7, 21.10 (= Req 32.5)). PURE and Phaser-free. It supplies the SHORT
// world-completion Comic_Panel sequence the pure `createCinematicPlayer` walks —
// a brief "world cleared!" celebration for the just-cleared world, the newly-
// unlocked world's silhouette dissolving to reveal it (only when a world was
// unlocked), and the return-to-menu hand-off beat — via
// `buildWorldCompletionCinematicPanels(input)`, taking its config values (world
// names, placeholder-friendly asset keys) as plain inputs so it never imports
// the config/engine layers (Req 21.6, 21.7). It ALSO owns the PURE reveal STATE
// that REUSES (does not duplicate) the treasure-map display model:
// `computeSilhouetteReveal(updatedSave, unlockedWorldId)` reports the dissolve
// target (the newly unlocked world) and confirms — via the EXISTING
// `computeMapRows` on the updated save — that the revealed world renders GREYED
// rather than a black silhouette (Req 21.7); and
// `computeGenerationGreying(newGenerationSave)` classifies each world on a NEW
// generation's map so previously-discovered worlds render GREYED rather than
// BLACK (Req 21.10 / Req 32.5). The engine CinematicScene resolves these panels
// for WORLD_COMPLETION_CINEMATIC_ID and hands back to the MENU on completion.
export {
  WORLD_COMPLETION_CINEMATIC_ID,
  WORLD_COMPLETION_PANEL_IDS,
  buildWorldCompletionCinematicPanels,
  computeSilhouetteReveal,
  computeGenerationGreying,
  worldKeyForId,
} from './worldCompletionCinematic.ts';
export type {
  WorldCompletionBeatKind,
  WorldCompletionContentInput,
  SilhouetteRevealState,
  GenerationGreyingRow,
} from './worldCompletionCinematic.ts';

// The MentorCutscene CONTENT + rules (task 10.3; design: "Cinematics System
// (Req 21, 29, 42)"; Req 21.2, 21.4, 21.5, 29.1-29.12, 42.1-42.6, 39.4). PURE
// and Phaser-free. It supplies the per-world mentor cutscene ORDERED
// Comic_Panel sequence the pure `createCinematicPlayer` walks — one dialogue
// panel per `config.mentorDialogue[worldN]` line, each carrying the SPEAKER-SWAP
// layout state (the ACTIVE speaker's sprite + chatbox shown, the OTHER greyed in
// a background corner, ALTERNATING line-by-line as the speaker changes, over the
// animated `config.worldBackgrounds[worldN]` background — Req 42.1-42.6),
// followed by the EVOLUTION beat (World 1 egg-crack into the ghost hatchling,
// worlds 2-5 a subtle evolve, carrying the `config.evolutionStyle`
// electric-zap-glow-burst default — Req 29.9-29.11) — via
// `buildMentorCutscenePanels(input)`, taking its config values (dialogue, mentor
// name/symbol/image, world background, evolution style) as plain inputs so it
// never imports the config/engine layers. It ALSO owns the SKIP-ON-RETRY rule
// `shouldPlayMentorCutscene(world, alreadyEvolvedThisGeneration)` — false (skip)
// on a same-generation retry when Kino is already evolved for that world
// (restart / menu Continue/Play / Run_End retry, Req 21.4/39.4), true (play) on
// a world's first entry in the generation, including after a new generation
// resets the evolved flags (Req 21.2/21.5). The evolved-this-generation flag is
// PER-GENERATION engine RUN STATE (tracked on the engine shared context), NOT
// persisted to the Save_Store (Req 22.3/22.7) — the predicate stays pure. The
// engine CinematicScene resolves these panels for MENTOR_CUTSCENE_ID, renders
// the animated background + speaker-swap layout + evolution effect, and on
// completion hands off INTO the run (GameplayScene); it SKIPS the cutscene when
// the world's current-generation evolved flag is already set.
export {
  MENTOR_CUTSCENE_ID,
  MENTOR_CUTSCENE_PANEL_IDS,
  DEFAULT_EVOLUTION_STYLE,
  buildMentorCutscenePanels,
  buildEvolutionDescriptor,
  evolutionKindForWorld,
  shouldPlayMentorCutscene,
} from './mentorCutscene.ts';
export type {
  MentorBeatKind,
  MentorSpeaker,
  EvolutionKind,
  MentorDialogueLineInput,
  MentorCutsceneContentInput,
  SpeakerSwapLayout,
  EvolutionDescriptor,
} from './mentorCutscene.ts';

// The World5Plan composition (task 11.1; design: "Per-world sequence
// composition" row 5, "World 5 scripted finale (Req 8.7–8.15, 45.5)"; Req
// 8.1-8.6). PURE and Phaser-free SINGLE SOURCE OF TRUTH for the World 5
// (Security Citadel) STORY `sequencePlan`: `buildWorld5SequencePlan()` chains
// Flight / Zigzag / Underwater Sequences (environment-forced, telegraphed
// transitions; water-gated at the Underwater↔Flight boundaries exactly like
// World 4) with NO Jumping in the pre-finale chain (Jumping is finale-only, Req
// 8.6), makes the Sequence IMMEDIATELY before the finale a FLIGHT Sequence (Req
// 8.2-8.3), and ENDS on a single scripted FINALE `SequenceSpec` flagged
// `isFinale: true` (Req 8.8) whose mode is Jumping — the terminal boundary task
// 11.2's engine-side crawl→run→jump finale hooks into (it does NOT run the
// finale itself). `validateWorld5Plan` / `isValidWorld5Plan` are the structural
// guards (mirroring endlessMode.validateEndlessPlanModes): they return the Req
// 8.2-8.6/8.8 violations (empty when well-formed), flagging a Jumping-containing
// pre-finale chain or a non-Flight-terminal plan; `world5FinaleIndex` locates
// the finale boundary. It does NOT drive transitions (sequenceDirector.ts) and
// carries no Phaser.
export {
  WORLD5_PREFINALE_MODES,
  WORLD5_FINALE_MODE,
  buildWorld5SequencePlan,
  world5FinaleIndex,
  validateWorld5Plan,
  isValidWorld5Plan,
} from './world5Plan.ts';
export type { World5PlanViolation } from './world5Plan.ts';

// The EndingCinematic CONTENT + ending generation-advance math (task 10.5;
// design: "Cinematics System (Req 21, 29, 42)"; Req 21.8, 21.9, 21.19, 21.20,
// 32.3, 32.4). PURE and Phaser-free. It supplies the FINAL ending ORDERED
// Comic_Panel sequence the pure `createCinematicPlayer` walks when Kino Jumps
// through the World-5 portal barrier (Req 8.15 → 21.8) — REUNION (home to the
// henhouse, grown family) → START A FAMILY (carrying this ending's
// SAME-iteration Junior→Senior advance, Req 21.19/32.3) → KNOCK THE NEXT EGG
// (labelled the NEXT iteration + Junior, looping the story, Req 21.20/32.4) →
// CREDITS (one panel per `config.cinematics.creditsSlots`) → BLOOPER outtakes
// (one panel per `config.cinematics.blooperSlots`, referencing the
// creator/inspiration, Req 21.9) — via `buildEndingCinematicPanels(input)`,
// taking its config values (generation + scheme + base name, credits/blooper
// slots, placeholder-friendly asset keys) as plain inputs so it never imports
// the config/engine layers; everything stays skippable via the pure player.
// It ALSO owns the ending's GENERATION ADVANCE math (Req 32.3/32.4) which REUSES
// (does not duplicate) `generationTransition`'s `formatGenerationName` +
// `nextGeneration`: `advanceToThisEndingSenior` (Junior→Senior, SAME iteration),
// `nextEggGeneration` (the NEXT iteration's Junior), `computeEndingGenerationAdvance`
// (the three states), and `computeEndingGenerationLabels` (those states run
// through the shared name composer). The engine CinematicScene resolves these
// panels for FINAL_ENDING_CINEMATIC_ID and, on completion, hands back to the
// menu / loops.
export {
  FINAL_ENDING_CINEMATIC_ID,
  FINAL_ENDING_PANEL_IDS,
  buildEndingCinematicPanels,
  advanceToThisEndingSenior,
  nextEggGeneration,
  computeEndingGenerationAdvance,
  computeEndingGenerationLabels,
} from './endingCinematic.ts';
export type {
  EndingBeatKind,
  EndingCinematicContentInput,
  EndingGenerationLabels,
  EndingGenerationAdvance,
} from './endingCinematic.ts';

// The FinaleSequence controller — the PURE, Phaser-free scripted-finale STATE
// MACHINE for the World 5 auto-controlled finale (task 11.2; design: "World 5
// scripted finale (Req 8.7–8.15, 45.5)"; Req 8.7-8.15, 45.5). PURE and
// Phaser-free. `createFinaleController(options?)` is a deterministic phase
// machine over accrued scripted-progress distance modeling crawl → run → jump:
// DESCEND (Flight disabled, Kino descends to the ground — Req 8.7) → CRAWL
// (automatic rightward crawl locomotion, the crawl-step cycle, the SANCTIONED
// horizontal-movement exception — Req 8.9-8.11/45.5) → RUN (automatic rightward
// running, the run-step cycle — Req 8.12) → AT_BARRIER (the portal barrier; the
// final Jump becomes ENABLED — Jumping was unavailable until here, Req 8.13-8.14)
// → JUMPED_THROUGH (the final jump carries Kino through into the final cinematic
// — Req 8.15). It exposes the pure driver (`advance(delta)` / `currentPhase()`),
// `jumpEnabled()` (false until AT_BARRIER, Req 8.13), `isAutoControlled()` (true
// through DESCEND/CRAWL/RUN — the engine ignores player locomotion input and
// scripts Kino's x, Req 8.9-8.12), the LOCOMOTION hook (`locomotionPhase()` +
// `locomotionFrame(clock?)` REUSE the FinalePhase + `selectAnimationFrame` from
// animationFrameCycle.ts to produce crawl-step/run-step frames — NOT duplicated),
// the one-shot final `jump()` (valid ONLY at the barrier, Req 8.14-8.15), and
// `isComplete()` / `endingCinematicId()` which report "finale complete → play
// ending" via the REUSED FINAL_ENDING_CINEMATIC_ID (endingCinematic.ts, task
// 10.5). The engine (GameplayScene) reads these pure outputs to disable Flight,
// descend Kino, script the crawl→run locomotion, gate the jump, and on the
// jump-through start the CinematicScene with FINAL_ENDING_CINEMATIC_ID; it does
// NOT start scenes or touch Phaser itself.
export {
  createFinaleController,
  FINALE_PHASES,
  DEFAULT_FINALE_DISTANCES,
} from './finaleSequence.ts';
export type {
  FinaleController,
  FinaleControllerOptions,
  FinalePhaseName,
  FinaleDistanceConfig,
  FinaleLocomotionClock,
} from './finaleSequence.ts';

// The performance / optimization pure core (task 12.3; design: "Performance &
// Optimization Guidelines" → "Frame budget / 60 fps target", "Obstacle &
// particle pooling / memory management"; Req 26.3, 26.4, 26.5, 26.9). PURE and
// Phaser-free so the reusable, testable pieces live in core and the engine only
// WIRES them to Phaser:
//
//   - `createObjectPool` — a generic acquire/release pool with a factory + reset
//     fn, sized to a worst-case `capacity`, so acquire-on-spawn / release-off-
//     screen does ZERO per-frame allocation once warmed (same object identity
//     reused; never grows past capacity; double-release is a no-op). Req 26.3,
//     26.5. `worstCaseOnScreenCount` derives a view-pool capacity from
//     `minGapPx` + screen width + a safety margin (design pooling note).
//   - `resetObstacle` / `clearObstacle` / `createBlankObstacle` — the pure
//     `Obstacle` RECYCLE helpers that reset EVERY field incl. the `scored`
//     latch (reusing the bounds array in place), so a pooled `Obstacle` never
//     leaks stale state — esp. a stale `scored=true` — into a fresh spawn,
//     keeping Property 1 (exactly-once scoring) intact under reuse (Req 26.3/26.5).
//   - `createDegradationLadder` / `qualitySettingsForLevel` — the graceful-
//     degradation quality-level state machine: given a measured frame-time
//     signal it steps DOWN the ladder (reduce particles → parallax detail →
//     non-essential effects) under sustained overload and back UP when headroom
//     returns, with hysteresis so it never flaps, clamped at both ends, and
//     scoped to active gameplay (the engine samples it only during a live run).
//     Req 26.4, 26.9.
//   - `isWithinViewport` / `isRectWithinViewport` / `isScrolledOffLeft` — the
//     OFF-SCREEN CULLING predicates the engine uses to release pooled views once
//     a unit scrolls off the left and to limit the collision/update pass to the
//     viewport window (Req 26.3). `createBoundedBuffer` — a small ring buffer
//     that caps history/log length, dropping the oldest entry when full so the
//     heap stays flat over long endless runs (Req 26.5).
export {
  createObjectPool,
  worstCaseOnScreenCount,
} from './objectPool.ts';
export type {
  ObjectPool,
  ObjectPoolOptions,
  PoolFactory,
  PoolReset,
} from './objectPool.ts';

export {
  createBlankObstacle,
  resetObstacle,
  clearObstacle,
} from './obstacleRecycle.ts';
export type { ObstacleInit } from './obstacleRecycle.ts';

export {
  QualityLevel,
  MAX_QUALITY_LEVEL,
  DEFAULT_FRAME_BUDGET_MS,
  createDegradationLadder,
  qualitySettingsForLevel,
} from './degradationLadder.ts';
export type {
  QualitySettings,
  DegradationLadder,
  DegradationLadderOptions,
} from './degradationLadder.ts';

export {
  isWithinViewport,
  isRectWithinViewport,
  isScrolledOffLeft,
  createBoundedBuffer,
} from './offscreenCulling.ts';
export type { BoundedBuffer } from './offscreenCulling.ts';

// The multi-layer PARALLAX MODEL — the PURE, Phaser-free geometry behind the
// per-World parallax backgrounds (task 12.2a; design: "Visual Direction"; Req
// 30.3, supporting the comic-book aesthetic + saturated per-World palettes of
// Req 30.1/30.2/30.6 that the engine render treatment applies on top). PURE and
// Phaser-free: `parallaxOffset` / `parallaxOffsets` resolve each layer's
// rendered x-offset = -scrollX * factor from a layer's scroll factor in [0,1]
// (0 = static far backdrop, 1 = foreground moving 1:1 with the world scroll) so
// far layers move slower than near layers and read as depth; the per-World
// default stacks (`DEFAULT_WORLD_PARALLAX_LAYERS` / `defaultParallaxLayers`) are
// data-driven 4-layer far→near sets with NON-DECREASING factors that vary per
// World ("change per World", Req 30.3); and `visibleParallaxLayers` folds in the
// degradation ladder's parallax-detail scale by dropping the farthest/most
// subtle layers first while always keeping the nearest foreground (Req 26.9).
// GameplayScene builds these layers, tints them from the per-World
// Color_Palette, and scrolls each by its offset each frame; the aesthetic
// styling (outlines, cel-shading, halftone, contrast) is the engine render
// treatment applied over this geometry and works for placeholder + final art.
export {
  parallaxOffset,
  parallaxOffsets,
  defaultParallaxLayers,
  visibleParallaxLayers,
  DEFAULT_WORLD_PARALLAX_LAYERS,
} from './parallax.ts';
export type {
  ParallaxLayer,
  ParallaxLayerOffset,
} from './parallax.ts';

// The per-World ENVIRONMENT-ELEMENT CATALOG + PLACEMENT model — the PURE,
// Phaser-free DECORATION layer that dresses each World with its signature
// scenery on the task-12.2a parallax backdrop (task 12.2b; design: "Visual
// Direction"; Req 27.1-27.12). PURE and Phaser-free: `WORLD_ENVIRONMENT_ELEMENTS`
// / `environmentElementsForWorld(world)` list the decorative element KINDS per
// World — W1 desert highway / Route 53 signs / cacti / rocks / tumbleweeds
// (Req 27.1, 27.8); W2 mountains / lava rocks / pipes / compute structures
// (Req 27.2, 27.9); W3 jungle / vines / caves / paths (Req 27.3, 27.10); W4
// icebergs / icy structures / water surface / underwater scenery PLUS the icy
// surface navigated BEFORE the water (Req 27.4, 27.11); W5 data center /
// security infra / barriers / restricted zones (Req 27.5, 27.12) — each pinned
// to one of its World's `./parallax.ts` layer names with a deterministic
// spacing/phase/vertical band and a `decorative: true` flag (the structural
// guarantee these are NEVER collidable and NEVER enter the ObstacleSpawner /
// CollisionSystem — Req 41/44 body-only collision is unaffected). AWS
// references (e.g. "Route 53") ride as in-world `awsFlavor` signage only
// (Req 27.7). `placeElement` / `placeEnvironmentElements(world, startX, width)`
// deterministically lay repeats out along the scroll on a per-kind world-space
// grid anchored at x=0 (like obstacleSpawner's grid), so identical inputs yield
// identical placements with stable `<kind>-<index>` ids and overlapping windows
// agree on their overlap (recycle-safe). `elementsWithUnknownLayer` is a pure
// self-check that every element references a valid parallax layer name. The
// GameplayScene renders these placeholder-friendly comic-styled shapes on the
// matching parallax layer, scrolled with that layer's `-scrollX * factor` —
// render-only decoration, never fed to collision, scoring, or the Obstacle pool.
export {
  WORLD_ENVIRONMENT_ELEMENTS,
  environmentElementsForWorld,
  elementsWithUnknownLayer,
  placeElement,
  placeEnvironmentElements,
} from './environmentElements.ts';
export type {
  ElementSizeHint,
  EnvironmentElementSpec,
  EnvironmentElementPlacement,
} from './environmentElements.ts';

// The PURE palette APPLICATION / OVERLAY resolver (task 12.2c; design: "Visual
// Direction"; Req 27.13-27.14, 38.3-38.6). The single source of truth for each
// World's ELEMENT-LEVEL color treatment — background, obstacles, Kino — and the
// overlay/tint defaults from the Config_File. `resolvePaletteApplication(palette,
// context)` returns one treatment per target (base element color + the ORDERED
// active overlays composited on top); `activeOverlays` lists the overlays active
// for a render context and `isOverlayActive` is the single gate predicate (an
// overlay applies ONLY when its `appliesWhen` gate is active, or ALWAYS when it
// has none — Req 38.4/38.7). The ATOMIC `obstacles+kino` overlay (World 4's
// underwater blue) resolves IDENTICALLY into BOTH the obstacles and Kino
// treatments when its gate is active and is absent from both when it is not, so
// they can never fall out of sync (Req 38.4-38.6). Pure, deterministic color
// compositing (`parseHexColor`/`compositeColor`/`rgbToHex`) lives here too so
// the engine (GameplayScene) and tests share one implementation; the engine
// only APPLIES the resolved treatment to its Phaser render objects.
export {
  PALETTE_TARGETS,
  ATOMIC_OBSTACLES_KINO_TARGET,
  parseHexColor,
  rgbToHex,
  compositeColor,
  isOverlayActive,
  activeOverlays,
  resolvePaletteApplication,
} from './paletteApplication.ts';
export type {
  PaletteTarget,
  RenderContext,
  Rgb,
  ResolvedOverlay,
  TargetTreatment,
  PaletteApplication,
} from './paletteApplication.ts';

// Feature: kino-game
//
// EndlessMode — the standalone HIGH-SCORE mode for completed worlds (task 7.8;
// design: "Endless ability restriction (Req 23.7–23.8)", "Difficulty ramp (Req
// 7.6, 23.3)"; Req 23.1, 23.2, 23.3, 23.6, 23.7, 23.8, 23.9).
//
// PURE simulation logic — no Phaser, no clocks, no ambient randomness, no I/O.
// Enforced Phaser-free by test/boundary.core-no-phaser.test.ts.
//
// Endless is a SEPARATE mode from the story: a procedurally-generated, ramping,
// high-score run for a world the player has already discovered+completed. This
// module owns exactly three concerns and deliberately nothing else:
//
//   1. THE ABILITY ALLOW-LIST (Req 23.7-23.8, design "Endless ability
//      restriction"). `allowedEndlessModes(world)` is the set of movement
//      abilities learned UP TO AND INCLUDING that world in STORY ORDER:
//        World 1 → {jumping}
//        World 2 → {jumping, flight}
//        World 3 → {jumping, flight, zigzag}
//        World 4 → {jumping, flight, zigzag, underwater}
//      An endless run of world N is built with this allow-list; the
//      SequenceDirector can NEVER schedule a mode outside it — abilities from
//      LATER worlds are STRUCTURALLY IMPOSSIBLE to appear (Property 9, task 7.9
//      owns the property test; this module builds so it holds).
//
//   2. ENDLESS SUPPORT (Req 23.1, 23.2). `supportsEndless(world)` is true for
//      worlds 1-4 (procedural endless) and false for World 5 (the finite
//      designed finale has NO endless). `buildEndlessRunConfig` / the plan
//      composer refuse to build a World-5 endless run.
//
//   3. THE NO-STORY-PROGRESS CONTRACT (Req 23.6, 23.9). An endless run awards
//      NO story progress, unlocks, perks, or cosmetics, and presents no perk
//      choices. This module does not touch the Save_Store or the PerkSystem
//      directly — those are engine concerns — but it produces an
//      `EndlessRunConfig` whose flags the GameplayScene / ProgressionSystem /
//      PerkSystem read to SKIP every story-side-effect path (the PerkSystem
//      already suppresses perk choices from its own `endless` flag, task 6.12;
//      the ProgressionSystem's world-unlock flow is simply never run in
//      endless). `endlessAwardsNoStoryProgress(cfg)` is the single assertion
//      the scene/tests check.
//
// WHAT IT DOES NOT OWN:
//   - endless HIGH-SCORE tracking (task 7.6 / Req 28) — a separate module.
//   - the map-screen endless control / confirmation UI (Req 23.4-23.5) — an
//     engine (scene) concern.
//   - the actual SequenceDirector transition mechanics — owned by
//     sequenceDirector.ts; this module only supplies the allow-list and a
//     restricted sequence plan to build one from.
//
// COMPOSITION WITH THE SequenceDirector: `buildEndlessSequencePlan(world)`
// produces a `SequenceSpec[]` drawn ONLY from `allowedEndlessModes(world)`
// (water-gated chaining preserved where Underwater is allowed), so
// `createSequenceDirector(plan, balance, …)` yields a director whose every
// scheduled mode is in the allow-list. `validateEndlessPlanModes(world, plan)`
// is the structural guard: it returns the offending modes (empty when clean),
// letting callers/tests assert that no later-world ability leaked in.

import type { BalanceTable } from '../config/index.ts';
import type { Difficulty } from './obstacleSpawner.ts';
import type { MovementMode, SequenceSpec, WorldId } from './types.ts';

/**
 * The movement abilities in the order they are LEARNED across the story
 * (design: "Endless ability restriction"; Req 23.7-23.8). Index i holds the
 * ability first available in World (i+1):
 *   World 1 → jumping, World 2 → flight, World 3 → zigzag, World 4 → underwater.
 * World 5 introduces no NEW base ability (its finale recombines the learned
 * ones), so this array has four entries. The cumulative prefix of this array up
 * to a world is that world's endless allow-list.
 */
export const STORY_ABILITY_ORDER: readonly MovementMode[] = [
  'jumping', // World 1 (Req 2)
  'flight', // World 2 (Req 3.5)
  'zigzag', // World 3 (Req 4)
  'underwater', // World 4 (Req 5)
] as const;

/** Highest world id that supports endless (1-4; World 5 has none, Req 23.2). */
const MAX_ENDLESS_WORLD = 4 as const;

/**
 * Base length (px) of an endless Sequence segment at ramp=0 (the longest,
 * least-frequent-transition end). Layout/pacing geometry, not a balance
 * tunable. Chosen a touch longer than the story default so endless transition
 * cadence has clear room to ramp up.
 */
const ENDLESS_BASE_SEGMENT_PX = 3600;

/**
 * Hard floor (px) on an endless Sequence segment — transitions never get closer
 * than this regardless of ramp, so the run stays readable/feasible (the
 * telegraph still fits). Pacing geometry, not a balance tunable.
 */
const ENDLESS_MIN_SEGMENT_PX = 1200;

/**
 * A segment must be at least this multiple of the telegraph lead so the
 * transition cue (Req 6.3) always fits before the boundary resolves. Keeps the
 * ramped floor feasible even if the configured lead is large.
 */
const ENDLESS_SEGMENT_LEAD_FACTOR = 1.5;

/**
 * Cleared-obstacle count at which the endless difficulty `ramp` reaches 1.0
 * (its feasible hard cap). Past this the ramp stays clamped at 1.0, so the
 * ObstacleSpawner holds gaps at its `minGapPx` floor and scroll speed at its
 * `maxMultiplier` cap (still feasible, Req 23.3). Pacing geometry, not a
 * balance tunable. Tuned so an endless run ramps briskly but keeps climbing for
 * a good while (endless is a high-score mode, Req 23.1).
 */
const ENDLESS_RAMP_SATURATION_OBSTACLES = 90;

/** Clamp `v` into the inclusive range `[lo, hi]`. */
function clamp(v: number, lo: number, hi: number): number {
  if (v < lo) return lo;
  if (v > hi) return hi;
  return v;
}

/**
 * Does `world` support Endless_Mode? True for the procedural worlds 1-4
 * (Req 23.1); false for World 5, the finite designed finale (Req 23.2). A world
 * id outside 1..5 is treated as unsupported.
 */
export function supportsEndless(world: WorldId): boolean {
  return world >= 1 && world <= MAX_ENDLESS_WORLD;
}

/**
 * The endless ability ALLOW-LIST for `world`: the movement abilities learned UP
 * TO AND INCLUDING that world, in STORY ORDER (Req 23.7-23.8). This is the
 * cumulative prefix of {@link STORY_ABILITY_ORDER}:
 *   World 1 → [jumping]
 *   World 2 → [jumping, flight]
 *   World 3 → [jumping, flight, zigzag]
 *   World 4 → [jumping, flight, zigzag, underwater]
 *   World 5 → [jumping, flight, zigzag, underwater] (all; the finale world —
 *             endless is not OFFERED there (Req 23.2), but the cumulative set
 *             is still well-defined, so WorldDefinition.allowedEndlessModes for
 *             World 5 reflects the full learned set).
 *
 * The returned array is a fresh copy in story order; a world outside 1..5 maps
 * to an empty list. This is the value a WorldDefinition carries in
 * `allowedEndlessModes` and the set the SequenceDirector is restricted to for
 * an endless run — so NO later-world ability can ever be scheduled.
 */
export function allowedEndlessModes(world: WorldId): MovementMode[] {
  if (world < 1) return [];
  // Prefix length: abilities learned through `world`, capped at the full set
  // (World 5 introduces no new base ability, so it carries all four).
  const count = Math.min(world, STORY_ABILITY_ORDER.length);
  return STORY_ABILITY_ORDER.slice(0, count);
}

/**
 * A membership-test form of {@link allowedEndlessModes}: a Set of the modes
 * allowed in `world`'s endless run, for O(1) `has` checks when validating a
 * composed plan or gating a transition request.
 */
export function allowedEndlessModeSet(world: WorldId): Set<MovementMode> {
  return new Set(allowedEndlessModes(world));
}

/**
 * Is `mode` permitted in `world`'s Endless_Mode run (Req 23.7-23.8)? True iff
 * the ability is learned up to and including `world` in story order.
 */
export function isEndlessModeAllowed(world: WorldId, mode: MovementMode): boolean {
  return allowedEndlessModeSet(world).has(mode);
}

/**
 * Validate that a composed endless `plan` references ONLY modes in `world`'s
 * allow-list (Req 23.7-23.8). Returns the list of OFFENDING modes (those from
 * later worlds that leaked in), in the order they appear; an EMPTY array means
 * the plan is clean and the SequenceDirector built from it can never schedule a
 * later-world ability (the structural guarantee behind Property 9). Duplicates
 * are de-duplicated in the result.
 *
 * Also treats a World-5 plan as invalid-for-endless by flagging it: World 5 has
 * no endless (Req 23.2), so any plan offered for World-5 endless is a misuse —
 * callers should check {@link supportsEndless} first. (The mode-membership
 * check itself still passes for World 5 since its allow-list is the full set;
 * the explicit support check is the gate.)
 */
export function validateEndlessPlanModes(
  world: WorldId,
  plan: SequenceSpec[],
): MovementMode[] {
  const allowed = allowedEndlessModeSet(world);
  const offenders: MovementMode[] = [];
  const seen = new Set<MovementMode>();
  for (const spec of plan) {
    if (!allowed.has(spec.mode) && !seen.has(spec.mode)) {
      seen.add(spec.mode);
      offenders.push(spec.mode);
    }
  }
  return offenders;
}

/**
 * Build the procedural endless `sequencePlan` for `world`, drawn ONLY from its
 * ability allow-list (Req 23.1, 23.7-23.8). The plan LOOPS (endless) and its
 * composition mirrors the story world's mode mix, restricted to learned
 * abilities:
 *   - World 1 → Jumping only, looping (the single learned ability).
 *   - World 2 → Flight only, looping.
 *   - World 3 → Flight ↔ Zigzag, looping (the two post-jumping abilities; the
 *     Flight→Zigzag→Flight cycle is the World-3 story mix, Req 4.4, 4.7).
 *   - World 4 → Flight / Zigzag / Underwater chained and looping, water-gated
 *     at the Underwater boundaries (the three World-4 abilities; Jumping is
 *     excluded from the World-4 mix per Req 5.8 even though it is in the
 *     allow-list — the plan uses the world's actual mode set, which is a subset
 *     of the allow-list, keeping Property 9's guarantee: every scheduled mode
 *     is within the allow-list).
 *
 * Throws for a world with no endless (World 5, Req 23.2) — callers MUST gate on
 * {@link supportsEndless}. The result is always a non-empty, looping plan
 * whose modes pass {@link validateEndlessPlanModes}.
 */
export function buildEndlessSequencePlan(world: WorldId): SequenceSpec[] {
  if (!supportsEndless(world)) {
    throw new Error(
      `EndlessMode: world ${world} does not support Endless_Mode (Req 23.2)`,
    );
  }

  switch (world) {
    case 1:
      return [{ mode: 'jumping', loops: true }];
    case 2:
      return [{ mode: 'flight', loops: true }];
    case 3:
      // Flight ↔ Zigzag cycle (Req 4.4, 4.7); the final leg loops back.
      return [{ mode: 'flight' }, { mode: 'zigzag', loops: true }];
    case 4:
      // Flight / Zigzag / Underwater chain, water-gated at Underwater; loops
      // back to Flight. No Jumping (Req 5.8). The final leg loops.
      return [
        { mode: 'flight' },
        { mode: 'zigzag' },
        { mode: 'flight' },
        { mode: 'underwater' },
        { mode: 'flight', loops: true },
      ];
    default:
      // Unreachable: supportsEndless already rejected world 5 and out-of-range.
      throw new Error(`EndlessMode: unexpected world ${world}`);
  }
}

/**
 * The per-Sequence boundary distances (px) for an endless `plan`, RAMPING the
 * TRANSITION FREQUENCY with run progress (Req 23.3): the further into the run
 * (higher `obstaclesCleared`), the SHORTER each Sequence segment becomes, so
 * transitions happen more often. Segments shrink linearly from
 * `DEFAULT_SEQUENCE_BOUNDARY_PX`-scale toward a floor as the ramp climbs, and
 * are clamped so they never collapse below a feasible minimum (a Sequence is
 * always long enough to contain the telegraph lead + a little play).
 *
 * The ramp is driven by {@link endlessDifficulty}'s `ramp` (a clamped [0,1]
 * dial): at ramp=0 segments are at their base length; at ramp=1 they are at the
 * floor. This is the "increase Transition frequency" half of Req 23.3 (the
 * speed/density half is {@link endlessDifficulty} fed to the ObstacleSpawner).
 */
export function endlessBoundaryDistancesPx(
  plan: SequenceSpec[],
  difficulty: Difficulty,
  balance: BalanceTable,
): number[] {
  const ramp = clamp(difficulty.ramp, 0, 1);
  // Base segment length; shrinks toward the floor as ramp climbs so transitions
  // get MORE frequent deeper into the run.
  const base = ENDLESS_BASE_SEGMENT_PX;
  // Floor: a segment must comfortably contain the telegraph lead so a
  // transition can still be announced before it resolves (Req 6.3).
  const lead = balance.telegraphLeadPx();
  const floor = Math.max(ENDLESS_MIN_SEGMENT_PX, lead * ENDLESS_SEGMENT_LEAD_FACTOR);
  const span = Math.max(0, base - floor);
  const segment = Math.max(floor, base - span * ramp);
  return plan.map(() => segment);
}

/**
 * The endless difficulty inputs for the ObstacleSpawner at `obstaclesCleared`
 * (Req 23.3). Mirrors {@link import('./progressionSystem.ts').ProgressionSystem.difficulty}
 * but ramps FASTER (endless is a pure high-score test, not a story on-ramp):
 *   - `obstaclesCleared` is handed straight through so the spawner's scroll
 *     SPEED ramp climbs (`base * clamp(1 + rampPerObstacle*cleared, 1,
 *     maxMultiplier)`), i.e. speed increases (Req 23.3).
 *   - `ramp` in [0,1] climbs linearly with cleared obstacles toward 1.0 so the
 *     spawner's gap shrinks toward `minGapPx`, i.e. DENSITY and obstacle
 *     CONFIGURATION difficulty increase (Req 23.3).
 * Both are clamped so every resulting gap/speed stays within the spawner's
 * feasible bounds (`minGapPx` floor, `maxMultiplier` cap). The same `ramp`
 * feeds {@link endlessBoundaryDistancesPx} so TRANSITION FREQUENCY ramps on the
 * same dial — covering all four Req 23.3 ramps (speed, density, config
 * difficulty, transition frequency) from one progress input.
 */
export function endlessDifficulty(obstaclesCleared: number): Difficulty {
  const cleared = Math.max(0, Math.floor(obstaclesCleared || 0));
  const ramp = clamp(cleared / ENDLESS_RAMP_SATURATION_OBSTACLES, 0, 1);
  return { ramp, obstaclesCleared: cleared };
}

/**
 * The flags an endless run carries so the engine/story systems SKIP every
 * story-side-effect path (Req 23.6, 23.9). All four are ALWAYS the restrictive
 * value for an endless run — they exist as an explicit, inspectable contract
 * (not magic booleans scattered in the scene):
 *   - `awardsStoryProgress: false` — no world unlock / story-clear / discovery
 *     updates (the ProgressionSystem world-unlock flow is simply not run).
 *   - `awardsUnlocks: false` — no skill/world unlocks from an endless run.
 *   - `awardsPerksOrCosmetics: false` — no perks and no cosmetic drops.
 *   - `offersPerkChoices: false` — no perk CHOICE prompts (the PerkSystem's own
 *     `endless` flag already suppresses these, task 6.12; this mirrors it so a
 *     single config object describes the whole no-progress contract).
 */
export interface EndlessRunConfig {
  /** The world this endless run is playing (must support endless, Req 23.1-23.2). */
  readonly world: WorldId;
  /** The ability allow-list for this run (Req 23.7-23.8). */
  readonly allowedModes: readonly MovementMode[];
  /** Never awards story progress/unlocks (Req 23.6). */
  readonly awardsStoryProgress: false;
  /** Never awards unlocks (Req 23.6). */
  readonly awardsUnlocks: false;
  /** Never awards perks or cosmetics (Req 23.6). */
  readonly awardsPerksOrCosmetics: false;
  /** Never presents perk choices (Req 23.9). */
  readonly offersPerkChoices: false;
}

/**
 * Build the {@link EndlessRunConfig} for an endless run of `world`. Throws for a
 * world with no endless (World 5, Req 23.2) — callers MUST gate on
 * {@link supportsEndless}. The returned config pins the allow-list and the
 * no-story-progress contract (Req 23.6, 23.9); the scene reads these flags to
 * skip unlocks/perks/cosmetics and to build the SequenceDirector with the
 * allow-list (via {@link buildEndlessSequencePlan}).
 */
export function buildEndlessRunConfig(world: WorldId): EndlessRunConfig {
  if (!supportsEndless(world)) {
    throw new Error(
      `EndlessMode: world ${world} does not support Endless_Mode (Req 23.2)`,
    );
  }
  return {
    world,
    allowedModes: allowedEndlessModes(world),
    awardsStoryProgress: false,
    awardsUnlocks: false,
    awardsPerksOrCosmetics: false,
    offersPerkChoices: false,
  };
}

/**
 * The single assertion the scene/tests check: an endless run awards NO story
 * progress, unlocks, perks, or cosmetics, and offers no perk choices (Req 23.6,
 * 23.9). Returns true iff ALL four restrictive flags hold — i.e. the config
 * truly blocks all story progress. By construction {@link buildEndlessRunConfig}
 * always satisfies this; the helper exists so callers can defensively verify a
 * config before running endless side-effect-free.
 */
export function endlessAwardsNoStoryProgress(cfg: EndlessRunConfig): boolean {
  return (
    cfg.awardsStoryProgress === false &&
    cfg.awardsUnlocks === false &&
    cfg.awardsPerksOrCosmetics === false &&
    cfg.offersPerkChoices === false
  );
}

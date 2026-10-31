// Feature: kino-game
//
// PerkSystem — two-choice perk selection, optional cosmetic drop, and the
// run-vs-generation retention model (task 6.12; design: "Perk system (Req 10,
// 11)"; Req 10.1–10.11, 11.1–11.5, 12.5).
//
// This module owns the PURE lifecycle of the player's TEMPORARY passive run
// bonuses (Perks), stored SEPARATELY from Skills (Req 11.3 — Skills live in
// skillSystem.ts; this module never imports or touches them). Its three jobs:
//
//   1. Choice presentation (Req 10.1–10.2, 10.7–10.10). At the configured
//      obstacle milestones (default [20, 40] via `perkObstacleMilestones()`),
//      offer EXACTLY TWO perk choices. With probability `cosmeticDropProbability`
//      an UNOWNED cosmetic is offered in a CENTER slot flanked by the two perks
//      (Req 10.8–10.9), colored by its rarity tier (Req 10.10). Endless-mode
//      runs are suppressed entirely: no choices are ever presented (Req 10.7).
//
//   2. Selection + passive effects (Req 10.3, 11.1–11.2). Selecting a perk
//      applies it for the REST OF THE CURRENT RUN. Two effects are modeled:
//        - Speed Boost (Req 11.2): `speedMultiplier()` becomes 1 + pct/100.
//        - Reduced Skill Cooldown (Req 11.1, 12.5): `cooldownScale()` becomes
//          1 - pct/100, the exact value GameplayScene feeds into
//          `createSkillSystem({ cooldownScale })` so the equipped skill's
//          cooldown shortens WITHOUT this module rewriting skillSystem.ts.
//      Percentages, probability, and rarity colors are read from config /
//      BalanceTable (Req 11.5) — nothing is hardcoded.
//
//   3. Retention state machine (Req 10.4–10.6, 11.4). Perks chosen this run are
//      PROVISIONAL until the run reaches 50 points:
//        - run ends by collision BEFORE 50 pts  → DISCARD (revert to unselected
//          / locked, as if never chosen; Req 10.4).
//        - run REACHES 50 pts                     → RETAIN for the rest of the
//          current generation's story (Req 10.5).
//        - a NEW generation begins                → RESET all perks (Req 10.6,
//          11.4, 22.3).
//      Retained perks carry forward into the next run of the same generation
//      and are themselves provisional-free (already earned); a fresh run layers
//      new provisional selections on top until it too banks at 50.
//
// Determinism: the cosmetic offer uses an INJECTABLE random source (default a
// seeded PRNG), never `Math.random`, so the offer is reproducible and the
// retention/offer behavior is property-testable (src/core boundary, Req 26.6).
//
// PURE / Phaser-free. No clock. Given the same construction and the same
// ordered calls it produces the same offers, selections, and retained state.

import type { BalanceTable } from '../config/index.ts';
import type { PerkId, Perk } from './types.ts';

/** Rarity tier string (mirrors config `RarityTier`; display/flavor only). */
export type CosmeticRarity = 'common' | 'uncommon' | 'rare' | 'legendary';

/** Map of rarity tier → display color, read from config (Req 10.10, 11.5). */
export type CosmeticRarityColors = Record<CosmeticRarity, string>;

/** A cosmetic that can be offered in the center slot of a perk choice (Req 10.8). */
export interface CosmeticDef {
  /** Stable unique id; also the key persisted in the Save_Store (Req 10.11). */
  id: string;
  /** Rarity tier, used to color the center slot (Req 10.10). */
  rarity: CosmeticRarity;
}

/**
 * An injectable source of random fractions in [0, 1). GameplayScene can pass a
 * run-seeded source; tests pass a scripted one. Defaults to a seeded PRNG so
 * the system is NEVER coupled to `Math.random` (Req 26.6 determinism).
 */
export type RandomSource = () => number;

/**
 * A single perk choice presented in a selection (Req 10.1). Carries the
 * concrete magnitude read from balance so the UI can describe it without
 * re-reading config, and so selection applies a snapshot consistent with the
 * offer.
 */
export interface PerkChoice {
  id: PerkId;
  /** Configured magnitude (percent) for this perk (Req 11.1–11.2, 11.5). */
  magnitude: number;
}

/**
 * The cosmetic shown in the CENTER slot of an offer, flanked by the two perks
 * (Req 10.8). Present only when an unowned cosmetic was rolled (Req 10.9).
 */
export interface CosmeticOffer {
  id: string;
  rarity: CosmeticRarity;
  /** Rarity color for the slot, resolved from config (Req 10.10). */
  color: string;
}

/**
 * A perk selection presented at a milestone (Req 10.1–10.2, 10.8). EXACTLY two
 * perk choices, with an OPTIONAL center cosmetic. `milestone` is the obstacle
 * count that triggered it.
 */
export interface PerkOffer {
  /** The obstacle milestone (e.g. 20 or 40) that triggered this offer. */
  milestone: number;
  /** Exactly two perk choices (Req 10.1–10.2). */
  choices: readonly [PerkChoice, PerkChoice];
  /** Optional center cosmetic, present only when one was rolled (Req 10.8–10.9). */
  cosmetic: CosmeticOffer | null;
}

/** Result of selecting from an open {@link PerkOffer}. */
export interface PerkSelectionResult {
  /** The perk now applied for the rest of the run (Req 10.3). */
  perk: Perk;
  /** The cosmetic newly obtained (and to be persisted), or null (Req 10.11). */
  cosmeticObtained: string | null;
}

/** Construction options for {@link createPerkSystem}. */
export interface PerkSystemOptions {
  /**
   * True when the current run is an Endless_Mode run. Perk choices are NEVER
   * presented in endless (Req 10.7, 23.9). Defaults to false (story run).
   */
  endless?: boolean;
  /**
   * The score (points) at which provisional perks are BANKED/retained for the
   * rest of the generation (Req 10.4–10.5). Defaults to the balance world-unlock
   * threshold (50, Req 7.1) — the same 50-point gate.
   */
  retentionThreshold?: number;
  /**
   * The pool of all cosmetics that could ever drop (Req 10.8). Only UNOWNED
   * ones are offered (Req 10.9); ownership is tracked via `ownedCosmetics`.
   */
  cosmeticPool?: readonly CosmeticDef[];
  /**
   * Cosmetics the player already owns at construction (from the Save_Store).
   * These are never re-offered (Req 10.9). Obtained cosmetics are added here.
   */
  ownedCosmetics?: readonly string[];
  /**
   * Rarity → color map (Req 10.10). Defaults to the balance/config
   * `cosmeticRarityColors`. Supplying it lets GameplayScene pass the loaded
   * config map directly.
   */
  rarityColors?: CosmeticRarityColors;
  /**
   * Injectable random source in [0, 1) (Req 26.6). Defaults to a seeded PRNG so
   * behavior is deterministic and never touches `Math.random`.
   */
  random?: RandomSource;
  /** Seed for the default PRNG when `random` is not supplied. Defaults to 1. */
  seed?: number;
  /** Fired when a cosmetic is obtained, so the SaveStore can persist it (Req 10.11). */
  onCosmeticObtained?: (id: string) => void;
}

/**
 * The perk authority (design: "Perk system"). Owns provisional + retained perk
 * state, offer presentation, and the passive-effect getters GameplayScene reads.
 */
export interface PerkSystem {
  /**
   * Notify the system that the run's cleared-obstacle count advanced to
   * `obstacleCount` (Req 10.1–10.2). If that count newly surpasses a configured
   * milestone AND the run is a story run (not endless, Req 10.7), returns the
   * two-choice {@link PerkOffer} to present; otherwise returns null. Each
   * milestone fires at most once per run.
   */
  onObstacleCleared(obstacleCount: number): PerkOffer | null;
  /** The currently open offer awaiting a selection, or null. */
  pendingOffer(): PerkOffer | null;
  /**
   * Select perk `id` from the open offer (Req 10.3). Applies it as a PROVISIONAL
   * perk for the rest of the run and, if the offer carried a cosmetic and the
   * caller `takeCosmetic` is true, obtains + persists it (Req 10.11). Closes the
   * offer. Throws if there is no open offer or `id` is not one of its choices.
   */
  select(id: PerkId, takeCosmetic?: boolean): PerkSelectionResult;
  /** Dismiss the open offer without choosing (no perk applied). */
  decline(): void;
  /**
   * Report the run's current score so the retention gate can bank provisional
   * perks when it reaches the threshold (Req 10.5). Idempotent once banked.
   */
  onScore(score: number): void;
  /**
   * The run ended by collision (Req 10.4). If provisional perks were NOT yet
   * banked (score never reached the threshold), DISCARD them — revert to the
   * retained set as if this run's selections never happened. Banked perks and
   * perks retained from earlier runs are untouched.
   */
  onRunEnd(): void;
  /**
   * A new run of the SAME generation is starting. Retained perks carry forward;
   * provisional (this-run) state is cleared and milestones re-arm (Req 10.3,
   * 10.5). Does NOT reset retained perks — that is {@link onNewGeneration}.
   */
  startRun(options?: { endless?: boolean }): void;
  /**
   * A new generation begins: RESET all perks — provisional AND retained
   * (Req 10.6, 11.4, 22.3). Owned cosmetics are permanent and are NOT reset.
   */
  onNewGeneration(): void;
  /** True once this run's provisional perks have been banked (score ≥ threshold). */
  isBanked(): boolean;
  /** The perks active RIGHT NOW (retained + provisional), separate from skills (Req 11.3). */
  activePerks(): Perk[];
  /** True when the given perk is currently active (retained or provisional). */
  hasPerk(id: PerkId): boolean;
  /**
   * Live cooldown scale for the equipped skill (Req 11.1, 12.5). Returns
   * `1 - cooldownReductionPct/100` while the Reduced Skill Cooldown perk is
   * active, else 1. This is the getter GameplayScene passes to
   * `createSkillSystem({ cooldownScale })`.
   */
  cooldownScale(): number;
  /**
   * Live run-speed multiplier (Req 11.2). Returns `1 + speedBoostPct/100` while
   * the Speed Boost perk is active, else 1. GameplayScene multiplies scroll /
   * run speed by this.
   */
  speedMultiplier(): number;
  /** Cosmetics the player owns (seed + obtained this session) — for persistence/UI. */
  ownedCosmetics(): string[];
}

/** The two perks offered at every milestone (the full temporary-bonus set). */
const PERK_CHOICE_IDS: readonly [PerkId, PerkId] = ['speedBoost', 'cooldownReduction'];

/** Default retention/bank gate, mirrors the 50-point world-unlock threshold (Req 7.1). */
const DEFAULT_RETENTION_FALLBACK = 50;

/**
 * A tiny, deterministic PRNG (mulberry32). Not cryptographic — just a stable,
 * seedable fraction source so the cosmetic roll is reproducible without ever
 * reaching for `Math.random` (Req 26.6). Produces values in [0, 1).
 */
function createSeededRandom(seed: number): RandomSource {
  // Normalize to a 32-bit unsigned integer state; a non-finite seed falls back
  // to 1 so the source is always well-defined.
  let state = (Number.isFinite(seed) ? Math.floor(seed) : 1) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Clamp a percentage magnitude to a finite, non-negative number. */
function safePct(value: number): number {
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

/**
 * Create a PerkSystem. Pure factory: behavior depends only on its options (and
 * the injected BalanceTable / random source readings) and the ordered calls it
 * receives. See the module header for the full contract.
 */
export function createPerkSystem(
  balance: BalanceTable,
  options: PerkSystemOptions = {},
): PerkSystem {
  const random: RandomSource =
    options.random ?? createSeededRandom(options.seed ?? 1);

  // Owned cosmetics are PERMANENT (Req 10.11) — never cleared by run end or new
  // generation. A Set for O(1) "already owned?" checks when rolling an offer.
  const owned = new Set<string>(options.ownedCosmetics ?? []);
  const cosmeticPool: readonly CosmeticDef[] = options.cosmeticPool ?? [];
  const rarityColors: CosmeticRarityColors | undefined = options.rarityColors;
  const onCosmeticObtained = options.onCosmeticObtained;

  // The bank gate (Req 10.5). A sane finite positive value or the 50-pt fallback.
  const retentionThreshold = (() => {
    const t = options.retentionThreshold;
    if (t !== undefined && Number.isFinite(t) && t > 0) return t;
    const w = balance.worldUnlockThreshold();
    return Number.isFinite(w) && w > 0 ? w : DEFAULT_RETENTION_FALLBACK;
  })();

  // RETAINED perks: earned by reaching the threshold in an earlier run of this
  // generation (Req 10.5). Carried across runs; reset only on new generation.
  let retained = new Map<PerkId, Perk>();
  // PROVISIONAL perks: chosen in the CURRENT run, not yet banked (Req 10.3–10.4).
  let provisional = new Map<PerkId, Perk>();

  let endless = options.endless === true;
  // Milestones already fired THIS run (each fires at most once, Req 10.1–10.2).
  const firedMilestones = new Set<number>();
  let pending: PerkOffer | null = null;
  // True once this run's provisional selections have been banked into retained.
  let banked = false;

  /** Resolve a rarity tier to a display color (Req 10.10), tolerating gaps. */
  function colorFor(rarity: CosmeticRarity): string {
    if (rarityColors && typeof rarityColors[rarity] === 'string') {
      return rarityColors[rarity];
    }
    return ''; // no color configured → empty (UI falls back to a neutral tint)
  }

  /** Current configured magnitude for a perk id (Req 11.1–11.2, 11.5). */
  function magnitudeFor(id: PerkId): number {
    return id === 'speedBoost'
      ? safePct(balance.speedBoostPct())
      : safePct(balance.cooldownReductionPct());
  }

  /**
   * Roll an UNOWNED cosmetic for the center slot (Req 10.8–10.10). Returns null
   * when the drop does not fire (probability) or no unowned cosmetic remains
   * (Req 10.9). Deterministic given the injected random source.
   */
  function rollCosmetic(): CosmeticOffer | null {
    const candidates = cosmeticPool.filter((c) => !owned.has(c.id));
    if (candidates.length === 0) return null;

    const probRaw = balance.cosmeticDropProbability();
    const prob = Number.isFinite(probRaw) ? Math.min(Math.max(probRaw, 0), 1) : 0;
    if (random() >= prob) return null; // drop did not fire this offer

    // Pick one unowned candidate deterministically from the random source.
    const idx = Math.min(
      candidates.length - 1,
      Math.floor(random() * candidates.length),
    );
    const chosen = candidates[idx];
    if (chosen === undefined) return null; // unreachable given idx clamp; satisfies the checker
    return { id: chosen.id, rarity: chosen.rarity, color: colorFor(chosen.rarity) };
  }

  /** Build the fixed two-choice offer for a milestone (Req 10.1–10.2, 10.8). */
  function buildOffer(milestone: number): PerkOffer {
    const choices: [PerkChoice, PerkChoice] = [
      { id: PERK_CHOICE_IDS[0], magnitude: magnitudeFor(PERK_CHOICE_IDS[0]) },
      { id: PERK_CHOICE_IDS[1], magnitude: magnitudeFor(PERK_CHOICE_IDS[1]) },
    ];
    return { milestone, choices, cosmetic: rollCosmetic() };
  }

  function onObstacleCleared(obstacleCount: number): PerkOffer | null {
    // No perk choices during endless (Req 10.7, 23.9).
    if (endless) return null;
    if (!Number.isFinite(obstacleCount)) return null;

    // Fire a milestone the FIRST time the cleared count reaches/surpasses it
    // (Req 10.1–10.2: "surpasses Obstacle 20/40"). Each milestone once per run.
    for (const milestone of balance.perkObstacleMilestones()) {
      if (obstacleCount >= milestone && !firedMilestones.has(milestone)) {
        firedMilestones.add(milestone);
        pending = buildOffer(milestone);
        return pending;
      }
    }
    return null;
  }

  function pendingOffer(): PerkOffer | null {
    return pending;
  }

  function select(id: PerkId, takeCosmetic = true): PerkSelectionResult {
    if (pending === null) {
      throw new Error('[PerkSystem] select() called with no open offer');
    }
    const choice = pending.choices.find((c) => c.id === id);
    if (choice === undefined) {
      throw new Error(`[PerkSystem] "${id}" is not one of the open offer's choices`);
    }

    // Apply the chosen perk for the rest of the run (Req 10.3) as a PROVISIONAL
    // selection — it only becomes retained once the run banks at the threshold.
    const perk: Perk = { id: choice.id, magnitude: choice.magnitude };
    provisional.set(perk.id, perk);

    // Optionally obtain the center cosmetic and persist it permanently (Req 10.11).
    let cosmeticObtained: string | null = null;
    const offered = pending.cosmetic;
    if (takeCosmetic && offered !== null && !owned.has(offered.id)) {
      owned.add(offered.id);
      cosmeticObtained = offered.id;
      onCosmeticObtained?.(offered.id);
    }

    pending = null;
    return { perk, cosmeticObtained };
  }

  function decline(): void {
    pending = null;
  }

  function onScore(score: number): void {
    if (banked || endless) return;
    if (!Number.isFinite(score)) return;
    // Reaching the threshold banks this run's provisional perks into retained
    // for the rest of the generation (Req 10.5). From here the run's selections
    // are permanent for the generation and immune to a later collision discard.
    if (score >= retentionThreshold) {
      for (const [id, perk] of provisional) {
        retained.set(id, { ...perk });
      }
      provisional = new Map();
      banked = true;
    }
  }

  function onRunEnd(): void {
    // Collision end: if NOT banked, discard this run's provisional perks and
    // revert to the retained set, as if they were never chosen (Req 10.4). If
    // already banked, provisional is empty and retained stands.
    if (!banked) {
      provisional = new Map();
    }
  }

  function startRun(opts: { endless?: boolean } = {}): void {
    // New run of the same generation: retained perks carry forward; this-run
    // state resets and milestones re-arm. Retained perks are NOT provisional.
    if (opts.endless !== undefined) {
      endless = opts.endless === true;
    }
    provisional = new Map();
    firedMilestones.clear();
    pending = null;
    banked = false;
  }

  function onNewGeneration(): void {
    // Full reset of ALL perks — provisional AND retained (Req 10.6, 11.4, 22.3).
    // Owned cosmetics are permanent and intentionally preserved (Req 10.11).
    retained = new Map();
    provisional = new Map();
    firedMilestones.clear();
    pending = null;
    banked = false;
  }

  /** The live perk for `id` if active (provisional overrides retained), else null. */
  function activePerk(id: PerkId): Perk | null {
    return provisional.get(id) ?? retained.get(id) ?? null;
  }

  function activePerks(): Perk[] {
    const merged = new Map<PerkId, Perk>();
    for (const [id, perk] of retained) merged.set(id, { ...perk });
    for (const [id, perk] of provisional) merged.set(id, { ...perk });
    return [...merged.values()];
  }

  function hasPerk(id: PerkId): boolean {
    return provisional.has(id) || retained.has(id);
  }

  function cooldownScale(): number {
    const perk = activePerk('cooldownReduction');
    if (perk === null) return 1;
    // 1 - pct/100, clamped to a positive scale so a bad tunable can never zero
    // or invert a cooldown (the SkillSystem also guards, but keep this sane).
    const scale = 1 - safePct(perk.magnitude) / 100;
    return scale > 0 && Number.isFinite(scale) ? scale : 1;
  }

  function speedMultiplier(): number {
    const perk = activePerk('speedBoost');
    if (perk === null) return 1;
    const mult = 1 + safePct(perk.magnitude) / 100;
    return Number.isFinite(mult) && mult > 0 ? mult : 1;
  }

  return {
    onObstacleCleared,
    pendingOffer,
    select,
    decline,
    onScore,
    onRunEnd,
    startRun,
    onNewGeneration,
    isBanked: () => banked,
    activePerks,
    hasPerk,
    cooldownScale,
    speedMultiplier,
    ownedCosmetics: () => [...owned],
  };
}

// -- GameplayScene wiring seam ------------------------------------------------
//
// The PerkSystem is stored SEPARATELY from the SkillSystem (Req 11.3) and feeds
// the Reduced Skill Cooldown perk into the SkillSystem purely through the
// existing injectable `cooldownScale` seam (Req 12.5) — no change to
// skillSystem.ts:
//
//   const perks = createPerkSystem(this.ctx.balance, {
//     endless: this.isEndless,
//     cosmeticPool: this.ctx.cosmeticPool,
//     ownedCosmetics: this.save.unlockedCosmetics,
//     rarityColors: this.ctx.config.cosmeticRarityColors,
//     seed: this.runSeed,
//     onCosmeticObtained: (id) => this.save.addCosmetic(id),
//   });
//   this.skills = createSkillSystem(this.ctx.balance, {
//     cooldownScale: () => perks.cooldownScale(),   // Req 11.1, 12.5
//   });
//
// Each cleared obstacle: `const offer = perks.onObstacleCleared(count)` → if
// non-null, open PerkSelectScene with `offer.choices` (two) + `offer.cosmetic`
// (center). On pick: `perks.select(id)`. Each score credit: `perks.onScore(s)`
// (banks at 50, Req 10.5). On collision end: `perks.onRunEnd()` (discard if not
// banked, Req 10.4). Run speed each step is multiplied by `perks.speedMultiplier()`
// (Req 11.2). New generation: `perks.onNewGeneration()` (Req 10.6, 11.4).

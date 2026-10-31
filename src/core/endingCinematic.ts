// Feature: kino-game
//
// EndingCinematic — the PURE, Phaser-free CONTENT for the FINAL comic-panel
// ending + credits/bloopers PLUS the ending's GENERATION ADVANCE math (task
// 10.5; design: "Cinematics System (Req 21, 29, 42)"; Req 21.8, 21.9, 21.19,
// 21.20, 32.3, 32.4).
//
// SCOPE / TASK BOUNDARY (10.5): this module owns two pure things, NO rendering:
//
//   1. The FINAL Comic_Panel sequence the pure `createCinematicPlayer`
//      (`src/core/cinematicSequence.ts`) walks panel-by-panel when Kino Jumps
//      through the World-5 portal barrier (Req 8.15 → 21.8). The beats, in
//      order:
//        a. REUNION — Kino returns through the portal to the henhouse and
//           reunites with Mama Kino + siblings, now grown (Req 21.8).
//        b. START A FAMILY — the grown Kino starts a family of its own
//           (Req 21.8, 21.19 flavour — the same-iteration Junior→Senior advance
//           rides on this beat as pure `data`).
//        c. KNOCK THE NEXT EGG — Kino scratches and knocks the NEXT egg out to
//           LOOP the story (Req 21.8); the egg is LABELLED with the NEXT
//           iteration + Junior (Req 21.20, 32.4) carried as pure `data`.
//        d..  CREDITS — one panel per `config.cinematics.creditsSlots` entry
//           (Req 21.9), then the BLOOPER outtakes — one panel per
//           `config.cinematics.blooperSlots` entry — referencing the
//           creator/inspiration (Req 21.9, 21.20). Everything is skippable: the
//           pure player (`skip()`) and the engine CinematicScene already provide
//           the single skip affordance (Req 21.21 tie-in).
//
//   2. The ending's GENERATION ADVANCE math (Req 32.3, 32.4). This ending
//      completes a generation, so it:
//        - advances the CURRENT Kino Junior→Senior within the SAME iteration
//          (Req 21.19, 32.3), and
//        - labels the NEXT egg with the NEXT iteration + Junior (Req 21.20,
//          32.4).
//      Both are composed by REUSING `generationTransition.ts`
//      (`formatGenerationName` for the name, `nextGeneration` for the one-step
//      advance) — this module never re-implements the roman-numeral / name
//      logic. It exposes pure helpers that, given the current generation
//      `{ iteration, suffix }`, return the this-ending Senior advance and the
//      next-egg Junior label.
//
// HARD RULE: no module under `src/core/**` may import `phaser` (see
// `src/README.md`). This module imports only the pure CinematicPanel type, the
// pure generation composition from `generationTransition.ts`, and config TYPES;
// it takes config VALUES (credits/blooper slots, scheme, base name) as plain
// inputs so it stays unit-testable in plain Node with no browser/canvas/DOM.

import type { GenerationalScheme } from '../config/index.ts';
import type { CinematicPanel } from './cinematicSequence.ts';
import type { GenerationState } from './saveStore.ts';
import { formatGenerationName, nextGeneration } from './generationTransition.ts';

// ---------------------------------------------------------------------------
// Cinematic id + panel-id scheme (co-located with the OPENING / WORLD_COMPLETION
// / MENTOR ids so the engine CinematicScene seam references ONE shared string
// per id).
// ---------------------------------------------------------------------------

/**
 * The cinematic id for the FINAL ending — the ENDING counterpart to
 * OPENING_CINEMATIC_ID / WORLD_COMPLETION_CINEMATIC_ID / MENTOR_CUTSCENE_ID. The
 * World-5 finale (task 11.2), when Kino Jumps through the portal barrier (Req
 * 8.15), starts the CinematicScene with this id; on completion the ending hands
 * back to the menu / loops (Req 21.8).
 */
export const FINAL_ENDING_CINEMATIC_ID = 'final-ending';

/** Stable panel ids for the ending beats so the engine/tests can key off them. */
export const FINAL_ENDING_PANEL_IDS = {
  reunion: 'ending-reunion',
  startFamily: 'ending-start-family',
  knockNextEgg: 'ending-knock-next-egg',
  /** Per-credits-slot panel ids are suffixed with the 0-based slot index. */
  creditsPrefix: 'ending-credits-',
  /** Per-blooper-slot panel ids are suffixed with the 0-based slot index. */
  blooperPrefix: 'ending-blooper-',
} as const;

/** A discriminator the engine can switch rendering on. */
export type EndingBeatKind =
  | 'reunion'
  | 'start-family'
  | 'knock-next-egg'
  | 'credits'
  | 'blooper';

// ---------------------------------------------------------------------------
// Generation advance on the ending (Req 32.3, 32.4) — REUSING generationTransition
// ---------------------------------------------------------------------------

/**
 * The generational labels the ending shows, both composed by reusing
 * `formatGenerationName` (NO duplicated roman-numeral / name logic).
 */
export interface EndingGenerationLabels {
  /**
   * The CURRENT generation BEFORE this ending's advance (e.g. "Kino III
   * Junior") — the Kino that just finished the story.
   */
  readonly current: string;
  /**
   * The CURRENT Kino AFTER the Junior→Senior advance within the SAME iteration
   * (Req 21.19, 32.3) — e.g. "Kino III Junior" → "Kino III Senior". The egg
   * handoff happens while THIS Kino is now the Senior of the family.
   */
  readonly thisEndingSenior: string;
  /**
   * The NEXT egg's label — the NEXT iteration + Junior (Req 21.20, 32.4) — e.g.
   * "Kino IV Junior" when this ending's Kino was iteration III. This is the
   * generation the loop's next playthrough begins as.
   */
  readonly nextEggJunior: string;
}

/**
 * The resolved generation STATES behind {@link EndingGenerationLabels} (the
 * names are these states run through `formatGenerationName`). Exposed so callers
 * (e.g. the save transition) can act on the advanced state without re-parsing a
 * composed name.
 */
export interface EndingGenerationAdvance {
  /** The current generation state BEFORE the ending's advance. */
  readonly current: GenerationState;
  /**
   * This ending's SAME-iteration Senior (Req 21.19, 32.3): Junior→Senior with
   * the iteration unchanged. (If the current state is already Senior this stays
   * Senior — same iteration — which is the correct "advance Junior→Senior same
   * iteration" semantics at the ending.)
   */
  readonly thisEndingSenior: GenerationState;
  /**
   * The NEXT egg's generation (Req 21.20, 32.4): the NEXT iteration's Junior.
   * Computed by advancing the SENIOR one more step via `nextGeneration`, which
   * rolls a Senior over to the next iteration's Junior — so the sequence reads
   * current → Senior(same N) → Junior(N+1) using ONE shared advance rule.
   */
  readonly nextEggJunior: GenerationState;
}

/**
 * Advance this-iteration Junior→Senior for the ending (Req 21.19, 32.3), reusing
 * `nextGeneration`. A Junior generation becomes the SAME iteration's Senior; a
 * generation already Senior stays that iteration's Senior (so the ending always
 * leaves the current Kino as the family's Senior, same iteration number).
 */
export function advanceToThisEndingSenior(
  generation: GenerationState,
  scheme: Pick<GenerationalScheme, 'juniorSuffix' | 'seniorSuffix'>,
): GenerationState {
  if (generation.suffix === scheme.seniorSuffix) {
    // Already Senior: stay Senior, SAME iteration (do not roll over here — the
    // roll-over to next-iteration Junior is the NEXT egg's step).
    return { iteration: generation.iteration, suffix: scheme.seniorSuffix };
  }
  // Junior (or any non-Senior value, defensively) → this iteration's Senior.
  return nextGeneration(generation, scheme);
}

/**
 * Compute the NEXT egg's generation (Req 21.20, 32.4): the NEXT iteration's
 * Junior. Composed by advancing the this-ending SENIOR one more step via the
 * shared `nextGeneration` rule, which rolls a Senior over to the next
 * iteration's Junior — so this never duplicates the iteration-increment logic.
 */
export function nextEggGeneration(
  generation: GenerationState,
  scheme: Pick<GenerationalScheme, 'juniorSuffix' | 'seniorSuffix'>,
): GenerationState {
  const senior = advanceToThisEndingSenior(generation, scheme);
  // Senior → next iteration's Junior (the loop's next generation).
  return nextGeneration(senior, scheme);
}

/**
 * Resolve the full {@link EndingGenerationAdvance} for a generation (Req 32.3,
 * 32.4): the current state, this ending's same-iteration Senior, and the next
 * egg's next-iteration Junior — all via the shared `nextGeneration` rule.
 */
export function computeEndingGenerationAdvance(
  generation: GenerationState,
  scheme: Pick<GenerationalScheme, 'juniorSuffix' | 'seniorSuffix'>,
): EndingGenerationAdvance {
  return {
    current: generation,
    thisEndingSenior: advanceToThisEndingSenior(generation, scheme),
    nextEggJunior: nextEggGeneration(generation, scheme),
  };
}

/**
 * Compose the ending's generational LABELS (Req 21.19, 21.20, 32.3, 32.4) by
 * running the {@link computeEndingGenerationAdvance} states through the SHARED
 * `formatGenerationName` (NO duplicated roman-numeral / name logic). `baseName`
 * + `scheme.format` stay config-authoritative (Req 32.2).
 */
export function computeEndingGenerationLabels(
  baseName: string,
  scheme: Pick<GenerationalScheme, 'format' | 'juniorSuffix' | 'seniorSuffix'>,
  generation: GenerationState,
): EndingGenerationLabels {
  const advance = computeEndingGenerationAdvance(generation, scheme);
  const name = (g: GenerationState): string => formatGenerationName(baseName, scheme, g);
  return {
    current: name(advance.current),
    thisEndingSenior: name(advance.thisEndingSenior),
    nextEggJunior: name(advance.nextEggJunior),
  };
}

// ---------------------------------------------------------------------------
// Ending cinematic CONTENT — the ordered Comic_Panel sequence (Req 21.8, 21.9)
// ---------------------------------------------------------------------------

/**
 * The config values the ending content reads. Passed in as plain data so this
 * pure module never imports the config/engine layers; the engine seam
 * (CinematicScene) supplies them from the loaded Config_File.
 *
 * `generation` + `names` drive the pure Junior→Senior advance and next-egg label
 * (Req 32.3, 32.4); `creditsSlots` / `blooperSlots` come from
 * `config.cinematics` (Req 21.9). Everything is optional with sensible fallbacks
 * so a caller can build the sequence from as little as `{}` (empty slots + the
 * default "Kino" generation still yields a well-formed reunion→family→egg loop).
 */
export interface EndingCinematicContentInput {
  /**
   * The CURRENT generation state (the Kino that just finished the story). Drives
   * the same-iteration Senior advance + the next egg's label. Defaults to
   * iteration 1 Junior when omitted.
   */
  readonly generation?: GenerationState;
  /**
   * The base character name + generational scheme (`config.names`), used ONLY to
   * compose the generation labels via the shared `formatGenerationName`.
   * Defaults to a "Kino {roman} {suffix}" scheme when omitted.
   */
  readonly baseName?: string;
  readonly scheme?: Pick<GenerationalScheme, 'format' | 'juniorSuffix' | 'seniorSuffix'>;
  /**
   * Credits slots (`config.cinematics.creditsSlots`, Req 21.9) — one panel per
   * entry, in order. Empty by default.
   */
  readonly creditsSlots?: readonly string[];
  /**
   * Blooper-outtake slots (`config.cinematics.blooperSlots`, Req 21.9, 21.20) —
   * one panel per entry, referencing the creator/inspiration. Empty by default.
   */
  readonly blooperSlots?: readonly string[];
  /**
   * Optional Asset_Registry image keys for the three story beats
   * (placeholder-friendly: a missing/unknown key renders the comic frame as a
   * placeholder). The engine resolves these; this module just threads them on.
   */
  readonly imageKeys?: Partial<Record<'reunion' | 'start-family' | 'knock-next-egg', string>>;
}

/** The documented default generational scheme when the input omits one. */
const DEFAULT_SCHEME: Pick<GenerationalScheme, 'format' | 'juniorSuffix' | 'seniorSuffix'> = {
  format: '{base} {roman} {suffix}',
  juniorSuffix: 'Junior',
  seniorSuffix: 'Senior',
};

/** The documented default base character name when the input omits one. */
const DEFAULT_BASE_NAME = 'Kino';

/** The documented default current generation (Generation 1 Junior). */
function defaultGeneration(
  scheme: Pick<GenerationalScheme, 'juniorSuffix'>,
): GenerationState {
  return { iteration: 1, suffix: scheme.juniorSuffix };
}

/**
 * Build the full, ordered FINAL ending Comic_Panel sequence (Req 21.8, 21.9,
 * 21.19, 21.20, 32.3, 32.4).
 *
 * Order (the sequence the pure player walks, Req 21.8 + 21.9):
 *   1. REUNION          — Kino returns to the henhouse, reunites with grown
 *                         family.
 *   2. START A FAMILY   — carries this ending's SAME-iteration Senior label
 *                         (Req 21.19, 32.3) as `data`.
 *   3. KNOCK NEXT EGG   — carries the NEXT egg's NEXT-iteration + Junior label
 *                         (Req 21.20, 32.4) as `data`, looping the story.
 *   4..N. CREDITS       — one panel per `creditsSlots` entry (Req 21.9).
 *   N+1.. BLOOPERS       — one panel per `blooperSlots` entry (Req 21.9, 21.20).
 *
 * All sequencing + skippability stay in the pure player; this only supplies the
 * ordered content. The sequence always has AT LEAST the three story beats, so a
 * config with empty credits/blooper slots still plays a complete loop ending.
 */
export function buildEndingCinematicPanels(
  input: EndingCinematicContentInput = {},
): CinematicPanel[] {
  const scheme = input.scheme ?? DEFAULT_SCHEME;
  const baseName = input.baseName ?? DEFAULT_BASE_NAME;
  const generation = input.generation ?? defaultGeneration(scheme);

  const labels = computeEndingGenerationLabels(baseName, scheme, generation);
  const advance = computeEndingGenerationAdvance(generation, scheme);

  const imageFor = (
    kind: 'reunion' | 'start-family' | 'knock-next-egg',
  ): string | undefined => input.imageKeys?.[kind];
  const withImage = (
    panel: CinematicPanel,
    kind: 'reunion' | 'start-family' | 'knock-next-egg',
  ): CinematicPanel => {
    const key = imageFor(kind);
    return key ? { ...panel, imageKey: key } : panel;
  };

  const panels: CinematicPanel[] = [];

  // 1. REUNION — Kino returns through the portal to the henhouse (Req 21.8).
  panels.push(
    withImage(
      {
        id: FINAL_ENDING_PANEL_IDS.reunion,
        caption: `${labels.current} jumps through the portal — home at last — and reunites with Mama Kino and the now-grown siblings.`,
        data: {
          beat: 'reunion' satisfies EndingBeatKind,
        },
      },
      'reunion',
    ),
  );

  // 2. START A FAMILY — the Junior→Senior SAME-iteration advance (Req 21.19, 32.3).
  panels.push(
    withImage(
      {
        id: FINAL_ENDING_PANEL_IDS.startFamily,
        caption: `${labels.thisEndingSenior} starts a family of its own.`,
        data: {
          beat: 'start-family' satisfies EndingBeatKind,
          // The same-iteration Junior→Senior advance this ending performs.
          generationAdvance: {
            from: advance.current,
            to: advance.thisEndingSenior,
            fromLabel: labels.current,
            toLabel: labels.thisEndingSenior,
          },
        },
      },
      'start-family',
    ),
  );

  // 3. KNOCK THE NEXT EGG — labelled NEXT iteration + Junior, loops the story
  //    (Req 21.8, 21.20, 32.4).
  panels.push(
    withImage(
      {
        id: FINAL_ENDING_PANEL_IDS.knockNextEgg,
        caption: `Scratching its back, ${labels.thisEndingSenior} knocks the next egg out — ${labels.nextEggJunior} — and the story loops.`,
        data: {
          beat: 'knock-next-egg' satisfies EndingBeatKind,
          // The next egg's label: NEXT iteration + Junior (the loop's next gen).
          nextEgg: {
            generation: advance.nextEggJunior,
            label: labels.nextEggJunior,
          },
        },
      },
      'knock-next-egg',
    ),
  );

  // 4. CREDITS — one panel per config credits slot (Req 21.9).
  (input.creditsSlots ?? []).forEach((text, slotIndex) => {
    panels.push({
      id: `${FINAL_ENDING_PANEL_IDS.creditsPrefix}${slotIndex}`,
      caption: text,
      data: {
        beat: 'credits' satisfies EndingBeatKind,
        slotIndex,
      },
    });
  });

  // 5. BLOOPERS — blooper-style outtakes referencing creator/inspiration
  //    (Req 21.9, 21.20). One panel per config blooper slot.
  (input.blooperSlots ?? []).forEach((text, slotIndex) => {
    panels.push({
      id: `${FINAL_ENDING_PANEL_IDS.blooperPrefix}${slotIndex}`,
      caption: text,
      data: {
        beat: 'blooper' satisfies EndingBeatKind,
        slotIndex,
      },
    });
  });

  return panels;
}

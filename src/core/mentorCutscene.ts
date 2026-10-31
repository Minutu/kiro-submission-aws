// Feature: kino-game
//
// MentorCutscene — the PURE, Phaser-free CONTENT + rules for the per-world
// mentor cutscene: the speaker-swap dialogue sequence, the Evolution beat, and
// the skip-on-same-generation-retry predicate (task 10.3; design: "Cinematics
// System (Req 21, 29, 42)"; Req 21.2, 21.4, 21.5, 29.1-29.12, 42.1-42.6, 39.4).
//
// SCOPE / TASK BOUNDARY (10.3): this module owns three pure things, NO rendering:
//
//   1. The mentor cutscene Comic_Panel sequence (the `CinematicPanel[]` the pure
//      `createCinematicPlayer` walks) for a given world, built from config: the
//      per-world dialogue lines (`config.mentorDialogue[worldN]`), the mentor
//      name (`config.names.mentors[worldN]`), symbol (`config.mentorSymbols`),
//      image key (`config.mentorImages`), and world background
//      (`config.worldBackgrounds`). Each dialogue line becomes a panel carrying
//      the SPEAKER-SWAP layout state: which speaker is ACTIVE (sprite + chatbox)
//      and which is greyed in the corner, ALTERNATING per line (Req 42.1-42.6),
//      all over the animated world background (Req 42.3).
//
//   2. The EVOLUTION beat descriptor (Req 29.1-29.12): World 1 is the egg-crack
//      into a ghost hatchling (Req 29.10 / 21.17 tie-in), worlds 2-5 are a
//      subtle evolve (Req 29.11); the evolution visual style defaults to
//      `config.evolutionStyle` ('electric-zap-glow-burst', Req 29.9). Exposed as
//      pure data on the evolution panel.
//
//   3. The SKIP-ON-RETRY rule (Req 21.4, 21.5, 39.4): `shouldPlayMentorCutscene(
//      world, alreadyEvolvedThisGeneration)` returns false when Kino is already
//      evolved for that world in the current generation (same-generation retry
//      via restart or menu Continue/Play), true otherwise. The evolved flag is
//      PER-GENERATION RUN STATE the engine tracks for the current run/generation
//      — it is NOT persisted to the Save_Store schema (per-generation run state
//      never persists, Req 22.3/22.7). See EVOLVED-FLAG LOCATION below.
//
// EVOLVED-FLAG LOCATION: the "Kino is already evolved for world N this
// generation" bit is engine RUN STATE, not Save_Store data. The engine seam
// (CinematicScene / the run routing) tracks a per-generation set of
// already-evolved worlds — e.g. on the shared boot/run context in
// `src/engine/sharedContext.ts` — and passes the single boolean for the world
// being entered into this pure predicate. It resets when a new generation
// begins (every world's cutscene plays again on first entry, Req 21.5). Keeping
// it out of the persisted schema is deliberate: a returning session does NOT
// resurrect per-generation evolution (Req 22.7).
//
// HARD RULE: no module under `src/core/**` may import `phaser` (see
// `src/README.md`). This module imports only the pure CinematicPanel type and
// takes its config values (dialogue, names, symbols, keys) as plain inputs, so
// it stays unit-testable in plain Node with no browser/canvas/DOM.

import type { CinematicPanel } from './cinematicSequence.ts';

// ---------------------------------------------------------------------------
// Cinematic id + panel-id scheme (co-located with the OPENING / WORLD_COMPLETION
// ids so the engine CinematicScene seam references ONE shared string per id).
// ---------------------------------------------------------------------------

/**
 * The cinematic id for the mentor cutscene — the MENTOR counterpart to
 * OPENING_CINEMATIC_ID / WORLD_COMPLETION_CINEMATIC_ID. The engine
 * CinematicScene adds a branch for this id that resolves the pure panels for the
 * requested world and, on completion, hands off INTO the run (GameplayScene) —
 * the mentor cutscene precedes a world's run (Req 21.2).
 */
export const MENTOR_CUTSCENE_ID = 'mentor';

/** Stable panel ids for the mentor-cutscene beats so the engine/tests can key off them. */
export const MENTOR_CUTSCENE_PANEL_IDS = {
  /** Per-dialogue-line panel ids are suffixed with the 0-based line index. */
  dialoguePrefix: 'mentor-dialogue-',
  evolution: 'mentor-evolution',
} as const;

/** A discriminator the engine can switch rendering on. */
export type MentorBeatKind = 'dialogue' | 'evolution';

/** The two speakers in a mentor cutscene (Req 42.4-42.6). */
export type MentorSpeaker = 'mentor' | 'kino';

/**
 * The evolution visual kind (Req 29.10-29.11):
 *   - `egg-crack`      — World 1: the egg cracks into the walking/jumping ghost
 *                        hatchling (Req 29.10, the 21.17 tie-in).
 *   - `subtle-evolve`  — Worlds 2-5: an evolution effect with a subtle visual
 *                        change to Kino (Req 29.11).
 */
export type EvolutionKind = 'egg-crack' | 'subtle-evolve';

// ---------------------------------------------------------------------------
// Inputs — the config values the content reads, passed as plain data
// ---------------------------------------------------------------------------

/** One dialogue line with its alternating speaker (mirrors `config.mentorDialogue`). */
export interface MentorDialogueLineInput {
  /** `'mentor'` or `'kino'` (other values are normalized to `'mentor'`). */
  readonly speaker: string;
  readonly text: string;
}

/**
 * The config values the mentor-cutscene content reads for ONE world. Passed in
 * as plain data so this pure module never imports the config/engine layers; the
 * engine seam (CinematicScene) supplies them from the loaded Config_File for the
 * requested world.
 *
 * Everything except `world` is optional with sensible fallbacks so a caller can
 * build the sequence from as little as `{ world }` (an empty dialogue list still
 * yields the evolution beat).
 */
export interface MentorCutsceneContentInput {
  /** The World this cutscene precedes (1..5). */
  readonly world: number;
  /** This world's ordered dialogue lines (`config.mentorDialogue[worldN]`, Req 42.1). */
  readonly dialogue?: readonly MentorDialogueLineInput[];
  /** Mentor display name (`config.names.mentors[worldN]`, Req 29.2-29.6). */
  readonly mentorName?: string;
  /** Mentor AWS symbol (`config.mentorSymbols[worldN]`, Req 29.1). */
  readonly mentorSymbol?: string;
  /** Mentor image/Asset_Registry key (`config.mentorImages[worldN]`). Placeholder-friendly. */
  readonly mentorImageKey?: string;
  /** Baby-Kino image/Asset_Registry key (placeholder-friendly). Optional. */
  readonly kinoImageKey?: string;
  /** Animated world background key (`config.worldBackgrounds[worldN]`, Req 42.3). */
  readonly worldBackgroundKey?: string;
  /** Evolution visual style (`config.evolutionStyle`, Req 29.9). Defaults below. */
  readonly evolutionStyle?: string;
}

/** The documented default Evolution style (Req 29.9) when config omits it. */
export const DEFAULT_EVOLUTION_STYLE = 'electric-zap-glow-burst';

// ---------------------------------------------------------------------------
// Speaker-swap layout — the per-line ACTIVE / greyed state (Req 42.4-42.6)
// ---------------------------------------------------------------------------

/**
 * The speaker-swap layout state for one dialogue line (Req 42.4-42.6): exactly
 * ONE speaker is ACTIVE (sprite + chatbox shown), the OTHER is GREYED in a
 * background corner. The engine renders from this pure state; it decides nothing
 * itself.
 */
export interface SpeakerSwapLayout {
  /** The ACTIVE speaker — sprite + chatbox shown (Req 42.4-42.5). */
  readonly activeSpeaker: MentorSpeaker;
  /** The GREYED speaker — rendered greyed in a background corner (Req 42.4-42.5). */
  readonly greyedSpeaker: MentorSpeaker;
  /** The ACTIVE speaker's sprite image key (placeholder-friendly). */
  readonly activeImageKey?: string | undefined;
  /** The GREYED speaker's sprite image key (placeholder-friendly). */
  readonly greyedImageKey?: string | undefined;
}

/** Normalize a raw config speaker string to a `MentorSpeaker` (default `'mentor'`). */
function normalizeSpeaker(raw: string): MentorSpeaker {
  return raw === 'kino' ? 'kino' : 'mentor';
}

/** The opposite speaker (the greyed one) of an active speaker. */
function otherSpeaker(speaker: MentorSpeaker): MentorSpeaker {
  return speaker === 'mentor' ? 'kino' : 'mentor';
}

// ---------------------------------------------------------------------------
// Evolution beat — World 1 egg-crack vs worlds 2-5 subtle evolve (Req 29.9-29.11)
// ---------------------------------------------------------------------------

/** The pure Evolution descriptor carried on the evolution panel (Req 29.8-29.11). */
export interface EvolutionDescriptor {
  /** World 1 => `'egg-crack'`, worlds 2-5 => `'subtle-evolve'` (Req 29.10-29.11). */
  readonly kind: EvolutionKind;
  /** The evolution visual style from config, defaulting to `DEFAULT_EVOLUTION_STYLE` (Req 29.9). */
  readonly style: string;
  /** The World this evolution belongs to (1..5). */
  readonly world: number;
}

/**
 * The Evolution kind for a world (Req 29.10-29.11): World 1 cracks the egg into
 * the ghost hatchling; every other world is a subtle evolve.
 */
export function evolutionKindForWorld(world: number): EvolutionKind {
  return Math.trunc(world) === 1 ? 'egg-crack' : 'subtle-evolve';
}

/**
 * Build the pure Evolution descriptor for a world, resolving the style from the
 * input and falling back to the documented default (Req 29.9).
 */
export function buildEvolutionDescriptor(
  input: Pick<MentorCutsceneContentInput, 'world' | 'evolutionStyle'>,
): EvolutionDescriptor {
  const style =
    input.evolutionStyle && input.evolutionStyle.length > 0
      ? input.evolutionStyle
      : DEFAULT_EVOLUTION_STYLE;
  return {
    kind: evolutionKindForWorld(input.world),
    style,
    world: Math.trunc(input.world),
  };
}

// ---------------------------------------------------------------------------
// Content sequence — dialogue (speaker-swap) → evolution (Req 42.1-42.6, 29.x)
// ---------------------------------------------------------------------------

/**
 * Build ONE dialogue panel for `line` at `lineIndex` (Req 42.1-42.6). The panel
 * carries the speaker-swap layout state — ACTIVE speaker shown, OTHER greyed in
 * a corner — plus the animated world background key (Req 42.3). The active
 * speaker alternates line-by-line: it is simply the line's OWN speaker, which
 * the config dialogue alternates (mentor/kino/mentor/...), so when the current
 * speaker changes the layout swaps (Req 42.6).
 */
function buildDialoguePanel(
  input: MentorCutsceneContentInput,
  line: MentorDialogueLineInput,
  lineIndex: number,
): CinematicPanel {
  const active = normalizeSpeaker(line.speaker);
  const greyed = otherSpeaker(active);

  const imageFor = (speaker: MentorSpeaker): string | undefined =>
    speaker === 'mentor' ? input.mentorImageKey : input.kinoImageKey;

  const layout: SpeakerSwapLayout = {
    activeSpeaker: active,
    greyedSpeaker: greyed,
    activeImageKey: imageFor(active),
    greyedImageKey: imageFor(greyed),
  };

  const panel: CinematicPanel = {
    id: `${MENTOR_CUTSCENE_PANEL_IDS.dialoguePrefix}${lineIndex}`,
    caption: line.text,
    data: {
      beat: 'dialogue' satisfies MentorBeatKind,
      world: Math.trunc(input.world),
      lineIndex,
      layout,
      // Mentor identity, so the engine can render the name/symbol alongside.
      mentorName: input.mentorName,
      mentorSymbol: input.mentorSymbol,
      // The animated world background rendered BEHIND the dialogue (Req 42.3).
      worldBackgroundKey: input.worldBackgroundKey,
    },
  };

  // The panel's primary art is the ACTIVE speaker's sprite (placeholder-friendly).
  return layout.activeImageKey ? { ...panel, imageKey: layout.activeImageKey } : panel;
}

/**
 * Build the evolution panel (Req 29.8-29.11): the beat AFTER the dialogue where
 * Kino evolves and gains the world's ability for the current generation. Carries
 * the pure Evolution descriptor (egg-crack vs subtle-evolve + config style).
 */
function buildEvolutionPanel(input: MentorCutsceneContentInput): CinematicPanel {
  const evolution = buildEvolutionDescriptor(input);
  const caption =
    evolution.kind === 'egg-crack'
      ? 'The egg cracks — baby Kino emerges as a walking, jumping ghost!'
      : 'Energy surges — Kino evolves and takes on the new ability!';

  const panel: CinematicPanel = {
    id: MENTOR_CUTSCENE_PANEL_IDS.evolution,
    caption,
    data: {
      beat: 'evolution' satisfies MentorBeatKind,
      world: Math.trunc(input.world),
      evolution,
      // Background stays behind the evolution beat too (Req 42.3 continuity).
      worldBackgroundKey: input.worldBackgroundKey,
    },
  };
  return input.kinoImageKey ? { ...panel, imageKey: input.kinoImageKey } : panel;
}

/**
 * Build the full, ordered mentor cutscene Comic_Panel sequence for a world
 * (Req 21.2, 29.7-29.11, 42.1-42.6).
 *
 * Order (the sequence the pure player walks):
 *   1..N. One dialogue panel per config dialogue line, with the speaker-swap
 *         layout ALTERNATING as the speaker changes, over the animated world
 *         background (Req 42.1-42.6).
 *   N+1.  The Evolution beat — World 1 egg-crack / worlds 2-5 subtle-evolve,
 *         carrying the config evolution style (Req 29.8-29.11).
 *
 * The Mentor "introduces the World's required movement immediately before the
 * Evolution" (Req 29.7): the dialogue precedes the evolution panel by
 * construction. An empty dialogue list still yields the single evolution panel.
 */
export function buildMentorCutscenePanels(
  input: MentorCutsceneContentInput,
): CinematicPanel[] {
  const panels: CinematicPanel[] = [];

  const dialogue = input.dialogue ?? [];
  dialogue.forEach((line, lineIndex) => {
    panels.push(buildDialoguePanel(input, line, lineIndex));
  });

  // The Evolution beat always follows the dialogue (Req 29.7-29.8).
  panels.push(buildEvolutionPanel(input));

  return panels;
}

// ---------------------------------------------------------------------------
// Skip-on-retry rule — the pure predicate (Req 21.4, 21.5, 39.4)
// ---------------------------------------------------------------------------

/**
 * Whether the mentor cutscene should PLAY before a world's run (Req 21.4, 21.5,
 * 39.4).
 *
 * Returns FALSE — SKIP the cutscene — when Kino is ALREADY EVOLVED for that
 * world in the CURRENT generation: a same-generation retry via the restart
 * control or the menu Continue/Play control (Req 21.4), or a Run_End_Screen
 * retry (Req 39.4). In that case the run starts with Kino already evolved and
 * the cutscene is not replayed.
 *
 * Returns TRUE — PLAY the cutscene — otherwise: the first entry of a world in
 * the current generation (Req 21.2), including the first entry after a NEW
 * generation begins (every world's `alreadyEvolvedThisGeneration` resets to
 * false on a new generation, so each world's cutscene plays again — Req 21.5).
 *
 * `world` is accepted for call-site clarity/symmetry (the decision is purely the
 * evolved flag for THAT world); it is not otherwise inspected.
 *
 * This is PURE: the `alreadyEvolvedThisGeneration` bit is per-generation RUN
 * state the engine tracks (see the EVOLVED-FLAG LOCATION note at the top). It is
 * NOT read from the persisted Save_Store.
 */
export function shouldPlayMentorCutscene(
  world: number,
  alreadyEvolvedThisGeneration: boolean,
): boolean {
  void world;
  return !alreadyEvolvedThisGeneration;
}

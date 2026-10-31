// Feature: kino-game
//
// UNIT tests for task 10.3 — the PURE mentor-cutscene CONTENT + rules
// (`src/core/mentorCutscene.ts`; design: "Cinematics System (Req 21, 29, 42)";
// Req 21.2, 21.4, 21.5, 29.1-29.12, 42.1-42.6, 39.4).
//
// Pins:
//   1. The dialogue panels carry the SPEAKER-SWAP layout — exactly one ACTIVE
//      speaker (sprite + chatbox) and the OTHER greyed in the corner, ALTERNATING
//      as the config dialogue speaker changes, over the animated world
//      background (Req 42.1-42.6).
//   2. Five mentors resolve name / symbol / image from config per world (Req
//      29.1-29.6); the sequence precedes the evolution (Req 29.7).
//   3. The Evolution beat carries the config evolution style and the World-1
//      egg-crack vs worlds-2-5 subtle-evolve distinction (Req 29.8-29.11).
//   4. `shouldPlayMentorCutscene` is false when already evolved this generation
//      and true otherwise (Req 21.4/21.5/39.4).
//
// Pure TypeScript, no Phaser — core module, testable in plain Node.

import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/config/index.ts';
import {
  buildMentorCutscenePanels,
  buildEvolutionDescriptor,
  evolutionKindForWorld,
  shouldPlayMentorCutscene,
  DEFAULT_EVOLUTION_STYLE,
  MENTOR_CUTSCENE_ID,
  MENTOR_CUTSCENE_PANEL_IDS,
  type CinematicPanel,
  type MentorBeatKind,
  type MentorCutsceneContentInput,
  type SpeakerSwapLayout,
  type EvolutionDescriptor,
} from '../src/core/index.ts';

/** Read a panel beat from its opaque `data` bag. */
function beat(panel: CinematicPanel): MentorBeatKind | undefined {
  return panel.data?.['beat'] as MentorBeatKind | undefined;
}

/** Read the speaker-swap layout off a dialogue panel. */
function layoutOf(panel: CinematicPanel): SpeakerSwapLayout | undefined {
  return panel.data?.['layout'] as SpeakerSwapLayout | undefined;
}

type WorldKey = 'world1' | 'world2' | 'world3' | 'world4' | 'world5';
const WORLD_KEYS: readonly WorldKey[] = ['world1', 'world2', 'world3', 'world4', 'world5'];

/** Build the content input for a world straight from the default config. */
function inputForWorld(world: number): MentorCutsceneContentInput {
  const key = `world${world}` as WorldKey;
  return {
    world,
    dialogue: defaultConfig.mentorDialogue[key],
    mentorName: defaultConfig.names.mentors[key],
    mentorSymbol: defaultConfig.mentorSymbols[key],
    mentorImageKey: defaultConfig.mentorImages[key],
    kinoImageKey: defaultConfig.starterAssets.kinoSprite,
    worldBackgroundKey: defaultConfig.worldBackgrounds[key],
    evolutionStyle: defaultConfig.evolutionStyle,
  };
}

// ---------------------------------------------------------------------------
// 0. The cinematic id constant
// ---------------------------------------------------------------------------

describe('MENTOR_CUTSCENE_ID', () => {
  it('is the stable "mentor" id', () => {
    expect(MENTOR_CUTSCENE_ID).toBe('mentor');
  });
});

// ---------------------------------------------------------------------------
// 1. Speaker-swap dialogue (Req 42.1-42.6)
// ---------------------------------------------------------------------------

describe('buildMentorCutscenePanels — speaker-swap dialogue (Req 42.1-42.6)', () => {
  it('emits one dialogue panel per config line, then the evolution beat', () => {
    // Give World 1 a four-line alternating dialogue.
    const input: MentorCutsceneContentInput = {
      world: 1,
      dialogue: [
        { speaker: 'mentor', text: 'Welcome to the desert, hatchling.' },
        { speaker: 'kino', text: '...peep?' },
        { speaker: 'mentor', text: 'You must learn to JUMP.' },
        { speaker: 'kino', text: 'peep!' },
      ],
    };
    const panels = buildMentorCutscenePanels(input);

    expect(panels.map(beat)).toEqual(['dialogue', 'dialogue', 'dialogue', 'dialogue', 'evolution']);
    // Dialogue panel ids are suffixed with the line index.
    expect(panels.slice(0, 4).map((p) => p.id)).toEqual([
      `${MENTOR_CUTSCENE_PANEL_IDS.dialoguePrefix}0`,
      `${MENTOR_CUTSCENE_PANEL_IDS.dialoguePrefix}1`,
      `${MENTOR_CUTSCENE_PANEL_IDS.dialoguePrefix}2`,
      `${MENTOR_CUTSCENE_PANEL_IDS.dialoguePrefix}3`,
    ]);
    expect(panels[4]!.id).toBe(MENTOR_CUTSCENE_PANEL_IDS.evolution);
  });

  it('marks exactly one ACTIVE speaker and the OTHER greyed, alternating per line (Req 42.4-42.6)', () => {
    const input: MentorCutsceneContentInput = {
      world: 2,
      dialogue: [
        { speaker: 'mentor', text: 'a' },
        { speaker: 'kino', text: 'b' },
        { speaker: 'mentor', text: 'c' },
      ],
    };
    const dialoguePanels = buildMentorCutscenePanels(input).filter((p) => beat(p) === 'dialogue');

    const actives = dialoguePanels.map((p) => layoutOf(p)!.activeSpeaker);
    const greyed = dialoguePanels.map((p) => layoutOf(p)!.greyedSpeaker);

    // Active follows the config line speaker; greyed is always the OTHER.
    expect(actives).toEqual(['mentor', 'kino', 'mentor']);
    expect(greyed).toEqual(['kino', 'mentor', 'kino']);

    // The active and greyed speaker are always distinct (exactly one active).
    for (const p of dialoguePanels) {
      const l = layoutOf(p)!;
      expect(l.activeSpeaker).not.toBe(l.greyedSpeaker);
    }
  });

  it('normalizes unknown speaker strings to "mentor"', () => {
    const panels = buildMentorCutscenePanels({
      world: 1,
      dialogue: [{ speaker: 'narrator', text: 'x' }],
    });
    expect(layoutOf(panels[0]!)!.activeSpeaker).toBe('mentor');
    expect(layoutOf(panels[0]!)!.greyedSpeaker).toBe('kino');
  });

  it('routes each speaker to its own sprite image key (active + greyed)', () => {
    const input: MentorCutsceneContentInput = {
      world: 1,
      dialogue: [
        { speaker: 'mentor', text: 'a' },
        { speaker: 'kino', text: 'b' },
      ],
      mentorImageKey: 'mentor-img',
      kinoImageKey: 'kino-img',
    };
    const [mentorLine, kinoLine] = buildMentorCutscenePanels(input);

    const mLayout = layoutOf(mentorLine!)!;
    expect(mLayout.activeImageKey).toBe('mentor-img');
    expect(mLayout.greyedImageKey).toBe('kino-img');
    // The panel's primary art is the ACTIVE speaker's sprite.
    expect(mentorLine!.imageKey).toBe('mentor-img');

    const kLayout = layoutOf(kinoLine!)!;
    expect(kLayout.activeImageKey).toBe('kino-img');
    expect(kLayout.greyedImageKey).toBe('mentor-img');
    expect(kinoLine!.imageKey).toBe('kino-img');
  });

  it('carries the animated world background key on every dialogue panel (Req 42.3)', () => {
    const panels = buildMentorCutscenePanels({
      world: 3,
      dialogue: [
        { speaker: 'mentor', text: 'a' },
        { speaker: 'kino', text: 'b' },
      ],
      worldBackgroundKey: 'bg-world3',
    });
    for (const p of panels.filter((x) => beat(x) === 'dialogue')) {
      expect(p.data?.['worldBackgroundKey']).toBe('bg-world3');
    }
  });

  it('uses the config dialogue text verbatim as the panel caption (Req 42.1)', () => {
    const panels = buildMentorCutscenePanels({
      world: 1,
      dialogue: [{ speaker: 'mentor', text: 'Serious teaching line.' }],
    });
    expect(panels[0]!.caption).toBe('Serious teaching line.');
  });

  it('still yields the evolution beat when the dialogue list is empty', () => {
    const panels = buildMentorCutscenePanels({ world: 1, dialogue: [] });
    expect(panels.map(beat)).toEqual(['evolution']);
  });
});

// ---------------------------------------------------------------------------
// 2. Five mentors resolve name / symbol / image from config (Req 29.1-29.6)
// ---------------------------------------------------------------------------

describe('five mentors resolve name/symbol/image from config per world (Req 29.1-29.6)', () => {
  it('threads the config mentor name + symbol onto this world\'s dialogue panels', () => {
    for (let world = 1; world <= 5; world += 1) {
      const key = WORLD_KEYS[world - 1]!;
      const input = inputForWorld(world);
      // Ensure a non-empty dialogue so a dialogue panel exists to read.
      const withDialogue: MentorCutsceneContentInput = {
        ...input,
        dialogue: [{ speaker: 'mentor', text: 'line' }],
      };
      const panels = buildMentorCutscenePanels(withDialogue);
      const dialogue = panels.find((p) => beat(p) === 'dialogue')!;

      expect(dialogue.data?.['mentorName']).toBe(defaultConfig.names.mentors[key]);
      expect(dialogue.data?.['mentorSymbol']).toBe(defaultConfig.mentorSymbols[key]);
    }
  });

  it('the five default mentor names are the documented defaults (Req 29.2-29.6)', () => {
    expect(defaultConfig.names.mentors.world1).toBe('Officer Kino-Route-53');
    expect(defaultConfig.names.mentors.world2).toBe('Engineer Kino-EC2');
    expect(defaultConfig.names.mentors.world3).toBe('Archivist Kino');
    expect(defaultConfig.names.mentors.world4).toBe('Storage Keeper Kino');
    expect(defaultConfig.names.mentors.world5).toBe('Commander Kino-IAM');
  });

  it('the five default mentor symbols are distinct (one per world, Req 29.1)', () => {
    const symbols = WORLD_KEYS.map((k) => defaultConfig.mentorSymbols[k]);
    expect(new Set(symbols).size).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// 3. Evolution beat — config style + egg-crack vs subtle-evolve (Req 29.8-29.11)
// ---------------------------------------------------------------------------

describe('evolution beat — config style + egg-crack vs subtle (Req 29.8-29.11)', () => {
  it('World 1 evolution is the egg-crack into the ghost hatchling (Req 29.10)', () => {
    expect(evolutionKindForWorld(1)).toBe('egg-crack');
    const panels = buildMentorCutscenePanels(inputForWorld(1));
    const evo = panels.find((p) => beat(p) === 'evolution')!;
    const descriptor = evo.data?.['evolution'] as EvolutionDescriptor;
    expect(descriptor.kind).toBe('egg-crack');
    expect(descriptor.world).toBe(1);
  });

  it('worlds 2-5 evolution is the subtle evolve (Req 29.11)', () => {
    for (const world of [2, 3, 4, 5]) {
      expect(evolutionKindForWorld(world)).toBe('subtle-evolve');
      const panels = buildMentorCutscenePanels(inputForWorld(world));
      const evo = panels.find((p) => beat(p) === 'evolution')!;
      const descriptor = evo.data?.['evolution'] as EvolutionDescriptor;
      expect(descriptor.kind).toBe('subtle-evolve');
      expect(descriptor.world).toBe(world);
    }
  });

  it('carries the config evolution style on the evolution descriptor (Req 29.9)', () => {
    const panels = buildMentorCutscenePanels({ world: 2, evolutionStyle: 'custom-sparkle' });
    const descriptor = panels.find((p) => beat(p) === 'evolution')!.data?.[
      'evolution'
    ] as EvolutionDescriptor;
    expect(descriptor.style).toBe('custom-sparkle');
  });

  it('defaults the evolution style to electric-zap-glow-burst when config omits it (Req 29.9)', () => {
    expect(DEFAULT_EVOLUTION_STYLE).toBe('electric-zap-glow-burst');
    const descriptor = buildEvolutionDescriptor({ world: 3 });
    expect(descriptor.style).toBe(DEFAULT_EVOLUTION_STYLE);
    // Empty string also falls back to the default.
    expect(buildEvolutionDescriptor({ world: 3, evolutionStyle: '' }).style).toBe(
      DEFAULT_EVOLUTION_STYLE,
    );
  });

  it('the default config evolution style IS the documented default', () => {
    expect(defaultConfig.evolutionStyle).toBe(DEFAULT_EVOLUTION_STYLE);
  });

  it('places the evolution beat LAST, after all dialogue (Req 29.7)', () => {
    const panels = buildMentorCutscenePanels({
      world: 1,
      dialogue: [
        { speaker: 'mentor', text: 'a' },
        { speaker: 'kino', text: 'b' },
      ],
    });
    expect(beat(panels[panels.length - 1]!)).toBe('evolution');
    // No dialogue appears after the evolution.
    const evoIndex = panels.findIndex((p) => beat(p) === 'evolution');
    expect(panels.slice(evoIndex + 1).some((p) => beat(p) === 'dialogue')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 4. Skip-on-retry predicate (Req 21.4, 21.5, 39.4)
// ---------------------------------------------------------------------------

describe('shouldPlayMentorCutscene — skip when already evolved this generation (Req 21.4/39.4)', () => {
  it('is FALSE (skip) when Kino is already evolved for the world this generation', () => {
    for (let world = 1; world <= 5; world += 1) {
      expect(shouldPlayMentorCutscene(world, true)).toBe(false);
    }
  });

  it('is TRUE (play) on first entry this generation — not yet evolved (Req 21.2/21.5)', () => {
    for (let world = 1; world <= 5; world += 1) {
      expect(shouldPlayMentorCutscene(world, false)).toBe(true);
    }
  });

  it('decision depends only on the evolved flag, not the world id', () => {
    // Same evolved flag => same decision across all worlds.
    const playedWorlds = [1, 2, 3, 4, 5].map((w) => shouldPlayMentorCutscene(w, false));
    expect(new Set(playedWorlds)).toEqual(new Set([true]));
    const skippedWorlds = [1, 2, 3, 4, 5].map((w) => shouldPlayMentorCutscene(w, true));
    expect(new Set(skippedWorlds)).toEqual(new Set([false]));
  });
});

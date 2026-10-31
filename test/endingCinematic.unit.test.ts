// Feature: kino-game
//
// UNIT tests for task 10.5 — the PURE final-ending cinematic CONTENT + the
// ending GENERATION-ADVANCE math (`src/core/endingCinematic.ts`; design:
// "Cinematics System (Req 21, 29, 42)"; Req 21.8, 21.9, 21.19, 21.20, 32.3,
// 32.4).
//
// Pins:
//   1. `buildEndingCinematicPanels` emits the final sequence beats IN ORDER —
//      reunion → start-family → knock-next-egg → credits → bloopers — every
//      panel well-formed (Req 21.8, 21.9).
//   2. The CREDITS panels mirror `config.cinematics.creditsSlots` and the
//      BLOOPER panels mirror `config.cinematics.blooperSlots`, referencing the
//      creator/inspiration via those config slots (Req 21.9, 21.20).
//   3. The START-A-FAMILY panel carries this ending's Junior→Senior SAME-iteration
//      advance (Req 21.19, 32.3) and the KNOCK-NEXT-EGG panel carries the NEXT
//      egg's NEXT-iteration + Junior label (Req 21.20, 32.4) — both asserted
//      against the shared `formatGenerationName`.
//
// Pure TypeScript, no Phaser — core module, testable in plain Node.

import { describe, it, expect } from 'vitest';
import { defaultConfig } from '../src/config/index.ts';
import {
  buildEndingCinematicPanels,
  advanceToThisEndingSenior,
  nextEggGeneration,
  computeEndingGenerationAdvance,
  computeEndingGenerationLabels,
  formatGenerationName,
  FINAL_ENDING_CINEMATIC_ID,
  FINAL_ENDING_PANEL_IDS,
  type CinematicPanel,
  type EndingBeatKind,
  type GenerationState,
} from '../src/core/index.ts';

/** Read a panel beat from its opaque `data` bag. */
function beat(panel: CinematicPanel): EndingBeatKind | undefined {
  return panel.data?.['beat'] as EndingBeatKind | undefined;
}

const scheme = defaultConfig.names.generationalScheme;
const baseName = defaultConfig.names.baseCharacterName;

/** Compose a name via the SHARED composer (the assertion oracle). */
function name(g: GenerationState): string {
  return formatGenerationName(baseName, scheme, g);
}

// ---------------------------------------------------------------------------
// 1. Content sequence order + well-formedness (Req 21.8, 21.9)
// ---------------------------------------------------------------------------

describe('buildEndingCinematicPanels — ordered, well-formed final sequence (Req 21.8, 21.9)', () => {
  it('emits reunion → start-family → knock-next-egg → credits… → bloopers… in order', () => {
    const panels = buildEndingCinematicPanels({
      generation: { iteration: 3, suffix: scheme.juniorSuffix },
      baseName,
      scheme,
      creditsSlots: ['Created by Nym', 'Inspired by Flappy Bird'],
      blooperSlots: ['Outtake: Kino misses the portal'],
    });

    expect(panels.map(beat)).toEqual([
      'reunion',
      'start-family',
      'knock-next-egg',
      'credits',
      'credits',
      'blooper',
    ]);

    // Every panel is well-formed: a non-empty caption and an id.
    expect(
      panels.every(
        (p) => typeof p.caption === 'string' && p.caption.length > 0 && typeof p.id === 'string',
      ),
    ).toBe(true);
  });

  it('keeps the three story beats before ANY credits/blooper beat', () => {
    const panels = buildEndingCinematicPanels({
      creditsSlots: ['c0'],
      blooperSlots: ['b0'],
    });
    const firstCredits = panels.findIndex((p) => beat(p) === 'credits');
    const firstStory = panels.findIndex((p) => beat(p) === 'knock-next-egg');
    expect(firstStory).toBeLessThan(firstCredits);
  });

  it('uses the stable story-beat panel ids', () => {
    const panels = buildEndingCinematicPanels();
    expect(panels[0]!.id).toBe(FINAL_ENDING_PANEL_IDS.reunion);
    expect(panels[1]!.id).toBe(FINAL_ENDING_PANEL_IDS.startFamily);
    expect(panels[2]!.id).toBe(FINAL_ENDING_PANEL_IDS.knockNextEgg);
  });

  it('always has at least the three story beats even with empty slots', () => {
    const panels = buildEndingCinematicPanels({ creditsSlots: [], blooperSlots: [] });
    expect(panels.map(beat)).toEqual(['reunion', 'start-family', 'knock-next-egg']);
  });

  it('threads placeholder-friendly image keys onto the story beats they name', () => {
    const panels = buildEndingCinematicPanels({
      imageKeys: {
        reunion: 'img-reunion',
        'start-family': 'img-family',
        'knock-next-egg': 'img-egg',
      },
    });
    expect(panels.find((p) => beat(p) === 'reunion')?.imageKey).toBe('img-reunion');
    expect(panels.find((p) => beat(p) === 'start-family')?.imageKey).toBe('img-family');
    expect(panels.find((p) => beat(p) === 'knock-next-egg')?.imageKey).toBe('img-egg');
  });

  it('exposes the final-ending cinematic id constant', () => {
    expect(FINAL_ENDING_CINEMATIC_ID).toBe('final-ending');
  });
});

// ---------------------------------------------------------------------------
// 2. Credits + bloopers come from the config slots (Req 21.9, 21.20)
// ---------------------------------------------------------------------------

describe('buildEndingCinematicPanels — credits/bloopers mirror the config slots (Req 21.9, 21.20)', () => {
  it('one credits panel per creditsSlots entry, in order, captioned verbatim', () => {
    const creditsSlots = ['Created by Nym', 'Art by Nym', 'Inspired by Flappy Bird + DBZ'];
    const panels = buildEndingCinematicPanels({ creditsSlots });
    const credits = panels.filter((p) => beat(p) === 'credits');
    expect(credits).toHaveLength(creditsSlots.length);
    expect(credits.map((p) => p.caption)).toEqual(creditsSlots);
    credits.forEach((p, i) => {
      expect(p.id).toBe(`${FINAL_ENDING_PANEL_IDS.creditsPrefix}${i}`);
      expect(p.data?.['slotIndex']).toBe(i);
    });
  });

  it('one blooper panel per blooperSlots entry, in order, captioned verbatim', () => {
    const blooperSlots = ['Blooper: Kino trips on the egg', 'Blooper: mentor forgets the line'];
    const panels = buildEndingCinematicPanels({ blooperSlots });
    const bloopers = panels.filter((p) => beat(p) === 'blooper');
    expect(bloopers).toHaveLength(blooperSlots.length);
    expect(bloopers.map((p) => p.caption)).toEqual(blooperSlots);
    bloopers.forEach((p, i) => {
      expect(p.id).toBe(`${FINAL_ENDING_PANEL_IDS.blooperPrefix}${i}`);
    });
  });

  it('references the creator/inspiration through the slots (not hard-coded)', () => {
    const panels = buildEndingCinematicPanels({
      creditsSlots: ['A game by ACME'],
      blooperSlots: ['Inspired by the classic bird'],
    });
    const texts = panels
      .filter((p) => beat(p) === 'credits' || beat(p) === 'blooper')
      .map((p) => p.caption);
    expect(texts).toContain('A game by ACME');
    expect(texts).toContain('Inspired by the classic bird');
  });

  it('builds from the default config cinematics slots without throwing', () => {
    const panels = buildEndingCinematicPanels({
      generation: { iteration: 1, suffix: scheme.juniorSuffix },
      baseName,
      scheme,
      creditsSlots: defaultConfig.cinematics.creditsSlots,
      blooperSlots: defaultConfig.cinematics.blooperSlots,
    });
    // Default slots are empty, so only the three story beats play.
    expect(panels.map(beat)).toEqual(['reunion', 'start-family', 'knock-next-egg']);
  });
});

// ---------------------------------------------------------------------------
// 3. Generation advance — Junior→Senior same iteration + next egg (Req 32.3, 32.4)
// ---------------------------------------------------------------------------

describe('ending generation advance — Junior→Senior same iteration + next egg (Req 21.19, 21.20, 32.3, 32.4)', () => {
  it('advanceToThisEndingSenior: Junior → Senior with the SAME iteration', () => {
    const senior = advanceToThisEndingSenior(
      { iteration: 3, suffix: scheme.juniorSuffix },
      scheme,
    );
    expect(senior).toEqual({ iteration: 3, suffix: scheme.seniorSuffix });
  });

  it('advanceToThisEndingSenior: an already-Senior ending stays Senior, same iteration', () => {
    const senior = advanceToThisEndingSenior(
      { iteration: 4, suffix: scheme.seniorSuffix },
      scheme,
    );
    expect(senior).toEqual({ iteration: 4, suffix: scheme.seniorSuffix });
  });

  it('nextEggGeneration: the NEXT iteration + Junior', () => {
    const egg = nextEggGeneration({ iteration: 3, suffix: scheme.juniorSuffix }, scheme);
    expect(egg).toEqual({ iteration: 4, suffix: scheme.juniorSuffix });
  });

  it('computeEndingGenerationAdvance resolves current / this-ending-Senior / next-egg', () => {
    const advance = computeEndingGenerationAdvance(
      { iteration: 2, suffix: scheme.juniorSuffix },
      scheme,
    );
    expect(advance.current).toEqual({ iteration: 2, suffix: scheme.juniorSuffix });
    expect(advance.thisEndingSenior).toEqual({ iteration: 2, suffix: scheme.seniorSuffix });
    expect(advance.nextEggJunior).toEqual({ iteration: 3, suffix: scheme.juniorSuffix });
  });

  it('computeEndingGenerationLabels composes via the shared formatGenerationName', () => {
    const gen: GenerationState = { iteration: 3, suffix: scheme.juniorSuffix };
    const labels = computeEndingGenerationLabels(baseName, scheme, gen);
    expect(labels.current).toBe(name({ iteration: 3, suffix: scheme.juniorSuffix }));
    expect(labels.thisEndingSenior).toBe(name({ iteration: 3, suffix: scheme.seniorSuffix }));
    expect(labels.nextEggJunior).toBe(name({ iteration: 4, suffix: scheme.juniorSuffix }));
    // Sanity: the default scheme renders roman numerals (Req 32.1).
    expect(labels.thisEndingSenior).toBe('Kino III Senior');
    expect(labels.nextEggJunior).toBe('Kino IV Junior');
  });

  it('the start-family panel carries the Junior→Senior same-iteration advance (Req 21.19, 32.3)', () => {
    const gen: GenerationState = { iteration: 3, suffix: scheme.juniorSuffix };
    const panels = buildEndingCinematicPanels({ generation: gen, baseName, scheme });
    const family = panels.find((p) => beat(p) === 'start-family')!;
    const adv = family.data?.['generationAdvance'] as {
      from: GenerationState;
      to: GenerationState;
      fromLabel: string;
      toLabel: string;
    };
    expect(adv.from).toEqual({ iteration: 3, suffix: scheme.juniorSuffix });
    expect(adv.to).toEqual({ iteration: 3, suffix: scheme.seniorSuffix });
    // Same iteration number across the advance (the 21.19 contract).
    expect(adv.to.iteration).toBe(adv.from.iteration);
    expect(adv.toLabel).toBe(name({ iteration: 3, suffix: scheme.seniorSuffix }));
    // The panel caption surfaces the Senior label (comic-book narration).
    expect(family.caption).toContain(adv.toLabel);
  });

  it('the knock-next-egg panel labels the next egg NEXT iteration + Junior (Req 21.20, 32.4)', () => {
    const gen: GenerationState = { iteration: 3, suffix: scheme.juniorSuffix };
    const panels = buildEndingCinematicPanels({ generation: gen, baseName, scheme });
    const egg = panels.find((p) => beat(p) === 'knock-next-egg')!;
    const next = egg.data?.['nextEgg'] as { generation: GenerationState; label: string };
    expect(next.generation).toEqual({ iteration: 4, suffix: scheme.juniorSuffix });
    expect(next.label).toBe(name({ iteration: 4, suffix: scheme.juniorSuffix }));
    // The next-egg label is next iteration + Junior (never Senior).
    expect(next.generation.suffix).toBe(scheme.juniorSuffix);
    expect(next.generation.iteration).toBe(gen.iteration + 1);
    // The panel caption surfaces the next-egg label.
    expect(egg.caption).toContain(next.label);
  });

  it('defaults to Generation 1 Junior when no generation is supplied', () => {
    const panels = buildEndingCinematicPanels();
    const family = panels.find((p) => beat(p) === 'start-family')!;
    const adv = family.data?.['generationAdvance'] as { from: GenerationState };
    expect(adv.from).toEqual({ iteration: 1, suffix: 'Junior' });
  });
});

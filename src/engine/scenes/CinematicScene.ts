// Feature: kino-game
//
// CinematicScene — the generic, reusable, SKIPPABLE cinematic shell (task 10.1;
// design: "Cinematics System (Req 21, 29, 42)" → "CinematicScene plays
// scripted, skippable sequences driven by config-supplied content"; Req 21.3,
// 21.18, 21.21).
//
// SCOPE / TASK BOUNDARY (10.1): this is the reusable FRAMEWORK — a comic-book
// panel renderer plus the skip control and the next-scene hand-off — NOT any
// specific cinematic's content. It renders the CURRENT Comic_Panel in a
// comic-book style (paneled frame, caption, art via the Asset_Registry with a
// placeholder-friendly resolve), advances panel-by-panel on tap/click/key
// (Req 21.21), offers a SKIP control that ends the sequence (Req 21.3, 21.18),
// and on completion runs the onComplete / next-scene hand-off. ALL sequencing
// is deferred to the PURE `core.createCinematicPlayer`; this class owns only
// Phaser rendering, input, and scene routing. The specific cinematics (opening
// egg-descent 10.2, mentor cutscene 10.3, world-completion 10.4, final/credits
// 10.5) build on top of this shell by supplying their panels/content.
//
// It registers under the SAME `CINEMATIC_SCENE_KEY` ('Cinematic') BootScene
// routes a first boot to (Req 40.2), so the existing boot routing resolves even
// while the opening-cinematic CONTENT is a later task: with no panels for the
// requested cinematic yet, the pure player is immediately complete and the
// scene hands straight back to its `nextSceneKey` (defaulting to Preload).
//
// ENGINE layer, so importing Phaser is allowed (src/README.md). The sequencing
// decisions live in the Phaser-free `core.createCinematicPlayer` so they stay
// unit-testable without a browser/canvas; this class is only Phaser wiring.

import Phaser from 'phaser';
import {
  createCinematicPlayer,
  buildOpeningCinematicPanels,
  buildWorldCompletionCinematicPanels,
  buildMentorCutscenePanels,
  buildEndingCinematicPanels,
  shouldPlayMentorCutscene,
  WORLD_COMPLETION_CINEMATIC_ID,
  MENTOR_CUTSCENE_ID,
  FINAL_ENDING_CINEMATIC_ID,
  type CinematicPanel,
  type CinematicPlayer,
  type OpeningCinematicContentInput,
  type WorldCompletionContentInput,
  type MentorCutsceneContentInput,
  type EndingCinematicContentInput,
} from '../../core/index.ts';
import type { ConfigFileData } from '../../config/index.ts';
import {
  getBootContext,
  isWorldEvolvedThisGeneration,
  markWorldEvolvedThisGeneration,
} from '../sharedContext.ts';
import { CINEMATIC_SCENE_KEY, OPENING_CINEMATIC_ID, PRELOAD_SCENE_KEY } from './BootScene.ts';
import { MAIN_MENU_SCENE_KEY, GAMEPLAY_SCENE_KEY } from './MainMenuScene.ts';

/** Re-export the world-completion cinematic id so callers import it from here. */
export { WORLD_COMPLETION_CINEMATIC_ID } from '../../core/index.ts';

/** Re-export the mentor cutscene id so callers import it from here (task 10.3). */
export { MENTOR_CUTSCENE_ID } from '../../core/index.ts';

/** Re-export the final-ending cinematic id so callers import it from here (task 10.5). */
export { FINAL_ENDING_CINEMATIC_ID } from '../../core/index.ts';

/** Re-export the shared key so importers can reference it from this module. */
export { CINEMATIC_SCENE_KEY } from './BootScene.ts';

/**
 * The launch contract for CinematicScene (what BootScene / a caller passes via
 * `scene.start(CINEMATIC_SCENE_KEY, data)`).
 */
export interface CinematicSceneData {
  /**
   * Which cinematic to play (e.g. OPENING_CINEMATIC_ID 'opening'). The specific
   * cinematic tasks (10.2–10.5) map an id to its panels/content; until then an
   * unknown id resolves to an empty sequence that completes immediately and
   * hands back, so BootScene's first-boot routing still resolves.
   */
  readonly cinematicId?: string;
  /**
   * Optional explicit panels to play. When provided these drive the player
   * directly (used by the specific cinematics and by tests); when omitted the
   * scene resolves panels for `cinematicId` (currently none exist, so empty).
   */
  readonly panels?: readonly CinematicPanel[];
  /**
   * Scene key to start once the cinematic finishes or is skipped (Req 21.18).
   * Defaults to PreloadScene so a first-boot cinematic rejoins the normal
   * Preload → Menu flow.
   */
  readonly nextSceneKey?: string;
  /**
   * Optional hand-off callback invoked on completion INSTEAD of starting
   * `nextSceneKey`. Lets a caller (or a specific cinematic) customize where the
   * sequence hands back to (e.g. a mentor cutscene returning into Gameplay).
   */
  readonly onComplete?: (scene: Phaser.Scene) => void;
  /**
   * The World the player JUST cleared (1..5). Used by the WORLD_COMPLETION
   * cinematic (Req 21.6) to caption the celebration. Ignored by other ids.
   */
  readonly clearedWorldId?: number;
  /**
   * The World this completion NEWLY UNLOCKED (1..5), whose silhouette dissolves
   * to reveal it on the menu return (Req 21.7). Omit when nothing was unlocked
   * (e.g. the final world). Used by the WORLD_COMPLETION cinematic.
   */
  readonly unlockedWorldId?: number;
  /**
   * The World (1..5) a MENTOR cutscene precedes (task 10.3, MENTOR_CUTSCENE_ID,
   * Req 21.2). Selects the world's mentor dialogue / name / symbol / background
   * and the evolution beat. On completion the mentor cutscene hands off INTO the
   * run (GameplayScene) for this world. Ignored by other cinematic ids.
   */
  readonly worldId?: number;
}

/** Depth bands so the skip control and caption sit above the panel art. */
const DEPTH = { panel: 0, caption: 10, skip: 20, hint: 20 } as const;

export class CinematicScene extends Phaser.Scene {
  /** The pure, config-driven, skippable panel player (all sequencing). */
  private player!: CinematicPlayer;

  /** The resolved launch contract (defaults applied). Named `launch` rather
   * than `data` to avoid shadowing Phaser.Scene's own `data` DataManager. */
  private launch!: {
    cinematicId: string;
    nextSceneKey: string;
    onComplete?: (scene: Phaser.Scene) => void;
    clearedWorldId?: number;
    unlockedWorldId?: number;
    worldId?: number;
  };

  /** Container for the current panel's visuals, rebuilt on each advance. */
  private panelLayer!: Phaser.GameObjects.Container;

  /** Guard so the hand-off runs exactly once. */
  private handedOff = false;

  constructor() {
    super({ key: CINEMATIC_SCENE_KEY });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Capture the launch contract before `create` runs. */
  init(data?: CinematicSceneData): void {
    this.handedOff = false;
    const cinematicId = data?.cinematicId ?? '';
    // Default hand-off per cinematic: WORLD_COMPLETION returns to the MENU (Req
    // 21.6); a MENTOR cutscene precedes a world's run, so it hands INTO Gameplay
    // (Req 21.2); every other cinematic defaults to the Preload → Menu flow.
    let defaultNext: string;
    if (cinematicId === WORLD_COMPLETION_CINEMATIC_ID) {
      defaultNext = MAIN_MENU_SCENE_KEY;
    } else if (cinematicId === MENTOR_CUTSCENE_ID) {
      defaultNext = GAMEPLAY_SCENE_KEY;
    } else if (cinematicId === FINAL_ENDING_CINEMATIC_ID) {
      // The final ending Jumps through the portal to loop the story: on
      // completion hand back to the MENU, where the new generation starts
      // (Req 21.8 — the loop). The actual generation ADVANCE on the save is the
      // finale's job (task 11.2); this cinematic only shows the loop and hands
      // back.
      defaultNext = MAIN_MENU_SCENE_KEY;
    } else {
      defaultNext = PRELOAD_SCENE_KEY;
    }
    this.launch = {
      cinematicId,
      nextSceneKey: data?.nextSceneKey ?? defaultNext,
      ...(data?.onComplete ? { onComplete: data.onComplete } : {}),
      ...(data?.clearedWorldId != null ? { clearedWorldId: data.clearedWorldId } : {}),
      ...(data?.unlockedWorldId != null ? { unlockedWorldId: data.unlockedWorldId } : {}),
      ...(data?.worldId != null ? { worldId: data.worldId } : {}),
    };

    // MENTOR SKIP-ON-RETRY (Req 21.4, 21.5, 39.4): when Kino is already evolved
    // for this world in the CURRENT generation (a same-generation retry via the
    // restart control, the menu Continue/Play control, or a Run_End retry), the
    // PURE `shouldPlayMentorCutscene` says SKIP — resolve to an EMPTY sequence
    // so the player is immediately complete and the scene hands straight INTO
    // the run with Kino already evolved. On a world's first entry this
    // generation it returns true and the cutscene plays normally.
    const panels = data?.panels ?? this.resolvePanelsForCinematic(this.launch.cinematicId);
    this.player = createCinematicPlayer(panels);
  }

  create(): void {
    const { width, height } = this.scale.gameSize;

    // Comic-book backdrop: a solid page behind the paneled layout.
    this.add
      .rectangle(width / 2, height / 2, width, height, 0x14181f, 1)
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.panel - 1);

    this.panelLayer = this.add.container(0, 0).setDepth(DEPTH.panel);

    // Advance on tap / click / any key (panel-by-panel, Req 21.21). The skip
    // control (Req 21.3, 21.18) is a distinct always-visible button.
    this.input.on('pointerdown', this.onAdvanceInput, this);
    this.input.keyboard?.on('keydown-SPACE', this.onAdvanceInput, this);
    this.input.keyboard?.on('keydown-ENTER', this.onAdvanceInput, this);
    this.input.keyboard?.on('keydown-ESC', this.onSkip, this);

    this.buildSkipControl(width);

    // If the sequence is already complete (empty panels), hand off immediately
    // after this frame so BootScene's routing resolves with no content.
    if (this.player.isComplete()) {
      this.finish();
      return;
    }

    this.renderCurrentPanel();
  }

  shutdown(): void {
    // Detach input listeners so a re-entered scene does not double-fire.
    this.input.off('pointerdown', this.onAdvanceInput, this);
    this.input.keyboard?.off('keydown-SPACE', this.onAdvanceInput, this);
    this.input.keyboard?.off('keydown-ENTER', this.onAdvanceInput, this);
    this.input.keyboard?.off('keydown-ESC', this.onSkip, this);
  }

  // -------------------------------------------------------------------------
  // Input → pure player
  // -------------------------------------------------------------------------

  /** Tap/click/key: advance one panel; hand off when the sequence completes. */
  private onAdvanceInput(): void {
    if (this.player.isComplete()) {
      this.finish();
      return;
    }
    const result = this.player.advance();
    if (result === 'done') {
      this.finish();
      return;
    }
    this.renderCurrentPanel();
  }

  /** Skip control / ESC: complete immediately from any panel (Req 21.3, 21.18). */
  private onSkip(): void {
    this.player.skip();
    this.finish();
  }

  // -------------------------------------------------------------------------
  // Rendering (comic-book panel)
  // -------------------------------------------------------------------------

  /**
   * Draw the current Comic_Panel in a comic-book style: a bordered panel frame,
   * the panel art (resolved placeholder-friendly through the Asset_Registry when
   * the panel names an `imageKey`), and the caption. Rebuilt each advance.
   */
  private renderCurrentPanel(): void {
    this.panelLayer.removeAll(true);

    const panel = this.player.current();
    if (!panel) return;

    const { width, height } = this.scale.gameSize;
    const cx = width / 2;
    const cy = height / 2;

    // MENTOR cutscene: render the animated World background BEHIND the dialogue
    // (Req 42.3) before the comic frame, so the speaker-swap layout + evolution
    // effect sit over it. Driven entirely by the pure panel `data`.
    this.renderMentorBackground(panel, width, height);

    // Paneled frame: an inset bordered box, the comic-book "panel".
    const frameW = width * 0.82;
    const frameH = height * 0.62;
    const frame = this.add
      .rectangle(cx, cy, frameW, frameH, 0x0b0f16, 1)
      .setStrokeStyle(6, 0xf5e6c8, 1)
      .setOrigin(0.5, 0.5);
    this.panelLayer.add(frame);

    // Panel art. Use the real texture when the Asset_Registry resolved one for
    // the panel's imageKey; otherwise leave the frame as a placeholder fill
    // (the specific cinematics supply their own art/placeholder factories).
    if (panel.imageKey && this.textures.exists(panel.imageKey)) {
      const img = this.add.image(cx, cy - frameH * 0.08, panel.imageKey);
      const maxW = frameW * 0.9;
      const maxH = frameH * 0.72;
      const scale = Math.min(maxW / img.width, maxH / img.height, 1);
      img.setScale(scale).setOrigin(0.5, 0.5);
      this.panelLayer.add(img);
    }

    // MENTOR cutscene overlays: the speaker-swap layout (active speaker + the
    // greyed corner speaker, Req 42.4-42.6) and the Evolution effect (Req
    // 29.8-29.11), both driven by the pure panel `data`.
    this.renderMentorOverlay(panel, cx, cy, frameW, frameH);

    // Caption (comic-book narration box) at the bottom of the panel.
    if (panel.caption) {
      const caption = this.add
        .text(cx, cy + frameH * 0.34, panel.caption, {
          fontFamily: 'monospace',
          fontSize: '24px',
          color: '#f5e6c8',
          align: 'center',
          wordWrap: { width: frameW * 0.86 },
        })
        .setOrigin(0.5, 0.5)
        .setDepth(DEPTH.caption);
      this.panelLayer.add(caption);
    }

    // Panel counter / advance hint so the player knows it is panel-by-panel.
    const hint = this.add
      .text(
        cx,
        cy + frameH * 0.46,
        `Panel ${this.player.index + 1} / ${this.player.length}  —  tap to continue`,
        {
          fontFamily: 'monospace',
          fontSize: '16px',
          color: '#8b93a1',
        },
      )
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.hint);
    this.panelLayer.add(hint);
  }

  // -------------------------------------------------------------------------
  // Mentor-cutscene rendering (task 10.3; Req 42.3-42.6, 29.8-29.11)
  // -------------------------------------------------------------------------

  /**
   * Render the animated World background BEHIND a mentor-cutscene panel (Req
   * 42.3). Uses the resolved texture when the pure panel's `worldBackgroundKey`
   * exists in the Asset_Registry; otherwise a placeholder tinted fill so the
   * cutscene remains functional with placeholder assets (Req 24.1, 24.10). A
   * gentle alpha pulse approximates the "animated" background. No-op for
   * non-mentor panels.
   */
  private renderMentorBackground(
    panel: CinematicPanel,
    width: number,
    height: number,
  ): void {
    if (panel.data?.['beat'] == null) return; // not a mentor panel
    const bgKey = panel.data['worldBackgroundKey'] as string | undefined;

    if (bgKey && this.textures.exists(bgKey)) {
      const bg = this.add
        .image(width / 2, height / 2, bgKey)
        .setOrigin(0.5, 0.5)
        .setDepth(DEPTH.panel - 1);
      const scale = Math.max(width / bg.width, height / bg.height);
      bg.setScale(scale);
      this.panelLayer.add(bg);
    } else {
      // Placeholder animated background (subtle pulse) when no art is wired.
      const placeholder = this.add
        .rectangle(width / 2, height / 2, width, height, 0x1b2733, 1)
        .setOrigin(0.5, 0.5)
        .setDepth(DEPTH.panel - 1);
      this.panelLayer.add(placeholder);
      this.tweens.add({
        targets: placeholder,
        alpha: { from: 0.75, to: 1 },
        duration: 1200,
        yoyo: true,
        repeat: -1,
      });
    }
  }

  /**
   * Render the mentor-cutscene overlay for the current panel (driven by the pure
   * panel `data`): on a DIALOGUE beat the speaker-swap layout — the ACTIVE
   * speaker sprite + chatbox, the OTHER speaker greyed in a background corner
   * (Req 42.4-42.6); on the EVOLUTION beat a glow/zap burst over Kino (Req
   * 29.8-29.11). No-op for non-mentor panels.
   */
  private renderMentorOverlay(
    panel: CinematicPanel,
    cx: number,
    cy: number,
    frameW: number,
    frameH: number,
  ): void {
    const beat = panel.data?.['beat'] as string | undefined;
    if (beat === 'dialogue') {
      const layout = panel.data?.['layout'] as
        | { activeSpeaker: string; greyedSpeaker: string; greyedImageKey?: string }
        | undefined;
      if (!layout) return;

      // The GREYED non-speaker in a background corner (upper-left), darkened.
      const cornerX = cx - frameW * 0.36;
      const cornerY = cy - frameH * 0.3;
      if (layout.greyedImageKey && this.textures.exists(layout.greyedImageKey)) {
        const greyed = this.add
          .image(cornerX, cornerY, layout.greyedImageKey)
          .setOrigin(0.5, 0.5)
          .setTint(0x555555)
          .setAlpha(0.6)
          .setScale(0.35)
          .setDepth(DEPTH.caption - 1);
        this.panelLayer.add(greyed);
      } else {
        const greyedBox = this.add
          .rectangle(cornerX, cornerY, frameW * 0.14, frameH * 0.2, 0x444444, 0.6)
          .setOrigin(0.5, 0.5)
          .setDepth(DEPTH.caption - 1);
        this.panelLayer.add(greyedBox);
      }
      // A small label marking who is currently speaking (active) for clarity.
      const speakerLabel = this.add
        .text(cx, cy - frameH * 0.4, `${layout.activeSpeaker} speaking`, {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#8b93a1',
        })
        .setOrigin(0.5, 0.5)
        .setDepth(DEPTH.caption);
      this.panelLayer.add(speakerLabel);
      return;
    }

    if (beat === 'evolution') {
      // Evolution effect: an energy-burst glow ring over Kino (Req 29.8-29.11).
      const glow = this.add
        .circle(cx, cy - frameH * 0.08, frameH * 0.22, 0x9ad8ff, 0.4)
        .setOrigin(0.5, 0.5)
        .setDepth(DEPTH.panel + 1);
      this.panelLayer.add(glow);
      this.tweens.add({
        targets: glow,
        scale: { from: 0.6, to: 1.3 },
        alpha: { from: 0.6, to: 0 },
        duration: 900,
        yoyo: false,
        repeat: -1,
      });
    }
  }

  /** The always-visible Skip control (Req 21.3, 21.18). */
  private buildSkipControl(width: number): void {
    const label = 'Skip';
    const x = width - 90;
    const y = 48;

    const text = this.add
      .text(x, y, label, {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#0b0f16',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.skip + 1);

    const bg = this.add
      .rectangle(x, y, text.width + 36, text.height + 18, 0xf5e6c8)
      .setOrigin(0.5, 0.5)
      .setDepth(DEPTH.skip)
      .setInteractive({ useHandCursor: true });

    bg.on('pointerover', () => bg.setFillStyle(0xffffff));
    bg.on('pointerout', () => bg.setFillStyle(0xf5e6c8));
    // Stop the pointerdown from ALSO triggering the advance handler.
    bg.on(
      'pointerdown',
      (_p: Phaser.Input.Pointer, _lx: number, _ly: number, ev: Phaser.Types.Input.EventData) => {
        ev?.stopPropagation?.();
        this.onSkip();
      },
    );
  }

  // -------------------------------------------------------------------------
  // Panel resolution (per-cinematic CONTENT seam)
  // -------------------------------------------------------------------------

  /**
   * Resolve the panels for a named cinematic.
   *
   * SEAM(10.2–10.5): the SPECIFIC cinematics (opening egg-descent, mentor
   * cutscene, world-completion, final/credits) supply their own panels/content
   * built on this framework. The OPENING cinematic (task 10.2,
   * OPENING_CINEMATIC_ID) is wired here: it builds its ordered Comic_Panel
   * sequence from the PURE `core.buildOpeningCinematicPanels`, fed the
   * config-driven gag text / world names / placeholder-friendly asset keys so
   * ALL sequencing stays in the pure player and this scene just renders them.
   * The FINAL ENDING cinematic (task 10.5, FINAL_ENDING_CINEMATIC_ID) is wired
   * here too: on jumping through the World-5 portal barrier (Req 8.15 → 21.8) it
   * builds its reunion → start-family → knock-next-egg → credits/bloopers
   * sequence from the PURE `core.buildEndingCinematicPanels`, fed the
   * config-driven generation/scheme (for the Junior→Senior + next-egg labels,
   * Req 21.19/21.20/32.3/32.4) and the `config.cinematics` credits/blooper slots
   * (Req 21.9), and hands back to the MENU on completion (the loop).
   *
   * Any other (not-yet-built) id resolves to an EMPTY sequence so the generic
   * scene completes immediately and hands back — all BootScene's first-boot
   * routing to 'Cinematic' needs before those content tasks land. Explicit
   * `CinematicSceneData.panels` still bypass this entirely.
   */
  private resolvePanelsForCinematic(cinematicId: string): readonly CinematicPanel[] {
    if (cinematicId === OPENING_CINEMATIC_ID) {
      return buildOpeningCinematicPanels(this.openingContentInput());
    }
    if (cinematicId === WORLD_COMPLETION_CINEMATIC_ID) {
      return buildWorldCompletionCinematicPanels(this.worldCompletionContentInput());
    }
    if (cinematicId === MENTOR_CUTSCENE_ID) {
      // SKIP-ON-RETRY (Req 21.4/21.5/39.4): an already-evolved world this
      // generation resolves to EMPTY panels so the player completes immediately
      // and hands straight into the run with Kino already evolved. The decision
      // is the PURE `shouldPlayMentorCutscene` fed the engine's per-generation
      // evolved-world run-state bit for this world.
      const world = this.launch.worldId ?? 1;
      const alreadyEvolved = isWorldEvolvedThisGeneration(this, world);
      if (!shouldPlayMentorCutscene(world, alreadyEvolved)) {
        return [];
      }
      return buildMentorCutscenePanels(this.mentorContentInput(world));
    }
    if (cinematicId === FINAL_ENDING_CINEMATIC_ID) {
      return buildEndingCinematicPanels(this.endingContentInput());
    }
    return [];
  }

  /**
   * Assemble the pure final-ending content input (task 10.5, Req 21.8, 21.9,
   * 21.19, 21.20, 32.3, 32.4) from the loaded Config_File + Save_Store: the
   * CURRENT generation (so the Junior→Senior same-iteration advance + next-egg
   * NEXT-iteration-Junior label compose correctly, Req 32.3/32.4), the base
   * character name + generational scheme, and the credits / blooper slots
   * (`config.cinematics`, Req 21.9). Reads the boot context when available;
   * falls back to the pure module's own sensible defaults in headless/test
   * contexts where BootScene did not run, so the scene never throws here.
   */
  private endingContentInput(): EndingCinematicContentInput {
    let config: ConfigFileData | undefined;
    let save: ReturnType<typeof getBootContext>['save'] | undefined;
    try {
      const ctx = getBootContext(this);
      config = ctx.config;
      save = ctx.save;
    } catch {
      config = undefined;
      save = undefined;
    }

    return {
      ...(save ? { generation: save.generation } : {}),
      ...(config
        ? {
            baseName: config.names.baseCharacterName,
            scheme: config.names.generationalScheme,
            creditsSlots: config.cinematics.creditsSlots,
            blooperSlots: config.cinematics.blooperSlots,
          }
        : {}),
    };
  }

  /**
   * Assemble the pure mentor-cutscene content input (task 10.3, Req 21.2,
   * 29.1-29.12, 42.1-42.6) for `world` from the loaded Config_File: the world's
   * dialogue lines, mentor name / symbol / image key, world background key, and
   * the evolution style. Reads the boot context when available; falls back to a
   * minimal world-only input in headless/test contexts where BootScene did not
   * run, so the scene never throws here.
   */
  private mentorContentInput(world: number): MentorCutsceneContentInput {
    let config: ConfigFileData | undefined;
    try {
      config = getBootContext(this).config;
    } catch {
      config = undefined;
    }

    const key = `world${Math.trunc(world)}` as keyof ConfigFileData['names']['mentors'];
    const starterKino = config?.starterAssets.kinoSprite;

    return {
      world: Math.trunc(world),
      ...(config
        ? {
            dialogue: config.mentorDialogue[key],
            mentorName: config.names.mentors[key],
            mentorSymbol: config.mentorSymbols[key],
            mentorImageKey: config.mentorImages[key],
            ...(starterKino ? { kinoImageKey: starterKino } : {}),
            worldBackgroundKey: config.worldBackgrounds[key],
            evolutionStyle: config.evolutionStyle,
          }
        : {}),
    };
  }

  /**
   * Assemble the pure world-completion content input (task 10.4, Req 21.6-21.7)
   * from the launch data + the loaded Config_File world names. The cleared /
   * newly-unlocked world ids ride in on `CinematicSceneData`; the celebratory
   * captions use the config world names when available. The silhouette DISSOLVE
   * itself is driven by the pure reveal state (core.computeSilhouetteReveal) the
   * menu consumes on rebuild; this seam only supplies the panels.
   */
  private worldCompletionContentInput(): WorldCompletionContentInput {
    let config: ConfigFileData | undefined;
    try {
      config = getBootContext(this).config;
    } catch {
      config = undefined;
    }

    const worlds = config?.names.worlds;
    return {
      // Fall back to World 1 if a caller forgot to pass the cleared world.
      clearedWorldId: this.launch.clearedWorldId ?? 1,
      ...(this.launch.unlockedWorldId != null
        ? { unlockedWorldId: this.launch.unlockedWorldId }
        : {}),
      ...(worlds
        ? {
            worldNames: {
              world1: worlds.world1,
              world2: worlds.world2,
              world3: worlds.world3,
              world4: worlds.world4,
              world5: worlds.world5,
            },
          }
        : {}),
    };
  }

  /**
   * Assemble the pure opening-cinematic content input from the loaded
   * Config_File (Req 21.12 gag text + world names for the band captions). Reads
   * the boot context when available; falls back to a minimal gag-only input in
   * headless/test contexts where BootScene did not run, so the scene never
   * throws here.
   */
  private openingContentInput(): OpeningCinematicContentInput {
    let config: ConfigFileData | undefined;
    try {
      config = getBootContext(this).config;
    } catch {
      config = undefined;
    }

    const permissionGag = config?.labels.permissionGag ?? 'aws:button:not-allowed';
    const worlds = config?.names.worlds;
    return {
      permissionGag,
      ...(worlds
        ? {
            worldNames: {
              world1: worlds.world1,
              world2: worlds.world2,
              world3: worlds.world3,
              world4: worlds.world4,
              world5: worlds.world5,
            },
          }
        : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Hand-off
  // -------------------------------------------------------------------------

  /**
   * Run the completion hand-off exactly once (Req 21.18): prefer the explicit
   * `onComplete` callback, else start `nextSceneKey` if registered, else log a
   * clear seam (headless/dev contexts where the next scene is not wired).
   */
  private finish(): void {
    if (this.handedOff) return;
    this.handedOff = true;

    // A MENTOR cutscene ending (played OR skipped) means Kino is evolved for
    // this world for the remainder of the generation (Req 21.2): record it on
    // the engine's per-generation run state so a same-generation retry SKIPS the
    // cutscene next time (Req 21.4/39.4). Not persisted (Req 22.3/22.7).
    const isMentor = this.launch.cinematicId === MENTOR_CUTSCENE_ID;
    if (isMentor) {
      markWorldEvolvedThisGeneration(this, this.launch.worldId ?? 1);
    }

    if (this.launch.onComplete) {
      this.launch.onComplete(this);
      return;
    }

    const next = this.launch.nextSceneKey;
    if (this.scene.get(next)) {
      // The mentor cutscene precedes a world's run, so it hands INTO Gameplay
      // with the world it introduced (Req 21.2).
      if (isMentor) {
        this.scene.start(next, { world: this.launch.worldId ?? 1 });
      } else {
        this.scene.start(next);
      }
      return;
    }
    console.info(
      `[KINO][Cinematic] Sequence complete; '${next}' scene not registered. Nothing to hand off to.`,
    );
  }
}



// Feature: kino-game
//
// RunEndScene — the Run_End_Screen shown when a run ends by collision (task
// 4.7; design: "RunEndScene", "Run_End_Screen (28.4, 39)"). GameplayScene hands
// this scene a RunEndData snapshot of the run (final score, world, mode,
// obstacles cleared, run time); this scene renders those stats plus the
// relevant High_Score and offers Retry (restart the SAME world/mode) and Menu
// (return to the main menu).
//
// SCOPE / TASK BOUNDARY (4.7): this stands up the minimal Run_End_Screen for the
// vertical slice — the four run stats (Req 39.1), a Retry control that restarts
// the same world/mode (Req 39.2), and a Menu control that returns to the main
// menu (Req 39.3, 7.7). It intentionally leaves SEAMS for later work:
//
//   - Task 7.6 (high-score persistence): this scene only DISPLAYS the relevant
//     stored High_Score (default 0 if absent) and, as a convenience, updates the
//     IN-MEMORY save when the final score beats it so a subsequent screen reads a
//     fresh value. It does NOT write localStorage — the authoritative persistence
//     (and the this-gen vs past-gen history, Req 28) is task 7.6. See
//     `// SEAM(7.6)`.
//   - Task 21.4 (mentor-cutscene skip on Retry, Req 39.4): Retry here restarts
//     Gameplay directly. The evolved-Kino cutscene-skip branch lands with the
//     cinematic/mentor system. See `// SEAM(21.4)`.
//
// ENGINE layer, so importing Phaser is allowed (src/README.md). The pure bits
// (which High_Score map to read, and how to format a run time) live in the
// exported Phaser-free helpers below so they stay unit testable without a
// browser/canvas; the class is only Phaser wiring + drawing.

import Phaser from 'phaser';
import type { MovementMode } from '../../core/index.ts';
import { getBootContext, type KinoBootContext } from '../sharedContext.ts';
import { relevantHighScore, formatRunTime } from '../runEndStats.ts';
import { GAMEPLAY_SCENE_KEY } from './GameplayScene.ts';
import type { RunEndData } from './GameplayScene.ts';

/** Scene key, shared with GameplayScene's `RUN_END_SCENE_KEY` + main.ts. */
export const RUN_END_SCENE_KEY = 'RunEnd';

/** Key the Menu control returns to (Req 39.3, 7.7). */
const MAIN_MENU_SCENE_KEY = 'MainMenu';

export class RunEndScene extends Phaser.Scene {
  /** The run stats captured in `init` (Req 39.1-39.3). */
  private runData!: RunEndData;

  /** Cached boot context (config/balance/assets/save). */
  private ctx!: KinoBootContext;

  constructor() {
    super({ key: RUN_END_SCENE_KEY });
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /** Capture the run-stats contract GameplayScene passed before `create` runs. */
  init(data: RunEndData): void {
    // Defensive defaults so a direct/dev launch without data still renders.
    this.runData = {
      finalScore: data?.finalScore ?? 0,
      world: data?.world ?? 1,
      mode: data?.mode ?? 'jumping',
      obstaclesCleared: data?.obstaclesCleared ?? 0,
      runTimeMs: data?.runTimeMs ?? 0,
    };
  }

  create(): void {
    this.ctx = getBootContext(this);
    const { width, height } = this.scale.gameSize;
    const cx = width / 2;

    // Plain dimmed backdrop so the end screen reads as an overlay-style panel
    // distinct from the run behind it. Phase 9 styles this fully.
    this.add.rectangle(cx, height / 2, width, height, 0x0b0f16, 0.92).setOrigin(0.5, 0.5);

    // The relevant stored High_Score for this mode + world (Req 39.1). Updating
    // the in-memory save when the run beats it is a convenience seam only.
    const highScore = this.resolveAndMaybeUpdateHighScore();

    this.buildTitle(cx, height * 0.16);
    this.buildStats(cx, height * 0.34, highScore);
    this.buildControls(cx, height * 0.72);
  }

  // -------------------------------------------------------------------------
  // High_Score resolution (display + in-memory convenience update)
  // -------------------------------------------------------------------------

  /**
   * Resolve the relevant High_Score for this run and, if the final score beats
   * it, update the IN-MEMORY save so a subsequent screen reads the fresh value.
   *
   * SEAM(7.6): this does NOT persist to localStorage. Task 7.6 owns the
   * authoritative high-score persistence (and the this-gen vs past-gen history,
   * Req 28). Returning the value actually shown keeps display + the in-memory
   * bump consistent.
   */
  private resolveAndMaybeUpdateHighScore(): number {
    const { highScores } = this.ctx.save;
    const stored = relevantHighScore(highScores, this.runData.mode, this.runData.world);

    if (this.runData.finalScore > stored) {
      // SEAM(7.6): in-memory only — mirror the new best into the save map the
      // display read from. The persisted write is task 7.6's responsibility.
      const map =
        this.runData.mode === ('endless' as MovementMode)
          ? highScores.endless
          : highScores.story;
      map[`world${this.runData.world}`] = this.runData.finalScore;
      return this.runData.finalScore;
    }
    return stored;
  }

  // -------------------------------------------------------------------------
  // Drawing
  // -------------------------------------------------------------------------

  /** Title header for the Run_End_Screen. */
  private buildTitle(cx: number, y: number): void {
    this.add
      .text(cx, y, 'Run Over', {
        fontFamily: 'monospace',
        fontSize: '44px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0.5);
  }

  /**
   * Render the four run stats (Req 39.1): final score, the relevant High_Score,
   * obstacles cleared, and the run time formatted as seconds. Laid out as a
   * simple centered column; Phase 9 replaces this with the full styled panel.
   */
  private buildStats(cx: number, top: number, highScore: number): void {
    const lines = [
      `Score: ${this.runData.finalScore}`,
      `High Score: ${highScore}`,
      `Obstacles Cleared: ${this.runData.obstaclesCleared}`,
      `Time: ${formatRunTime(this.runData.runTimeMs)}`,
    ];

    const lineHeight = 44;
    lines.forEach((line, i) => {
      this.add
        .text(cx, top + i * lineHeight, line, {
          fontFamily: 'monospace',
          fontSize: '28px',
          color: '#cfd8e3',
        })
        .setOrigin(0.5, 0.5);
    });
  }

  /** Retry + Menu controls (Req 39.2, 39.3). */
  private buildControls(cx: number, y: number): void {
    const gap = 72;
    this.addButton(cx, y, this.ctx.config.labels.retry, () => this.retry());
    this.addButton(cx, y + gap, this.ctx.config.labels.menu, () => this.returnToMenu());
  }

  /**
   * Add a simple interactive text button centered at (x, y). Minimal styling to
   * match the vertical slice; Phase 9 replaces these with the styled controls.
   */
  private addButton(x: number, y: number, label: string, onPress: () => void): void {
    const paddingX = 28;
    const paddingY = 14;

    const text = this.add
      .text(x, y, label, {
        fontFamily: 'monospace',
        fontSize: '28px',
        color: '#0b0f16',
      })
      .setOrigin(0.5, 0.5);

    const bg = this.add
      .rectangle(x, y, text.width + paddingX * 2, text.height + paddingY * 2, 0xf5e6c8)
      .setOrigin(0.5, 0.5)
      .setInteractive({ useHandCursor: true });

    // Keep the label above its background.
    text.setDepth(1);

    bg.on('pointerover', () => bg.setFillStyle(0xffffff));
    bg.on('pointerout', () => bg.setFillStyle(0xf5e6c8));
    bg.on('pointerdown', () => bg.setFillStyle(0xd9c9a8));
    bg.on('pointerup', () => {
      bg.setFillStyle(0xffffff);
      onPress();
    });
  }

  // -------------------------------------------------------------------------
  // Hand-off
  // -------------------------------------------------------------------------

  /**
   * Retry: start a NEW run of the SAME world and mode (Req 39.2) by launching
   * GameplayScene with the run's `{ world, mode }`.
   *
   * SEAM(21.4): Req 39.4 (skip the mentor cutscene when Kino is already evolved
   * for that World this Generation) lands with the cinematic/mentor system. For
   * the vertical slice Retry restarts Gameplay directly.
   */
  private retry(): void {
    const data = { world: this.runData.world, mode: this.runData.mode };

    if (this.scene.get(GAMEPLAY_SCENE_KEY)) {
      this.scene.start(GAMEPLAY_SCENE_KEY, data);
      return;
    }
    console.info(
      `[KINO][RunEnd] Retry pressed; would restart (${JSON.stringify(
        data,
      )}). '${GAMEPLAY_SCENE_KEY}' scene not registered.`,
    );
  }

  /** Menu: return the player to the main menu (Req 39.3, 7.7). */
  private returnToMenu(): void {
    if (this.scene.get(MAIN_MENU_SCENE_KEY)) {
      this.scene.start(MAIN_MENU_SCENE_KEY);
      return;
    }
    console.info(
      `[KINO][RunEnd] Menu pressed; '${MAIN_MENU_SCENE_KEY}' scene not registered.`,
    );
  }
}

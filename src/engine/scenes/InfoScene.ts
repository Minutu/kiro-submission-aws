// Feature: kino-game
//
// InfoScene — the run-statistics Info panel overlay (task 9.2 + task 9.6;
// design: "Info panel (31)"; Req 20.10, 20.23, 31.1, 31.2). Opened from the
// MainMenuScene Stats control in the TOP-LEFT corner (Req 20.23) and launched
// OVER the menu with Phaser's parallel-scene mechanism (`scene.launch`) so the
// menu stays beneath.
//
// RESPONSIBILITY: render the PURE `core.buildInfoPanelViewModel` view-model and
// NOTHING MORE. Every value shown — obstacles cleared, current score, active
// Perk effects as ±%, the equipped Skill, and the per-World this-gen vs
// best-past-gen High_Scores — is computed by the Phaser-free core (task 9.6);
// this scene only lays the plain view-model object out as text.
//
// On the MENU there is no active run, so the run counters (obstacles cleared,
// current score, active perks) are zero/empty and the panel reads as the
// save-backed high-score + equipped-skill summary; the same scene renders a
// live run's stats unchanged when later wired from a paused run. ENGINE layer,
// so importing Phaser is allowed (src/README.md).

import Phaser from 'phaser';
import { getBootContext, type KinoBootContext } from '../sharedContext.ts';
import {
  buildInfoPanelViewModel,
  composeGenerationName,
  type InfoPanelViewModel,
} from '../../core/index.ts';

/** Scene key, shared with MainMenuScene + main.ts. */
export const INFO_SCENE_KEY = 'Info';

/**
 * Launch data MainMenuScene passes when opening the panel. All optional so the
 * scene also runs standalone (menu case: no active run => zeros). A paused run
 * can later pass its live counters here without touching this scene.
 */
export interface InfoSceneData {
  /** Obstacles cleared in the current run (Req 31.1). Defaults to 0 on the menu. */
  obstaclesCleared?: number;
  /** The current run score (Req 31.1). Defaults to 0 on the menu. */
  currentScore?: number;
  /** Invoked when the overlay closes (menu can re-read anything if needed). */
  onClose?: () => void;
}

export class InfoScene extends Phaser.Scene {
  private ctx!: KinoBootContext;
  private launchData!: InfoSceneData;
  private onClose: () => void = () => {};

  constructor() {
    super({ key: INFO_SCENE_KEY });
  }

  init(data: InfoSceneData): void {
    this.launchData = data ?? {};
    this.onClose = typeof data?.onClose === 'function' ? data.onClose : () => {};
  }

  create(): void {
    this.ctx = getBootContext(this);
    const { width, height } = this.scale.gameSize;
    const cx = width / 2;

    // Dimmed backdrop — the menu stays visible beneath this overlay.
    this.add
      .rectangle(cx, height / 2, width, height, 0x0b0f16, 0.82)
      .setOrigin(0.5, 0.5)
      .setDepth(0);

    this.add
      .text(cx, height * 0.08, 'Run Info', {
        fontFamily: 'monospace',
        fontSize: '40px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(1);

    // Build the PURE view-model (task 9.6) and render it verbatim (Req 31.1-31.2).
    const vm = this.buildViewModel();
    this.renderViewModel(vm, cx, height);

    this.buildButton(cx, height * 0.92, 'Close', () => this.close());
  }

  /**
   * Assemble the Info-panel view-model from the pure core (task 9.6). On the
   * menu there is no active run, so run counters are zero and no perks are
   * active; the current generation key (the composed Generation_Name) is passed
   * so the current generation is not folded into its own "past" roll-up.
   */
  private buildViewModel(): InfoPanelViewModel {
    return buildInfoPanelViewModel({
      obstaclesCleared: this.launchData.obstaclesCleared ?? 0,
      currentScore: this.launchData.currentScore ?? 0,
      activePerks: [],
      equippedSkill: this.ctx.save.equippedSkill,
      save: this.ctx.save,
      currentGenerationKey: composeGenerationName(this.ctx.config, this.ctx.save),
    });
  }

  /** Lay the plain view-model out as read-only text (no logic — Req 31.1-31.2). */
  private renderViewModel(vm: InfoPanelViewModel, cx: number, height: number): void {
    const lines: string[] = [];
    lines.push(`Obstacles cleared: ${vm.obstaclesCleared}`);
    lines.push(`Current score: ${vm.currentScore}`);
    lines.push(
      `Equipped skill: ${vm.equippedSkill.name ?? 'None'}`,
    );
    if (vm.perkEffects.length > 0) {
      lines.push('Perk effects:');
      for (const perk of vm.perkEffects) {
        lines.push(`  ${perk.label}: ${perk.percent}`);
      }
    } else {
      lines.push('Perk effects: none');
    }
    lines.push('');
    lines.push('High scores (this gen / best past):');
    for (const row of vm.worldHighScores) {
      lines.push(
        `  World ${row.world}: ${row.currentGeneration} / ${row.bestPastGeneration}`,
      );
    }

    this.add
      .text(cx, height * 0.18, lines.join('\n'), {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#cfd8e3',
        align: 'left',
        lineSpacing: 6,
      })
      .setOrigin(0.5, 0)
      .setDepth(1);
  }

  private close(): void {
    this.onClose();
    this.scene.stop(INFO_SCENE_KEY);
  }

  /** Build a simple interactive text button centered at (x, y). */
  private buildButton(x: number, y: number, label: string, onPress: () => void): void {
    const paddingX = 18;
    const paddingY = 10;
    const text = this.add
      .text(x, y, label, {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#0b0f16',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(2);
    const bg = this.add
      .rectangle(x, y, text.width + paddingX * 2, text.height + paddingY * 2, 0xf5e6c8)
      .setOrigin(0.5, 0.5)
      .setDepth(1)
      .setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => bg.setFillStyle(0xffffff));
    bg.on('pointerout', () => bg.setFillStyle(0xf5e6c8));
    bg.on('pointerup', () => {
      bg.setFillStyle(0xffffff);
      onPress();
    });
    bg.once('destroy', () => text.destroy());
  }
}

// Feature: kino-game
//
// SettingsScene — the Settings_Screen overlay (task 9.7; design: Scene table
// "SettingsScene (overlay) | Volume, rebinding, reset-save confirm | 20.48-
// 20.51, 25.7", "Control rebinding failures (Req 1.7, 1.9)"). Opened from the
// MainMenuScene Settings control (Req 20.24, 20.48) and launched OVER the menu
// with Phaser's parallel-scene mechanism (`scene.launch`) so the menu stays
// beneath.
//
// RESPONSIBILITY: present a volume control, control rebinding, and a reset-save
// option (Req 20.48) — and NOTHING MORE. Every DECISION comes from the PURE
// `src/core/settingsScreen.ts` module; this scene is a thin shell that:
//   - renders a volume slider and feeds changes to `setVolume` / `setMuted`,
//     persisting each change (Req 20.49, 25.7, 25.8),
//   - captures the next key/mouse for a rebind, runs the pure `rebind` conflict
//     check, shows the NAMING conflict message on rejection (Req 1.7), and on an
//     accepted rebind persists through `applyRebindWithPersist` — which ROLLS
//     BACK to the previous binding if the persist fails (Req 1.8-1.9),
//   - gates the reset-save option behind a CONFIRMATION (Req 20.50) and only on
//     confirm calls `resetToFirstLaunch` + persists the First_Launch_State (Req
//     20.51).
//
// The authoritative Save_Store it mutates is the one BootScene stashed on the
// registry; persistence goes through the core SaveStore wrapper bound to
// `window.localStorage`. ENGINE layer, so importing Phaser is allowed.

import Phaser from 'phaser';
import { getBootContext, SHARED_CONTEXT_KEYS, type KinoBootContext } from '../sharedContext.ts';
import {
  createSaveStore,
  setVolume,
  setMuted,
  rebind,
  applyRebindWithPersist,
  resetToFirstLaunch,
  REBIND_ACTION_LABELS,
  type SaveState,
  type SaveStore,
  type RebindAction,
} from '../../core/index.ts';

/** Scene key, shared with MainMenuScene + main.ts. */
export const SETTINGS_SCENE_KEY = 'Settings';

/** Minimal literal labels for the overlay (kept local; not part of the config schema). */
const LABELS = {
  title: 'Settings',
  close: 'Close',
  volume: 'Volume',
  mute: 'Mute',
  unmute: 'Unmute',
  rebindPrimary: 'Rebind Primary',
  rebindSkill: 'Rebind Skill',
  listening: 'Press a key or mouse button...',
  resetSave: 'Reset Save',
  resetConfirm: 'Erase all progress?',
  resetConfirmYes: 'Yes, reset',
  resetConfirmNo: 'Cancel',
  resetDone: 'Save reset to a fresh start.',
} as const;

/**
 * Launch data MainMenuScene passes when opening the overlay. `onClose` lets the
 * menu refresh anything that depends on the (possibly changed/reset) save after
 * the overlay dismisses; optional so the scene can also run standalone in tests.
 */
export interface SettingsSceneData {
  /** Invoked when the overlay closes (menu can re-read the save). */
  onClose?: (save: SaveState) => void;
}

export class SettingsScene extends Phaser.Scene {
  private ctx!: KinoBootContext;
  private store!: SaveStore;

  /** Working copy of the authoritative save; every mutation flows through the pure core. */
  private save!: SaveState;

  private onClose: (save: SaveState) => void = () => {};

  /** Status line used for conflict / rollback / reset messages (Req 1.7, 1.9). */
  private statusText!: Phaser.GameObjects.Text;

  /** Live read-outs so rebinds/volume reflect immediately. */
  private volumeValueText!: Phaser.GameObjects.Text;
  private primaryValueText!: Phaser.GameObjects.Text;
  private skillValueText!: Phaser.GameObjects.Text;
  private muteText!: Phaser.GameObjects.Text;

  /** True while capturing the next control for a rebind (one-shot listener armed). */
  private listeningFor: RebindAction | null = null;

  constructor() {
    super({ key: SETTINGS_SCENE_KEY });
  }

  init(data: SettingsSceneData): void {
    this.onClose = typeof data?.onClose === 'function' ? data.onClose : () => {};
  }

  create(): void {
    this.ctx = getBootContext(this);
    this.store = createSaveStore(this.ctx.config);
    // Start from the authoritative registry save (clone defensively).
    this.save = this.cloneSave(this.ctx.save);

    const { width, height } = this.scale.gameSize;
    const cx = width / 2;

    // Dimmed backdrop — the menu stays visible beneath this overlay.
    this.add
      .rectangle(cx, height / 2, width, height, 0x0b0f16, 0.82)
      .setOrigin(0.5, 0.5)
      .setDepth(0);

    this.add
      .text(cx, height * 0.08, LABELS.title, {
        fontFamily: 'monospace',
        fontSize: '40px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(1);

    this.buildVolumeControl(cx, height * 0.24);
    this.buildMuteControl(cx, height * 0.34);
    this.buildRebindControls(cx, height * 0.46);
    this.buildResetControl(cx, height * 0.68);

    // Status line (conflict / rollback / reset feedback).
    this.statusText = this.add
      .text(cx, height * 0.82, '', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#ffd24a',
        align: 'center',
        wordWrap: { width: width * 0.8 },
      })
      .setOrigin(0.5, 0.5)
      .setDepth(1);

    this.buildButton(cx, height * 0.92, LABELS.close, () => this.close());
  }

  // -- volume (Req 20.49, 25.7, 25.8) -------------------------------------

  /**
   * Render a simple volume control: decrement / increment steps around a live
   * read-out. Each change runs the pure `setVolume` (clamped to [0,1]) and
   * persists (Req 25.8).
   */
  private buildVolumeControl(cx: number, y: number): void {
    this.add
      .text(cx, y - 26, LABELS.volume, {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#cfd8e3',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(1);

    this.volumeValueText = this.add
      .text(cx, y, this.formatVolume(), {
        fontFamily: 'monospace',
        fontSize: '24px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(1);

    this.buildButton(cx - 120, y, '-', () => this.nudgeVolume(-0.1), 36);
    this.buildButton(cx + 120, y, '+', () => this.nudgeVolume(+0.1), 36);
  }

  /** Apply a volume delta through the pure core, persist, and refresh the read-out. */
  private nudgeVolume(delta: number): void {
    const next = setVolume(this.save, this.save.settings.volume + delta);
    this.commit(next);
    this.volumeValueText.setText(this.formatVolume());
  }

  private formatVolume(): string {
    return `${Math.round(this.save.settings.volume * 100)}%`;
  }

  // -- mute (Req 25.7) -----------------------------------------------------

  private buildMuteControl(cx: number, y: number): void {
    this.muteText = this.add
      .text(cx, y, this.save.settings.muted ? LABELS.unmute : LABELS.mute, {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#0b0f16',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(2);

    const bg = this.add
      .rectangle(cx, y, 200, 44, 0xf5e6c8)
      .setOrigin(0.5, 0.5)
      .setDepth(1)
      .setInteractive({ useHandCursor: true });
    bg.on('pointerup', () => this.toggleMute());
  }

  private toggleMute(): void {
    const next = setMuted(this.save, !this.save.settings.muted);
    this.commit(next);
    this.muteText.setText(this.save.settings.muted ? LABELS.unmute : LABELS.mute);
  }

  // -- rebinding (Req 1.6-1.9) --------------------------------------------

  private buildRebindControls(cx: number, y: number): void {
    this.add
      .text(cx, y - 30, 'Controls', {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#cfd8e3',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(1);

    this.primaryValueText = this.add
      .text(cx - 140, y, this.formatBindings('primary'), {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(1);
    this.buildButton(cx + 100, y, LABELS.rebindPrimary, () => this.beginRebind('primary'), 18);

    this.skillValueText = this.add
      .text(cx - 140, y + 56, this.formatBindings('skill'), {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(1);
    this.buildButton(cx + 100, y + 56, LABELS.rebindSkill, () => this.beginRebind('skill'), 18);
  }

  private formatBindings(action: RebindAction): string {
    return `${REBIND_ACTION_LABELS[action]}: ${this.save.controlBindings[action].join(', ')}`;
  }

  /**
   * Arm a one-shot capture of the next key or mouse button and rebind the
   * PRIMARY slot (index 0 — the keyboard binding) of `action`. The captured
   * token is routed through the pure `rebind` conflict check; a rejection shows
   * the naming message (Req 1.7) and an accepted rebind persists with rollback
   * on failure (Req 1.8-1.9).
   */
  private beginRebind(action: RebindAction): void {
    if (this.listeningFor) return; // already capturing
    this.listeningFor = action;
    this.setStatus(LABELS.listening);

    const keyboard = this.input.keyboard;
    const onKey = (event: KeyboardEvent): void => {
      cleanup();
      this.applyCapturedBinding(action, this.keyTokenFor(event));
    };
    const onPointer = (pointer: Phaser.Input.Pointer): void => {
      cleanup();
      this.applyCapturedBinding(action, this.mouseTokenFor(pointer));
    };
    const cleanup = (): void => {
      this.listeningFor = null;
      keyboard?.off('keydown', onKey);
      this.input.off('pointerdown', onPointer);
    };

    keyboard?.once('keydown', onKey);
    this.input.once('pointerdown', onPointer);
  }

  /** Map a DOM keyboard event to a canonical binding token (Phaser KeyCodes name). */
  private keyTokenFor(event: KeyboardEvent): string {
    // `event.code` like "KeyQ" / "Space" / "ArrowUp"; reduce to the bare key name.
    const code = event.code || event.key || '';
    if (code === 'Space') return 'SPACE';
    const letter = /^Key([A-Z])$/.exec(code);
    if (letter && letter[1]) return letter[1];
    const digit = /^Digit([0-9])$/.exec(code);
    if (digit && digit[1]) return digit[1];
    return code.toUpperCase();
  }

  /** Map a Phaser pointer to a canonical `MOUSE_*` token. */
  private mouseTokenFor(pointer: Phaser.Input.Pointer): string {
    if (pointer.rightButtonDown()) return 'MOUSE_RIGHT';
    if (pointer.middleButtonDown()) return 'MOUSE_MIDDLE';
    return 'MOUSE_LEFT';
  }

  /**
   * Route a captured control through the pure rebind + persist contract. On a
   * conflict/invalid rejection, show the message and apply NOTHING (Req 1.7). On
   * an accepted rebind, attempt persistence; if it fails, the pure helper rolls
   * back to the previous binding (Req 1.9) and we report it.
   */
  private applyCapturedBinding(action: RebindAction, token: string): void {
    const result = rebind(this.save, action, 0, token);
    if (!result.ok) {
      this.setStatus(result.message);
      return;
    }

    const outcome = applyRebindWithPersist(this.save, result, (s) => this.persist(s));
    this.save = outcome.save;
    this.ctx.save = outcome.save;
    this.game.registry.set(SHARED_CONTEXT_KEYS.save, outcome.save);

    this.primaryValueText.setText(this.formatBindings('primary'));
    this.skillValueText.setText(this.formatBindings('skill'));

    if (outcome.rolledBack) {
      this.setStatus('Could not save the new binding; kept the previous one.');
    } else {
      this.setStatus(`Rebound ${REBIND_ACTION_LABELS[action]} to "${token.trim().toUpperCase()}".`);
    }
  }

  // -- reset-save (Req 20.50-20.51) ---------------------------------------

  private buildResetControl(cx: number, y: number): void {
    this.buildButton(cx, y, LABELS.resetSave, () => this.confirmReset(cx, y));
  }

  /**
   * Gate the reset behind a confirmation (Req 20.50): only after the player
   * presses the confirm control do we call `resetToFirstLaunch` and persist the
   * First_Launch_State (Req 20.51). A Cancel control dismisses without resetting.
   */
  private confirmReset(cx: number, y: number): void {
    this.setStatus(LABELS.resetConfirm);
    const yes = this.buildButton(cx - 110, y + 54, LABELS.resetConfirmYes, () => {
      yes.destroy();
      no.destroy();
      this.doReset();
    }, 16);
    const no = this.buildButton(cx + 110, y + 54, LABELS.resetConfirmNo, () => {
      yes.destroy();
      no.destroy();
      this.setStatus('');
    }, 16);
  }

  /** Perform the confirmed reset: pure First_Launch_State, then persist (Req 20.51). */
  private doReset(): void {
    const fresh = resetToFirstLaunch(this.save, this.ctx.config);
    this.persist(fresh);
    this.save = fresh;
    this.ctx.save = fresh;
    this.game.registry.set(SHARED_CONTEXT_KEYS.save, fresh);

    this.volumeValueText.setText(this.formatVolume());
    this.muteText.setText(this.save.settings.muted ? LABELS.unmute : LABELS.mute);
    this.primaryValueText.setText(this.formatBindings('primary'));
    this.skillValueText.setText(this.formatBindings('skill'));
    this.setStatus(LABELS.resetDone);
  }

  // -- persistence + commit -----------------------------------------------

  /**
   * Persist a save through the core SaveStore bound to localStorage. Returns
   * whether the write succeeded so `applyRebindWithPersist` can roll back (Req
   * 1.9). Guarded for headless contexts where `window` is absent.
   */
  private persist(save: SaveState): boolean {
    const storage = typeof window !== 'undefined' ? window.localStorage : undefined;
    if (!storage) return false;
    return this.store.save(storage, save);
  }

  /** Apply a settings change (volume/mute) + persist + sync the shared context. */
  private commit(next: SaveState): void {
    this.persist(next);
    this.save = next;
    this.ctx.save = next;
    this.game.registry.set(SHARED_CONTEXT_KEYS.save, next);
  }

  private setStatus(message: string): void {
    this.statusText?.setText(message);
  }

  private close(): void {
    this.onClose(this.save);
    this.scene.stop(SETTINGS_SCENE_KEY);
  }

  // -- helpers ------------------------------------------------------------

  private cloneSave(save: SaveState): SaveState {
    return {
      ...save,
      settings: { ...save.settings },
      controlBindings: {
        primary: [...save.controlBindings.primary],
        skill: [...save.controlBindings.skill],
      },
    };
  }

  /** Build a simple interactive button; returns the background so callers can destroy it. */
  private buildButton(
    x: number,
    y: number,
    label: string,
    onPress: () => void,
    fontSize = 22,
  ): Phaser.GameObjects.Rectangle {
    const paddingX = 18;
    const paddingY = 10;
    const text = this.add
      .text(x, y, label, {
        fontFamily: 'monospace',
        fontSize: `${fontSize}px`,
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
    // Keep the label clickable with the bg and destroyed alongside it.
    bg.once('destroy', () => text.destroy());
    return bg;
  }
}

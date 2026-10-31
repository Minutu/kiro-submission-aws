// Feature: kino-game
//
// InventoryScene — the Inventory_Panel overlay (task 9.4; design: "UI / Menu >
// Inventory_Panel (12.8–12.14, 19, 20.42–20.47, 43)"; Req 12.7-12.14, 19.7,
// 20.8, 20.9, 20.17, 20.42-20.47, 36.6). Opened from the MainMenuScene Cosmetics
// control (left of Kino) or Skills control (right of Kino) (Req 20.26) and
// launched OVER the menu with Phaser's parallel-scene mechanism (`scene.launch`)
// on the correct tab so the menu stays beneath — a dimmed backdrop FADES the
// other menu elements so customization/equip happens in place (Req 20.8, 20.17,
// 20.42).
//
// RESPONSIBILITY: a THIN shell over the PURE `core.inventoryPanel` view-model +
// selection algebra. This scene renders what the pure core decides and makes NO
// selection decisions itself:
//   - Kino fixed in the UPPER area (Req 20.8, 20.43), drawn through the
//     Asset_Registry so placeholders work exactly like MainMenuScene's Kino.
//   - The equipped item PREVIEWED above Kino with a highlighted outline (Req
//     20.9, 20.17, 20.43) — the `previewId` from the view-model.
//   - The LOWER HALF as a tabbed Cosmetics/Skills view with the active tab
//     visually indicated as selected (Req 20.42-20.44).
//   - A SCROLLABLE grid of items (Req 20.45); each cell colored by its rarity
//     (Req 12.12, 12.14, 20.47, 36.6); locked skills + unowned cosmetics are
//     greyed and ignore presses (Req 12.11, 20.46).
//   - Selecting an OWNED item calls the pure `equipItem` (single-select, Req
//     12.15, 19.7), PERSISTS through the Save_Store (the same SaveStore path
//     SettingsScene uses), refreshes the grid + preview (Req 12.12, 20.47), and
//     keeps the shared-context save in sync for the menu beneath.
//
// ENGINE layer, so importing Phaser is allowed (src/README.md).

import Phaser from 'phaser';
import { getBootContext, SHARED_CONTEXT_KEYS, type KinoBootContext } from '../sharedContext.ts';
import {
  buildInventoryViewModel,
  equipItem,
  createSaveStore,
  resolveEquipJiggleConfig,
  jelloBob,
  type InventoryTab,
  type InventoryViewModel,
  type InventoryItem,
  type SaveState,
  type SaveStore,
  type EquipJiggleConfig,
} from '../../core/index.ts';

/** Scene key, shared with MainMenuScene + main.ts. */
export const INVENTORY_SCENE_KEY = 'Inventory';

/** The asset key for the player's Kino preview (matches MainMenuScene, Req 24.7, 20.7). */
const KINO_SPRITE_KEY = 'starter:kinoSprite';

/** Launch data MainMenuScene passes when opening the panel. */
export interface InventorySceneData {
  /** Which tab to open on (Req 20.42-20.44). Defaults to 'cosmetics'. */
  tab?: InventoryTab;
  /** Invoked when the overlay closes (menu can re-read the possibly-changed save). */
  onClose?: (save: SaveState) => void;
}

/** Minimal literal labels for the overlay (kept local; not part of the config schema). */
const LABELS = {
  close: 'Close',
  cosmeticsTab: 'Cosmetics',
  skillsTab: 'Skills',
  none: 'None',
  empty: 'Nothing here yet',
} as const;

export class InventoryScene extends Phaser.Scene {
  private ctx!: KinoBootContext;
  private store!: SaveStore;

  /** Working copy of the authoritative save; every mutation flows through the pure core. */
  private save!: SaveState;

  /** The active tab (Req 20.42-20.44). */
  private tab: InventoryTab = 'cosmetics';

  private onClose: (save: SaveState) => void = () => {};

  // Layout anchors resolved in create().
  private cx = 0;
  private kinoY = 0;
  private gridTop = 0;
  private gridBottom = 0;

  /** Container holding the scrollable grid cells so they scroll as a unit (Req 20.45). */
  private gridContainer!: Phaser.GameObjects.Container;
  /** Highlighted outline drawn around the previewed equipped item (Req 20.9, 20.17). */
  private previewHighlight!: Phaser.GameObjects.Rectangle;
  /** The preview swatch above Kino reflecting the equipped item's rarity color. */
  private previewSwatch!: Phaser.GameObjects.Rectangle;
  private previewLabel!: Phaser.GameObjects.Text;

  /** Tab button handles so the active one can be indicated as selected (Req 20.44). */
  private cosmeticsTabBg!: Phaser.GameObjects.Rectangle;
  private skillsTabBg!: Phaser.GameObjects.Rectangle;
  private cosmeticsTabText!: Phaser.GameObjects.Text;
  private skillsTabText!: Phaser.GameObjects.Text;

  /** Current vertical scroll offset of the grid (clamped to content height). */
  private scrollOffset = 0;
  private maxScrollOffset = 0;

  /**
   * Resolved menu equip jiggle config (asset key + brief timing/shape params),
   * from the pure `menu-equip-jiggle` resolution with a placeholder fallback
   * (Req 43.4-43.5). The actual "jello bob" curve is the pure `jelloBob(t)`.
   */
  private jiggleConfig!: EquipJiggleConfig;
  /** The anchor the preview + its highlight rest at, so the jiggle returns to rest. */
  private previewRestY = 0;
  /** The currently-running equip-jiggle tween, if any (so re-equip restarts cleanly). */
  private jiggleTween: Phaser.Tweens.Tween | undefined = undefined;

  constructor() {
    super({ key: INVENTORY_SCENE_KEY });
  }

  init(data: InventorySceneData): void {
    this.tab = data?.tab === 'skills' ? 'skills' : 'cosmetics';
    this.onClose = typeof data?.onClose === 'function' ? data.onClose : () => {};
  }

  create(): void {
    this.ctx = getBootContext(this);
    this.store = createSaveStore(this.ctx.config);
    this.save = this.cloneSave(this.ctx.save);

    const { width, height } = this.scale.gameSize;
    this.cx = width / 2;

    // Dimmed backdrop FADES the other menu elements so equip/customize happens
    // in place over the menu (Req 20.8, 20.17, 20.42) — the menu stays beneath.
    this.add
      .rectangle(this.cx, height / 2, width, height, 0x0b0f16, 0.9)
      .setOrigin(0.5, 0.5)
      .setDepth(0);

    // --- Kino fixed in the UPPER area (Req 20.8, 20.43) ------------------
    this.kinoY = height * 0.26;
    this.drawKino(this.cx, this.kinoY);

    // --- Equipped-item preview above Kino, with a highlight (Req 20.9, 20.17)
    this.previewRestY = height * 0.1;
    this.buildPreview(this.cx, this.previewRestY);

    // Resolve the menu equip jiggle (asset key + brief timing) once, with the
    // placeholder fallback baked in (Req 43.4-43.5). The jiggle itself plays on
    // equip via the pure `jelloBob` curve — menu-only, distinct from gameplay
    // Animation_Frames (Req 43.3).
    this.jiggleConfig = resolveEquipJiggleConfig(this.ctx.config);

    // --- Lower-half tabbed view (Req 20.44) ------------------------------
    this.gridTop = height * 0.52;
    this.gridBottom = height * 0.86;
    this.buildTabs(this.cx, height * 0.46);

    // Grid container + the clipped scroll input (Req 20.45).
    this.gridContainer = this.add.container(0, 0).setDepth(2);
    this.installGridScroll();

    // Close control.
    this.buildButton(this.cx, height * 0.94, LABELS.close, () => this.close());

    // First render for the launch tab.
    this.refresh();
  }

  // -- tabs ----------------------------------------------------------------

  /** Build the Cosmetics/Skills tab controls; the active tab is indicated below. */
  private buildTabs(cx: number, y: number): void {
    const half = 150;
    const build = (
      x: number,
      label: string,
      onPress: () => void,
    ): { bg: Phaser.GameObjects.Rectangle; text: Phaser.GameObjects.Text } => {
      const text = this.add
        .text(x, y, label, { fontFamily: 'monospace', fontSize: '24px', color: '#0b0f16' })
        .setOrigin(0.5, 0.5)
        .setDepth(6);
      const bg = this.add
        .rectangle(x, y, 220, 48, 0xf5e6c8)
        .setOrigin(0.5, 0.5)
        .setDepth(5)
        .setInteractive({ useHandCursor: true });
      bg.on('pointerup', onPress);
      return { bg, text };
    };

    const cosmetics = build(cx - half, LABELS.cosmeticsTab, () => this.switchTab('cosmetics'));
    const skills = build(cx + half, LABELS.skillsTab, () => this.switchTab('skills'));
    this.cosmeticsTabBg = cosmetics.bg;
    this.cosmeticsTabText = cosmetics.text;
    this.skillsTabBg = skills.bg;
    this.skillsTabText = skills.text;
  }

  /** Visually indicate the active tab as selected (Req 20.44). */
  private indicateActiveTab(): void {
    const activeFill = 0xffe08a;
    const inactiveFill = 0x8a8f99;
    const cosmeticsActive = this.tab === 'cosmetics';
    this.cosmeticsTabBg.setFillStyle(cosmeticsActive ? activeFill : inactiveFill);
    this.skillsTabBg.setFillStyle(cosmeticsActive ? inactiveFill : activeFill);
    this.cosmeticsTabText.setColor(cosmeticsActive ? '#11151c' : '#3a3f47');
    this.skillsTabText.setColor(cosmeticsActive ? '#3a3f47' : '#11151c');
  }

  private switchTab(tab: InventoryTab): void {
    if (this.tab === tab) return;
    this.tab = tab;
    this.scrollOffset = 0;
    this.refresh();
  }

  // -- preview -------------------------------------------------------------

  /** Build the equipped-item preview swatch + its highlighted outline (Req 20.9, 20.17). */
  private buildPreview(x: number, y: number): void {
    // Highlight outline sits behind the swatch; shown only when an item is equipped.
    this.previewHighlight = this.add
      .rectangle(x, y, 72, 72, 0x000000, 0)
      .setOrigin(0.5, 0.5)
      .setStrokeStyle(4, 0xffffff, 1)
      .setDepth(3)
      .setVisible(false);
    this.previewSwatch = this.add
      .rectangle(x, y, 56, 56, 0x8a8f99)
      .setOrigin(0.5, 0.5)
      .setDepth(4)
      .setVisible(false);
    this.previewLabel = this.add
      .text(x, y + 44, '', { fontFamily: 'monospace', fontSize: '16px', color: '#cfd8e3' })
      .setOrigin(0.5, 0.5)
      .setDepth(4);
  }

  /** Reflect the view-model's preview (equipped item of this type) above Kino. */
  private renderPreview(vm: InventoryViewModel): void {
    if (vm.previewId === null) {
      this.previewHighlight.setVisible(false);
      this.previewSwatch.setVisible(false);
      this.previewLabel.setText(LABELS.none);
      return;
    }
    const equipped = vm.items.find((it) => it.id === vm.previewId);
    const color = equipped ? colorToNumber(equipped.color) : 0xffffff;
    this.previewSwatch.setFillStyle(color).setVisible(true);
    this.previewHighlight.setVisible(true);
    this.previewLabel.setText(equipped ? equipped.label : vm.previewId);
    // Ensure the preview rests at its neutral transform on (re)render — any
    // interrupted jiggle is undone so the following jiggle starts from rest.
    this.previewSwatch.setScale(1, 1);
    this.previewHighlight.setScale(1, 1);
    this.previewSwatch.y = this.previewRestY;
    this.previewHighlight.y = this.previewRestY;
  }

  // -- grid ----------------------------------------------------------------

  /** Wire wheel + drag vertical scrolling over the grid region (Req 20.45). */
  private installGridScroll(): void {
    this.input.on('wheel', (_p: unknown, _o: unknown, _dx: number, dy: number) => {
      this.scrollGridBy(dy);
    });
    let dragging = false;
    let lastY = 0;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      // Only start a scroll drag when the press begins inside the grid region.
      if (p.y >= this.gridTop && p.y <= this.gridBottom) {
        dragging = true;
        lastY = p.y;
      }
    });
    this.input.on('pointerup', () => {
      dragging = false;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!dragging) return;
      this.scrollGridBy(-(p.y - lastY));
      lastY = p.y;
    });
  }

  private scrollGridBy(dy: number): void {
    if (this.maxScrollOffset <= 0) return;
    this.scrollOffset = Phaser.Math.Clamp(this.scrollOffset + dy, 0, this.maxScrollOffset);
    this.gridContainer.y = -this.scrollOffset;
  }

  /**
   * Rebuild the grid cells from the pure view-model for the active tab. Each
   * cell is colored by rarity (Req 12.14, 20.47, 36.6); owned items are
   * interactive and equip on press; greyed non-selectable items ignore presses
   * (Req 12.11, 20.46). The equipped cell carries a highlighted outline.
   */
  private renderGrid(vm: InventoryViewModel): void {
    this.gridContainer.removeAll(true);

    const cols = 4;
    const cell = 84;
    const gap = 16;
    const startX = this.cx - ((cols - 1) * (cell + gap)) / 2;
    const startY = this.gridTop + cell / 2;

    if (vm.items.length === 0) {
      const empty = this.add
        .text(this.cx, startY, LABELS.empty, {
          fontFamily: 'monospace',
          fontSize: '18px',
          color: '#8a8f99',
        })
        .setOrigin(0.5, 0.5);
      this.gridContainer.add(empty);
      this.maxScrollOffset = 0;
      this.gridContainer.y = 0;
      return;
    }

    vm.items.forEach((item, i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = startX + col * (cell + gap);
      const y = startY + row * (cell + gap);
      this.buildCell(item, x, y, cell);
    });

    // Content height drives the scroll range so every row can reach the top.
    const rows = Math.ceil(vm.items.length / cols);
    const contentHeight = rows * (cell + gap);
    const viewHeight = this.gridBottom - this.gridTop;
    this.maxScrollOffset = Math.max(0, contentHeight - viewHeight);
    this.scrollOffset = Phaser.Math.Clamp(this.scrollOffset, 0, this.maxScrollOffset);
    this.gridContainer.y = -this.scrollOffset;
  }

  /** Build one grid cell for an item, wiring equip-on-press only when selectable. */
  private buildCell(item: InventoryItem, x: number, y: number, size: number): void {
    const rarityColor = colorToNumber(item.color);

    // Greyed, non-selectable items (locked skills / unowned cosmetics) render
    // dimmed and ignore presses (Req 12.11, 20.46).
    const fill = item.selectable ? rarityColor : 0x3a3f47;
    const alpha = item.selectable ? 1 : 0.5;

    const swatch = this.add
      .rectangle(x, y, size, size, fill, alpha)
      .setOrigin(0.5, 0.5);
    // The equipped item carries a highlighted outline in the grid too.
    if (item.equipped) {
      swatch.setStrokeStyle(4, 0xffffff, 1);
    } else if (item.selectable) {
      swatch.setStrokeStyle(2, 0xffffff, 0.3);
    }
    this.gridContainer.add(swatch);

    const label = this.add
      .text(x, y + size / 2 - 4, item.label, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: item.selectable ? '#11151c' : '#6b7078',
        align: 'center',
        wordWrap: { width: size - 6 },
      })
      .setOrigin(0.5, 1);
    this.gridContainer.add(label);

    if (item.selectable) {
      swatch.setInteractive({ useHandCursor: true });
      swatch.on('pointerup', () => this.selectItem(item.id));
    }
  }

  // -- selection + persistence --------------------------------------------

  /**
   * Equip the selected OWNED item through the pure `equipItem` (single-select,
   * Req 12.15, 19.7), persist, sync the shared context, and refresh the grid +
   * preview (Req 12.12, 20.47). A non-selectable id is a pure no-op.
   */
  private selectItem(id: string): void {
    const next = equipItem(this.save, this.tab, id, this.ctx.config);
    this.commit(next);
    this.refresh();
    // Equip feedback: play the menu-only "jello bob" jiggle on the equipped-item
    // preview (Req 43.1-43.2). Distinct from the gameplay Animation_Frame cycles
    // (Req 43.3) — it drives the pure `jelloBob(t)` curve, not a frame cycle.
    this.playEquipJiggle();
  }

  /**
   * Play the brief menu equip jiggle on the equipped-item preview (Req 43.1-43.2).
   * An update-driven application of the PURE `jelloBob(t)` curve over the resolved
   * `durationMs`: the preview swatch + its highlight bob up and down like jello
   * and return exactly to rest at t=1 (the curve is neutral at t=0 and t=1, Req
   * 43.3). Non-blocking and restartable, so it never interferes with further
   * selection. Menu-only — it reuses NONE of the gameplay frame cycle.
   */
  private playEquipJiggle(): void {
    const targets = [this.previewSwatch, this.previewHighlight];
    // Nothing to jiggle (no item equipped / preview hidden) — skip.
    if (!this.previewSwatch.visible) return;

    // Restart cleanly if a previous jiggle is still running.
    this.jiggleTween?.remove();

    const baseHeight = this.previewSwatch.height;
    const { durationMs, bobs, amplitude } = this.jiggleConfig;

    const apply = (t: number): void => {
      const { scaleX, scaleY, offsetY } = jelloBob(t, { bobs, amplitude });
      for (const obj of targets) {
        obj.setScale(scaleX, scaleY);
        obj.y = this.previewRestY + offsetY * baseHeight;
      }
    };

    const counter = { t: 0 };
    this.jiggleTween = this.tweens.add({
      targets: counter,
      t: 1,
      duration: durationMs,
      ease: 'Linear',
      onUpdate: () => apply(counter.t),
      onComplete: () => {
        apply(1); // snap exactly to rest (Req 43.3)
        this.jiggleTween = undefined;
      },
      onStop: () => apply(1), // ensure rest even if interrupted
    });
  }

  /** Rebuild tab indication, grid, and preview for the current tab + save. */
  private refresh(): void {
    const vm = buildInventoryViewModel(this.save, this.ctx.config, this.tab, {
      labelFor: (itemId) => this.labelFor(itemId),
    });
    this.indicateActiveTab();
    this.renderGrid(vm);
    this.renderPreview(vm);
  }

  /** Resolve a display label; skills get a prettier name, cosmetics use the id. */
  private labelFor(id: string): string {
    return prettifyId(id);
  }

  /** Persist a save through the core SaveStore bound to localStorage (as SettingsScene). */
  private persist(save: SaveState): boolean {
    const storage = typeof window !== 'undefined' ? window.localStorage : undefined;
    if (!storage) return false;
    return this.store.save(storage, save);
  }

  /** Apply an equip change + persist + sync the shared context for the menu beneath. */
  private commit(next: SaveState): void {
    this.persist(next);
    this.save = next;
    this.ctx.save = next;
    this.game.registry.set(SHARED_CONTEXT_KEYS.save, next);
  }

  private close(): void {
    this.onClose(this.save);
    this.scene.stop(INVENTORY_SCENE_KEY);
  }

  // -- Kino preview --------------------------------------------------------

  /**
   * Draw the player's Kino FIXED in the upper area (Req 20.8). Resolves the
   * starter sprite through the Asset_Registry: a real loaded texture renders as
   * an image, otherwise the geometric placeholder descriptor is drawn as a
   * tinted shape — identical behavior whether or not final art exists (Req
   * 24.1-24.3, 24.10), matching MainMenuScene's Kino rendering.
   */
  private drawKino(x: number, y: number): void {
    const resolved = this.ctx.assets.resolve(KINO_SPRITE_KEY);
    if (resolved.source === 'real' && this.textures.exists(KINO_SPRITE_KEY)) {
      const img = this.add.image(x, y, KINO_SPRITE_KEY).setOrigin(0.5, 0.5).setDepth(1);
      const maxSize = 140;
      const scale = Math.min(maxSize / img.width, maxSize / img.height, 1);
      img.setScale(scale);
      return;
    }
    const ph = resolved.placeholder;
    if (!ph) return;
    const tint = colorToNumber(ph.tint);
    if (ph.kind === 'circle') {
      const radius = Math.max(ph.width, ph.height) / 2;
      this.add.circle(x, y, radius, tint).setOrigin(0.5, 0.5).setDepth(1);
    } else {
      this.add.rectangle(x, y, ph.width, ph.height, tint).setOrigin(0.5, 0.5).setDepth(1);
    }
  }

  // -- helpers -------------------------------------------------------------

  private cloneSave(save: SaveState): SaveState {
    return {
      ...save,
      unlockedSkills: [...save.unlockedSkills],
      unlockedCosmetics: [...save.unlockedCosmetics],
    };
  }

  /** Build a simple interactive text button centered at (x, y). */
  private buildButton(x: number, y: number, label: string, onPress: () => void): void {
    const paddingX = 18;
    const paddingY = 10;
    const text = this.add
      .text(x, y, label, { fontFamily: 'monospace', fontSize: '22px', color: '#0b0f16' })
      .setOrigin(0.5, 0.5)
      .setDepth(6);
    const bg = this.add
      .rectangle(x, y, text.width + paddingX * 2, text.height + paddingY * 2, 0xf5e6c8)
      .setOrigin(0.5, 0.5)
      .setDepth(5)
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

/**
 * Parse a `#RRGGBB` hex color string to the 0xRRGGBB number Phaser wants.
 * Tolerates a missing leading '#'. Falls back to white on a malformed value so
 * a cell is always visible.
 */
function colorToNumber(hex: string): number {
  const cleaned = (hex ?? '').replace('#', '').trim();
  const parsed = Number.parseInt(cleaned, 16);
  return Number.isNaN(parsed) ? 0xffffff : parsed;
}

/** Turn an id like "secondChance" / "wizard-hat" into a readable label. */
function prettifyId(id: string): string {
  const spaced = id
    .replace(/[-_]/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.replace(/\b\w/g, (c) => c.toUpperCase());
}

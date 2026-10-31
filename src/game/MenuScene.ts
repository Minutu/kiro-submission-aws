// Minimal rebuild — Main Menu (revamped with Kino preview + cosmetics).
//
// Layout:
//   - Top: a black rectangle panel with a centered Kino preview (wearing the
//     currently equipped hat). A "Cosmetics" button sits on the left of the
//     panel.
//   - Below the panel: a SCROLLABLE list of world buttons (wheel or drag),
//     clipped to the area beneath the panel.
//   - Clicking Cosmetics opens an inventory panel OVER the world list with the
//     four hats to choose from; picking one equips it on the Kino preview.

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './config.ts';
import { HATS, getEquippedHat, setEquippedHat, loadHatAssets, type Hat } from './cosmetics.ts';
import { SKILLS, getEquippedSkill, setEquippedSkill, type Skill } from './skills.ts';

interface WorldButton {
  sceneKey: string;
  title: string;
  subtitle: string;
  color: number;
  hover: number;
}

// Listed top-to-bottom: World 5 at the top down to World 1 at the bottom.
const WORLDS: WorldButton[] = [
  { sceneKey: 'World5', title: 'World 5', subtitle: 'Security Citadel', color: 0xc0392b, hover: 0xe05545 },
  { sceneKey: 'World4', title: 'World 4', subtitle: 'Ice & Underwater', color: 0x0a3d62, hover: 0x156824 },
  { sceneKey: 'World3', title: 'World 3', subtitle: 'Memory Jungle', color: 0x8e44ad, hover: 0xa55fc4 },
  { sceneKey: 'World2', title: 'World 2', subtitle: 'Foundry', color: 0x2e9e4f, hover: 0x3fc063 },
  { sceneKey: 'World1', title: 'World 1', subtitle: 'Desert', color: 0x3a7bd5, hover: 0x5a97e8 },
];

// --- layout constants -------------------------------------------------------
const PANEL_TOP = 20;
const PANEL_HEIGHT = 300;
const PANEL_BOTTOM = PANEL_TOP + PANEL_HEIGHT;

const LIST_TOP = PANEL_BOTTOM + 20;
const LIST_BOTTOM = GAME_HEIGHT - 20;
const LIST_HEIGHT = LIST_BOTTOM - LIST_TOP;

const BTN_W = 520;
const BTN_H = 120;
const BTN_GAP = 24;
const ROW_STEP = BTN_H + BTN_GAP;

export class MenuScene extends Phaser.Scene {
  /** Scene-space position of the top of the preview Kino's head. */
  private previewHeadX = 0;
  private previewHeadY = 0;
  /** The current preview hat object (destroyed/recreated on change). */
  private previewHatObj: Phaser.GameObjects.Image | null = null;
  private listContainer!: Phaser.GameObjects.Container;
  private scrollY = 0;
  private maxScroll = 0;
  private inventoryOpen = false;
  private whichInventory: 'cosmetics' | 'skills' = 'cosmetics';
  private inventoryContainer: Phaser.GameObjects.Container | null = null;

  constructor() {
    super('Menu');
  }

  preload(): void {
    this.load.image('kino-base', 'assets/kino-base-0.png');
    loadHatAssets(this);
  }

  create(): void {
    this.cameras.main.setBackgroundColor('#1d2b53');
    this.scrollY = 0;
    this.inventoryOpen = false;
    this.inventoryContainer = null;

    this.buildPreviewPanel();
    this.buildWorldList();
    this.buildCosmeticsButton();
    this.buildSkillsButton();

    // Scroll input for the world list (wheel + drag), disabled while inventory
    // is open so the two don't fight.
    this.input.on(
      'wheel',
      (_p: unknown, _o: unknown, _dx: number, dy: number) => {
        if (!this.inventoryOpen) this.scrollList(dy);
      },
    );
    let dragging = false;
    let lastY = 0;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.y > LIST_TOP && p.y < LIST_BOTTOM && !this.inventoryOpen) {
        dragging = true;
        lastY = p.y;
      }
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (dragging) {
        this.scrollList(-(p.y - lastY));
        lastY = p.y;
      }
    });
    this.input.on('pointerup', () => { dragging = false; });
  }

  // -- top preview panel ---------------------------------------------------

  private buildPreviewPanel(): void {
    // Black rectangle panel.
    this.add
      .rectangle(GAME_WIDTH / 2, PANEL_TOP + PANEL_HEIGHT / 2, GAME_WIDTH - 40, PANEL_HEIGHT, 0x000000)
      .setStrokeStyle(3, 0x3a4a7a);

    // Title tucked at the top of the panel.
    this.add
      .text(GAME_WIDTH / 2, PANEL_TOP + 44, 'KINO', {
        fontFamily: 'sans-serif', fontSize: '56px', color: '#ffffff', fontStyle: 'bold',
      })
      .setOrigin(0.5);

    // Centered Kino preview (sprite) with the equipped hat on top.
    const centerX = GAME_WIDTH / 2;
    const centerY = PANEL_TOP + PANEL_HEIGHT / 2 + 40;
    const targetH = 150;
    const src = this.textures.get('kino-base').getSourceImage();
    const scale = targetH / src.height;
    const kino = this.add.image(centerX, centerY, 'kino-base').setScale(scale).setOrigin(0.5, 0.5);

    // Remember the top-of-head point in SCENE coordinates; the hat is drawn
    // there directly (no container) to avoid double-offsetting.
    this.previewHeadX = centerX;
    this.previewHeadY = centerY - kino.displayHeight / 2 + 10;
    this.renderPreviewHat();
  }

  /** Redraw the hat sitting on top of the preview Kino from the equipped hat. */
  private renderPreviewHat(): void {
    this.previewHatObj?.destroy();
    this.previewHatObj = null;
    const hat = getEquippedHat();
    if (!hat) return;
    // Bigger hat, base resting on the head, sunk down slightly so it sits on
    // the cookie head rather than floating above it.
    this.previewHatObj = this.makeHatImage(hat, this.previewHeadX, this.previewHeadY + 50, 120);
    this.previewHatObj.setDepth(2);
  }

  /**
   * Build a hat IMAGE whose base (bottom-center) rests on the baseline (bx, by)
   * and extends upward, sized to a target width keeping aspect ratio.
   */
  private makeHatImage(hat: Hat, bx: number, by: number, targetWidth: number): Phaser.GameObjects.Image {
    const src = this.textures.get(hat.textureKey).getSourceImage();
    const scale = targetWidth / src.width;
    return this.add
      .image(bx, by, hat.textureKey)
      .setScale(scale)
      .setOrigin(0.5, 1);
  }

  // -- scrollable world list -----------------------------------------------

  private buildWorldList(): void {
    this.listContainer = this.add.container(0, 0);

    WORLDS.forEach((world, i) => {
      const y = LIST_TOP + BTN_H / 2 + i * ROW_STEP;
      const row = this.makeWorldButton(world, GAME_WIDTH / 2, y, BTN_W, BTN_H);
      this.listContainer.add(row);
    });

    // Clip the list to the region beneath the panel.
    const maskShape = this.make.graphics({});
    maskShape.fillRect(0, LIST_TOP, GAME_WIDTH, LIST_HEIGHT);
    this.listContainer.setMask(maskShape.createGeometryMask());

    // How far the content can scroll (content height beyond the viewport).
    const contentHeight = WORLDS.length * ROW_STEP - BTN_GAP;
    this.maxScroll = Math.max(0, contentHeight - LIST_HEIGHT);
  }

  private scrollList(dy: number): void {
    this.scrollY = Phaser.Math.Clamp(this.scrollY + dy, 0, this.maxScroll);
    this.listContainer.y = -this.scrollY;
  }

  private makeWorldButton(
    world: WorldButton, x: number, y: number, w: number, h: number,
  ): Phaser.GameObjects.Container {
    const button = this.add
      .rectangle(0, 0, w, h, world.color)
      .setStrokeStyle(4, 0xffffff)
      .setInteractive({ useHandCursor: true });

    const title = this.add
      .text(0, -22, world.title, {
        fontFamily: 'sans-serif', fontSize: '46px', color: '#ffffff', fontStyle: 'bold',
      })
      .setOrigin(0.5);
    const subtitle = this.add
      .text(0, 28, world.subtitle, {
        fontFamily: 'sans-serif', fontSize: '26px', color: '#eaf2ff',
      })
      .setOrigin(0.5);

    button.on('pointerover', () => button.setFillStyle(world.hover));
    button.on('pointerout', () => button.setFillStyle(world.color));
    button.on('pointerup', (p: Phaser.Input.Pointer) => {
      // Only treat as a click if it wasn't a scroll-drag and inventory closed.
      if (!this.inventoryOpen) this.scene.start(world.sceneKey);
      void p;
    });

    return this.add.container(x, y, [button, title, subtitle]);
  }

  // -- cosmetics button + inventory ----------------------------------------

  private buildCosmeticsButton(): void {
    const x = PANEL_TOP + 90;
    const y = PANEL_TOP + PANEL_HEIGHT / 2;
    const btn = this.add
      .rectangle(x, y, 150, 72, 0x2c3e66)
      .setStrokeStyle(3, 0xffffff)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(x, y, 'Cosmetics', {
        fontFamily: 'sans-serif', fontSize: '22px', color: '#ffffff', fontStyle: 'bold',
      })
      .setOrigin(0.5);

    btn.on('pointerover', () => btn.setFillStyle(0x3a5287));
    btn.on('pointerout', () => btn.setFillStyle(0x2c3e66));
    btn.on('pointerup', () => this.toggleInventory('cosmetics'));
  }

  private buildSkillsButton(): void {
    // Mirror of the cosmetics button, on the RIGHT of Kino.
    const x = GAME_WIDTH - (PANEL_TOP + 90);
    const y = PANEL_TOP + PANEL_HEIGHT / 2;
    const btn = this.add
      .rectangle(x, y, 150, 72, 0x5a2c66)
      .setStrokeStyle(3, 0xffffff)
      .setInteractive({ useHandCursor: true });
    this.add
      .text(x, y, 'Skills', {
        fontFamily: 'sans-serif', fontSize: '24px', color: '#ffffff', fontStyle: 'bold',
      })
      .setOrigin(0.5);

    btn.on('pointerover', () => btn.setFillStyle(0x743a87));
    btn.on('pointerout', () => btn.setFillStyle(0x5a2c66));
    btn.on('pointerup', () => this.toggleInventory('skills'));
  }

  private toggleInventory(which: 'cosmetics' | 'skills'): void {
    // Clicking a button while its own inventory is open closes it; clicking the
    // other button swaps to that inventory.
    if (this.inventoryOpen && this.whichInventory === which) {
      this.closeInventory();
      return;
    }
    if (this.inventoryOpen) this.closeInventory();
    this.whichInventory = which;
    if (which === 'cosmetics') this.openInventory();
    else this.openSkillInventory();
  }

  private openInventory(): void {
    this.inventoryOpen = true;

    const c = this.add.container(0, 0);

    // Dim backdrop over the world list area.
    const bg = this.add
      .rectangle(GAME_WIDTH / 2, (LIST_TOP + LIST_BOTTOM) / 2, GAME_WIDTH - 20, LIST_HEIGHT, 0x101828, 0.97)
      .setStrokeStyle(3, 0x3a4a7a);
    c.add(bg);

    c.add(
      this.add
        .text(GAME_WIDTH / 2, LIST_TOP + 44, 'Cosmetics — pick a hat', {
          fontFamily: 'sans-serif', fontSize: '34px', color: '#ffffff', fontStyle: 'bold',
        })
        .setOrigin(0.5),
    );

    // Lay out the four hats in a 2x2 grid of cells.
    const cols = 2;
    const cellW = 300;
    const cellH = 180;
    const gridW = cols * cellW;
    const startX = GAME_WIDTH / 2 - gridW / 2 + cellW / 2;
    const startY = LIST_TOP + 150;
    const equipped = getEquippedHat();

    HATS.forEach((hat, i) => {
      const col = i % cols;
      const rowIdx = Math.floor(i / cols);
      const cx = startX + col * cellW;
      const cy = startY + rowIdx * cellH;
      for (const obj of this.makeHatCell(hat, cx, cy, equipped?.id === hat.id)) {
        c.add(obj);
      }
    });

    // Close button.
    const closeBtn = this.add
      .rectangle(GAME_WIDTH / 2, LIST_BOTTOM - 46, 220, 60, 0x555f7a)
      .setStrokeStyle(3, 0xffffff)
      .setInteractive({ useHandCursor: true });
    c.add(closeBtn);
    c.add(
      this.add
        .text(GAME_WIDTH / 2, LIST_BOTTOM - 46, 'Close', {
          fontFamily: 'sans-serif', fontSize: '26px', color: '#ffffff',
        })
        .setOrigin(0.5),
    );
    closeBtn.on('pointerup', () => this.closeInventory());

    c.setDepth(50);
    this.inventoryContainer = c;
  }

  /**
   * Build a hat inventory cell at ABSOLUTE scene coords (cx, cy). Returns the
   * cell's objects as a flat array so the caller can add them to the single
   * inventory container without nested-container double-offsetting.
   */
  private makeHatCell(hat: Hat, cx: number, cy: number, selected: boolean): Phaser.GameObjects.GameObject[] {
    const cell = this.add
      .rectangle(cx, cy, 260, 150, selected ? 0x2e7d32 : 0x1f2a44)
      .setStrokeStyle(selected ? 4 : 2, selected ? 0x7fff9f : 0x5a6a9a)
      .setInteractive({ useHandCursor: true });

    // Swatch: the hat image, base sitting low in the cell so it reads upright.
    const swatch = this.makeHatImage(hat, cx, cy + 44, 90);
    const label = this.add
      .text(cx, cy + 62, hat.label, {
        fontFamily: 'sans-serif', fontSize: '22px', color: '#ffffff',
      })
      .setOrigin(0.5);

    cell.on('pointerup', () => {
      setEquippedHat(hat.id);
      this.renderPreviewHat();
      this.refreshInventory();
    });

    return [cell, swatch, label];
  }

  private refreshInventory(): void {
    // Rebuild to reflect the new selection highlight, reopening whichever
    // inventory is currently active.
    const which = this.whichInventory;
    this.closeInventory();
    this.whichInventory = which;
    if (which === 'cosmetics') this.openInventory();
    else this.openSkillInventory();
  }

  private closeInventory(): void {
    this.inventoryOpen = false;
    this.inventoryContainer?.destroy();
    this.inventoryContainer = null;
  }

  // -- skills inventory ----------------------------------------------------

  private openSkillInventory(): void {
    this.inventoryOpen = true;
    const c = this.add.container(0, 0);

    const bg = this.add
      .rectangle(GAME_WIDTH / 2, (LIST_TOP + LIST_BOTTOM) / 2, GAME_WIDTH - 20, LIST_HEIGHT, 0x101828, 0.97)
      .setStrokeStyle(3, 0x3a4a7a);
    c.add(bg);

    c.add(
      this.add
        .text(GAME_WIDTH / 2, LIST_TOP + 44, 'Skills — pick a super power', {
          fontFamily: 'sans-serif', fontSize: '34px', color: '#ffffff', fontStyle: 'bold',
        })
        .setOrigin(0.5),
    );

    // Three skills stacked vertically.
    const equipped = getEquippedSkill();
    const startY = LIST_TOP + 150;
    const rowH = 130;
    SKILLS.forEach((skill, i) => {
      const cy = startY + i * rowH;
      for (const obj of this.makeSkillCell(skill, GAME_WIDTH / 2, cy, equipped?.id === skill.id)) {
        c.add(obj);
      }
    });

    const closeBtn = this.add
      .rectangle(GAME_WIDTH / 2, LIST_BOTTOM - 46, 220, 60, 0x555f7a)
      .setStrokeStyle(3, 0xffffff)
      .setInteractive({ useHandCursor: true });
    c.add(closeBtn);
    c.add(
      this.add
        .text(GAME_WIDTH / 2, LIST_BOTTOM - 46, 'Close', {
          fontFamily: 'sans-serif', fontSize: '26px', color: '#ffffff',
        })
        .setOrigin(0.5),
    );
    closeBtn.on('pointerup', () => this.closeInventory());

    c.setDepth(50);
    this.inventoryContainer = c;
  }

  private makeSkillCell(skill: Skill, cx: number, cy: number, selected: boolean): Phaser.GameObjects.GameObject[] {
    const cell = this.add
      .rectangle(cx, cy, 560, 108, selected ? 0x2e7d32 : 0x1f2a44)
      .setStrokeStyle(selected ? 4 : 2, selected ? 0x7fff9f : 0x5a6a9a)
      .setInteractive({ useHandCursor: true });

    // A colored dot on the left as the skill's icon.
    const dot = this.add.circle(cx - 230, cy, 26, skill.color).setStrokeStyle(2, 0x000000);
    const name = this.add
      .text(cx - 180, cy - 16, skill.label, {
        fontFamily: 'sans-serif', fontSize: '30px', color: '#ffffff', fontStyle: 'bold',
      })
      .setOrigin(0, 0.5);
    const desc = this.add
      .text(cx - 180, cy + 20, this.skillDescription(skill.id), {
        fontFamily: 'sans-serif', fontSize: '18px', color: '#c7d2ea',
      })
      .setOrigin(0, 0.5);

    cell.on('pointerup', () => {
      setEquippedSkill(skill.id);
      this.refreshInventory();
    });

    return [cell, dot, name, desc];
  }

  private skillDescription(id: Skill['id']): string {
    switch (id) {
      case 'time-slow':
        return 'Slow the world for 4s';
      case 'second-chance':
        return 'For 3s, phase through the first object hit';
      case 'ultra-instinct':
        return 'For 4s, a hit teleports you to safety';
    }
  }
}

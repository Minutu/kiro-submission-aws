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
import { getOwnedHats, getEquippedHat, setEquippedHat, loadHatAssets, type Hat } from './cosmetics.ts';
import { getOwnedSkills, getEquippedSkill, setEquippedSkill, type Skill } from './skills.ts';
import {
  isWorldUnlocked, worldNumberFromKey, getKiroDisplayName,
  getOwnedCosmeticCount, getOwnedSkillCount,
  consumeCosmeticsButtonHighlight, consumeSkillsButtonHighlight,
} from './progression.ts';
import { textStyle } from './ui.ts';
import { latestUnlockedWorld, paletteForWorld, doodleButton, type UIPalette } from './uiTheme.ts';
import { MENU_BG_SCENE_KEY } from './menuBackground.ts';

interface WorldButton {
  sceneKey: string;
  title: string;
  subtitle: string;
  color: number;
  hover: number;
}

// Listed top-to-bottom: World 5 at the top down to World 1 at the bottom.
// Colors match each world's theme.
const WORLDS: WorldButton[] = [
  { sceneKey: 'World5', title: 'FINAL WORLD', subtitle: 'Security Citadel', color: 0xd81e1e, hover: 0xf23b3b }, // bright red
  { sceneKey: 'World4', title: 'World 4', subtitle: 'Ice & Underwater', color: 0x2a7fb5, hover: 0x3fa0dc }, // icy blue
  { sceneKey: 'World3', title: 'World 3', subtitle: 'Memory Jungle', color: 0x2e8b4f, hover: 0x3fb568 },     // jungle green
  { sceneKey: 'World2', title: 'World 2', subtitle: 'Foundry', color: 0xb5431e, hover: 0xdc5a2c },           // molten red-orange
  { sceneKey: 'World1', title: 'World 1', subtitle: 'Desert', color: 0xd99a3a, hover: 0xf0b654 },            // sandy gold
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
  /** Scene position of the preview Kino center (for placing the skill badge). */
  private previewCenterX = 0;
  private previewCenterY = 0;
  /** The equipped-skill badge beside the preview Kino (recreated on change). */
  private skillBadge: Phaser.GameObjects.Container | null = null;
  private listContainer!: Phaser.GameObjects.Container;
  private scrollY = 0;
  private maxScroll = 0;
  private inventoryOpen = false;
  private whichInventory: 'cosmetics' | 'skills' = 'cosmetics';
  private inventoryContainer: Phaser.GameObjects.Container | null = null;
  /** Palette of the latest unlocked world — drives the menu's colors. */
  private pal!: UIPalette;

  constructor() {
    super('Menu');
  }

  preload(): void {
    this.load.image('kino-base', 'assets/kino-base-0.png');
    loadHatAssets(this);
  }

  create(): void {
    // Menu palette follows the LATEST unlocked world's theme.
    const latest = latestUnlockedWorld();
    this.pal = paletteForWorld(latest);
    // Transparent camera so the blurred backdrop scene (below) shows through.
    this.cameras.main.setBackgroundColor('rgba(0,0,0,0)');
    this.scrollY = 0;
    this.inventoryOpen = false;
    this.inventoryContainer = null;

    // Launch the blurred parallax backdrop as a separate scene running UNDER
    // this one (one blur pass over the whole backdrop, not per object). Restart
    // it so it reflects the current latest-unlocked world, then keep the menu
    // rendered on top.
    const mgr = this.scene;
    if (mgr.isActive(MENU_BG_SCENE_KEY)) mgr.stop(MENU_BG_SCENE_KEY);
    mgr.launch(MENU_BG_SCENE_KEY, { worldNum: latest });
    mgr.sendToBack(MENU_BG_SCENE_KEY);
    mgr.bringToTop('Menu');

    // Stop the backdrop scene when leaving the menu (e.g. entering a world).
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      if (mgr.isActive(MENU_BG_SCENE_KEY)) mgr.stop(MENU_BG_SCENE_KEY);
    });

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
    // Rounded, themed panel for the Kino preview (doodle/modern look).
    const pg = this.add.graphics();
    pg.fillStyle(this.pal.panel, 1);
    pg.fillRoundedRect(20, PANEL_TOP, GAME_WIDTH - 40, PANEL_HEIGHT, 28);
    pg.lineStyle(5, this.pal.panelBorder, 1);
    pg.strokeRoundedRect(20, PANEL_TOP, GAME_WIDTH - 40, PANEL_HEIGHT, 28);

    // Title = the current generation's display name, contoured for contrast.
    this.add
      .text(GAME_WIDTH / 2, PANEL_TOP + 44, getKiroDisplayName(),
        textStyle({ fontSize: 48, color: this.pal.text }))
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
    this.previewCenterX = centerX + kino.displayWidth / 2 + 20;
    this.previewCenterY = centerY;
    this.renderPreviewHat();
    this.renderSkillBadge();
  }

  /** A small round badge to the RIGHT of the preview Kino showing the equipped
   * skill's initials in its color (empty when no skill is equipped). */
  private renderSkillBadge(): void {
    this.skillBadge?.destroy();
    this.skillBadge = null;
    const skill = getEquippedSkill();
    if (!skill) return;

    const r = 34;
    const c = this.add.container(this.previewCenterX, this.previewCenterY).setDepth(3);
    const circle = this.add.circle(0, 0, r, skill.color, 1).setStrokeStyle(3, 0xffffff);
    const label = this.add
      .text(0, 0, skill.short, textStyle({ fontSize: 20 }))
      .setOrigin(0.5);
    c.add([circle, label]);
    this.skillBadge = c;
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

    // Start scrolled to the BOTTOM so World 1 (bottom of the list) is visible
    // whenever the menu opens (game start / new generation).
    this.scrollY = this.maxScroll;
    this.listContainer.y = -this.scrollY;
  }

  private scrollList(dy: number): void {
    this.scrollY = Phaser.Math.Clamp(this.scrollY + dy, 0, this.maxScroll);
    this.listContainer.y = -this.scrollY;
  }

  private makeWorldButton(
    world: WorldButton, x: number, y: number, w: number, h: number,
  ): Phaser.GameObjects.Container {
    const worldNum = worldNumberFromKey(world.sceneKey);
    const unlocked = isWorldUnlocked(worldNum);
    const isLatest = worldNum === latestUnlockedWorld();
    const baseColor = unlocked ? world.color : 0x2b2f38;
    const border = unlocked ? 0xffffff : 0x565b66;
    const radius = 24;

    const children: Phaser.GameObjects.GameObject[] = [];

    // Pulsing outer glow on the LATEST unlocked world, to invite a click.
    if (isLatest) {
      const glow = this.add.graphics();
      const gw = w + 26, gh = h + 26;
      glow.fillStyle(this.pal.accent, 0.5);
      glow.fillRoundedRect(-gw / 2, -gh / 2, gw, gh, radius + 10);
      children.push(glow);
      this.tweens.add({
        targets: glow, alpha: { from: 0.25, to: 0.9 }, scale: { from: 0.98, to: 1.04 },
        duration: 850, yoyo: true, repeat: -1, ease: 'Sine.inOut',
      });
    }

    // Rounded doodle card with a soft drop shadow.
    const shadow = this.add.graphics();
    shadow.fillStyle(0x000000, 0.25);
    shadow.fillRoundedRect(-w / 2, -h / 2 + 6, w, h, radius);

    const g = this.add.graphics();
    const paint = (c: number) => {
      g.clear();
      g.fillStyle(c, 1);
      g.fillRoundedRect(-w / 2, -h / 2, w, h, radius);
      g.lineStyle(4, border, 1);
      g.strokeRoundedRect(-w / 2, -h / 2, w, h, radius);
    };
    paint(baseColor);

    const title = this.add
      .text(unlocked ? 0 : -24, -22, world.title,
        textStyle({ fontSize: 46, color: unlocked ? '#ffffff' : '#8b90a0' }))
      .setOrigin(0.5);
    const subtitle = this.add
      .text(unlocked ? 0 : -24, 28, unlocked ? world.subtitle : 'Locked',
        textStyle({ fontSize: 26, color: unlocked ? '#eaf2ff' : '#6d7282' }))
      .setOrigin(0.5);

    children.push(shadow, g, title, subtitle);

    if (!unlocked) {
      // Emoji glyphs render taller/wider than the font's reported bounds, so
      // without padding Phaser clips the top/bottom (and sometimes the sides)
      // of the padlock. Pad the text canvas so the whole glyph fits.
      const lock = this.add
        .text(w / 2 - 72, 0, '\u{1F512}', {
          fontSize: '40px',
          padding: { x: 8, y: 10 },
        })
        .setOrigin(0.5);
      children.push(lock);
    } else {
      const hit = this.add.rectangle(0, 0, w, h, 0x000000, 0).setInteractive({ useHandCursor: true });
      hit.on('pointerover', () => paint(world.hover));
      hit.on('pointerout', () => paint(world.color));
      hit.on('pointerup', () => { if (!this.inventoryOpen) this.scene.start(world.sceneKey); });
      children.push(hit);
    }

    return this.add.container(x, y, children);
  }

  // -- cosmetics button + inventory ----------------------------------------

  private buildCosmeticsButton(): void {
    // Hidden until the player owns at least one cosmetic (after beating W1).
    if (getOwnedCosmeticCount() < 1) return;
    const btn = doodleButton(
      this, PANEL_TOP + 100, PANEL_TOP + PANEL_HEIGHT - 44, 170, 68, 'Cosmetics',
      this.pal.secondary, this.pal.secondaryHover, this.pal.panelBorder,
      () => this.toggleInventory('cosmetics'), 22,
    );
    // One-time appear-highlight the first time this button is ever shown.
    if (consumeCosmeticsButtonHighlight()) this.highlightNewButton(btn.container);
  }

  private buildSkillsButton(): void {
    // Hidden until the player owns at least one skill (after beating W2).
    if (getOwnedSkillCount() < 1) return;
    const btn = doodleButton(
      this, GAME_WIDTH - (PANEL_TOP + 100), PANEL_TOP + PANEL_HEIGHT - 44, 170, 68, 'Skills',
      this.pal.secondary, this.pal.secondaryHover, this.pal.panelBorder,
      () => this.toggleInventory('skills'), 24,
    );
    if (consumeSkillsButtonHighlight()) this.highlightNewButton(btn.container);
  }

  /** Pulse a just-appeared reward button (scale + glow) for ~2 seconds, once. */
  private highlightNewButton(container: Phaser.GameObjects.Container): void {
    // A soft accent glow behind the button, tweened for ~2s then removed.
    const glow = this.add.circle(container.x, container.y, 70, this.pal.accent, 0.5).setDepth(container.depth - 1);
    this.tweens.add({
      targets: glow, alpha: { from: 0.55, to: 0.1 }, scale: { from: 0.8, to: 1.25 },
      duration: 500, yoyo: true, repeat: 1, ease: 'Sine.inOut',
      onComplete: () => glow.destroy(),
    });
    this.tweens.add({
      targets: container, scale: { from: 1, to: 1.12 },
      duration: 500, yoyo: true, repeat: 1, ease: 'Sine.inOut',
      onComplete: () => container.setScale(1),
    });
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

    // Themed rounded backdrop over the world list area.
    const bgG = this.add.graphics();
    bgG.fillStyle(this.pal.panel, 0.98);
    bgG.fillRoundedRect(10, LIST_TOP, GAME_WIDTH - 20, LIST_HEIGHT, 24);
    bgG.lineStyle(4, this.pal.panelBorder, 1);
    bgG.strokeRoundedRect(10, LIST_TOP, GAME_WIDTH - 20, LIST_HEIGHT, 24);
    c.add(bgG);

    c.add(
      this.add
        .text(GAME_WIDTH / 2, LIST_TOP + 44, 'Cosmetics — pick a hat',
          textStyle({ fontSize: 34, color: this.pal.text }))
        .setOrigin(0.5),
    );

    // Lay out only the OWNED hats in a 2x2 grid of cells.
    const cols = 2;
    const cellW = 300;
    const cellH = 180;
    const gridW = cols * cellW;
    const startX = GAME_WIDTH / 2 - gridW / 2 + cellW / 2;
    const startY = LIST_TOP + 150;
    const equipped = getEquippedHat();

    getOwnedHats().forEach((hat, i) => {
      const col = i % cols;
      const rowIdx = Math.floor(i / cols);
      const cx = startX + col * cellW;
      const cy = startY + rowIdx * cellH;
      for (const obj of this.makeHatCell(hat, cx, cy, equipped?.id === hat.id)) {
        c.add(obj);
      }
    });

    // Close button (doodle).
    const close = doodleButton(
      this, GAME_WIDTH / 2, LIST_BOTTOM - 46, 220, 60, 'Close',
      this.pal.secondary, this.pal.secondaryHover, this.pal.panelBorder,
      () => this.closeInventory(), 26,
    );
    c.add(close.container);

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
      // Toggle: clicking the equipped hat again unequips it.
      setEquippedHat(selected ? null : hat.id);
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

    const bgG = this.add.graphics();
    bgG.fillStyle(this.pal.panel, 0.98);
    bgG.fillRoundedRect(10, LIST_TOP, GAME_WIDTH - 20, LIST_HEIGHT, 24);
    bgG.lineStyle(4, this.pal.panelBorder, 1);
    bgG.strokeRoundedRect(10, LIST_TOP, GAME_WIDTH - 20, LIST_HEIGHT, 24);
    c.add(bgG);

    c.add(
      this.add
        .text(GAME_WIDTH / 2, LIST_TOP + 44, 'Skills — pick a super power',
          textStyle({ fontSize: 34, color: this.pal.text }))
        .setOrigin(0.5),
    );

    // Only the OWNED skills, stacked vertically.
    const equipped = getEquippedSkill();
    const startY = LIST_TOP + 150;
    const rowH = 130;
    getOwnedSkills().forEach((skill, i) => {
      const cy = startY + i * rowH;
      for (const obj of this.makeSkillCell(skill, GAME_WIDTH / 2, cy, equipped?.id === skill.id)) {
        c.add(obj);
      }
    });

    const close = doodleButton(
      this, GAME_WIDTH / 2, LIST_BOTTOM - 46, 220, 60, 'Close',
      this.pal.secondary, this.pal.secondaryHover, this.pal.panelBorder,
      () => this.closeInventory(), 26,
    );
    c.add(close.container);

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
      // Toggle: clicking the equipped skill again unequips it.
      setEquippedSkill(selected ? null : skill.id);
      this.renderSkillBadge();
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

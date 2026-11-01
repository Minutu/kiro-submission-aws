// UI theming — per-world color palettes for the menu and pause overlay, plus
// a generic modern palette for the cinematics, and a reusable "doodle" rounded
// button helper for a modern mobile-game look.

import Phaser from 'phaser';
import { addText } from './ui.ts';
import { isWorldUnlocked, TOTAL_WORLDS } from './progression.ts';

export interface UIPalette {
  /** Scene background. */
  bg: number;
  /** Panel fill + its border. */
  panel: number;
  panelBorder: number;
  /** Primary action button (idle / hover). */
  primary: number;
  primaryHover: number;
  /** Secondary button (idle / hover). */
  secondary: number;
  secondaryHover: number;
  /** Accent for highlights/strokes. */
  accent: number;
  /** Main text color. */
  text: string;
}

// World palettes: 1 desert, 2 lava foundry, 3 jungle, 4 ice, 5 cyber-red night.
export const WORLD_PALETTES: Record<number, UIPalette> = {
  1: { // Desert
    bg: 0x3a2a14, panel: 0x6b4a22, panelBorder: 0xe0b060,
    primary: 0xe0a93e, primaryHover: 0xf2c25c, secondary: 0x8a5a28, secondaryHover: 0xa8723a,
    accent: 0xffe3a0, text: '#fff4dc',
  },
  2: { // Foundry / lava
    bg: 0x2a0d08, panel: 0x5a1c10, panelBorder: 0xff7a3c,
    primary: 0xe8542a, primaryHover: 0xff7a44, secondary: 0x7a2614, secondaryHover: 0x9c3420,
    accent: 0xffb070, text: '#ffe6d8',
  },
  3: { // Jungle
    bg: 0x0f2a16, panel: 0x1d4a2a, panelBorder: 0x7fe08a,
    primary: 0x2fae55, primaryHover: 0x44c96c, secondary: 0x1a5e30, secondaryHover: 0x267a40,
    accent: 0xbdf5c0, text: '#eafff0',
  },
  4: { // Ice
    bg: 0x0d2438, panel: 0x18476b, panelBorder: 0x9fe0ff,
    primary: 0x2f9fd6, primaryHover: 0x4cc0f0, secondary: 0x175a7a, secondaryHover: 0x2277a0,
    accent: 0xcdf3ff, text: '#eaf8ff',
  },
  5: { // Red city at night / cybersecurity
    bg: 0x14040a, panel: 0x3a0a18, panelBorder: 0xff3b6b,
    primary: 0xd62246, primaryHover: 0xf23a60, secondary: 0x5a1020, secondaryHover: 0x7a1830,
    accent: 0xff7aa0, text: '#ffdbe4',
  },
};

/** Generic modern palette for the cinematics (not world-themed). A bright
 * (near-white) border gives the buttons a high-contrast contour like the menu. */
export const GENERIC_PALETTE: UIPalette = {
  bg: 0x0e1020, panel: 0x1a1f36, panelBorder: 0xeaf0ff,
  primary: 0x5b6fd6, primaryHover: 0x7488ef, secondary: 0x2a3050, secondaryHover: 0x3a4268,
  accent: 0xaab6ff, text: '#eef1ff',
};

/** The latest (highest) unlocked world, 1..TOTAL_WORLDS. */
export function latestUnlockedWorld(): number {
  let w = 1;
  for (let i = 1; i <= TOTAL_WORLDS; i++) if (isWorldUnlocked(i)) w = i;
  return w;
}

export function paletteForWorld(worldNumber: number): UIPalette {
  return WORLD_PALETTES[worldNumber] ?? WORLD_PALETTES[1]!;
}

export interface DoodleButton {
  container: Phaser.GameObjects.Container;
  setLabel(text: string): void;
}

/**
 * A rounded, slightly chunky "doodle" button with a drop shadow, a thick
 * border, and a hover lift — modern mobile-game feel.
 */
export function doodleButton(
  scene: Phaser.Scene,
  x: number, y: number, w: number, h: number,
  label: string,
  fill: number, hover: number, border: number,
  onClick: () => void,
  fontSize = 28,
): DoodleButton {
  const radius = Math.min(h / 2, 26);
  const container = scene.add.container(x, y);

  const shadow = scene.add.graphics();
  shadow.fillStyle(0x000000, 0.28);
  shadow.fillRoundedRect(-w / 2, -h / 2 + 7, w, h, radius);

  const g = scene.add.graphics();
  const draw = (c: number) => {
    g.clear();
    g.fillStyle(c, 1);
    g.fillRoundedRect(-w / 2, -h / 2, w, h, radius);
    g.lineStyle(4, border, 1);
    g.strokeRoundedRect(-w / 2, -h / 2, w, h, radius);
  };
  draw(fill);

  const txt = addText(scene, 0, 0, label, { fontSize });

  // A transparent interactive hit zone over the whole button.
  const hit = scene.add
    .rectangle(0, 0, w, h, 0x000000, 0)
    .setInteractive({ useHandCursor: true });

  container.add([shadow, g, txt, hit]);

  hit.on('pointerover', () => { draw(hover); container.y = y - 2; });
  hit.on('pointerout', () => { draw(fill); container.y = y; });
  hit.on('pointerup', () => onClick());

  return {
    container,
    setLabel: (t: string) => txt.setText(t),
  };
}

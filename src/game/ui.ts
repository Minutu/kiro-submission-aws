// Shared UI text styling so every label across the game uses the same look:
// white fill with a black contour (stroke). Centralized here so the style is
// uniform in the menu, the worlds, and all HUD elements.

import Phaser from 'phaser';

export interface TextOpts {
  fontSize?: number;
  color?: string;
  bold?: boolean;
  align?: 'left' | 'center' | 'right';
  /** Stroke thickness; scales loosely with font size by default. */
  strokeThickness?: number;
  strokeColor?: string;
}

/** Build the contoured text style used everywhere. */
export function textStyle(opts: TextOpts = {}): Phaser.Types.GameObjects.Text.TextStyle {
  const fontSize = opts.fontSize ?? 32;
  const stroke = opts.strokeThickness ?? Math.max(3, Math.round(fontSize / 9));
  return {
    fontFamily: 'sans-serif',
    fontSize: `${fontSize}px`,
    color: opts.color ?? '#ffffff',
    fontStyle: opts.bold ?? true ? 'bold' : 'normal',
    align: opts.align ?? 'center',
    stroke: opts.strokeColor ?? '#000000',
    strokeThickness: stroke,
  };
}

/** Add a contoured text object to a scene, centered by default. */
export function addText(
  scene: Phaser.Scene, x: number, y: number, text: string, opts: TextOpts = {},
): Phaser.GameObjects.Text {
  return scene.add.text(x, y, text, textStyle(opts)).setOrigin(0.5);
}

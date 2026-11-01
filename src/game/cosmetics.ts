// Cosmetics — a hat worn on top of Kino, using the image assets in
// assets/hats/. The chosen hat is persisted to localStorage so it is
// remembered across sessions and drawn on the menu preview and in gameplay.

import Phaser from 'phaser';
import { getOwnedCosmeticCount } from './progression.ts';

export interface Hat {
  id: string;
  label: string;
  /** Phaser texture key (loaded via loadHatAssets). */
  textureKey: string;
  /** Asset path for preloading. */
  path: string;
}

/** The four available hats, in inventory display order. */
export const HATS: Hat[] = [
  { id: 'hat-1', label: 'Hat 1', textureKey: 'hat-1', path: 'assets/hats/hat-1.png' },
  { id: 'hat-2', label: 'Hat 2', textureKey: 'hat-2', path: 'assets/hats/hat-2.png' },
  { id: 'hat-3', label: 'Hat 3', textureKey: 'hat-3', path: 'assets/hats/hat-3.png' },
  { id: 'hat-4', label: 'Hat 4', textureKey: 'hat-4', path: 'assets/hats/hat-4.png' },
];

/** The hats the player currently OWNS (earned by beating worlds), in list
 * order. Empty until World 1 is beaten. */
export function getOwnedHats(): Hat[] {
  return HATS.slice(0, getOwnedCosmeticCount());
}

/** True if the given hat id is owned. */
export function isHatOwned(id: string): boolean {
  const idx = HATS.findIndex((h) => h.id === id);
  return idx >= 0 && idx < getOwnedCosmeticCount();
}

/** Queue all hat textures for loading. Call from a scene's preload(). */
export function loadHatAssets(scene: Phaser.Scene): void {
  for (const hat of HATS) {
    if (!scene.textures.exists(hat.textureKey)) {
      scene.load.image(hat.textureKey, hat.path);
    }
  }
}

const STORAGE_KEY = 'kino.cosmetic.hat';

/** The currently equipped hat id, or null for no hat. Starts from storage. */
let equippedId: string | null = loadEquipped();

function loadEquipped(): string | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw === '') return null;
    return HATS.some((h) => h.id === raw) ? raw : null;
  } catch {
    return null;
  }
}

/** Get the equipped hat, or null if none (or if it's not owned). */
export function getEquippedHat(): Hat | null {
  if (equippedId === null) return null;
  if (!isHatOwned(equippedId)) return null;
  return HATS.find((h) => h.id === equippedId) ?? null;
}

/** Equip a hat by id, or pass null to remove. Ignores un-owned ids. Persists. */
export function setEquippedHat(id: string | null): void {
  if (id !== null && !isHatOwned(id)) return;
  equippedId = id;
  try {
    window.localStorage.setItem(STORAGE_KEY, id ?? '');
  } catch {
    // Ignore storage failures; selection still applies for the session.
  }
}

// ---------------------------------------------------------------------------
// Rendering helper (gameplay)
// ---------------------------------------------------------------------------
//
// A HatSprite draws the equipped hat image on top of a character. It is PURELY
// VISUAL: it never participates in collision (worlds test only Kino's own
// hitbox). Call update(x, y) each frame with the top-of-head point.

export class HatSprite {
  private obj: Phaser.GameObjects.Image | null = null;

  /**
   * @param scene owning scene
   * @param targetWidth desired on-screen hat width in px (keeps aspect ratio)
   * @param depth render depth (above the character body)
   */
  /**
   * @param scene owning scene
   * @param targetWidth desired on-screen hat width in px (keeps aspect ratio)
   * @param depth render depth (above the character body)
   * @param overlap how far DOWN to sink the hat onto the head (px), so it rests
   *   on the head rather than floating just above it
   */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly targetWidth: number = 72,
    private readonly depth: number = 6,
    private readonly overlap: number = 10,
  ) {
    this.build();
  }

  private build(): void {
    const hat = getEquippedHat();
    if (!hat || !this.scene.textures.exists(hat.textureKey)) {
      this.obj = null;
      return;
    }
    const src = this.scene.textures.get(hat.textureKey).getSourceImage();
    const scale = this.targetWidth / src.width;
    this.obj = this.scene.add
      .image(0, 0, hat.textureKey)
      .setScale(scale)
      .setOrigin(0.5, 1) // bottom-center sits on the head
      .setDepth(this.depth);
  }

  /** Position the hat so its base rests ON the head, sunk down by `overlap`
   * from the given top-of-head point (x, y). */
  update(x: number, y: number): void {
    if (!this.obj) return;
    this.obj.setPosition(x, y + this.overlap);
  }

  destroy(): void {
    this.obj?.destroy();
    this.obj = null;
  }
}

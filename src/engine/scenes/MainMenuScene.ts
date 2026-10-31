// Feature: kino-game
//
// MainMenuScene — menu with the vertical treasure-map (tasks 4.4 + 9.1).
//
// SCOPE: this scene stands up the boot → menu → gameplay chain AND renders the
// task-9.1 vertical treasure-map (lock-in, side glow, scrolling) PLUS the
// task-9.2 menu controls — a Stats control top-left opening the Info panel (Req
// 20.23), the top-right Settings control (Req 20.24, from task 9.7), a
// top-center Generation pill (Req 20.25), a replay control + Generation_Name
// header (Req 20.15), Cosmetics left of Kino + Skills right of Kino (Req 20.26),
// a large Play control (Req 20.32), and the BOTTOM PRIMARY Start/Continue button
// whose label comes from the PURE `resolvePrimaryButtonLabel` (Req 20.13) and
// which launches the next story step on press (Req 20.14, 20.26).
//
// The Play color-fill grow transition (task 9.8, Req 20.36-20.38, 20.12) is now
// implemented here: pressing Play (or Continue Story / Replay) expands the
// pressed control as an UPWARD color fill until it covers the screen, fades in a
// HUD + World-background stand-in, and glides the PERSISTENT Kino sprite from
// its menu position to the fixed run start before handing off to GameplayScene.
// The reusable easing / run-start-position / phase-timing MATH lives in the
// pure `src/core/playTransition.ts`; only the Phaser tween wiring is here.
//
// Still PENDING for later 9.x tasks: the Inventory_Panel grid behind the
// Cosmetics/Skills controls (task 9.4 — this scene only places the controls and
// stubs their open action) and the endless-mode triangles.
//
//   - a central VERTICAL treasure-map: one row per World, World 1 at the bottom
//     with higher worlds stacked up, next reveal fading in at the top, one
//     checkpoint per world, a Kino location marker, greyed completed/discovered
//     worlds and black undiscovered silhouettes (Req 20.2-20.6, 20.18-20.22,
//     20.27-20.28) — scrollable vertically (Req 20.6, 20.22),
//   - LOCK-IN: scrolling snaps the map center to the nearest DISCOVERED world =
//     Locked_In_World with a side glow; a centered undiscovered silhouette shows
//     no glow, locks nothing, reads as unselectable, and disables Play (Req
//     20.33-20.34, 34.1-34.3),
//   - a Start control (Req 20.1) and a Play control (Req 20.32) — Play launches
//     the Locked_In_World and is disabled when nothing is locked in,
//   - a representation of the player's Kino (Req 20.7), drawn from the resolved
//     starter sprite (real texture if loaded, else its geometric placeholder),
//   - the current Generation_Name label (Req 20.11/20.15).
//
// ENGINE-layer scene, so importing Phaser here is allowed (src/README.md). The
// treasure-map STATE (row ordering, display states, Kino marker, lock-in + Play
// enablement) lives in the Phaser-free `src/core/treasureMap.ts` and is the
// SINGLE SOURCE OF TRUTH; this scene only renders those rows and feeds its
// pixel scroll offset back into `lockInWorldForScroll`. The pure name
// composition lives in `../generationName.ts`.

import Phaser from 'phaser';
import { getBootContext } from '../sharedContext.ts';
import {
  computeMapRows,
  lockInWorldForScroll,
  resolvePrimaryButtonLabel,
  generationPillText,
  computeGlide,
  glideScalar,
  computeRunStartPosition,
  resolvePlayTransitionTiming,
  supportsEndless,
  type MapRow,
  type MapLayout,
  type LockInResult,
  type PrimaryButtonResolution,
  type TransitionPoint,
  type WorldId,
} from '../../core/index.ts';
import { SETTINGS_SCENE_KEY } from './SettingsScene.ts';
import { INFO_SCENE_KEY } from './InfoScene.ts';
import { INVENTORY_SCENE_KEY } from './InventoryScene.ts';

/** Scene key, shared with PreloadScene's `MAIN_MENU_SCENE_KEY` + main.ts. */
export const MAIN_MENU_SCENE_KEY = 'MainMenu';

/**
 * Key of the gameplay scene the Start/Play controls launch. GameplayScene
 * (task 4.6) registers under this key in main.ts; until then this scene starts
 * it defensively (see `launchWorld1`). Exported so main.ts and GameplayScene
 * reference the same constant.
 */
export const GAMEPLAY_SCENE_KEY = 'Gameplay';

/** The asset key for the player's Kino on the menu (Req 24.7, 20.7). */
const KINO_SPRITE_KEY = 'starter:kinoSprite';

/** Vertical pixel spacing between adjacent World rows on the map (Req 20.2). */
const ROW_SPACING_PX = 120;

export class MainMenuScene extends Phaser.Scene {
  /** The computed (pure) map layout — rows + Kino marker (task 9.1). */
  private mapLayout!: MapLayout;

  /** Container holding every map row so it can be scrolled as a unit (Req 20.6). */
  private mapContainer!: Phaser.GameObjects.Container;

  /** Continuous pixel scroll offset of the map (positive = scrolled up). */
  private scrollOffset = 0;

  /** Max scroll offset so the top world can reach the center (clamped). */
  private maxScrollOffset = 0;

  /** The vertical center line the map snaps rows to (Req 20.33, 34.1). */
  private mapCenterY = 0;

  /** Side-glow highlight drawn behind the locked-in row (Req 34.1). */
  private glow!: Phaser.GameObjects.Rectangle;

  /** The Play control background, dimmed/enabled per lock-in (Req 34.3). */
  private playBg!: Phaser.GameObjects.Rectangle;
  private playText!: Phaser.GameObjects.Text;

  /** The current lock-in decision, re-derived from the pure selector on scroll. */
  private lockIn!: LockInResult;

  /**
   * The resolved bottom-primary button (Start/Continue), computed by the PURE
   * `resolvePrimaryButtonLabel` from the save's story position + config labels
   * (Req 20.13). The scene only renders this + launches `launchWorld` on press.
   */
  private primary!: PrimaryButtonResolution;

  /**
   * The persistent Kino sprite drawn on the menu (Req 20.7). Held as a field so
   * the task-9.8 Play/Continue transition can GLIDE the SAME object from its
   * menu position to the fixed run start position (Req 20.12, 20.38) — Kino is
   * literally "kept placed." `drawKino` populates exactly one of these.
   */
  private kinoSprite?: Phaser.GameObjects.Image;
  private kinoPlaceholder?: Phaser.GameObjects.GameObject &
    Phaser.GameObjects.Components.Transform &
    Phaser.GameObjects.Components.Depth;

  /** Kino's menu position, captured so the glide has a fixed origin point. */
  private kinoMenuPos: TransitionPoint = { x: 0, y: 0 };

  /** Latched once a launch transition starts so a second press can't re-trigger. */
  private transitioning = false;

  /** The bottom-primary button background, kept so its press can expand it. */
  private primaryBg!: Phaser.GameObjects.Rectangle;

  /**
   * The open Endless_Mode confirmation overlay (Req 20.31, 23.5), or null when
   * none is showing. Held so only one prompt can be open at a time and so a
   * choice (confirm/cancel) can tear the whole group down cleanly.
   */
  private endlessPrompt: Phaser.GameObjects.Container | null = null;

  constructor() {
    super({ key: MAIN_MENU_SCENE_KEY });
  }

  /**
   * Build the menu: backdrop, Generation_Name label, the player's Kino, the
   * vertical treasure-map (scrollable, with lock-in glow), and the Start + Play
   * controls. The treasure-map STATE comes from the pure core module; this
   * method only lays out Phaser objects against it.
   */
  create(): void {
    const ctx = getBootContext(this);
    const { width, height } = this.scale.gameSize;
    const cx = width / 2;
    this.mapCenterY = height / 2;

    // Phaser REUSES the scene instance across scene.start('MainMenu'), so class
    // fields keep their values from a prior visit. Reset every per-entry
    // transient: clear the launch-transition latch and RE-ENABLE input (the
    // Play transition disabled it before handing off to Gameplay), and reset
    // the map scroll so a returning player can Play again (fixes: could not
    // play after returning to the menu).
    this.transitioning = false;
    this.input.enabled = true;
    this.scrollOffset = 0;
    this.endlessPrompt = null;
    this.kinoSprite = undefined;
    this.kinoPlaceholder = undefined;

    // Plain backdrop so the menu reads as a distinct screen from loading.
    this.add
      .rectangle(cx, height / 2, width, height, 0x1a2230)
      .setOrigin(0.5, 0.5);

    // The composed Generation_Name, reused by the top header AND the pill — the
    // PURE `generationPillText` (which itself reuses `formatGenerationName`) is
    // the single source of truth (Req 20.11, 20.15, 20.25).
    const generationName = generationPillText(ctx.save, ctx.config);

    // --- Top header: replay control + Generation_Name (Req 20.15) --------
    // A replay control and the current Generation_Name form the top header
    // section; the Generation name ALSO appears as the top-center pill below.
    this.buildReplayControl(cx - 150, height * 0.045);
    this.add
      .text(cx, height * 0.045, generationName, {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#cfd8e3',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(10);

    // --- Generation pill (top-center; Req 20.25) -------------------------
    // The current Generation_Name rendered as a pill (rounded chip) in the
    // top-center, distinct from the header line above it.
    this.buildGenerationPill(cx, height * 0.1, generationName);

    // --- Stats control (top-left corner; Req 20.23) ----------------------
    // Opens the run Info panel overlay (task 9.6 view-model). Launched OVER the
    // menu so the map stays beneath (parallel scene).
    this.buildStatsControl(70, height * 0.045);

    // --- Settings control (top-right corner; Req 20.24, 20.48) -----------
    // Opens the Settings_Screen overlay (volume / rebinding / reset-save). It
    // is a parallel scene launched OVER this menu so the map stays beneath;
    // on close the menu re-reads the (possibly changed/reset) save.
    this.buildSettingsControl(width - 70, height * 0.045);

    // --- Vertical treasure-map (task 9.1; Req 20.2-20.6, 20.18-20.28) ----
    // The pure core module decides row order, display states, and the Kino
    // marker; the scene renders them. World 1 is `rows[0]` (bottom).
    this.mapLayout = computeMapRows(ctx.save);
    this.buildTreasureMap(cx, width);

    // --- Player's Kino + flanking Cosmetics/Skills controls (Req 20.7, 20.26)
    const kinoY = height * 0.4;
    this.drawKino(cx, kinoY, ctx);
    // Cosmetics to the LEFT of Kino, Skills to the RIGHT (Req 20.26). Both open
    // the Inventory_Panel (task 9.4); for THIS task they are placed with a
    // stubbed open action (a clean seam 9.4 wires the panel into).
    this.buildCosmeticsControl(cx - 150, kinoY);
    this.buildSkillsControl(cx + 150, kinoY);

    // --- Play control (large; Req 20.32) ---------------------------------
    // Play launches the Locked_In_World and is disabled when a silhouette is
    // centered (Req 34.2-34.3). The color-fill grow transition is task 9.8.
    this.buildPlayControl(cx, height * 0.86, ctx.config.labels.play);

    // --- Bottom primary Start/Continue button (Req 20.13, 20.14) ---------
    // The LABEL + action come from the PURE `resolvePrimaryButtonLabel` (the
    // single source of truth for the 13a–13d cases); a press launches the next
    // available story step (Req 20.14).
    this.primary = resolvePrimaryButtonLabel(ctx.save, ctx.config);
    this.buildPrimaryButton(cx, height * 0.95);

    // Resolve the initial lock-in for the starting scroll position so the glow
    // and Play state are correct before any input.
    this.applyLockIn();
  }

  // -- treasure map --------------------------------------------------------

  /**
   * Render the vertical map into a scrollable container. `rows[0]` (World 1)
   * is drawn at the BOTTOM; higher worlds stack upward (Req 20.27). A side-glow
   * rectangle sits behind the rows to mark the locked-in world (Req 34.1). The
   * container scrolls vertically in response to wheel / drag input (Req 20.6,
   * 20.22); scroll is clamped so every discovered row can reach center.
   */
  private buildTreasureMap(cx: number, width: number): void {
    const rows = this.mapLayout.rows;
    const rowWidth = Math.min(width * 0.6, 360);

    // Glow lives OUTSIDE the scrolling container so it stays pinned to the
    // center line; it is shown/hidden + repositioned by `applyLockIn`.
    this.glow = this.add
      .rectangle(cx, this.mapCenterY, rowWidth + 36, ROW_SPACING_PX - 10, 0xffe08a)
      .setOrigin(0.5, 0.5)
      .setAlpha(0.0)
      .setDepth(1);

    this.mapContainer = this.add.container(0, 0).setDepth(2);

    // Lay each row out so row index i sits at a base Y that, at scrollOffset 0,
    // places World 1 (i=0) on the center line. Higher i => higher on screen.
    rows.forEach((row, i) => {
      const baseY = this.mapCenterY - i * ROW_SPACING_PX;
      this.drawMapRow(row, cx, baseY, rowWidth);
    });

    // The top world (last index) must be able to scroll DOWN to the center.
    this.maxScrollOffset = Math.max(0, (rows.length - 1) * ROW_SPACING_PX);

    // Vertical scroll input (Req 20.6, 20.22): mouse wheel + pointer drag.
    this.input.on(
      'wheel',
      (_p: unknown, _o: unknown, _dx: number, dy: number) => {
        this.scrollBy(dy);
      },
    );
    let dragging = false;
    let lastY = 0;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      dragging = true;
      lastY = p.y;
    });
    this.input.on('pointerup', () => {
      dragging = false;
      // Settle to the snapped row so a discovered world locks in (Req 34.1).
      this.snapToNearestRow();
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!dragging) return;
      // Dragging down (increasing y) scrolls the map content down.
      this.scrollBy(-(p.y - lastY));
      lastY = p.y;
    });
  }

  /** Draw a single World row (checkpoint + label), tinted by display state. */
  private drawMapRow(
    row: MapRow,
    cx: number,
    baseY: number,
    rowWidth: number,
  ): void {
    // Display-state colors (Req 20.18-20.19, 20.28):
    //   greyed => grey; nextReveal => faint (fading in at top); silhouette => black.
    let fill: number;
    let alpha: number;
    if (row.displayState === 'greyed') {
      fill = 0x8a8f99;
      alpha = 1;
    } else if (row.displayState === 'nextReveal') {
      fill = 0x101010;
      alpha = 0.45; // "fading in" at the top edge (Req 20.28)
    } else {
      fill = 0x000000; // black silhouette (Req 20.18)
      alpha = 1;
    }

    const panel = this.add
      .rectangle(cx, baseY, rowWidth, ROW_SPACING_PX - 24, fill)
      .setOrigin(0.5, 0.5)
      .setAlpha(alpha);
    this.mapContainer.add(panel);

    // Exactly one checkpoint per world (Req 20.20) — a small marker dot.
    const checkpoint = this.add
      .circle(cx + rowWidth / 2 - 24, baseY, 8, 0xf5e6c8)
      .setOrigin(0.5, 0.5);
    this.mapContainer.add(checkpoint);

    // World label only when discovered (silhouettes stay anonymous).
    if (row.selectable) {
      const label = this.add
        .text(cx, baseY, `World ${row.worldId}`, {
          fontFamily: 'monospace',
          fontSize: '20px',
          color: '#11151c',
        })
        .setOrigin(0.5, 0.5);
      this.mapContainer.add(label);
    }

    // Kino location marker on the current story world (Req 20.5, 20.21).
    if (row.hasKinoMarker) {
      const marker = this.add
        .triangle(cx - rowWidth / 2 - 16, baseY, 0, 0, 16, 8, 0, 16, 0xffd24a)
        .setOrigin(0.5, 0.5);
      this.mapContainer.add(marker);
    }

    // Endless-mode trigger: a right-pointing triangle on the RIGHT side of the
    // panel (Req 20.29). It is GREYED/LOCKED (non-interactive) while the world
    // is not cleared (Req 20.30) and ACTIVE (interactive) once it is cleared
    // (Req 20.31, 23.4). The PURE `row.endlessUnlocked` (derived from the
    // save's world `storyCleared`) is the single source of truth.
    this.drawEndlessTriangle(row, cx + rowWidth / 2 + 20, baseY);
  }

  /**
   * Draw a single World row's ENDLESS-MODE trigger triangle on the right side
   * of its panel (Req 20.29). Active state comes from the PURE
   * `row.endlessUnlocked` (world story cleared):
   *   - LOCKED (not cleared, Req 20.30): a greyed, dimmed triangle with NO
   *     pointer interactivity — selecting it does nothing.
   *   - ACTIVE (cleared, Req 20.31, 23.4): a bright, interactive triangle; a
   *     press shows the "outside story progression" confirmation (Req 20.31,
   *     23.5) and, on confirm, launches that world in ENDLESS mode.
   */
  private drawEndlessTriangle(row: MapRow, x: number, baseY: number): void {
    const active = row.endlessUnlocked;
    // A right-pointing triangle (points toward "play"): active => warm/bright,
    // locked => a dim grey.
    const fill = active ? 0xffd24a : 0x4a4f57;
    const tri = this.add
      .triangle(x, baseY, 0, 0, 0, 24, 20, 12, fill)
      .setOrigin(0.5, 0.5)
      .setAlpha(active ? 1 : 0.5);
    this.mapContainer.add(tri);

    // A locked triangle is NON-interactive (Req 20.30) — nothing wired.
    if (!active) return;

    // Active: wire a press to the confirmation → endless-launch flow. The hit
    // area is the triangle's local bounding box.
    tri.setInteractive(
      new Phaser.Geom.Triangle(0, 0, 0, 24, 20, 12),
      Phaser.Geom.Triangle.Contains,
    );
    tri.on('pointerover', () => tri.setAlpha(0.8));
    tri.on('pointerout', () => tri.setAlpha(1));
    tri.on('pointerup', () => {
      this.promptEndlessConfirmation(row.worldId);
    });
  }

  /** Scroll the map by `dy` pixels, clamped, then re-resolve the lock-in. */
  private scrollBy(dy: number): void {
    this.scrollOffset = Phaser.Math.Clamp(
      this.scrollOffset + dy,
      0,
      this.maxScrollOffset,
    );
    this.mapContainer.y = this.scrollOffset;
    this.applyLockIn();
  }

  /** Snap the scroll so the nearest row is exactly on the center line. */
  private snapToNearestRow(): void {
    const index = Math.round(this.scrollOffset / ROW_SPACING_PX);
    this.scrollOffset = Phaser.Math.Clamp(
      index * ROW_SPACING_PX,
      0,
      this.maxScrollOffset,
    );
    this.mapContainer.y = this.scrollOffset;
    this.applyLockIn();
  }

  /**
   * Convert the pixel scroll offset into a continuous row index and feed it to
   * the pure `lockInWorldForScroll` selector — the SINGLE source of truth for
   * the Locked_In_World, side glow, and Play enablement (Req 34.1-34.3). The
   * scene only reflects that decision into the glow + Play visuals.
   */
  private applyLockIn(): void {
    const scrollCenter = this.scrollOffset / ROW_SPACING_PX;
    this.lockIn = lockInWorldForScroll(this.mapLayout.rows, scrollCenter);

    // Side glow only when a discovered world is locked in (Req 34.1/34.3).
    this.glow.setAlpha(this.lockIn.showSideGlow ? 0.55 : 0);

    // Play enabled only when locked in (Req 34.2-34.3): dim + no-op otherwise.
    if (this.playBg && this.playText) {
      const enabled = this.lockIn.playEnabled;
      this.playBg.setFillStyle(enabled ? 0xf5e6c8 : 0x4a4f57);
      this.playText.setColor(enabled ? '#0b0f16' : '#8a8f99');
    }
  }

  // -- drawing helpers -----------------------------------------------------

  /**
   * Draw the player's Kino at (x, y). Resolves the starter sprite through the
   * Asset_Registry: a real, loaded texture renders as an image; otherwise the
   * geometric placeholder descriptor is drawn as a tinted shape so the menu is
   * identical in behavior whether or not final art exists (Req 24.1-24.3, 24.10).
   *
   * NOTE: when the asset is real, the texture was loaded by PreloadScene under
   * the REGISTRY KEY (PreloadScene uses the registry key as the Phaser loader
   * key), so we render by that key — not the resolved `real` path.
   */
  private drawKino(
    x: number,
    y: number,
    ctx: ReturnType<typeof getBootContext>,
  ): void {
    const resolved = ctx.assets.resolve(KINO_SPRITE_KEY);

    // Remember the menu position so the task-9.8 glide has a fixed origin.
    this.kinoMenuPos = { x, y };

    if (resolved.source === 'real' && this.textures.exists(KINO_SPRITE_KEY)) {
      const img = this.add.image(x, y, KINO_SPRITE_KEY).setOrigin(0.5, 0.5);
      // Fit the real sprite into a sensible menu slot without distorting it.
      const maxSize = 160;
      const scale = Math.min(
        maxSize / img.width,
        maxSize / img.height,
        1,
      );
      img.setScale(scale);
      // Keep a handle so the launch transition can glide this SAME sprite.
      this.kinoSprite = img;
      return;
    }

    // Placeholder path: draw the geometric descriptor tinted from the palette.
    const ph = resolved.placeholder;
    if (!ph) return; // defensive; resolve() always returns one branch.
    const tint = hexToNumber(ph.tint);
    // The Kino starter placeholder is a character blob (a tinted circle).
    if (ph.kind === 'circle') {
      const radius = Math.max(ph.width, ph.height) / 2;
      this.kinoPlaceholder = this.add
        .circle(x, y, radius, tint)
        .setOrigin(0.5, 0.5);
    } else {
      this.kinoPlaceholder = this.add
        .rectangle(x, y, ph.width, ph.height, tint)
        .setOrigin(0.5, 0.5);
    }
    // A tiny label aids dev-time identification while on placeholders.
    this.add
      .text(x, y + Math.max(ph.width, ph.height) / 2 + 12, 'Kino', {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: '#cfd8e3',
      })
      .setOrigin(0.5, 0);
  }

  /**
   * Add a simple interactive text button centered at (x, y). Minimal styling: a
   * filled rounded-ish rectangle behind a text label, with pointer hover/press
   * feedback and a keyboard-independent click handler. Shared by the
   * Cosmetics/Skills controls and the bottom primary Start/Continue button.
   */
  private addButton(
    x: number,
    y: number,
    label: string,
    onPress: () => void,
  ): Phaser.GameObjects.Rectangle {
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
      .rectangle(
        x,
        y,
        text.width + paddingX * 2,
        text.height + paddingY * 2,
        0xf5e6c8,
      )
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

    // Return the background so callers that need a handle (e.g. the primary
    // button, whose press runs the task-9.8 expand transition) can keep one.
    return bg;
  }

  /**
   * Build the Play control (Req 20.32) with lock-in gating. Unlike `addButton`,
   * Play keeps handles to its background + label so `applyLockIn` can dim it and
   * its press is IGNORED unless a discovered world is locked in (Req 34.2-34.3).
   * On an enabled press it runs the task-9.8 color-fill grow transition
   * (`beginLaunchTransition`, Req 20.36-20.38).
   */
  private buildPlayControl(x: number, y: number, label: string): void {
    const paddingX = 40;
    const paddingY = 16;

    this.playText = this.add
      .text(x, y, label, {
        fontFamily: 'monospace',
        fontSize: '30px',
        color: '#0b0f16',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(11);

    this.playBg = this.add
      .rectangle(
        x,
        y,
        this.playText.width + paddingX * 2,
        this.playText.height + paddingY * 2,
        0xf5e6c8,
      )
      .setOrigin(0.5, 0.5)
      .setDepth(10)
      .setInteractive({ useHandCursor: true });

    // Press only fires when Play is enabled (a world is locked in, Req 34.2),
    // and runs the expand/fade/glide launch transition (task 9.8, Req
    // 20.36-20.38) with the Play control itself as the color-fill origin.
    this.playBg.on('pointerup', () => {
      if (this.lockIn?.playEnabled && this.lockIn.lockedInWorldId !== null) {
        this.beginLaunchTransition(this.lockIn.lockedInWorldId, this.playBg);
      }
    });
  }

  /**
   * Build the top-right Settings control (Req 20.24). Pressing it opens the
   * Settings_Screen overlay (Req 20.48) with `scene.launch` so this menu stays
   * beneath; `onClose` lets the menu refresh against the latest save after any
   * setting change or a reset-save.
   */
  private buildSettingsControl(x: number, y: number): void {
    const label = this.add
      .text(x, y, 'Settings', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#0b0f16',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(11);
    const bg = this.add
      .rectangle(x, y, label.width + 24, label.height + 16, 0xf5e6c8)
      .setOrigin(0.5, 0.5)
      .setDepth(10)
      .setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => bg.setFillStyle(0xffffff));
    bg.on('pointerout', () => bg.setFillStyle(0xf5e6c8));
    bg.on('pointerup', () => this.openSettings());
  }

  /** Launch the Settings_Screen overlay over the menu (Req 20.48). */
  private openSettings(): void {
    if (this.scene.isActive(SETTINGS_SCENE_KEY)) return;
    this.scene.launch(SETTINGS_SCENE_KEY, {
      onClose: () => {
        // The overlay keeps the shared-context save in sync; nothing to re-read
        // for the current menu widgets, but this seam lets later 9.x tasks
        // refresh generation/world state after a reset-save.
      },
    });
  }

  /**
   * Build the top-left Stats control (Req 20.23). Pressing it opens the run
   * Info panel overlay (task 9.6's `buildInfoPanelViewModel`, rendered by
   * InfoScene) with `scene.launch` so this menu stays beneath.
   */
  private buildStatsControl(x: number, y: number): void {
    const label = this.add
      .text(x, y, 'Stats', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#0b0f16',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(11);
    const bg = this.add
      .rectangle(x, y, label.width + 24, label.height + 16, 0xf5e6c8)
      .setOrigin(0.5, 0.5)
      .setDepth(10)
      .setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => bg.setFillStyle(0xffffff));
    bg.on('pointerout', () => bg.setFillStyle(0xf5e6c8));
    bg.on('pointerup', () => this.openInfo());
  }

  /** Launch the run Info panel overlay over the menu (Req 20.10, 20.23). */
  private openInfo(): void {
    if (this.scene.isActive(INFO_SCENE_KEY)) return;
    // On the menu there is no active run, so the panel reads the save-backed
    // high-score + equipped-skill summary (run counters default to 0).
    this.scene.launch(INFO_SCENE_KEY, {});
  }

  /**
   * Build the top-left/header REPLAY control (Req 20.15). The top header
   * section pairs this replay control with the Generation_Name. Replaying the
   * current story step reuses the same launch seam as the primary button.
   */
  private buildReplayControl(x: number, y: number): void {
    const label = this.add
      .text(x, y, '↻ Replay', {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#0b0f16',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(11);
    const bg = this.add
      .rectangle(x, y, label.width + 24, label.height + 16, 0xf5e6c8)
      .setOrigin(0.5, 0.5)
      .setDepth(10)
      .setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => bg.setFillStyle(0xffffff));
    bg.on('pointerout', () => bg.setFillStyle(0xf5e6c8));
    bg.on('pointerup', () => {
      // Replay re-launches the current story world (the primary's target),
      // running the same expand/fade/glide transition from the replay control.
      this.beginLaunchTransition(this.primary.launchWorld, bg);
    });
  }

  /**
   * Build the top-center Generation pill (Req 20.25): a rounded chip carrying
   * the current Generation_Name. Pure display — the text comes from the pure
   * `generationPillText` resolved in `create`.
   */
  private buildGenerationPill(x: number, y: number, text: string): void {
    const label = this.add
      .text(x, y, text, {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#11151c',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(11);
    // Pill backdrop behind the label (a filled, soft-edged chip).
    this.add
      .rectangle(x, y, label.width + 36, label.height + 16, 0xffe08a, 1)
      .setOrigin(0.5, 0.5)
      .setDepth(10);
    // Re-add the label above the pill so it stays legible.
    label.setDepth(11);
  }

  /**
   * Build the Cosmetics control to the LEFT of Kino (Req 20.26). It opens the
   * Inventory_Panel with the Cosmetics tab (task 9.4); for THIS task it only
   * places the control and routes to a stubbed open seam so 9.4 can wire the
   * panel without touching the control's placement.
   */
  private buildCosmeticsControl(x: number, y: number): void {
    this.addButton(x, y, 'Cosmetics', () => this.openInventory('cosmetics'));
  }

  /**
   * Build the Skills control to the RIGHT of Kino (Req 20.26). It opens the
   * Inventory_Panel with the Skills tab (task 9.4); for THIS task it only places
   * the control and routes to the same stubbed open seam.
   */
  private buildSkillsControl(x: number, y: number): void {
    this.addButton(x, y, 'Skills', () => this.openInventory('skills'));
  }

  /**
   * Open the Inventory_Panel on the given tab (Req 20.42, 20.44). Launches the
   * InventoryScene (task 9.4) OVER this menu with `scene.launch` so the menu
   * stays beneath while its dimmed backdrop fades the other menu elements and
   * customization/equip happens in place (Req 20.8, 20.17, 20.42). The panel
   * keeps the shared-context save in sync on each equip, so nothing to re-read
   * here; `onClose` is the seam later tasks can use to refresh menu widgets.
   */
  private openInventory(tab: 'cosmetics' | 'skills'): void {
    if (this.scene.isActive(INVENTORY_SCENE_KEY)) return;
    this.scene.launch(INVENTORY_SCENE_KEY, { tab });
  }

  /**
   * Build the BOTTOM PRIMARY Start/Continue button (Req 20.13, 20.14). The
   * LABEL is the one the PURE `resolvePrimaryButtonLabel` resolved in `create`
   * (`this.primary.label`) — the scene renders it verbatim and NEVER decides
   * Start-vs-Continue itself. A press launches the next available story step
   * (`this.primary.launchWorld`, Req 20.14).
   */
  private buildPrimaryButton(x: number, y: number): void {
    // Keep the background so `launchPrimary` can use it as the expand origin.
    this.primaryBg = this.addButton(x, y, this.primary.label, () =>
      this.launchPrimary(),
    );
  }

  // -- hand-off ------------------------------------------------------------

  /**
   * Launch the next available story step for the bottom primary button (Req
   * 20.14, 20.26). The target World is the one the pure resolver reported
   * (`this.primary.launchWorld`), so Start and Continue both hand off here.
   * Continue Story expands to full screen, keeps Kino placed, and glides Kino
   * to the run start (Req 20.12) — the SAME task-9.8 transition Play runs.
   */
  private launchPrimary(): void {
    // Use the primary button's own background as the color-fill origin so the
    // bottom-anchored button grows upward to cover the screen (Req 20.36).
    this.beginLaunchTransition(this.primary.launchWorld, this.primaryBg);
  }

  // -- Play expand / Kino glide transition (task 9.8; Req 20.36-20.38, 20.12) --

  /**
   * Run the Play/Continue launch transition, then hand off to GameplayScene.
   *
   * Choreography (design: "Play-button expand transition (Req 20.36–20.38,
   * 20.12)"), all timing + math from the PURE `core` helpers:
   *   1. EXPAND the pressed control as a color fill growing UPWARD from its top
   *      edge until it covers the entire screen (Req 20.36). A dedicated fill
   *      rectangle is grown with the shared smoothstep easing so its TOP rises
   *      while its BOTTOM stays pinned at the screen bottom (grows upward).
   *   2. FADE IN the gameplay HUD controls + World background (Req 20.37). We
   *      have no live run yet, so a placeholder HUD/background layer fades in
   *      over the fill as the stand-in the real GameplayScene replaces on
   *      hand-off; this keeps the ordered 20.37 beat visible.
   *   3. GLIDE the persistent Kino sprite from its menu position to the fixed
   *      run start position on the LEFT and stabilize (Req 20.38, 20.12), using
   *      `computeRunStartPosition` so it lands exactly where GameplayScene seeds
   *      Kino (no jump at hand-off). Kino is kept placed the whole time.
   * On completion, hand off to GameplayScene via the existing seam.
   *
   * Idempotent per screen: once started, further presses are ignored until the
   * scene changes.
   */
  private beginLaunchTransition(
    world: number,
    originControl: Phaser.GameObjects.Rectangle,
  ): void {
    if (this.transitioning) return;
    this.transitioning = true;

    const { width, height } = this.scale.gameSize;
    const timing = resolvePlayTransitionTiming();

    // Disable further menu input during the transition.
    this.input.enabled = false;

    // The fill color is the pressed control's current fill so the expand reads
    // as "that button growing"; default to the warm panel color if unavailable.
    const fillColor =
      (originControl.fillColor as number | undefined) ?? 0xf5e6c8;

    // Color-fill rectangle anchored at the control's TOP edge, origin at the
    // bottom so growing its height makes the TOP rise (grows UPWARD, Req 20.36).
    const originTop = originControl.y - originControl.height / 2;
    const fill = this.add
      .rectangle(width / 2, originTop, width, 0, fillColor)
      .setOrigin(0.5, 1)
      .setDepth(100);

    // The distance the fill must rise to cover the whole screen (its bottom is
    // pinned at the control top, so it must reach up past y=0).
    const fillTargetHeight = originTop;

    // Phase 1 — expand upward to full-screen cover (Req 20.36).
    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: timing.expandMs,
      onUpdate: (tw) => {
        fill.height = glideScalar(0, fillTargetHeight, tw.getValue() ?? 0);
      },
      onComplete: () => {
        // Ensure a full, gap-free cover at the end of the expand.
        fill.setPosition(width / 2, height).setSize(width, height);
        this.fadeInRunStage(world, timing, fillColor);
      },
    });
  }

  /**
   * Phase 2 of the launch transition: once the color fill covers the screen,
   * fade in a placeholder HUD + World background layer (Req 20.37). With no
   * live run yet this stands in for the real GameplayScene stage so the ordered
   * fade beat is visible; GameplayScene replaces it on hand-off.
   */
  private fadeInRunStage(
    world: number,
    timing: ReturnType<typeof resolvePlayTransitionTiming>,
    fillColor: number,
  ): void {
    const { width, height } = this.scale.gameSize;

    // Placeholder World background (a darker stage) under a thin HUD bar; both
    // start transparent and fade in together (Req 20.37).
    const background = this.add
      .rectangle(width / 2, height / 2, width, height, 0x10151d)
      .setDepth(101)
      .setAlpha(0);
    const hudBar = this.add
      .rectangle(width / 2, 24, width, 48, fillColor)
      .setDepth(103)
      .setAlpha(0);

    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: timing.fadeMs,
      onUpdate: (tw) => {
        const a = glideScalar(0, 1, tw.getValue() ?? 0);
        background.setAlpha(a);
        hudBar.setAlpha(a);
      },
      onComplete: () => this.glideKinoToStart(world, timing, background),
    });
  }

  /**
   * Phase 3 of the launch transition: glide the persistent Kino sprite from its
   * menu position to the fixed run start position on the left where it
   * stabilizes (Req 20.38, 20.12), then hand off to GameplayScene. The target
   * comes from the PURE `computeRunStartPosition` so Kino lands exactly where
   * the run seeds it. Kino is lifted above the stage so it stays visible during
   * the glide — it is "kept placed" (the SAME object moves).
   */
  private glideKinoToStart(
    world: number,
    timing: ReturnType<typeof resolvePlayTransitionTiming>,
    background: Phaser.GameObjects.Rectangle,
  ): void {
    const { width, height } = this.scale.gameSize;
    const kino = this.kinoSprite ?? this.kinoPlaceholder;

    const to = computeRunStartPosition({ width, height });
    const from = this.kinoMenuPos;

    // No Kino object to move (defensive) — go straight to hand-off.
    if (!kino) {
      this.launchLockedInWorld(world);
      return;
    }

    // Keep Kino visible above the faded-in stage while it glides.
    kino.setDepth(102);

    this.tweens.addCounter({
      from: 0,
      to: 1,
      duration: timing.glideMs,
      onUpdate: (tw) => {
        const p = computeGlide(from, to, tw.getValue() ?? 0);
        kino.x = p.x;
        kino.y = p.y;
      },
      onComplete: () => {
        // Stabilize exactly at the run start, then hand off to the run.
        kino.x = to.x;
        kino.y = to.y;
        // Touch `background` so a future tweak keeps the stage reference alive;
        // the hand-off starts GameplayScene which renders its own stage.
        background.setVisible(true);
        this.launchLockedInWorld(world);
      },
    });
  }

  // -- endless-mode trigger confirmation (task 9.3; Req 20.31, 23.5) --------

  /**
   * Show the Endless_Mode confirmation for `world` (Req 20.31, 23.5): a modal
   * prompt stating that Endless_Mode is OUTSIDE story progression, with a
   * Confirm and a Cancel action. On Confirm, launch that world in ENDLESS mode
   * (Req 23.1); Cancel just dismisses. The prompt is a self-contained overlay
   * group drawn above the map so it never disturbs the menu layout — on either
   * choice the whole group is destroyed and the menu is untouched.
   *
   * World 5 has no endless run (Req 23.2); its (cleared) triangle is still
   * active per Req 20.31, but a confirm there cannot launch endless, so the
   * prompt copy notes it and the Confirm action is withheld.
   */
  private promptEndlessConfirmation(world: WorldId): void {
    if (this.endlessPrompt) return; // one prompt at a time
    const { width, height } = this.scale.gameSize;
    const cx = width / 2;
    const cy = height / 2;
    const canEndless = supportsEndless(world);

    const group = this.add.container(0, 0).setDepth(200);
    this.endlessPrompt = group;

    // Dim scrim behind the dialog so it reads as modal; a click on the scrim
    // (outside the dialog) cancels.
    const scrim = this.add
      .rectangle(cx, cy, width, height, 0x000000, 0.6)
      .setOrigin(0.5, 0.5)
      .setInteractive();
    scrim.on('pointerup', () => this.dismissEndlessPrompt());
    group.add(scrim);

    const panelW = Math.min(width * 0.8, 520);
    const panelH = 220;
    const panel = this.add
      .rectangle(cx, cy, panelW, panelH, 0x1f2733)
      .setOrigin(0.5, 0.5)
      .setStrokeStyle(2, 0xffd24a);
    group.add(panel);

    const message = canEndless
      ? `Endless Mode (World ${world})\n\nEndless Mode is outside story progression.\nIt awards no story progress, unlocks, perks, or cosmetics.`
      : `Endless Mode (World ${world})\n\nWorld ${world} has no Endless Mode.`;
    const text = this.add
      .text(cx, cy - 40, message, {
        fontFamily: 'monospace',
        fontSize: '18px',
        color: '#cfd8e3',
        align: 'center',
        wordWrap: { width: panelW - 40 },
      })
      .setOrigin(0.5, 0.5);
    group.add(text);

    // Cancel is always available; Confirm only when endless is supported.
    const cancel = this.addPromptButton(cx + 90, cy + 70, 'Cancel', () =>
      this.dismissEndlessPrompt(),
    );
    group.add(cancel.bg);
    group.add(cancel.text);

    if (canEndless) {
      const confirm = this.addPromptButton(cx - 90, cy + 70, 'Confirm', () => {
        this.dismissEndlessPrompt();
        this.launchLockedInWorld(world, 'endless');
      });
      group.add(confirm.bg);
      group.add(confirm.text);
    }
  }

  /** Destroy the open Endless_Mode confirmation overlay, if any. */
  private dismissEndlessPrompt(): void {
    if (!this.endlessPrompt) return;
    this.endlessPrompt.destroy(true);
    this.endlessPrompt = null;
  }

  /**
   * A tiny labeled button for the confirmation overlay. Returns the background
   * + label so the caller can add both to the prompt container (so they are
   * destroyed together when the prompt closes).
   */
  private addPromptButton(
    x: number,
    y: number,
    label: string,
    onPress: () => void,
  ): { bg: Phaser.GameObjects.Rectangle; text: Phaser.GameObjects.Text } {
    const text = this.add
      .text(x, y, label, {
        fontFamily: 'monospace',
        fontSize: '22px',
        color: '#0b0f16',
      })
      .setOrigin(0.5, 0.5)
      .setDepth(1);
    const bg = this.add
      .rectangle(x, y, text.width + 40, text.height + 20, 0xf5e6c8)
      .setOrigin(0.5, 0.5)
      .setInteractive({ useHandCursor: true });
    text.setDepth(bg.depth + 1);
    bg.on('pointerover', () => bg.setFillStyle(0xffffff));
    bg.on('pointerout', () => bg.setFillStyle(0xf5e6c8));
    bg.on('pointerup', () => onPress());
    return { bg, text };
  }

  /**
   * Launch the given World (Req 20.35, 34.2) in STORY (`jumping`) mode by
   * default, or in ENDLESS mode when `mode` is `'endless'` (Req 23.1, selected
   * via a world's endless triangle). GameplayScene (task 4.6) registers under
   * GAMEPLAY_SCENE_KEY in main.ts; if it is present we start it, otherwise we
   * log a clear seam rather than crash.
   *
   * The launch data mirrors the design run contract: `{ world, mode }`, where
   * `mode` carries the ENDLESS flag so the run skips every story side-effect
   * (Req 23.6) via the pure `endlessMode` config the run builds from it.
   */
  private launchLockedInWorld(
    world: number,
    mode: 'story' | 'endless' = 'story',
  ): void {
    const data =
      mode === 'endless'
        ? { world, mode: 'endless' as const }
        : { world, mode: 'jumping' as const };

    if (this.scene.get(GAMEPLAY_SCENE_KEY)) {
      this.scene.start(GAMEPLAY_SCENE_KEY, data);
      return;
    }

    // Seam for task 4.6: GameplayScene not registered yet.
    console.info(
      `[KINO][MainMenu] Play/Start pressed; would launch World ${world} (${JSON.stringify(
        data,
      )}). '${GAMEPLAY_SCENE_KEY}' scene not registered yet (task 4.6).`,
    );
  }
}

/**
 * Parse a `#RRGGBB` hex color string to the 0xRRGGBB number Phaser wants.
 * Tolerates a missing leading '#'. Falls back to white on a malformed value so
 * a placeholder is always visible.
 */
function hexToNumber(hex: string): number {
  const cleaned = hex.replace('#', '').trim();
  const parsed = Number.parseInt(cleaned, 16);
  return Number.isNaN(parsed) ? 0xffffff : parsed;
}

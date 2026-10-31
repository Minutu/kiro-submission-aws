// Skills (super powers) — one is equipped at a time, chosen on the menu.
//
// Three skills, each with a 10s cooldown, activated in-game with right-click or
// Q:
//   - time-slow:      the world runs slower for 4 seconds.
//   - second-chance:  Kino phases through the next 4 obstacles (hits negated),
//                     then the effect ends.
//   - ultra-instinct: for 4 seconds, any collision teleports Kino to a safe
//                     position along the x-axis instead of ending the run.
//
// This module owns the EQUIPPED selection + persistence. The in-run behavior
// (cooldown, active timers, HUD) lives in SkillRuntime below so every gameplay
// scene drives it the same way.

import Phaser from 'phaser';

export type SkillId = 'time-slow' | 'second-chance' | 'ultra-instinct';

export interface Skill {
  id: SkillId;
  label: string;
  /** Short name shown inside the HUD circle. */
  short: string;
  color: number;
}

export const SKILLS: Skill[] = [
  { id: 'time-slow', label: 'Time Slow', short: 'SLOW', color: 0x3fa7ff },
  { id: 'second-chance', label: 'Second Chance', short: '2ND', color: 0x2ecc71 },
  { id: 'ultra-instinct', label: 'Ultra Instinct', short: 'ULTRA', color: 0xffd166 },
];

const STORAGE_KEY = 'kino.skill';

let equippedId: SkillId | null = loadEquipped();

function loadEquipped(): SkillId | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null || raw === '') return null;
    return SKILLS.some((s) => s.id === raw) ? (raw as SkillId) : null;
  } catch {
    return null;
  }
}

export function getEquippedSkill(): Skill | null {
  if (equippedId === null) return null;
  return SKILLS.find((s) => s.id === equippedId) ?? null;
}

export function setEquippedSkill(id: SkillId | null): void {
  equippedId = id;
  try {
    window.localStorage.setItem(STORAGE_KEY, id ?? '');
  } catch {
    // ignore storage failures
  }
}

// ---------------------------------------------------------------------------
// In-run runtime: cooldown, active effect timers, and the bottom-left HUD.
// ---------------------------------------------------------------------------

const COOLDOWN_MS = 10_000;
const TIME_SLOW_MS = 4_000;
const TIME_SLOW_SCALE = 0.4; // world runs at 40% speed while slowed
const ULTRA_MS = 4_000;
const SECOND_CHANCE_WINDOW_MS = 3_000; // window to catch the first hit

export class SkillRuntime {
  private readonly skill: Skill | null;

  // Cooldown: ms remaining until the skill can be used again (0 = ready).
  private cooldownLeft = 0;

  // time-slow
  private slowLeft = 0;
  // ultra-instinct
  private ultraLeft = 0;

  // second-chance state machine:
  //   'idle'     — not active.
  //   'armed'    — window open, waiting to catch the first object hit.
  //   'phasing'  — an object was hit; phase through it until it clears.
  private phaseState: 'idle' | 'armed' | 'phasing' = 'idle';
  private phaseWindowLeft = 0; // ms left in the armed window

  // HUD objects.
  private hudGlow!: Phaser.GameObjects.Arc;
  private hudBase!: Phaser.GameObjects.Arc; // dim full disc (always shown)
  private hudPie!: Phaser.GameObjects.Graphics; // bright wedge revealing over cooldown
  private hudRing!: Phaser.GameObjects.Arc; // white outline
  private hudText!: Phaser.GameObjects.Text;
  private hudX = 0;
  private hudY = 0;
  private hudR = 52;

  /**
   * @param scene the owning scene
   * @param canActivate returns true only when a skill may be used right now
   *   (run started AND not paused). Activation is blocked otherwise.
   */
  constructor(
    private readonly scene: Phaser.Scene,
    private readonly canActivate: () => boolean = () => true,
  ) {
    this.skill = getEquippedSkill();
    this.buildHud();
    this.bindInput();
  }

  // -- HUD -----------------------------------------------------------------

  private buildHud(): void {
    const cam = this.scene.cameras.main;
    this.hudX = 80;
    this.hudY = cam.height - 80;
    this.hudR = 52;
    const { hudX: x, hudY: y, hudR: r } = this;
    const color = this.skill ? this.skill.color : 0x555555;

    // Glow (behind), dim base disc, bright pie wedge, white ring, label.
    this.hudGlow = this.scene.add.circle(x, y, r + 8, color, 0).setDepth(40);
    this.hudBase = this.scene.add.circle(x, y, r, color, 0.22).setDepth(41);
    this.hudPie = this.scene.add.graphics().setDepth(42);
    this.hudRing = this.scene.add
      .circle(x, y, r, 0x000000, 0)
      .setStrokeStyle(3, 0xffffff)
      .setDepth(43);
    this.hudText = this.scene.add
      .text(x, y, this.skill ? this.skill.short : '—', {
        fontFamily: 'sans-serif',
        fontSize: '22px',
        color: '#ffffff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5)
      .setDepth(44);

    this.refreshHud();
  }

  /**
   * Fraction (0..1) of the active skill duration REMAINING, or null if no skill
   * effect is currently active. For Second Chance the "duration" is the armed
   * window; once it latches onto an object (phasing) the duration is open-ended
   * so we report a full bar.
   */
  private activeRemaining(): number | null {
    if (this.slowLeft > 0) return this.slowLeft / TIME_SLOW_MS;
    if (this.ultraLeft > 0) return this.ultraLeft / ULTRA_MS;
    if (this.phaseState === 'armed') return this.phaseWindowLeft / SECOND_CHANCE_WINDOW_MS;
    if (this.phaseState === 'phasing') return 1;
    return null;
  }

  /** Draw a wedge from the top (-90deg) sweeping clockwise by `frac` (0..1). */
  private drawWedge(frac: number, color: number, alpha: number): void {
    const start = -Math.PI / 2;
    this.hudPie.fillStyle(color, alpha);
    if (frac >= 1) {
      this.hudPie.fillCircle(this.hudX, this.hudY, this.hudR);
    } else if (frac > 0) {
      this.hudPie.beginPath();
      this.hudPie.moveTo(this.hudX, this.hudY);
      this.hudPie.arc(this.hudX, this.hudY, this.hudR, start, start + frac * Math.PI * 2, false);
      this.hudPie.closePath();
      this.hudPie.fillPath();
    }
  }

  /**
   * Redraw the HUD with three visual states:
   *   - ACTIVE: skill effect running — a bright wedge that DRAINS as the
   *     duration runs out, plus the glow on, so it reads as "in use now".
   *   - COOLDOWN: a wedge that FILLS from empty as the skill recharges.
   *   - READY: full wedge + steady glow.
   */
  private refreshHud(): void {
    this.hudPie.clear();
    if (!this.skill) {
      this.hudBase.setAlpha(0.18);
      this.hudGlow.setFillStyle(0x555555, 0);
      this.hudText.setAlpha(0.4);
      return;
    }

    const active = this.activeRemaining();
    if (active !== null) {
      // Active: brighter base + draining wedge + glow pulsing on.
      this.hudGlow.setFillStyle(0xffffff, 0.5);
      this.drawWedge(active, 0xffffff, 0.9);
      this.hudText.setAlpha(1);
      return;
    }

    const ready = this.cooldownLeft <= 0;
    const progress = ready ? 1 : 1 - this.cooldownLeft / COOLDOWN_MS; // fills 0->1
    this.drawWedge(progress, this.skill.color, 1);
    this.hudText.setAlpha(ready ? 1 : 0.6);
    // Glow only when fully ready.
    this.hudGlow.setFillStyle(this.skill.color, ready ? 0.4 : 0);
  }

  // -- input ---------------------------------------------------------------

  private bindInput(): void {
    const activate = () => this.activate();
    this.scene.input.keyboard?.on('keydown-Q', activate);
    // Right-click. Disable the browser context menu so it doesn't pop up.
    this.scene.input.mouse?.disableContextMenu();
    this.scene.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.rightButtonDown()) activate();
    });
  }

  private activate(): void {
    if (!this.skill || this.cooldownLeft > 0) return;
    // Cannot use skills before the run has started or while paused.
    if (!this.canActivate()) return;
    // Cannot re-trigger while an effect is already active (cooldown is 0 during
    // the effect now, so guard against double-activation explicitly).
    if (this.activeRemaining() !== null) return;

    // Cooldown does NOT start on use — it begins only once the active effect
    // has fully ended (see tick / notifyPhasedObjectCleared).
    switch (this.skill.id) {
      case 'time-slow':
        this.slowLeft = TIME_SLOW_MS;
        break;
      case 'ultra-instinct':
        this.ultraLeft = ULTRA_MS;
        break;
      case 'second-chance':
        // Open a 3s window to catch the first hit. Cooldown does NOT start yet
        // — it begins once the phased object is fully cleared (or the window
        // expires unused).
        this.phaseState = 'armed';
        this.phaseWindowLeft = SECOND_CHANCE_WINDOW_MS;
        break;
    }
    this.refreshHud();
  }

  // -- per-frame -----------------------------------------------------------

  /**
   * Advance timers by the REAL frame delta (ms). Returns the time scale the
   * scene should apply to its own motion this frame (1 normally, slower while
   * time-slow is active).
   */
  tick(deltaMs: number): number {
    // Track whether anything is animating so we can redraw the HUD each frame.
    let animating = this.cooldownLeft > 0 || this.activeRemaining() !== null;

    if (this.cooldownLeft > 0) {
      this.cooldownLeft = Math.max(0, this.cooldownLeft - deltaMs);
    }
    if (this.slowLeft > 0) {
      this.slowLeft = Math.max(0, this.slowLeft - deltaMs);
      if (this.slowLeft === 0) {
        // Effect just ended -> start cooldown now.
        this.cooldownLeft = COOLDOWN_MS;
        animating = true;
      }
    }
    if (this.ultraLeft > 0) {
      this.ultraLeft = Math.max(0, this.ultraLeft - deltaMs);
      if (this.ultraLeft === 0) {
        this.cooldownLeft = COOLDOWN_MS;
        animating = true;
      }
    }
    // Second Chance armed window: if it expires with no hit caught, the skill
    // ends and the cooldown begins.
    if (this.phaseState === 'armed') {
      this.phaseWindowLeft = Math.max(0, this.phaseWindowLeft - deltaMs);
      if (this.phaseWindowLeft === 0) {
        this.phaseState = 'idle';
        this.cooldownLeft = COOLDOWN_MS;
        animating = true;
      }
    }

    if (animating) this.refreshHud();
    return this.slowLeft > 0 ? TIME_SLOW_SCALE : 1;
  }

  // -- collision hooks (called by the scene) --------------------------------

  /**
   * Called by the scene when an OBSTACLE hit occurs. Returns true if the hit
   * should be negated (phased through):
   *   - 'armed': the first hit latches phasing on this object -> 'phasing'.
   *   - 'phasing': keep phasing through the SAME object across frames.
   * Returns false otherwise (normal death).
   */
  tryPhase(): boolean {
    if (this.phaseState === 'armed') {
      this.phaseState = 'phasing';
      return true;
    }
    return this.phaseState === 'phasing';
  }

  /** True while a Second Chance phase is active (armed or phasing). */
  isPhaseActive(): boolean {
    return this.phaseState !== 'idle';
  }

  /**
   * Called by the scene when the object being phased through has been fully
   * cleared (Kino no longer overlaps any obstacle). Ends Second Chance and
   * starts its cooldown.
   */
  notifyPhasedObjectCleared(): void {
    if (this.phaseState === 'phasing') {
      this.phaseState = 'idle';
      this.cooldownLeft = COOLDOWN_MS;
      this.refreshHud();
    }
  }

  /** True while Ultra Instinct is active. */
  isUltraActive(): boolean {
    return this.ultraLeft > 0;
  }

  /** No-op kept for scenes that call it on scoring. */
  notifyObstacleCleared(): void {
    // intentionally empty
  }

  destroy(): void {
    this.hudGlow.destroy();
    this.hudBase.destroy();
    this.hudPie.destroy();
    this.hudRing.destroy();
    this.hudText.destroy();
  }
}

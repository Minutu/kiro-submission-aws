// World progression — which worlds are unlocked, persisted to localStorage.
//
// World 1 is unlocked from the start. Reaching UNLOCK_SCORE points in a world
// unlocks the next world (World N -> World N+1). Unlocks persist across
// sessions.

const STORAGE_KEY = 'kino.unlockedWorlds';
export const TOTAL_WORLDS = 5;
export const UNLOCK_SCORE = 3; // lowered for quick testing (was 15)

/** Highest unlocked world index (1..5). At least 1. */
let maxUnlocked: number = load();

function load(): number {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const n = raw ? parseInt(raw, 10) : 1;
    if (Number.isFinite(n)) return Math.min(TOTAL_WORLDS, Math.max(1, n));
    return 1;
  } catch {
    return 1;
  }
}

function save(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, String(maxUnlocked));
  } catch {
    // ignore storage failures; value still applies for the session
  }
}

/** World number (1-based) a scene key maps to, e.g. 'World3' -> 3. */
export function worldNumberFromKey(sceneKey: string): number {
  const m = /World(\d+)/.exec(sceneKey);
  return m ? parseInt(m[1]!, 10) : 1;
}

export function isWorldUnlocked(worldNumber: number): boolean {
  return worldNumber <= maxUnlocked;
}

// --- cosmetic & skill ownership --------------------------------------------
//
// Cosmetics (hats) and skills are earned by BEATING worlds, and once earned
// they stay owned FOREVER — including across generation resets. So they are
// tracked as independent high-water counts, never reset by completeGeneration.
//
// Grant schedule (by the world just beaten, i.e. maxUnlocked reaching N+1):
//   beat World 1 -> 1 cosmetic,            0 skills
//   beat World 2 -> 2 cosmetics,           1 skill
//   beat World 3 -> 3 cosmetics,           2 skills
//   beat World 4 -> 4 cosmetics (all),     3 skills (all)
// Equivalently: cosmetics = clamp(maxUnlocked-1, 0..4),
//               skills    = clamp(maxUnlocked-2, 0..3).

export const MAX_COSMETICS = 4;
export const MAX_SKILLS = 3;

const OWNED_COSMETICS_KEY = 'kino.ownedCosmetics';
const OWNED_SKILLS_KEY = 'kino.ownedSkills';

let ownedCosmetics: number = loadCount(OWNED_COSMETICS_KEY, MAX_COSMETICS);
let ownedSkills: number = loadCount(OWNED_SKILLS_KEY, MAX_SKILLS);

// Backfill for players whose worlds were unlocked before rewards existed: raise
// the owned counts to match current progress on load (silent, no toast).
backfillOwnedCounts();
function backfillOwnedCounts(): void {
  const targetCosmetics = Math.min(MAX_COSMETICS, Math.max(0, maxUnlocked - 1));
  const targetSkills = Math.min(MAX_SKILLS, Math.max(0, maxUnlocked - 2));
  if (targetCosmetics > ownedCosmetics) {
    ownedCosmetics = targetCosmetics;
    saveCount(OWNED_COSMETICS_KEY, ownedCosmetics);
  }
  if (targetSkills > ownedSkills) {
    ownedSkills = targetSkills;
    saveCount(OWNED_SKILLS_KEY, ownedSkills);
  }
}

function loadCount(key: string, max: number): number {
  try {
    const raw = window.localStorage.getItem(key);
    const n = raw ? parseInt(raw, 10) : 0;
    if (Number.isFinite(n)) return Math.min(max, Math.max(0, n));
    return 0;
  } catch {
    return 0;
  }
}

function saveCount(key: string, value: number): void {
  try {
    window.localStorage.setItem(key, String(value));
  } catch {
    // ignore storage failures
  }
}

/** Number of cosmetics (hats) the player owns, in HATS list order. */
export function getOwnedCosmeticCount(): number {
  return ownedCosmetics;
}

/** Number of skills the player owns, in SKILLS list order. */
export function getOwnedSkillCount(): number {
  return ownedSkills;
}

/**
 * Raise the owned cosmetic/skill counts to reflect everything earned by the
 * current `maxUnlocked` (counts only ever increase — persist across
 * generations). Returns whether a NEW cosmetic and/or skill was just granted,
 * so the caller can show a "new unlock" notification.
 */
export function syncRewardsForProgress(): { newCosmetic: boolean; newSkill: boolean } {
  const targetCosmetics = Math.min(MAX_COSMETICS, Math.max(0, maxUnlocked - 1));
  const targetSkills = Math.min(MAX_SKILLS, Math.max(0, maxUnlocked - 2));

  const newCosmetic = targetCosmetics > ownedCosmetics;
  const newSkill = targetSkills > ownedSkills;

  if (newCosmetic) {
    ownedCosmetics = targetCosmetics;
    saveCount(OWNED_COSMETICS_KEY, ownedCosmetics);
  }
  if (newSkill) {
    ownedSkills = targetSkills;
    saveCount(OWNED_SKILLS_KEY, ownedSkills);
  }
  return { newCosmetic, newSkill };
}

// --- generations -----------------------------------------------------------
//
// Each generation starts with only World 1 playable and the name "Kiro Junior
// N". Once World 1 is beaten (World 2 unlocks), the name upgrades to "Kiro N".
// Beating World 5 (end credits) ends the generation: everything re-locks and
// the generation increments, so the next one starts as "Kiro Junior N+1".

const GENERATION_KEY = 'kino.generation';

let generation: number = loadGeneration();

function loadGeneration(): number {
  try {
    const raw = window.localStorage.getItem(GENERATION_KEY);
    const n = raw ? parseInt(raw, 10) : 1;
    return Number.isFinite(n) && n >= 1 ? n : 1;
  } catch {
    return 1;
  }
}

function saveGeneration(): void {
  try {
    window.localStorage.setItem(GENERATION_KEY, String(generation));
  } catch {
    // ignore
  }
}

export function getGeneration(): number {
  return generation;
}

/** The display name shown on the menu: "Kiro Junior N" until World 1 is beaten
 * this generation, then "Kiro N". */
export function getKiroDisplayName(): string {
  const beatenWorld1 = maxUnlocked >= 2;
  return beatenWorld1 ? `Kiro ${generation}` : `Kiro Junior ${generation}`;
}

/** End the current generation (after beating World 5): re-lock all worlds and
 * advance to the next generation. The next run starts as "Kiro Junior N+1". */
export function completeGeneration(): void {
  generation += 1;
  saveGeneration();
  maxUnlocked = 1;
  save();
}

// --- one-time "new button appeared" highlight ------------------------------
//
// The Cosmetics button appears once the player owns >=1 cosmetic (after beating
// World 1); the Skills button once they own >=1 skill (after World 2). The
// FIRST time each becomes visible on the menu it pulses for a moment to draw
// the eye; after that it never highlights again. Persisted so it's truly once.

const HILITE_COSMETICS_KEY = 'kino.seenCosmeticsBtn';
const HILITE_SKILLS_KEY = 'kino.seenSkillsBtn';

function getFlag(key: string): boolean {
  try { return window.localStorage.getItem(key) === '1'; } catch { return false; }
}
function setFlag(key: string): void {
  try { window.localStorage.setItem(key, '1'); } catch { /* ignore */ }
}

/** Should the Cosmetics button play its one-time appear-highlight now? Returns
 * true at most once (marks itself seen). Only true when the button is actually
 * available (>=1 cosmetic owned). */
export function consumeCosmeticsButtonHighlight(): boolean {
  if (ownedCosmetics < 1) return false;
  if (getFlag(HILITE_COSMETICS_KEY)) return false;
  setFlag(HILITE_COSMETICS_KEY);
  return true;
}

/** Same as above for the Skills button (>=1 skill owned). */
export function consumeSkillsButtonHighlight(): boolean {
  if (ownedSkills < 1) return false;
  if (getFlag(HILITE_SKILLS_KEY)) return false;
  setFlag(HILITE_SKILLS_KEY);
  return true;
}

// --- first-boot (opening cinematic) ----------------------------------------

const SEEN_INTRO_KEY = 'kino.seenIntro';

/** True if the opening cinematic has already been shown (persisted). */
export function hasSeenIntro(): boolean {
  try {
    return window.localStorage.getItem(SEEN_INTRO_KEY) === '1';
  } catch {
    return false;
  }
}

/** Mark the opening cinematic as seen so it won't replay on future boots. */
export function markIntroSeen(): void {
  try {
    window.localStorage.setItem(SEEN_INTRO_KEY, '1');
  } catch {
    // ignore
  }
}

/**
 * Report a score reached while playing `worldNumber`. If it reaches the unlock
 * threshold and the next world was still locked, unlock it and return the newly
 * unlocked world number (so the caller can show a toast). Otherwise null.
 */
export function reportScore(worldNumber: number, score: number): number | null {
  if (score < UNLOCK_SCORE) return null;
  const next = worldNumber + 1;
  if (next > TOTAL_WORLDS) return null;
  if (next <= maxUnlocked) return null; // already unlocked
  maxUnlocked = next;
  save();
  return next;
}

// ---------------------------------------------------------------------------
// In-game unlock toast
// ---------------------------------------------------------------------------

import Phaser from 'phaser';

/**
 * Report the current score for a scene's world and, if it newly unlocks the
 * next world, show a brief toast. Safe to call every time the score changes;
 * the unlock (and thus the toast) only fires once.
 */
export function maybeUnlockAndToast(
  scene: Phaser.Scene,
  worldNumber: number,
  score: number,
): void {
  const unlocked = reportScore(worldNumber, score);
  if (unlocked === null) return;

  // The last world unlocks with special "FINAL WORLD" styling (bright red to
  // match the menu's final-world button) instead of the usual green toast.
  const isFinal = unlocked >= TOTAL_WORLDS;
  const label = isFinal ? 'FINAL WORLD unlocked!' : `World ${unlocked} unlocked!`;
  const fillCol = isFinal ? 0x8a0f24 : 0x1b6e36;
  const strokeCol = isFinal ? 0xff3b6b : 0x7fff9f;

  const cam = scene.cameras.main;
  const y0 = 150;
  const toast = scene.add.container(cam.width / 2, y0).setDepth(100);
  const bg = scene.add
    .rectangle(0, 0, 520, 72, fillCol, 0.95)
    .setStrokeStyle(3, strokeCol);
  const txt = scene.add
    .text(0, 0, label, {
      fontFamily: 'sans-serif', fontSize: '30px', color: '#ffffff', fontStyle: 'bold',
    })
    .setOrigin(0.5);
  toast.add([bg, txt]);

  // Slide/fade in, hold, then fade out and destroy.
  toast.setAlpha(0);
  scene.tweens.add({ targets: toast, alpha: 1, y: y0 + 10, duration: 250, ease: 'Quad.out' });
  scene.time.delayedCall(2200, () => {
    scene.tweens.add({
      targets: toast, alpha: 0, duration: 400,
      onComplete: () => toast.destroy(),
    });
  });

  // Beating this world also grants cosmetics/skills. Grant them now and, if
  // something new was earned, show a second toast right below the first.
  const reward = syncRewardsForProgress();
  if (reward.newCosmetic || reward.newSkill) {
    const msg = reward.newCosmetic && reward.newSkill
      ? 'A new cosmetic and skill are available!'
      : reward.newCosmetic
        ? 'A new cosmetic is available!'
        : 'A new skill is available!';
    showRewardToast(scene, msg);
  }
}

/** A second toast (purple/indigo) shown just below the world-unlock toast to
 * announce a newly earned cosmetic/skill. Slightly delayed so it reads as a
 * follow-up beat. */
function showRewardToast(scene: Phaser.Scene, message: string): void {
  const cam = scene.cameras.main;
  const y0 = 238; // just below the world-unlock toast (which sits at y=150..)
  const toast = scene.add.container(cam.width / 2, y0).setDepth(100).setAlpha(0);
  const bg = scene.add
    .rectangle(0, 0, 560, 64, 0x3a2a7a, 0.95)
    .setStrokeStyle(3, 0xb6a8ff);
  const txt = scene.add
    .text(0, 0, message, {
      fontFamily: 'sans-serif', fontSize: '26px', color: '#ffffff', fontStyle: 'bold',
    })
    .setOrigin(0.5);
  toast.add([bg, txt]);

  // Appear a touch after the unlock toast, hold, then fade out.
  scene.time.delayedCall(450, () => {
    scene.tweens.add({ targets: toast, alpha: 1, y: y0 + 10, duration: 250, ease: 'Quad.out' });
  });
  scene.time.delayedCall(2900, () => {
    scene.tweens.add({
      targets: toast, alpha: 0, duration: 400,
      onComplete: () => toast.destroy(),
    });
  });
}

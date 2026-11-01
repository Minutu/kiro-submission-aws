// Background music — one looping track played quietly across the WHOLE game.
//
// The track is owned by the game-level sound manager (not any single scene), so
// it keeps playing uninterrupted through every scene change. It is started once
// on the first user interaction (browsers block autoplay until a gesture), and
// subsequent start calls are no-ops.

import Phaser from 'phaser';

export const MUSIC_KEY = 'game-music';
const MUSIC_PATH = 'assets/Audio/game-music.mp3';
/** Very quiet background level — barely audible. */
const MUSIC_VOLUME = 0.015;

export const JUMP_SFX_KEY = 'sfx-jump';
const JUMP_SFX_PATH = 'assets/jump.wav';
/** Quiet SFX level for the action/jump sound. */
const JUMP_SFX_VOLUME = 0.25;

/** Queue the jump SFX for loading. Safe to call from any scene's preload(). */
export function loadJumpSfx(scene: Phaser.Scene): void {
  if (!scene.cache.audio.exists(JUMP_SFX_KEY)) {
    scene.load.audio(JUMP_SFX_KEY, JUMP_SFX_PATH);
  }
}

/** Play the jump/action SFX quietly (honors the global mute). */
export function playJumpSfx(scene: Phaser.Scene): void {
  if (!scene.cache.audio.exists(JUMP_SFX_KEY)) return;
  scene.sound.play(JUMP_SFX_KEY, { volume: JUMP_SFX_VOLUME });
}

const MUTE_KEY = 'kino.muted';

let sound: Phaser.Sound.BaseSound | null = null;

/** Read the persisted mute state (defaults to NOT muted). */
export function isMuted(): boolean {
  try { return window.localStorage.getItem(MUTE_KEY) === '1'; } catch { return false; }
}

/** Apply mute state to the WHOLE game (music + SFX) and persist it. */
export function setMuted(scene: Phaser.Scene, muted: boolean): void {
  scene.sound.mute = muted;
  try { window.localStorage.setItem(MUTE_KEY, muted ? '1' : '0'); } catch { /* ignore */ }
}

/** Flip and apply the mute state; returns the new state. */
export function toggleMuted(scene: Phaser.Scene): boolean {
  const next = !isMuted();
  setMuted(scene, next);
  return next;
}

/** Queue the music file for loading. Safe to call from any scene's preload();
 * only loads once. */
export function loadMusic(scene: Phaser.Scene): void {
  if (!scene.cache.audio.exists(MUSIC_KEY)) {
    scene.load.audio(MUSIC_KEY, MUSIC_PATH);
  }
}

/**
 * Start the looping background music if it isn't already playing. Uses the
 * game-level sound manager so it persists across scene transitions. Call after
 * a user gesture (e.g. the first click) so the browser allows audio.
 */
export function startMusic(scene: Phaser.Scene): void {
  if (sound && sound.isPlaying) return;
  if (!scene.cache.audio.exists(MUSIC_KEY)) return;

  // Reuse the existing instance if we've already created it (e.g. it was paused
  // by an autoplay block); otherwise create it on the global manager.
  if (!sound) {
    sound = scene.sound.add(MUSIC_KEY, { loop: true, volume: MUSIC_VOLUME });
  }
  if (!sound.isPlaying) sound.play();
}

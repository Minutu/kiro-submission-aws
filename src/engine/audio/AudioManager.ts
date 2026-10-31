// Feature: kino-game
//
// AudioManager — the THIN Phaser/WebAudio PLAYBACK layer behind the audio
// system (task 12.1; design: "Audio"; Req 25.1-25.9). Every GATING / POLICY
// decision lives in the pure `core.createAudioPolicy` state machine; this class
// owns only the real Sound objects and the browser plumbing:
//
//   - AUTOPLAY UNLOCK (Req 25.9): the browser blocks audio until a user
//     gesture, so this wires `onUserInteraction()` to the first real pointer /
//     key event. Before that the policy returns 'queued' for every play
//     request and this class plays NOTHING; on the first gesture it unlocks the
//     policy, resumes the WebAudio context, and FLUSHES the queued events in
//     order so the first legitimately-triggered sounds still fire.
//
//   - REUSED DECODED BUFFERS (Req 25.9 "reuse decoded buffers"): Phaser's sound
//     manager decodes each loaded audio key ONCE and caches the decoded buffer;
//     `play(key)` replays that cached buffer. We therefore keep ONE Sound per
//     asset key (created lazily, reused on every replay) and never re-decode.
//     Looping MUSIC keeps a single long-lived Sound per world.
//
//   - EFFECTIVE GAIN (Req 25.7-25.8): the volume applied to every sound is the
//     policy's `gain()` (muted ? 0 : clamped volume), read from the persisted
//     Save_Store settings. `refreshSettings(settings)` re-reads them after a
//     Settings_Screen change so the manager reflects the new volume/mute.
//
//   - ASSET RESOLUTION (Req 24.x): sound assets resolve through the
//     Asset_Registry. When a cue has no real audio (placeholder), there is
//     nothing to play, so the manager no-ops gracefully — the game never fails
//     for a missing sound.
//
// Engine-layer code: Phaser is allowed here. The pure policy carries no Phaser.

import type Phaser from 'phaser';
import type { AssetRegistry } from '../../assets/index.ts';
import type { SaveState } from '../saveState.ts';
import {
  createAudioPolicy,
  type AudioEvent,
  type AudioPolicy,
  type AudioCueEntry,
} from '../../core/index.ts';

/** Options for constructing an AudioManager. */
export interface AudioManagerOptions {
  /** The Asset_Registry choke point used to resolve sound cues. */
  readonly assets: AssetRegistry;
  /** The persisted Save_Store (read for the initial volume/mute settings). */
  readonly save: SaveState;
}

/**
 * The AudioManager owns the real sound plumbing for the game. A single instance
 * is created once the boot context exists (e.g. in BootScene) and shared via
 * the game registry; scenes raise logical events through `play(event)` and the
 * manager defers the gating decision to the pure policy.
 */
export class AudioManager {
  private scene: Phaser.Scene;
  private readonly assets: AssetRegistry;
  private readonly policy: AudioPolicy;

  /** One reusable Sound per asset key (decode-once, replay-many — Req 25.9). */
  private readonly sounds = new Map<
    string,
    Phaser.Sound.BaseSound
  >();

  /** The music key currently playing (looping), if any — only one at a time. */
  private currentMusicKey: string | null = null;

  /**
   * @param scene a live scene used for its Sound manager + input events. The
   *   Sound manager (`scene.sound`) is game-global, so any scene works; the
   *   manager is typically constructed with the Boot/Preload scene.
   */
  constructor(scene: Phaser.Scene, options: AudioManagerOptions) {
    this.scene = scene;
    this.assets = options.assets;
    this.policy = createAudioPolicy({ settings: options.save.settings });
    this.attachUnlock(scene);
  }

  /**
   * (Re)attach the first-interaction unlock listeners to `scene` (Req 25.9).
   * BootScene hands off immediately, so its input listeners never catch a
   * gesture; a later long-lived scene (MainMenu/Gameplay) calls this so the
   * FIRST real pointer/key press there unlocks audio. No-op once unlocked.
   */
  attachUnlock(scene: Phaser.Scene): void {
    if (this.policy.isUnlocked()) return;
    this.scene = scene;
    const unlock = (): void => this.handleUnlock();
    scene.input.once('pointerdown', unlock);
    scene.input.keyboard?.once('keydown', unlock);
  }

  /**
   * Raise a logical audio event (Req 25.1-25.6). The pure policy decides:
   *   - 'suppressed' (muted) → nothing plays;
   *   - 'queued' (gate still locked) → nothing plays yet; it flushes on unlock;
   *   - 'play' → play the mapped sound now at the effective gain.
   */
  play(event: AudioEvent): void {
    const decision = this.policy.requestPlay(event);
    if (decision === 'play') {
      this.playNow(event);
    }
    // 'queued' and 'suppressed' both play nothing here (the queue flushes on
    // the first user interaction via `onUserInteraction`).
  }

  /**
   * Re-read the persisted settings after a Settings_Screen change (Req 25.8) so
   * the effective gain reflects the new volume/mute. Applies the new gain to
   * any currently-playing looping music immediately.
   */
  refreshSettings(settings: SaveState['settings']): void {
    this.policy.setSettings(settings);
    const gain = this.policy.gain();
    // Reflect the change on live music right away.
    if (this.currentMusicKey) {
      const sound = this.sounds.get(this.currentMusicKey);
      applyVolume(sound, gain);
      // A mute (gain 0) stops the music loop; unmuting restarts it on next play.
      if (gain <= 0) {
        this.stopMusic();
      }
    }
  }

  /** Stop the currently-playing background music, if any. */
  stopMusic(): void {
    if (!this.currentMusicKey) return;
    const sound = this.sounds.get(this.currentMusicKey);
    if (sound && sound.isPlaying) sound.stop();
    this.currentMusicKey = null;
  }

  /** Whether the autoplay gate has been unlocked (Req 25.9). Mainly for tests. */
  isUnlocked(): boolean {
    return this.policy.isUnlocked();
  }

  // -- internal -----------------------------------------------------------

  /** Perform the unlock: resume context, flush queued events, play them. */
  private handleUnlock(): void {
    const flushed: AudioEvent[] = this.policy.onUserInteraction();

    // Resume a suspended WebAudio context so queued sounds can actually sound.
    const manager = this.scene.sound as Phaser.Sound.WebAudioSoundManager;
    const ctx = manager?.context;
    if (ctx && ctx.state === 'suspended' && typeof ctx.resume === 'function') {
      void ctx.resume();
    } else if (
      typeof (this.scene.sound as { unlock?: () => void }).unlock === 'function'
    ) {
      (this.scene.sound as { unlock: () => void }).unlock();
    }

    for (const event of flushed) {
      this.playNow(event);
    }
  }

  /**
   * Play a mapped event's real sound NOW. Resolves the cue's asset through the
   * Asset_Registry; if there is no real audio (placeholder) or the decoded
   * audio is not in the Phaser cache, this is a graceful no-op (Req 24.x).
   * Reuses one Sound per key so the decoded buffer is never re-decoded (Req
   * 25.9).
   */
  private playNow(event: AudioEvent): void {
    const cue: AudioCueEntry = this.policy.cueFor(event);
    const gain = this.policy.gain();
    if (gain <= 0) return; // muted; nothing to play.

    // Only real, loaded audio can play; a placeholder cue has no sound.
    if (!this.assets.hasReal(cue.assetKey)) return;
    if (!this.scene.cache.audio.exists(cue.assetKey)) return;

    if (cue.kind === 'music') {
      this.playMusic(cue.assetKey, gain);
      return;
    }
    this.playSfx(cue.assetKey, gain);
  }

  /** Replay a one-shot sfx, reusing the cached decoded buffer (Req 25.9). */
  private playSfx(key: string, gain: number): void {
    const sound = this.getOrCreateSound(key);
    // `play` on an existing Sound replays the same decoded buffer.
    sound.play(undefined, { volume: gain });
  }

  /**
   * Start looping world music, swapping out any current track. Only one music
   * loop plays at a time (Req 25.5). Reuses the per-key Sound.
   */
  private playMusic(key: string, gain: number): void {
    if (this.currentMusicKey === key) {
      // Already playing this world's music; just reflect the current gain.
      applyVolume(this.sounds.get(key), gain);
      return;
    }
    this.stopMusic();
    const sound = this.getOrCreateSound(key);
    sound.play(undefined, { loop: true, volume: gain });
    this.currentMusicKey = key;
  }

  /** Lazily create (once) and cache the reusable Sound for a key (Req 25.9). */
  private getOrCreateSound(key: string): Phaser.Sound.BaseSound {
    let sound = this.sounds.get(key);
    if (!sound) {
      sound = this.scene.sound.add(key);
      this.sounds.set(key, sound);
    }
    return sound;
  }
}

/** Apply a volume to a Sound that supports `setVolume`, tolerating undefined. */
function applyVolume(
  sound: Phaser.Sound.BaseSound | undefined,
  gain: number,
): void {
  const withVolume = sound as
    | (Phaser.Sound.BaseSound & { setVolume?: (v: number) => void })
    | undefined;
  if (withVolume && typeof withVolume.setVolume === 'function') {
    withVolume.setVolume(gain);
  }
}

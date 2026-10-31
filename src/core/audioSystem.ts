// Feature: kino-game
//
// The PURE audio STATE / POLICY logic (task 12.1; design: "Audio"; Req
// 25.1-25.9). Phaser-free and WebAudio-free so the whole autoplay-gate /
// effective-gain / event-catalog contract is unit-testable in plain Node, with
// the engine AudioManager (`src/engine/audio/AudioManager.ts`) deferring every
// DECISION to this module and owning only the real Sound/WebAudio objects.
//
// WHAT LIVES HERE (all pure over the Save_Store SettingsState):
//
//   - SOUND-EVENT CATALOG (Req 25.1-25.5): a map from a logical AudioEvent
//     (movement per mode jumping/flight/zigzag/underwater, evolution, collision,
//     UI, per-world music, mentor reaction) to the Asset_Registry KEY the engine
//     resolves and the playback KIND ('sfx' vs looping 'music'). The keys follow
//     the SAME scheme the Asset_Registry registers (`audio:<cue>`, `music:<world>`)
//     so the engine resolves a mapped key with NO extra wiring. Each movement
//     mode + evolution/collision/UI/music/mentor maps to a DISTINCT entry.
//
//   - AUTOPLAY GATE (Req 25.9 / 25.6 phrasing in the task): before the first
//     user interaction, audio must NOT start. `requestPlay` therefore returns
//     'queued' (for playback the engine should flush once unlocked) rather than
//     'play'; `onUserInteraction()` flips the gate to unlocked and FLUSHES the
//     queued events so the engine plays them in order. After unlock, a request
//     returns 'play' immediately.
//
//   - EFFECTIVE GAIN (Req 25.7-25.8): `effectiveGain(volume, muted)` is the pure
//     computation `muted ? 0 : clamp(volume)` — the engine multiplies a sound's
//     base gain by this. It reuses the SAME clamp as the Settings logic
//     (`clampVolume` from settingsScreen.ts) so there is ONE definition of the
//     [0,1] range. A muted request is 'suppressed' so the engine can skip it
//     entirely rather than play at zero gain.
//
// The volume/mute values originate in the Save_Store `SettingsState`
// (saveStore.ts) and are mutated by the pure Settings logic
// (settingsScreen.ts `setVolume`/`setMuted`); this module only READS them and
// never duplicates the clamp or the persistence path.

import type { MovementMode } from './types.ts';
import type { SettingsState } from './saveStore.ts';
import { clampVolume } from './settingsScreen.ts';

/**
 * The per-world music key form used by the Asset_Registry (`music:worldN`,
 * registry.ts `WorldId`). The core runtime `WorldId` is numeric (1..5); the
 * music catalog keys off the registry's STRING form so a mapped key resolves
 * with no translation. Kept local so this module needs no asset/registry import
 * (the core↔engine boundary keeps `src/core` free of `src/assets`).
 */
export type MusicWorldId = 'world1' | 'world2' | 'world3' | 'world4' | 'world5';

// ---------------------------------------------------------------------------
// Sound-event catalog (Req 25.1-25.6)
// ---------------------------------------------------------------------------

/**
 * How a mapped sound plays: a one-shot sound EFFECT, or looping background
 * MUSIC (Req 25.5). The engine uses this to decide `loop`/single-instance
 * behavior on the real Sound object.
 */
export type AudioPlaybackKind = 'sfx' | 'music';

/**
 * The logical audio events the game raises. One distinct entry per:
 *   - each movement action (Req 25.1): 'move:jumping' | 'move:flight' |
 *     'move:zigzag' | 'move:underwater'
 *   - evolution (Req 25.2): 'evolution'
 *   - collision / failure (Req 25.3): 'collision'
 *   - UI control (Req 25.4): 'ui'
 *   - mentor reaction (Req 25.6): 'mentorReaction'
 *   - per-world background music (Req 25.5): 'music:worldN'
 */
export type AudioEvent =
  | `move:${MovementMode}`
  | 'evolution'
  | 'collision'
  | 'ui'
  | 'mentorReaction'
  | `music:${MusicWorldId}`;

/** What the catalog records for one logical event. */
export interface AudioCueEntry {
  /** The Asset_Registry key the engine resolves (`audio:<cue>` / `music:<world>`). */
  assetKey: string;
  /** Whether this plays as a one-shot sfx or looping background music. */
  kind: AudioPlaybackKind;
}

/** The four movement modes, in a stable order, for catalog construction. */
const MOVEMENT_MODES: readonly MovementMode[] = ['jumping', 'flight', 'zigzag', 'underwater'];

/** The five worlds, in a stable order, for per-world music catalog entries. */
export const AUDIO_WORLD_IDS: readonly MusicWorldId[] = [
  'world1',
  'world2',
  'world3',
  'world4',
  'world5',
];

/**
 * Map a movement mode to its Asset_Registry sfx cue key. The AudioConfig cues
 * are named `jump`/`fly`/`zigzag`/`underwater` (config.ts AudioConfig), and the
 * registry registers them as `audio:<cue>`; this bridges the mode name to the
 * cue name so each of the four actions resolves to a DISTINCT sound (Req 25.1).
 */
function movementCueKey(mode: MovementMode): string {
  switch (mode) {
    case 'jumping':
      return 'audio:jump';
    case 'flight':
      return 'audio:fly';
    case 'zigzag':
      return 'audio:zigzag';
    case 'underwater':
      return 'audio:underwater';
    default: {
      const _never: never = mode;
      throw new Error(`movementCueKey: unhandled mode ${String(_never)}`);
    }
  }
}

/**
 * Build the complete sound-event catalog (Req 25.1-25.6). Every movement mode,
 * evolution, collision, UI, mentor reaction, and per-world music maps to a
 * DISTINCT Asset_Registry key. Pure and total: the engine calls `cueFor(event)`
 * to learn which asset key to resolve and whether to loop it.
 */
export function createAudioCatalog(): Record<AudioEvent, AudioCueEntry> {
  const catalog = {} as Record<AudioEvent, AudioCueEntry>;

  // Movement actions — one distinct sfx per mode (Req 25.1).
  for (const mode of MOVEMENT_MODES) {
    catalog[`move:${mode}`] = { assetKey: movementCueKey(mode), kind: 'sfx' };
  }

  // Single-cue sfx events (Req 25.2-25.4, 25.6).
  catalog.evolution = { assetKey: 'audio:evolution', kind: 'sfx' };
  catalog.collision = { assetKey: 'audio:collision', kind: 'sfx' };
  catalog.ui = { assetKey: 'audio:ui', kind: 'sfx' };
  catalog.mentorReaction = { assetKey: 'audio:mentorReaction', kind: 'sfx' };

  // Per-world background music (Req 25.5) — looping.
  for (const world of AUDIO_WORLD_IDS) {
    catalog[`music:${world}`] = { assetKey: `music:${world}`, kind: 'music' };
  }

  return catalog;
}

// ---------------------------------------------------------------------------
// Autoplay gate + effective gain (Req 25.7-25.9)
// ---------------------------------------------------------------------------

/**
 * The effective playback gain for the current settings (Req 25.7-25.8):
 * `muted ? 0 : clampVolume(volume)`. Reuses `clampVolume` so there is a single
 * definition of the [0,1] range (no duplicated clamp). The engine multiplies a
 * sound's base gain by this value.
 */
export function effectiveGain(volume: number, muted: boolean): number {
  if (muted) return 0;
  return clampVolume(volume);
}

/**
 * The outcome of a `requestPlay`:
 *   - 'play'       — the gate is unlocked and audio is on; the engine SHOULD
 *                    play this event now at the current effective gain.
 *   - 'queued'     — the gate is still locked (no user interaction yet, Req
 *                    25.9); the engine must NOT start audio. The event is held
 *                    and flushed on `onUserInteraction()`.
 *   - 'suppressed' — audio is muted (effective gain 0, Req 25.7); the engine
 *                    skips the event entirely rather than playing at zero gain.
 */
export type PlayDecision = 'play' | 'queued' | 'suppressed';

/** Options for {@link createAudioPolicy}. */
export interface AudioPolicyOptions {
  /** Initial settings (from the Save_Store); defaults to full volume, unmuted. */
  settings?: SettingsState;
  /**
   * Start already unlocked (e.g. a context where autoplay is known allowed).
   * Defaults to false so the gate holds until the first user interaction.
   */
  startUnlocked?: boolean;
}

/**
 * The pure audio POLICY state machine the engine AudioManager defers to. It
 * owns NO Phaser/WebAudio objects — only the autoplay gate, the current
 * settings, the queued-before-unlock buffer, and the event catalog. The engine
 * asks it `requestPlay(event)` and acts on the returned {@link PlayDecision};
 * on the first real user input the engine calls `onUserInteraction()` and plays
 * the FLUSHED queue.
 */
export interface AudioPolicy {
  /** Whether the autoplay gate has been unlocked by a user interaction. */
  isUnlocked(): boolean;
  /** The current audio settings (volume/mute). */
  settings(): SettingsState;
  /** The effective gain for the current settings (Req 25.7). */
  gain(): number;
  /** Look up the catalog entry for a logical event (Req 25.1-25.6). */
  cueFor(event: AudioEvent): AudioCueEntry;

  /**
   * Decide what to do with a play request for `event`:
   *   - muted → 'suppressed' (Req 25.7);
   *   - locked gate → 'queued' and buffered for flush (Req 25.9);
   *   - otherwise → 'play'.
   * Note the mute check precedes the gate check: a muted request is suppressed
   * even before unlock, so it is never queued only to be dropped on flush.
   */
  requestPlay(event: AudioEvent): PlayDecision;

  /**
   * Record the first user interaction (Req 25.9): unlock the gate and RETURN
   * the buffered events in request order so the engine can play them. The
   * returned list is cleared from the buffer. Muted events in the buffer are
   * dropped (not returned) since they should not sound. Idempotent: a second
   * call after unlock returns an empty list.
   */
  onUserInteraction(): AudioEvent[];

  /** Replace the current settings (e.g. after a Settings_Screen change). */
  setSettings(settings: SettingsState): void;

  /** The currently queued (pre-unlock) events, for inspection/tests. */
  queued(): readonly AudioEvent[];
}

/** Default settings when none are supplied: full volume, unmuted. */
const DEFAULT_SETTINGS: SettingsState = { volume: 1, muted: false };

/**
 * Create the pure audio policy (Req 25.1-25.9). Starts LOCKED by default so no
 * audio plays until `onUserInteraction()` (Req 25.9); holds a catalog mapping
 * every logical event to a distinct asset key (Req 25.1-25.6); and computes the
 * effective gain from the injected settings (Req 25.7-25.8). The engine wires
 * the real unlock to pointer/key events and plays the flushed queue.
 */
export function createAudioPolicy(options: AudioPolicyOptions = {}): AudioPolicy {
  const catalog = createAudioCatalog();
  let unlocked = options.startUnlocked === true;
  let currentSettings: SettingsState = options.settings
    ? { volume: clampVolume(options.settings.volume), muted: options.settings.muted }
    : { ...DEFAULT_SETTINGS };
  const queue: AudioEvent[] = [];

  function isMuted(): boolean {
    return currentSettings.muted || effectiveGain(currentSettings.volume, currentSettings.muted) <= 0;
  }

  return {
    isUnlocked() {
      return unlocked;
    },
    settings() {
      return { ...currentSettings };
    },
    gain() {
      return effectiveGain(currentSettings.volume, currentSettings.muted);
    },
    cueFor(event) {
      return catalog[event];
    },
    requestPlay(event) {
      // Mute short-circuits before the gate so a muted event is never queued
      // only to be dropped on flush (Req 25.7).
      if (isMuted()) return 'suppressed';
      if (!unlocked) {
        queue.push(event);
        return 'queued';
      }
      return 'play';
    },
    onUserInteraction() {
      unlocked = true;
      // Drop any events that would be muted at flush time; play the rest in
      // request order (Req 25.9).
      const flushed = isMuted() ? [] : queue.slice();
      queue.length = 0;
      return flushed;
    },
    setSettings(settings) {
      currentSettings = { volume: clampVolume(settings.volume), muted: settings.muted };
    },
    queued() {
      return queue.slice();
    },
  };
}

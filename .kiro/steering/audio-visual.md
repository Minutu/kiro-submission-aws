---
inclusion: fileMatch
fileMatchPattern: ["src/engine/**", "**/audio*", "**/sound*", "**/hud*", "**/ui*", "**/juice*", "**/effect*"]
---

# KINO Audio-Visual & Juice Steering

Adapted to KINO. Covers sound integration, screen shake, and UI animation. All assets resolve through `AssetRegistry`; volume persists via `SaveStore`.

## Sound effect integration

- Distinct SFX per movement action: jumping, flight, zigzag, underwater. Plus: evolution, collision/failure, UI interaction, optional mentor voice-like reactions, per-world background music.
- Resolve sounds via `AssetRegistry.resolve(key)`; a missing sound falls back to silence/placeholder, never an error.
- Reuse decoded audio buffers; never reload per play.
- Autoplay policy: browsers block audio before a user gesture. Defer the sound manager unlock until the first interaction (menu click/keypress); before then queue/no-op audio calls so nothing throws. Volume/mute still persist regardless.
- Player can adjust volume and mute (Settings); persist the setting in `SaveStore`.
- Trigger SFX off core events (`obstacle:cleared`, `collision:fatal`, `skill:activated`, `transition:begin`), not from inside the pure core — audio is an engine-layer side effect.

## Screen shake (juice)

- Reserve screen shake for high-impact beats: fatal collision, Nuke blast, evolution, World 5 slam-down. Keep it short and subtle; make amplitude/duration BalanceTable-tunable.
- Screen shake is a camera/render effect ONLY. It must never move Kino's logical `screenX`, alter hitboxes, or affect the fixed-step sim. Collision/scoring read authoritative state, never the shaken camera.
- Respect the graceful-degradation ladder and a potential "reduced motion" setting: shake is non-essential and may be scaled down/off under load.

## UI animation patterns

- Signature transitions from the design: the Play button expands as an upward color fill to full screen, then HUD + background fade in, then Kino glides from menu position to the fixed run-start spot.
- Menu equip jiggle (jello bob) on equipping a cosmetic/skill; treasure-map lock-in side glow on the centered discovered world; silhouette (undiscovered) shows no glow and disables Play.
- HUD: score top, equipped-skill control bottom-right with cooldown/effect-duration readout, active score-multiplier indicator, menu/pause controls.
- Keep UI tweens on the engine layer and time them in real/display time; gameplay-affecting timers (skill cooldowns, effect durations) run on the FIXED step and freeze on pause — do not conflate the two clocks.
- Cinematic panels (opening stacked-band descent, mentor speaker-swap, comic-panel ending) are skippable; honor skip immediately.

## Performance notes for A/V

- Particles and parallax detail are the first casualties under load (degradation ladder); SFX and core feedback are preserved.
- Pool particle emitters and UI effect objects; avoid per-frame allocation in tween callbacks.

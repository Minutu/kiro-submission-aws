---
inclusion: fileMatch
fileMatchPattern: ["src/engine/**", "**/render*", "**/sprite*", "**/animation*", "**/parallax*", "**/cosmetic*", "src/config/**"]
---

# KINO Visual Design Steering

Adapted to KINO. Comic-book art direction, placeholder-first, swappable via the `Config_File` -> `AssetRegistry`. Rendering lives in the engine layer only.

## Art direction

- Original 2D comic-book aesthetic: thick irregular black outlines, cel-shaded surfaces, halftone shading, exaggerated expressions.
- Saturated, distinctive per-world palettes with strong foreground/background contrast.
- Applies to BOTH placeholder and final art. Placeholders approximate each world's palette so the game reads correctly before real art exists.

## Sprite rendering patterns

- All gameplay/UI sprites and animation frames packed into texture atlases so draws batch from one bound texture.
- `ObstacleView` sprites come from an object pool (acquire on spawn, release off-screen). Never destroy mid-run.
- Resolve every texture through `AssetRegistry.resolve(key)`; on a missing/failed asset it returns a geometric placeholder tinted from the world palette. Rendering code never references raw paths.
- Collision is body-only; cosmetic layers are visual and must not influence any hitbox.

## Kino character animations (layered)

- `KinoRenderer` draws the base Kino body independently, then positions equipped cosmetic (hat) layers per `(movementMode, animationFrame)` from an anchor/offset table — no unique combined sprite per cosmetic+frame.
- Required frame sets (exact config keys):
  - Jumping: `run-step-right`, `run-step-left` (alternating ground walk cycle), `jump-go-up`, `jump-apex`, `jump-go-down` (airborne by velocity).
  - Flight: `fly-up`, `fly-apex`, `fly-down` — REUSED for Underwater (no separate underwater frames).
  - Zigzag: `zigzag-up`, `zigzag-down`.
  - Transition: `spin-1`, `spin-2` (alternating spin cycle); Kino also takes a pointed arrow form in the zigzag segment.
  - World 5 finale crawl: `crawl-step-right`, `crawl-step-left` (alternating), then the Jumping run cycle, then the final jump.
- Cosmetic layers are hidden during transitions; the transition animation has render priority over character layers.
- Menu-only: equipping a cosmetic or skill plays the `menu-equip-jiggle` (jello bob), distinct from gameplay frames.

## Obstacle textures (per world, per category)

- Every obstacle type has a named `Obstacle_Category` config key so art swaps per type without code changes. Underwater categories: `ceiling_underwater_obstacle`, `floor_underwater_obstacle`.
- Per-world environment flavor: W1 desert highway / Route 53 signs / cacti / rocks / tumbleweeds; W2 mountains / lava rocks / pipes / compute structures; W3 jungle / vines / caves; W4 icebergs / icy structures / water surface + underwater; W5 data center / security barriers / restricted zones.

## Background parallax

- `ParallaxBackground`: multiple layers scrolling at different speeds, changing per world. Nearer layers scroll faster; farthest slowest. Keep layer counts modest and degrade under load (see audio-visual.md / performance).

## Palette & overlay application

- Each world's `Color_Palette` defines element-level treatment for background, obstacles, and Kino (not just a background color), read from config.
- Underwater: apply a blue overlay/tint to obstacles AND Kino together as one atomic treatment while underwater; remove it immediately when the underwater condition ends.
- Default palettes (tunable in config): W1 warm orange + sandy yellow; W2 industrial orange-red + steel grey + lava glow; W3 deep blue + jungle green; W4 glacier cyan + teal + icy white; W5 dark steel + red alert accents.

## Particle effects

- Pool all particles; cap counts. Use for evolution bursts (electric-zap/glow), collisions, Nuke radiation blast, transition cues.
- Particles are the FIRST thing reduced under the graceful-degradation ladder; they must never affect gameplay state (purely cosmetic).

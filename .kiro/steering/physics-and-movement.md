---
inclusion: fileMatch
fileMatchPattern: ["src/core/**", "src/engine/**", "**/movement*", "**/collision*", "**/physics*", "**/obstacle*"]
---

# KINO Physics, Movement & Collision Steering

Adapted to KINO. There is no single "gravity + flap" model — physics is per movement mode. All numbers come from the `BalanceTable` (shown values are the design defaults, tunable).

## Core model: fixed Kino, scrolling world

- Kino holds a constant horizontal screen position (`screenX`). Forward progress is the world/obstacles scrolling left at `scrollSpeed`.
- Kino moves only vertically/diagonally under normal play. The only sanctioned horizontal exceptions are Dash (mode-dependent burst) and the World 5 auto-finale.
- The physics step is pure and deterministic: `step(state, dt, primaryPressed, balance) -> newState`. Fixed timestep (1/120 s) makes crossing detection, timers and reposition reproducible.

## Per-mode physics (momentum)

- Jumping: primary = upward impulse from ground; continuous downward gravity; rest on ground boundary. (`jump.impulse`, `jump.gravity`)
- Flight (base mode): primary = upward impulse; continuous downward gravity between presses. (`flight.impulse`, `flight.gravity`)
- Underwater_Buoyancy: inverted flight — continuous upward buoyancy; primary = downward impulse. Reuses flight animation frames. (`underwater.buoyancy`, `underwater.impulse`)
- Zigzag: constant-speed diagonal at a configurable angle (default ~30 deg); primary reverses the vertical diagonal between up and down. (`zigzag.angleDeg`, `zigzag.speed`)
- Integrate with semi-implicit Euler (update velocity, then position) for stability at the fixed step. Keep velocity in px/s, gravity in px/s^2.

## Collision boundaries (precise + fair)

- Single shared AABB overlap routine used in every mode (`CollisionSystem`). Only the hitbox scale differs per mode.
- Hitbox is derived ONLY from Kino's BODY sprite, scaled by `hitbox.scale.<mode>` (default < 1 so collisions favour the player). Cosmetic/hat layers are render-only and NEVER collide (a tall hat overlapping an obstacle is not a hit).
- Per-mode fatal contact: Jumping/Flight/Underwater = touching an obstacle unit ends the run; Zigzag = contacting ANY surface (top/bottom wall) ends the run.
- Obstacles may contain multiple visual rectangles but are one scoring unit with one `scoringLineX`.

## Smooth animation interpolation

- The sim advances in fixed steps; the renderer interpolates between the previous and current core state by the leftover accumulator fraction for smooth motion independent of frame rate.
- Never drive gameplay off the interpolated/visual position — collision and scoring read the authoritative fixed-step state only.
- Animation frames are selected from kinematic state: Jumping uses the run-step walk cycle when grounded and jump-go-up/apex/go-down by vertical velocity sign; Flight (and Underwater) use fly-up/apex/down by velocity; Zigzag uses zigzag-up/down by diagonal direction; transitions use the spin-1/spin-2 cycle.

## Input responsiveness

- Primary action (spacebar == left click) and skill (right click == Q) are normalized to intents; respond within one rendered frame (queue the intent for the next fixed step; do not drop inputs between steps).
- Rebindable and persisted; conflict only checked between the two bindings; roll back on persist failure.
- Skills are disabled during transitions; activating on cooldown/unavailable is silently deferred (no feedback).

## Obstacle spawning logic

- `ObstacleSpawner.spawnWindow(scrollX, world, mode, difficulty)` produces obstacles ahead of the scroll position for the ACTIVE mode only, using the mode's path layout:
  - Jumping: ground-resting obstacles with difficulty-scaled horizontal gaps.
  - Flight: top+bottom pillars with a vertical gap.
  - Zigzag: top/bottom walls bound the lane; scoring at transition points between diagonal segments.
  - Underwater: `ceiling_underwater_obstacle` (top) and `floor_underwater_obstacle` (bottom) with a navigable gap; both appear within the sequence but not necessarily simultaneously.
- Seed the spawner with a PRNG so endless runs are reproducible for tests.
- Difficulty ramp (beyond 50 pts in worlds 1-4, and throughout endless): raise `scrollSpeed` toward `scrollSpeed.maxMultiplier`, shrink gap toward `obstacleDensity.minGapPx`, keep it feasible.

## Safe reposition (Time Erase / Ultra Instinct)

- Operate on the current FROZEN obstacle-field snapshot; validate every candidate with the same AABB routine; guaranteed-terminating fallback scan so the result NEVER overlaps.
- Jumping: place directly right of and clear of the obstacle at ground level. Flight/Underwater: nearest non-overlapping gap center at `screenX`. Zigzag: clear interior on the diagonal maximizing clearance from the contacted wall, then return directional control to the player. Ultra Instinct: nearest clear y on the vertical axis.
- Second Chance does NOT reposition (it phases through one hit) — do not route it through the solver.

---
inclusion: always
---

# KINO Domain Steering

Adapted from generic "Flappy Kiro" domain prompts to the ACTUAL KINO design: five worlds, four movement modes, story + endless, generational loop. This supersedes any single-flappy-game assumption.

## Game session management

- A run belongs to a (World, mode: story | endless). Story runs progress the generation; endless runs never do.
- Run lifecycle: start -> play (fixed-step sim) -> (optional perk offers at obstacles 20 & 40) -> collision -> `RunEndScene` -> Retry (same world/mode) or Menu.
- Pause freezes the sim and ALL skill cooldown/effect timers; resume continues from held values.

## Score & difficulty progression

- Scoring is per movement mode but uses one consistent mechanism: exactly one `ScoringEvent` of value 1 per cleared obstacle unit / zigzag transition point, attributed to the active mode at the moment of clearing, times the active multiplier at credit time. No double counting for multi-element obstacles.
- Difficulty ramps with cleared obstacles: `scrollSpeed` rises (capped at `scrollSpeed.maxMultiplier`), inter-obstacle gap shrinks toward `obstacleDensity.minGapPx`, and in endless the transition frequency increases — always kept feasible.
- Story worlds 1-4 unlock the next world at 50 points, then the SAME run continues endlessly (hover -> "new world unlocked" -> "endless starting" -> keep going). No auto-advance. World 5 is a finite authored progression, no endless.

## Score persistence & high scores

- Persist high scores per world AND per mode SEPARATELY (story vs endless) in `SaveStore`; update only when exceeded.
- Track cross-generation history so the Info panel can show this-generation vs past-generation bests.

## Obstacle generation rules (per mode, not "walls")

- Obstacles are the single `Obstacle` entity keyed by `Obstacle_Category`, emitted by `ObstacleSpawner` for the active mode:
  - Jumping: ground obstacles; clear by jumping.
  - Flight: top/bottom pillars with a gap (gap sizing from `BalanceTable`, shrinking with difficulty but never below the configured minimum).
  - Zigzag: top/bottom walls; score at diagonal transition points; any wall contact is fatal.
  - Underwater: ceiling + floor obstacles with a navigable gap.
- Endless respects `allowedEndlessModes` for the selected world — later-world abilities are structurally impossible to schedule in an earlier world.

## Kino behavior & collision responses

- Kino auto-advances; player controls vertical/diagonal motion via the primary action; the environment (never the player) switches movement mode with a telegraphed transition.
- Collision response: without a protective skill, contact ends the run. With Time Erase / Ultra Instinct, Kino is repositioned to a validated safe spot (see physics-and-movement.md). Second Chance phases through one hit instead. Nuke clears all on-screen obstacles, crediting each once.

## Game-over state handling

- On fatal collision: stop the sim, record the run, update high score if beaten, show `RunEndScene` (final score, run time, relevant high score, obstacles cleared, Retry/Menu).
- Perk retention on game-over: if the run ended before reaching 50 points, discard this run's perks (revert to unselected); if 50 was reached (world cleared), retain them for the rest of the generation.
- Returning to menu reflects any newly unlocked world as selectable; the just-played story world becomes "left behind" once advanced past (story replay blocked; endless-only return; earned rewards kept).

## Generational progression

- Completing a generation: award a unique cosmetic, advance the name Junior -> Senior -> next iteration Junior, reset abilities/perks/run state, KEEP skills + cosmetics (permanent), grey previously discovered worlds.
- Skills unlock by milestone (world-first completions in fixed order, then generation 1 and generation 2 completions) via the config `skillUnlockSchedule`; rarity is display/flavor only. Skills are never granted via perk drops.
- First launch (no save): Generation 1 Junior, no skills, no cosmetics, only World 1, default bindings, then the opening cinematic.

## What NOT to assume (anti-patterns for this project)

- Do not treat the whole game as flappy-bird; flight is one of four modes.
- Do not model obstacles as a dedicated `WallObstacle` type; use the one `Obstacle` + `Obstacle_Category`.
- Do not put abilities in permanent persistence; abilities reset each generation and are re-learned via mentor/evolution. Skills and cosmetics are the permanent ones.

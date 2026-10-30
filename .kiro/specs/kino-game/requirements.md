# Requirements Document

## Introduction

KINO is a 2D side-scrolling arcade endless-runner/platformer that runs in the browser, built for an AWS Kiro workshop competition. The player controls Kino, a bird/ghost-like creature hatched from an egg that falls from a henhouse in a data center, spins down the kitchen ramp, bumps into a button the egg should not have clicked, gets aws:button:not-allowed for example, name to be changed, and then ground comically opens up beneath him, he (the egg) falls down the middle of screen through comic-book panels (each panel representing one of the worlds kino would have to cross), and lands in a desert. Little ghost kino hatches. The player crosses five worlds, each introducing a new movement ability themed around an AWS service family (AWS references are in-world flavor, not a tutorial). In world 3, there is randomly a portion of movement from world 2 too and then they loop infinitely for example, transitions to be determined. Then in world 4, we got movements learned in world 3 and 2. In World 5 we got them all, and only at the end of world 5 does kino fall to the ground and then he crawls, and then he jumps through the portal arriving back to the hen house, meeting his mom and siblings grown up, starting his family, then scratching his butt he knocks the egg again and so on.The story loops generationally, and each completed generation grants a unique cosmetic reward.

This document defines the complete intended scope for the competition submission. All five worlds and all major systems are in scope. Implementation ordering is a separate concern from intended scope; no feature described here is to be silently dropped or simplified.

The game is built placeholder-first: gameplay logic is developed against simple geometric placeholder assets, with an asset-replacement architecture that allows final art to be swapped in later without changing gameplay logic. Animation wise, organize it by frames to be had, say fro flying, you'd have going up, down, having 0 velocity, and crashing. idk.

Where the source vision documents conflict, v1.2 Gameplay Systems supersedes v1.1 Clarifications, which supersedes v1.0 Concept. The resolved values from v1.2 are reflected throughout this document (for example: two perk choices per selection, perk selections at obstacles 20 and 40, environment-controlled movement transitions).

## Glossary

- **Game**: The complete KINO browser application, including menu, gameplay, cinematics, and persistence systems.
- **Kino**: The player-controlled bird/ghost-like character.
- **Movement_Mode**: A distinct locomotion behavior that governs how Kino moves and how primary input affects Kino. The five movement modes are Jumping, Flight, Zigzag, Underwater_Buoyancy, and (as a composite in World 5) the combination of all four. Movement modes are selected by the environment, never manually chosen by the player during gameplay.
- **Ability**: A movement capability (movement pattern) Kino learns in a world (Jumping, Flight, Zigzag, Underwater_Buoyancy). Abilities are re-learned each Generation via the Mentor cutscene and Evolution, and are NOT persisted across Generations; they reset with each new Generation. (This is distinct from Skills and Cosmetics, which are permanent.)
- **World**: One of five themed stages (Desert, Foundry, Memory Jungle, Ice & Underwater, Security Citadel), each tied to an AWS service family and introducing or combining movement abilities.
- **Sequence**: A discrete gameplay segment within a World during which exactly one Movement_Mode is active. A World is composed of one or more Sequences chained together, with an environment-forced, telegraphed Transition between Sequences. Sequences may repeat or loop within a World.
- **High_Score**: The highest score a player has achieved for a specific mode (story or Endless_Mode) and World, persisted in the Save_Store.
- **Obstacle**: A hazard the player must surpass. An obstacle may be composed of multiple visual elements but counts as a single scoring entity.
- **Obstacle_Unit**: A single countable scoring entity appropriate to the active movement mode (for example, one Flappy-Bird pillar passage).
- **Scoring_Event**: A single increment to the player's score, tied to a specific obstacle or checkpoint, triggered exactly once.
- **Perk**: A temporary passive bonus selected during a run. Perks reset each generation and are stored separately from skills.
- **Skill**: An active, player-triggered ability equipped from the inventory and activated by a dedicated control. Skills are permanent across generations once unlocked. The seven Skills are Second Chance, Time Erase, Dash, Time Slow, Score Multiplier, Ultra Instinct, and Nuke. Skills are unlocked through World and Generation completion milestones (per a configurable unlock schedule in the Config_File), not through the perk-choice drop. Each Skill carries a rarity label used for display and flavor only; the rarity label does not change a Skill's gameplay effect.
- **Protective_Skill**: A Skill that, while active, prevents an imminent collision from ending the run and repositions Kino to a safe position. The Protective_Skills are Time Erase (Requirement 14) and Ultra Instinct (Requirement 18). Second Chance (Requirement 13) protects Kino by phasing through one Obstacle rather than repositioning, and is not a Protective_Skill for the purpose of the safe-reposition rules in Requirement 44.
- **Skill_Unlock_Schedule**: The configurable mapping, read from the Config_File, that assigns each Skill to a World-first-completion or Generation-completion milestone at which that Skill becomes unlocked.
- **Loading_Screen**: The initial screen displayed while the Game preloads the assets required for play, showing loading progress until entry to the main menu is enabled.
- **Cosmetic**: A visual customization item (primarily hats) rendered as a separate transparent layer over Kino. Cosmetics are permanent across generations once unlocked.
- **Generation**: One full pass through the story. Completing a generation advances the generational name (for example, Kino III Junior, Kino III Senior, Kino IV Junior) and grants a unique cosmetic.
- **Transition**: A visually telegraphed change between movement modes, controlled by the environment, during which skills are disabled and cosmetic layers are hidden.
- **Mentor**: A themed non-player Kino character that introduces a world.
- **Evolution**: An animation shown when Kino gains a new ability or advances in form.
- **Endless_Mode**: A standalone high-score mode for an individual completed world, outside story progression, that awards no story rewards.
- **Save_Store**: The durable browser-based persistence mechanism (for example, localStorage) that retains permanent progress across sessions.
- **Asset_Registry**: A centralized internal module that maps gameplay entities to visual and audio assets, separating assets from gameplay logic. The Asset_Registry is populated from the Config_File.
- **Config_File**: A single central, human-editable configuration layer (one file or a small set of config modules), separate from gameplay code, through which the user supplies asset paths, user-facing names and labels, and per-World color palettes without editing gameplay logic. The Config_File is the user-facing editable source; the Asset_Registry is the internal mapping that consumes it.
- **Comic_Panel**: A single framed illustration shown during a cinematic. Comic_Panels are framed illustrations used in cinematics other than the opening fall; the opening cinematic instead uses the stacked-band egg descent defined in Requirement 21.
- **Generation_Name**: The current Kino's full generational name, composed from a base character name, an iteration number, and a Junior or Senior suffix (for example, "Kino III Junior").
- **Color_Palette**: The set of placeholder color values and element-level color treatments associated with a World, read from the Config_File with built-in defaults. A Color_Palette defines color treatment per element — background, Obstacles, and Kino — not only a single background color, and MAY include element-level overlay/tint treatments (for example, a blue overlay applied over Obstacles and Kino during underwater sequences).
- **Obstacle_Category**: A named type key assigned to an Obstacle type and mapped in the Config_File / Asset_Registry, so that the art for each Obstacle type can be replaced independently without changes to gameplay logic (for example, "ceiling_underwater_obstacle" and "floor_underwater_obstacle").
- **Animation_Frame**: A single named drawing required by a Movement_Mode for a specific motion state (for example, ascending, descending, zero-vertical-velocity, crashing), mapped to a named Config_File key. The concrete named Animation_Frame keys required per Movement_Mode are enumerated in Requirement 30 and declared as Config_File keys in Requirement 33. A single named Animation_Frame key MAY be shared across more than one Movement_Mode (for example, the Flight frames are reused by the Underwater_Buoyancy Movement_Mode), so a shared key does not require separate art per Movement_Mode.
- **Locked_In_World**: The World positioned at the center/front of the vertical treasure map during map scrolling, which becomes the selected World that the Play control launches, highlighted with a side glow.
- **Inventory_Panel**: The menu view opened from the Cosmetics control or the Skills control, which keeps Kino fixed in the upper area, previews the equipped item above Kino, and presents a tabbed, scrollable grid of items in the lower half of the screen.
- **Adaptive_Layout**: The responsive presentation of all menu and gameplay elements that resizes to fit the available screen, targets a squarish/desktop-style aspect ratio, and repositions and rescales elements proportionally when the screen size changes rather than assuming a fixed phone-sized viewport.
- **Run_End_Screen**: The screen displayed when a run ends by collision, showing the final score, the relevant High_Score for that mode and World, the number of obstacles cleared, and the time spent in the run, and presenting Retry and Menu controls.
- **First_Launch_State**: The initial Save_Store state created when the Game starts with no existing Save_Store data, consisting of Generation 1 with the Junior suffix, no unlocked Skills, no unlocked Cosmetics, only World 1 available, and default control bindings.
- **Settings_Screen**: The menu view opened from the Settings control that presents player-adjustable settings including audio volume control, control rebinding, and a reset-save option.
- **Scrolling_Model**: The gameplay presentation model in which Kino is held at a fixed horizontal screen position and forward progress is simulated by scrolling the World background and Obstacles horizontally past Kino, defined in Requirement 45.
- **Transition_Pane**: The visual marker rendered at the water surface that separates the above-water area from the underwater area, below which underwater Obstacles and inverted buoyancy apply.

## Requirements

### Requirement 1: Core Input and Primary Control

**User Story:** As a player, I want a single simple primary input that behaves identically across keyboard and mouse, so that the game feels like a classic one-button arcade game.

#### Acceptance Criteria

1. WHILE a gameplay run is active, THE Game SHALL move Kino forward automatically without player input.
2. WHEN the player presses the spacebar, THE Game SHALL apply the primary action of the active Movement_Mode.
3. WHEN the player presses the left mouse button, THE Game SHALL apply the primary action of the active Movement_Mode identically to the spacebar.
4. WHEN the player presses the right mouse button, THE Game SHALL activate the equipped Skill.
5. WHEN the player presses the Q key, THE Game SHALL activate the equipped Skill identically to the right mouse button.
6. THE Game SHALL allow the player to reconfigure the primary-action and skill-activation controls.
7. WHEN the player attempts to rebind a primary-action or skill-activation control to a control that is already assigned to another binding, THE Game SHALL display a conflict message identifying the already-assigned control and SHALL NOT apply the binding.
8. WHEN the player reconfigures a control, THE Game SHALL persist the reconfigured control binding in the Save_Store.
9. IF persisting a reconfigured control binding fails, THEN THE Game SHALL roll back to the previous binding so that the previous binding remains active until persistence succeeds.



### Requirement 2: Movement Mode — Jumping (World 1)

**User Story:** As a player in the Desert world, I want Kino to jump over ground obstacles, so that I can learn the first movement ability.

#### Acceptance Criteria

1. WHILE the Jumping Movement_Mode is active, THE Game SHALL cause Kino to jump upward in response to the primary action.
2. WHILE the Jumping Movement_Mode is active, THE Game SHALL apply downward gravity to return Kino to the ground.
3. WHEN Kino surpasses one Jumping Obstacle, THE Game SHALL record exactly one Scoring_Event of value 1 attributed to the Jumping Movement_Mode active at the moment of clearing.
4. IF more than one Scoring_Event, a Scoring_Event of a value other than 1, or a Scoring_Event attributed to a Movement_Mode other than Jumping is recorded for a single surpassed Jumping Obstacle, THEN THE Game SHALL treat that outcome as an invalid scoring result.
5. WHILE the Jumping Movement_Mode is active, THE Game SHALL rest Jumping Obstacles on the ground and SHALL require Kino, held at a fixed horizontal screen position per Requirement 45, to jump to clear the Obstacles while the World background scrolls past Kino.

### Requirement 3: Movement Mode — Flight (World 2)

**User Story:** As a player in the Foundry world, I want Kino to fly in a Flappy-Bird style, so that I can navigate pillar obstacles.

#### Acceptance Criteria

1. WHILE the Flight Movement_Mode is active, THE Game SHALL apply an upward impulse to Kino in response to the primary action.
2. WHILE the Flight Movement_Mode is active, THE Game SHALL apply continuous downward gravity to Kino between primary actions.
3. WHEN Kino clears one Flight Obstacle_Unit, THE Game SHALL record exactly one Scoring_Event of value 1 attributed to the Flight Movement_Mode active at the moment of clearing.
4. IF more than one Scoring_Event, a Scoring_Event of a value other than 1, or a Scoring_Event attributed to a Movement_Mode other than Flight is recorded for a single cleared Flight Obstacle_Unit, THEN THE Game SHALL treat that outcome as an invalid scoring result.
5. THE Game SHALL treat Flight as the base Movement_Mode from which other in-world transitions derive.
6. WHILE the Flight Movement_Mode is active, THE Game SHALL present Obstacles as vertical pillars extending from the top of the play area and from the bottom of the play area with a gap through which Kino passes, SHALL render a ground at the bottom of the play area, and SHALL scroll the World background past Kino while Kino is held at a fixed horizontal screen position per Requirement 45.

### Requirement 4: Movement Mode — Zigzag (World 3)

**User Story:** As a player in the Memory Jungle world, I want Kino to change direction in a Geometry-Dash style, so that I can navigate directional segments.

#### Acceptance Criteria

1. WHILE the Zigzag Movement_Mode is active, THE Game SHALL reverse Kino's vertical direction between an upward and a downward diagonal of approximately 30 degrees in response to the primary action.
2. WHEN Kino crosses one transition point between directional segments, THE Game SHALL record exactly one Scoring_Event of value 1 attributed to the Zigzag Movement_Mode active at the moment of crossing.
3. IF more than one Scoring_Event, a Scoring_Event of a value other than 1, or a Scoring_Event attributed to a Movement_Mode other than Zigzag is recorded for a single crossed transition point, THEN THE Game SHALL treat that outcome as an invalid scoring result.
4. THE Game SHALL compose World 3 as chained Sequences in which a Flight Sequence precedes an environment-forced Transition into a Zigzag Sequence.
5. WHILE a Sequence in World 3 is active, THE Game SHALL make exactly one Movement_Mode active for that Sequence.
6. IF more than one Movement_Mode would be active during a World 3 Sequence, THEN THE Game SHALL forcibly deactivate the extra Movement_Modes so that exactly one Movement_Mode remains active.
7. THE Game SHALL allow World 3 Sequences to repeat or loop, alternating between Flight Sequences and Zigzag Sequences.
8. WHILE the Zigzag Movement_Mode is active, THE Game SHALL bound the play area with a top wall and a bottom wall and SHALL move Kino on a diagonal that bounces between the top wall and the bottom wall.
9. WHILE the Zigzag Movement_Mode is active, IF Kino contacts the top wall or the bottom wall while no Protective_Skill is active, THEN THE Game SHALL treat that contact as a surface contact that ends the current run, consistent with Requirement 44 criterion 4.

### Requirement 5: Movement Mode — Underwater Buoyancy (World 4)

**User Story:** As a player in the Ice & Underwater world, I want Kino to move with inverted-Flappy-Bird buoyancy underwater, so that I experience a new movement feel while reusing earlier mechanics.

#### Acceptance Criteria

1. WHILE the Underwater_Buoyancy Movement_Mode is active, THE Game SHALL apply continuous upward buoyancy to Kino between primary actions.
2. WHILE the Underwater_Buoyancy Movement_Mode is active, THE Game SHALL apply a downward impulse to Kino in response to the primary action.
3. WHEN Kino clears one Underwater Obstacle_Unit, THE Game SHALL record exactly one Scoring_Event of value 1 attributed to the Underwater_Buoyancy Movement_Mode active at the moment of clearing.
4. IF more than one Scoring_Event, a Scoring_Event of a value other than 1, or a Scoring_Event attributed to a Movement_Mode other than Underwater_Buoyancy is recorded for a single cleared Underwater Obstacle_Unit, THEN THE Game SHALL treat that outcome as an invalid scoring result.
5. THE Game SHALL compose World 4 as chained Sequences presenting Flight Sequences (from World 2), Zigzag Sequences (from World 3), and Underwater Sequences, with an environment-forced, telegraphed Transition between Sequences.
6. WHILE a Sequence in World 4 is active, THE Game SHALL make exactly one Movement_Mode active for that Sequence.
7. IF more than one Movement_Mode would be active during a World 4 Sequence, THEN THE Game SHALL forcibly deactivate the extra Movement_Modes so that exactly one Movement_Mode remains active.
8. THE Game SHALL exclude the Jumping Movement_Mode from World 4.
9. WHEN the water-surface crossing event fires for Kino crossing from below the water surface to above, THE Game SHALL transition Kino from the Underwater_Buoyancy Movement_Mode to the Flight Movement_Mode.
10. IF a transition between the Underwater_Buoyancy Movement_Mode and the Flight Movement_Mode is attempted without the water-surface crossing event firing, THEN THE Game SHALL keep Kino in the current Movement_Mode and SHALL NOT perform the transition.
11. THE Game SHALL categorize underwater Obstacles as named Obstacle_Category types including "ceiling_underwater_obstacle" and "floor_underwater_obstacle", each mapped to a named Config_File key for art replacement.
12. WHILE the Underwater_Buoyancy Movement_Mode is active, THE Game SHALL present both ceiling_underwater_obstacle hazards attached to the top of the underwater area and floor_underwater_obstacle hazards rising from the bottom of the underwater area for the player to dodge, where the two Obstacle_Category types appear within the underwater Sequence but SHALL NOT be required to appear at the same time.
13. THE Game SHALL render a Transition_Pane marking the water surface, below which the Game SHALL present ceiling_underwater_obstacle hazards extending from the top and floor_underwater_obstacle hazards extending from the bottom with a gap through which Kino navigates using inverted buoyancy, consistent with Requirement 38 criterion 2.

### Requirement 6: Movement Mode Transitions

**User Story:** As a player, I want movement changes to be clearly signaled by the environment, so that I have time to react and am never surprised.

#### Acceptance Criteria

1. THE Game SHALL select Movement_Mode transitions based on the environment.
2. THE Game SHALL NOT provide any manual control for the player to select a Movement_Mode during a run.
3. WHEN a Transition is approaching, THE Game SHALL display a visual telegraph before the Transition begins.
4. WHILE a Transition is in progress, THE Game SHALL disable all Skills.
5. WHILE a Transition is in progress, THE Game SHALL hide Cosmetic layers.
6. WHILE a Transition is in progress, THE Game SHALL give the Transition animation rendering priority over other character layers.
7. WHEN Kino transitions from Flight to Zigzag, THE Game SHALL play a spin telegraph and render Kino in a pointed arrow form for the Zigzag segment.
8. WHEN a Zigzag segment ends, THE Game SHALL reverse the Zigzag Transition back to the Flight form.
9. WHEN the water-surface crossing event fires for Kino crossing from above the water surface to below, THE Game SHALL play a surface-crossing Transition into the Underwater_Buoyancy Movement_Mode.
10. WHEN the water-surface crossing event fires for Underwater buoyancy launching Kino above the water surface, THE Game SHALL transition Kino back into the Flight Movement_Mode.
11. IF a transition between the Underwater_Buoyancy Movement_Mode and the Flight Movement_Mode is attempted without the water-surface crossing event firing, THEN THE Game SHALL keep Kino in the current Movement_Mode and SHALL NOT perform the transition.

### Requirement 7: World Progression and Unlocks

**User Story:** As a player, I want to unlock the next world by surpassing enough obstacles, so that I progress through the story without being forced to stop.

#### Acceptance Criteria

1. WHEN the player reaches 50 points in a story World, THE Game SHALL mark the next World as unlocked.
2. WHEN the player reaches 50 points in a story World, THE Game SHALL make Kino hover in place and display a "new world unlocked" message.
3. WHEN the "new world unlocked" message has been displayed, THE Game SHALL display a message indicating that endless mode is starting.
4. WHEN the endless-mode-starting message has been displayed, THE Game SHALL resume the same run continuing endlessly with ramping difficulty rather than starting a separate run.
5. THE Game SHALL NOT auto-transition to the next World at 50 points.
6. WHILE a run in Worlds 1 through 4 continues beyond 50 points, THE Game SHALL increase difficulty by ramping speed and obstacle density, all whilst making it feasible for player.
7. WHEN Kino collides with an Obstacle, THE Game SHALL end the current run and return the player to the main menu with the next World unlocked and selectable.
8. WHEN the player is at the main menu after unlocking a World, THE Game SHALL allow the player to choose any unlocked World to play next.
9. WHILE a run is active, THE Game SHALL provide a pause control.
10. WHEN the player activates the pause control, THE Game SHALL pause gameplay, movement, obstacle progression, Skill cooldown timers, and active skill-effect timers.
11. WHILE the Game is paused, THE Game SHALL hold Skill cooldown timers and active skill-effect timers at their current values and SHALL NOT advance those timers.
12. WHEN the player resumes from pause, THE Game SHALL resume Skill cooldown timers and active skill-effect timers from their held values.
13. WHEN the player resumes from pause, THE Game SHALL continue the run from the paused state.

### Requirement 8: World 5 — Security Citadel Finale

**User Story:** As a player reaching the final world, I want a designed climactic sequence that combines every ability, so that the story reaches a satisfying payoff.

#### Acceptance Criteria

1. THE Game SHALL present World 5 as a finite designed progression rather than an Endless_Mode.
2. THE Game SHALL compose World 5 as chained Sequences presenting Flight Sequences, Zigzag Sequences, and Underwater Sequences, with an environment-forced, telegraphed Transition between Sequences.
3. THE Game SHALL make the Sequence immediately preceding the World 5 final finale Sequence a Flight Sequence, so that the Flight Movement_Mode is the active Movement_Mode leading into the finale.
4. WHILE a Sequence in World 5 before the final finale is active, THE Game SHALL make exactly one of the Flight, Zigzag, or Underwater_Buoyancy Movement_Modes active for that Sequence.
5. IF more than one Movement_Mode would be active during a World 5 Sequence before the final finale, THEN THE Game SHALL forcibly deactivate the extra Movement_Modes so that exactly one Movement_Mode remains active.
6. THE Game SHALL make the Jumping Movement_Mode available in World 5 only during the final finale Sequence.
7. WHEN the player reaches the final finale Sequence of World 5, THE Game SHALL disable Flight and cause Kino to descend to the ground.
8. WHEN Kino stops flying at the start of the World 5 final finale Sequence, THE Game SHALL take automatic control of Kino and SHALL play the finale as an in-engine scripted sequence rather than as Comic_Panels.
9. WHILE the World 5 final finale automatic sequence is playing, THE Game SHALL drive Kino automatically through the crawl locomotion and then the running locomotion without player locomotion input, up to the portal barrier.
10. WHEN Kino reaches the ground in the final finale Sequence, THE Game SHALL render Kino in a distinct restricted locomotion state in which Kino crawls and walks in an exhausted state.
11. WHILE Kino is in the World 5 final finale restricted locomotion state, THE Game SHALL alternate the crawl-step-right and crawl-step-left Animation_Frames as a repeating crawl cycle consistent with Requirement 30 criterion 14.
12. WHEN the automatic finale sequence advances Kino from the crawl locomotion into the running locomotion, THE Game SHALL alternate the run-step-right and run-step-left Animation_Frames as the World 1 run walk cycle consistent with Requirement 30 criterion 13.
13. WHILE Kino is in the restricted locomotion state and has not yet reached the portal barrier, THE Game SHALL keep the Jumping action unavailable.
14. WHEN Kino reaches the portal barrier in the final finale Sequence, THE Game SHALL make the Jumping action available for the final action.
15. WHEN the player performs the final primary action at the portal barrier, THE Game SHALL cause Kino to Jump through the barrier into the final cinematic.

### Requirement 9: Scoring Consistency

**User Story:** As a player, I want my score to be accurate and consistent, so that high scores are fair and meaningful.

#### Acceptance Criteria

1. WHEN a Scoring_Event occurs, THE Game SHALL trigger that Scoring_Event exactly once for its associated Obstacle or checkpoint.
2. WHEN a Scoring_Event occurs, THE Game SHALL attribute the Scoring_Event to the Movement_Mode active at the moment the associated Obstacle or checkpoint is cleared.
3. IF a single Obstacle or checkpoint produces more than one Scoring_Event, a Scoring_Event of a value other than its defined value, or a Scoring_Event attributed to a Movement_Mode other than the one active at the moment of clearing, THEN THE Game SHALL treat that outcome as an invalid scoring result.
4. WHILE a score multiplier is active, THE Game SHALL apply to each Scoring_Event the multiplier that is active at the moment the score for that Scoring_Event is credited.
5. WHEN a Scoring_Event occurs, THE Game SHALL immediately update the score display to show the score value that results from applying that Scoring_Event.
6. WHERE an Obstacle is composed of multiple visual elements, THE Game SHALL record at most one Scoring_Event for that Obstacle.

### Requirement 10: Perk Selection

**User Story:** As a player, I want to choose a passive bonus at milestones during a run, so that I can shape my run strategy.

#### Acceptance Criteria

1. WHEN the player surpasses Obstacle 20 in a run, THE Game SHALL present exactly two Perk choices for selection.
2. WHEN the player surpasses Obstacle 40 in a run, THE Game SHALL present exactly two Perk choices for selection.
3. WHEN the player selects a Perk, THE Game SHALL apply that Perk for the remainder of the current run.
4. IF a run ends by collision before the player reaches 50 points in a story World, THEN THE Game SHALL discard the Perks selected during that run and SHALL NOT retain those Perks.
5. WHEN the player reaches 50 points in a story World, THE Game SHALL retain the Perks selected during that clearing run for the remainder of the current Generation's story.
6. WHEN a new Generation begins, THE Game SHALL reset retained Perks consistent with Requirement 22 criterion 3.
7. THE Game SHALL NOT present Perk choices during an Endless_Mode run, consistent with Requirement 23 criterion 9.
8. WHERE a random Cosmetic is offered at a Perk selection, THE Game SHALL display the Cosmetic in a center slot with the two Perk choices positioned to the sides.
9. WHERE a random Cosmetic is offered, THE Game SHALL offer only a Cosmetic the player does not already own.
10. WHERE a random Cosmetic is offered, THE Game SHALL indicate the Cosmetic's rarity tier by color.
11. WHEN the player obtains a Cosmetic from a Perk selection, THE Game SHALL persist that Cosmetic permanently in the Save_Store across generations.

### Requirement 11: Passive Perk Effects

**User Story:** As a player, I want perks that meaningfully change my run, so that milestone choices matter.

#### Acceptance Criteria

1. WHERE the Reduced Skill Cooldown Perk is active, THE Game SHALL reduce Skill cooldown durations by a configurable percentage.
2. WHERE the Speed Boost Perk is active, THE Game SHALL increase run speed by a configurable percentage.
3. THE Game SHALL store Perk data separately from Skill data.
4. WHEN a new Generation begins, THE Game SHALL reset all Perks.
5. THE Game SHALL read Perk percentages, Cosmetic drop probabilities, and rarity tier definitions from configurable balance values.

### Requirement 12: Active Skills — Equipping and Feedback

**User Story:** As a player, I want to equip and monitor an active skill, so that I can use it tactically during a run.

#### Acceptance Criteria

1. THE Game SHALL present an inventory of unlocked Skills along the bottom of the screen.
2. WHEN the player equips a Skill from the inventory, THE Game SHALL set that Skill as the active equipped Skill.
3. WHILE a run is active, THE Game SHALL display the equipped Skill's icon, availability, cooldown, and effect duration.
4. WHILE a Transition is in progress, THE Game SHALL disable Skill activation.
5. WHERE a cooldown-reduction Perk is active, THE Game SHALL reduce the equipped Skill's cooldown accordingly.
6. WHEN a Skill is unlocked, THE Game SHALL persist that Skill permanently in the Save_Store across generations.
7. WHILE a run is active, THE Game SHALL render the equipped Skill control at the bottom-right of the run HUD.
8. WHEN the player opens the Skills control, THE Game SHALL render the Inventory_Panel with the Skills tab active.
9. WHEN the player opens the Skills control, THE Game SHALL preview the equipped Skill above Kino with a highlighted outline.
10. THE Game SHALL render the Skills inventory as a scrollable grid within the Inventory_Panel.
11. THE Game SHALL render locked Skills in the Inventory_Panel in a greyed, non-selectable state.
12. WHEN the player selects an owned Skill in the Inventory_Panel, THE Game SHALL mark that Skill equipped and reflect it in the preview above Kino.
13. THE Game SHALL unlock active Skills through World and Generation completion milestones defined in the Skill_Unlock_Schedule, and SHALL NOT unlock Skills through the perk-choice drop.
14. WHERE a Skill is displayed in the Inventory_Panel, THE Game SHALL indicate that Skill's rarity tier by color, consistent with how Cosmetic rarity is shown.
15. WHEN the player activates an equipped Skill while that Skill is on cooldown or otherwise unavailable, THE Game SHALL silently defer the activation and SHALL NOT display any indication of the activation.

### Requirement 13: Active Skill — Second Chance

**User Story:** As a player, I want a skill that lets me survive one hit, so that I can recover from a mistake.

#### Acceptance Criteria

1. WHEN the player activates Second Chance, THE Game SHALL protect Kino from one collision for up to the next 3 seconds.
2. IF Kino collides with an Obstacle while Second Chance protection is active, THEN THE Game SHALL cause Kino to phase through the Obstacle, continue the run, consume the Second Chance protection, and end Second Chance immediately.
3. IF Kino collides with an Obstacle after the Second Chance protection has been consumed and within the remaining 3-second window, THEN THE Game SHALL resolve that collision as a normal hit.
4. WHEN Second Chance resolves, THE Game SHALL fade out the angel halo visual.

### Requirement 14: Active Skill — Time Erase

**User Story:** As a player, I want a skill that undoes an imminent collision, so that I can escape a deadly situation.

#### Acceptance Criteria

1. WHEN the player activates Time Erase, THE Game SHALL open a 4 second protection window.
2. IF Kino would collide with an Obstacle while Time Erase is active, THEN THE Game SHALL prevent the collision and reposition Kino to a safe position thus ending the protection window.
3. WHEN Time Erase repositions Kino, THE Game SHALL place Kino in a position that does not overlap any Obstacle.
4. WHEN Time Erase resolves, THE Game SHALL allow the run to continue.

### Requirement 15: Active Skill — Dash

**User Story:** As a player, I want a horizontal burst skill, so that I can quickly cover distance.

#### Acceptance Criteria

1. WHEN the player activates Dash, THE Game SHALL move Kino in a burst along a direction determined by the active Movement_Mode.
2. THE Game SHALL read Dash distance, duration, and collision behavior from configurable balance values.
3. WHILE the Jumping, Flight, or Underwater_Buoyancy Movement_Mode is active, WHEN the player activates Dash, THE Game SHALL move Kino in a straight horizontal-line burst.
4. WHILE the Zigzag Movement_Mode is active, WHEN the player activates Dash, THE Game SHALL move Kino in a burst along Kino's current diagonal trajectory.

### Requirement 16: Active Skill — Time Slow

**User Story:** As a player, I want a skill that slows the game, so that I can react to difficult sections.

#### Acceptance Criteria

1. WHEN the player activates Time Slow, THE Game SHALL slow Kino's movement and Obstacle progression together by a consistent factor.
2. THE Game SHALL read the Time Slow factor and duration from configurable balance values.

### Requirement 17: Active Skill — Score Multiplier

**User Story:** As a player, I want a skill that boosts my points, so that I can increase my score during good runs.

#### Acceptance Criteria

1. WHEN the player activates Score Multiplier, THE Game SHALL double the value of each Scoring_Event whose score is credited within the next 10 seconds, applying the multiplier that is active at the moment the score for that Scoring_Event is credited.
2. WHILE Score Multiplier is active, THE Game SHALL reflect the multiplier in the score display.

### Requirement 18: Active Skill — Ultra Instinct

**User Story:** As a player, I want a skill that automatically dodges hits, so that I gain temporary invulnerability through evasion.

#### Acceptance Criteria

1. WHEN the player activates Ultra Instinct, THE Game SHALL enable automatic evasion for the next 10 seconds.
2. IF Kino would be hurt while Ultra Instinct is active, THEN THE Game SHALL teleport Kino to a safe position along the vertical axis.

### Requirement 19: Cosmetics and Layered Rendering

**User Story:** As a player, I want to customize Kino with cosmetics, so that I can personalize my character across runs and generations.

#### Acceptance Criteria

1. THE Game SHALL render base Kino independently of any Cosmetic.
2. THE Game SHALL render each Cosmetic as a separate transparent layer positioned over base Kino.
3. WHILE Kino changes animation or Movement_Mode, THE Game SHALL position Cosmetic layers correctly for the current animation and Movement_Mode.
4. THE Game SHALL NOT require a unique full sprite per Cosmetic combination.
5. WHEN a Cosmetic is unlocked, THE Game SHALL persist that Cosmetic permanently in the Save_Store across generations.
6. THE Game SHALL treat each Cosmetic layer as a purely visual element and SHALL exclude every Cosmetic layer from collision detection, consistent with Requirement 41 criteria 4 and 5.

### Requirement 20: Main Menu and Treasure Map

**User Story:** As a player, I want a minimal menu with a visual progression map, so that I can see my progress and choose where to go.

#### Acceptance Criteria

1. THE Game SHALL present a start screen containing a Start control.
2. THE Game SHALL present a central vertical treasure-map with one checkpoint per World, each world being represented by a rectangular drawing with trasure-map layered on top, and on top of that the checkpoint/marker.
3. THE Game SHALL render completed Worlds on the map in a greyed state.
4. THE Game SHALL render undiscovered Worlds on the map as dark silhouettes.
5. THE Game SHALL display a marker for Kino's current location on the map.
6. WHERE the map extends beyond the visible area, THE Game SHALL allow the player to scroll the map.
7. THE Game SHALL display a representation of Kino on the menu.
8. WHEN the player opens the Cosmetics control, THE Game SHALL allow customization of Kino in place while fading other menu elements.
9. WHEN the player opens the Skills control, THE Game SHALL allow equipping a Skill in place.
10. WHEN the player opens the Info control, THE Game SHALL display current run statistics.
11. THE Game SHALL display the current Generation name prominently on the menu.
12. WHEN the player presses the Continue Story control, THE Game SHALL expand to full screen, keep Kino placed, and glide Kino to the gameplay start position.
13. THE Game SHALL present a bottom primary button whose label depends on the player's current story position, read from the Config_File as follows:
    - 13a. WHILE the player's current story position is World 1 at the beginning and the story is not yet started, THE Game SHALL label the bottom primary button with the "Start Story" label value read from the Config_File.
    - 13b. WHILE the player's current story position is beyond World 1, THE Game SHALL label the bottom primary button with the "Continue Story" label value read from the Config_File.
    - 13c. THE Game SHALL read both the "Start Story" label value and the "Continue Story" label value from the Config_File.
14. WHEN the player presses the bottom primary button, THE Game SHALL launch the next available story step.
15. THE Game SHALL present a top header section containing a replay control and the current Generation_Name.
16. WHILE the menu is displayed, THE Game SHALL display the player's Kino on the menu.
17. WHEN the player opens the Cosmetics control or the Skills control, THE Game SHALL customize or equip Kino in place while fading other menu elements.
18. THE Game SHALL render each undiscovered World on the map as a black silhouette.
19. THE Game SHALL render each completed or previously discovered World on the map in a greyed state.
20. THE Game SHALL render exactly one checkpoint per World on the map.
21. WHILE the menu is displayed, THE Game SHALL display a marker for Kino's current location on the map.
22. WHERE the treasure map extends beyond the visible area, THE Game SHALL allow the player to scroll the map vertically.
23. THE Game SHALL render a Stats control in the top-left corner of the menu that opens the run Info panel.
24. THE Game SHALL render a Settings control in the top-right corner of the menu.
25. THE Game SHALL render the current Generation_Name as a pill in the top-center of the menu.
26. THE Game SHALL render a Cosmetics control to the left of Kino and a Skills control to the right of Kino on the menu.
27. THE Game SHALL render the World 1 Desert panel at the bottom of the vertical map with higher-numbered Worlds stacked above it.
28. THE Game SHALL render the next World to be revealed as fading in at the top edge of the map.
29. THE Game SHALL render an Endless_Mode trigger as a triangle button on the right side of each World panel.
30. WHILE a World has not been cleared, THE Game SHALL render that World's Endless_Mode trigger in a greyed, locked state.
31. WHEN a World is cleared, THE Game SHALL render that World's Endless_Mode trigger in an active state.
32. THE Game SHALL render a Play control as a large button at the bottom of the menu.
33. WHILE the player scrolls the World map, THE Game SHALL snap the center position to the nearest discovered World, which becomes the Locked_In_World, and SHALL highlight the Locked_In_World with a side glow.
34. WHILE an undiscovered silhouette World is centered on the map, THE Game SHALL show no side glow, SHALL leave no World locked in, SHALL visually indicate that the centered World cannot be selected, and SHALL disable or ignore the Play control so that no run launches.
35. WHEN the player presses the Play control, THE Game SHALL launch the Locked_In_World.
36. WHEN the player presses the Play control, THE Game SHALL expand the Play control as a color fill growing upward until the color fill covers the entire screen.
37. WHEN the color fill covers the entire screen, THE Game SHALL fade in the gameplay HUD controls and the World background.
38. WHEN the World background has faded in, THE Game SHALL glide Kino from the menu position to the gameplay start position on the left of the screen where Kino stabilizes for the run.
39. WHILE a run is active, THE Game SHALL render the Score at the top of the run HUD.
40. WHILE a run is active, THE Game SHALL render a Menu control on the run HUD that returns the player to the menu.
41. WHILE a run is active, THE Game SHALL render Obstacles entering from the right of the screen and the ground at the bottom of the screen.
42. WHEN the player opens the Cosmetics control, THE Game SHALL render the Inventory_Panel with the Cosmetics tab active.
43. WHEN the player opens the Cosmetics control, THE Game SHALL keep Kino fixed in the upper area and preview the equipped Cosmetic above Kino with a highlighted outline.
44. THE Game SHALL render the Inventory_Panel in the lower half of the screen as a tabbed view containing a Cosmetics tab and a Skills tab, with the active tab visually indicated as selected.
45. THE Game SHALL render the Cosmetics inventory as a scrollable grid within the Inventory_Panel.
46. THE Game SHALL render unowned Cosmetics in the Inventory_Panel in a greyed, non-selectable state.
47. WHEN the player selects an owned Cosmetic in the Inventory_Panel, THE Game SHALL mark that Cosmetic equipped and reflect it in the preview above Kino.
48. WHEN the player opens the Settings control, THE Game SHALL present the Settings_Screen including an audio volume control, control rebinding consistent with Requirement 1, and a reset-save option.
49. WHEN the player changes a setting on the Settings_Screen, THE Game SHALL persist the changed setting in the Save_Store.
50. WHEN the player selects the reset-save option, THE Game SHALL require a confirmation before erasing persisted progress.
51. WHEN the player confirms the reset-save option, THE Game SHALL reset the Save_Store to the First_Launch_State.

### Requirement 21: Cinematics

**User Story:** As a player, I want comic-panel cinematics that tell Kino's story, so that the worlds feel connected and rewarding.

#### Acceptance Criteria

1. WHEN a new Generation's story begins, THE Game SHALL play the opening cinematic depicting the egg kick, a permission-denied gag, a fall through comic panels, and a desert landing and hatch.
2. WHEN the player enters a World for the first time in the current Generation, THE Game SHALL play the mentor comic-panel cutscene in which the Mentor teaches the World's required movement, followed by an Evolution animation after which Kino remains in the evolved state for that World for the remainder of the Generation. On World 1, egg cracks yielding the kino ghost hatchling. On all other worlds, the evolution effect with a subtle visual change.
3. THE Game SHALL make the mentor cutscene skippable.
4. WHEN the player retries a World via the restart control or via the menu Continue or Play control within the same Generation after Kino is already evolved for that World, THE Game SHALL skip the mentor cutscene and start gameplay with Kino already evolved.
5. WHEN a new Generation begins, THE Game SHALL play the mentor cutscene again on the first entry of each World.
6. WHEN a World is completed, THE Game SHALL play a short world-completion cinematic and then return the player to the menu.
7. WHEN the player returns to the menu after completing a World, THE Game SHALL dissolve the newly unlocked World's silhouette to reveal the World.
8. WHEN the final World is completed, THE Game SHALL play the final cinematic depicting Kino's reunion, starting a family, and kicking the next egg to loop the story.
9. WHEN the final cinematic ends, THE Game SHALL present credits that include blooper-style outtakes referencing the creator and inspiration.
10. WHEN a new Generation begins, THE Game SHALL render previously discovered Worlds in a greyed state rather than black.
11. WHEN the opening cinematic begins, THE Game SHALL depict Mama Kino sitting on eggs in a henhouse inside a data center and knocking one egg out while scratching.
12. WHEN the knocked-out egg rolls down the ramp and strikes the button, THE Game SHALL display a permission-denied gag using the gag text value read from the Config_File.
13. WHEN the permission-denied gag has been displayed, THE Game SHALL open the ground and cause the egg to fall.
14. WHILE the egg is falling during the opening cinematic, THE Game SHALL display the five Worlds as stacked horizontal bands with World 5 at the top and World 1 at the bottom, and SHALL animate the egg descending downward through the bands in order from World 5 to World 1.
15. WHILE the egg is falling during the opening cinematic, THE Game SHALL render the band the egg currently occupies as shown, render bands the egg has not yet reached as hidden, and render bands the egg has already passed as dark greyed-out silhouettes.
16. WHEN the egg reaches the World 1 band during the opening cinematic, THE Game SHALL expand the World 1 band to fill the entire screen for the landing and hatch.
17. WHEN the falling egg lands in the desert, THE Game SHALL crack the egg and emerge baby Kino as a ghost that initially walks and then gains the Jumping ability.
18. THE Game SHALL make the opening cinematic skippable.
19. WHEN a Generation's story is completed, THE Game SHALL advance the current Kino from Junior to Senior of the same iteration number in the final cinematic.
20. WHEN the final cinematic depicts the next egg being knocked out, THE Game SHALL label that egg with the next iteration number and the Junior suffix.

### Requirement 22: Generational Persistence

**User Story:** As a player, I want my permanent progress to survive across sessions and generations, so that my accomplishments are retained.

#### Acceptance Criteria

1. THE Game SHALL persist unlocked Skills permanently across Generations in the Save_Store.
2. THE Game SHALL persist unlocked Cosmetics, including random-drop Cosmetics, permanently across Generations in the Save_Store.
3. WHEN a new Generation begins, THE Game SHALL reset learned movement abilities, Perks, temporary run bonuses, current run score, and current run progression while leaving Skills and Cosmetics persisted.
4. WHEN a Generation is completed, THE Game SHALL unlock a unique Cosmetic reward for that Generation.
5. WHEN a Generation is completed, THE Game SHALL advance the Generation name.
6. THE Game SHALL store persistent data in a durable browser-based Save_Store.
7. WHEN the player returns in a later session, THE Game SHALL restore Skills, Cosmetics, control bindings, Generation name, and high scores from the Save_Store, and SHALL NOT restore learned movement abilities.

### Requirement 23: Endless Mode

**User Story:** As a player, I want a pure high-score mode for completed worlds, so that I can test my skill outside the story.

#### Acceptance Criteria

1. THE Game SHALL support Endless_Mode with procedural generation for Worlds 1 through 4.
2. THE Game SHALL NOT offer Endless_Mode for World 5.
3. WHILE an Endless_Mode run continues, THE Game SHALL ramp difficulty by increasing speed, density, obstacle configuration difficulty, and Transition frequency.
4. WHERE a World is discovered and completed, THE Game SHALL present an Endless_Mode control in the top-right of that World on the map.
5. WHEN the player selects the Endless_Mode control, THE Game SHALL present a confirmation stating that Endless_Mode is outside story progression.
6. WHEN an Endless_Mode run ends, THE Game SHALL award no story progress, unlocks, Perks, or Cosmetics.
7. WHILE a World is played in Endless_Mode, THE Game SHALL restrict movement to the abilities available up to and including that World in the story.
8. THE Game SHALL NOT allow abilities from Worlds later than the played World to be used in that World's Endless_Mode run.
9. THE Game SHALL NOT present Perk choices during an Endless_Mode run.

### Requirement 24: Asset Architecture and Placeholder Strategy

**User Story:** As a developer, I want gameplay logic separated from assets and buildable with placeholders, so that final art can be added later without changing gameplay.

#### Acceptance Criteria

1. THE Game SHALL present placeholder assets consisting of simple geometric shapes and temporary sprites, backgrounds, and UI, and SHALL function with those placeholder assets.
2. THE Game SHALL provide a visually distinguishable placeholder environment and obstacle set for each World.
3. THE Game SHALL preserve collision, physics, and scoring behavior identically whether placeholder or final assets are used.
4. THE Game SHALL provide a centralized Asset_Registry and SHALL separate visual assets from gameplay logic, such that both the centralization of the Asset_Registry and the separation of visual assets from gameplay logic hold.
5. THE Game SHALL organize character animations, backgrounds, obstacles, UI, and cinematics as modular asset groups.
6. WHEN a final asset replaces a placeholder in the Asset_Registry, THE Game SHALL perform that replacement only at build-time or on level or game load, and SHALL use the final asset without changes to gameplay logic.
7. THE Game SHALL use the existing starter assets `assets/ghosty.png`, `assets/jump.wav`, `assets/game_over.wav`, and `img/example-ui.png` within the Asset_Registry.
8. IF the Asset_Registry is populated from the Config_File, THEN THE Game SHALL hold both role properties: the Config_File is the user-facing editable source and the Asset_Registry is the internal mapping consumed by gameplay.
9. THE Game SHALL declare, for each Movement_Mode, the exact set of Animation_Frames that Movement_Mode requires, each mapped to a named Config_File key.
10. WHERE a configured asset path in the Config_File is missing or empty, THE Game SHALL fall back to the corresponding placeholder asset so that gameplay remains functional.
11. THE Game SHALL assign every Obstacle type across all Worlds a named Obstacle_Category key in the Config_File / Asset_Registry, following a consistent naming convention, so that each Obstacle type's art can be replaced independently without changes to gameplay logic.

### Requirement 25: Audio

**User Story:** As a player, I want clear audio feedback, so that key events are immediately recognizable.

#### Acceptance Criteria

1. THE Game SHALL play a distinct sound for each of the Jumping, Flight, Zigzag, and Underwater_Buoyancy movement actions.
2. WHEN an Evolution animation plays, THE Game SHALL play an Evolution sound effect.
3. WHEN Kino collides with an Obstacle, THE Game SHALL play a collision or failure sound effect.
4. WHEN the player interacts with a UI control, THE Game SHALL play a UI sound effect.
5. WHERE a World is active, THE Game SHALL play that World's background music.
6. WHERE mentor reactions are enabled, THE Game SHALL play mentor voice-like reaction sounds.
7. THE Game SHALL provide a player control to adjust audio volume and to mute audio.
8. WHEN the player adjusts or mutes audio volume, THE Game SHALL persist the volume setting in the Save_Store.
9. WHERE the browser blocks audio autoplay before user interaction, THE Game SHALL start audio only after the first user interaction rather than failing.

### Requirement 26: Performance and Non-Functional Quality

**User Story:** As a player, I want responsive and smooth gameplay in the browser, so that the experience is enjoyable even with many elements on screen.

#### Acceptance Criteria

1. THE Game SHALL run in a web browser.
2. WHEN the player provides a primary action, THE Game SHALL respond within one rendered frame.
3. WHILE multiple parallax layers, particles, obstacles, and animations are on screen, THE Game SHALL maintain a consistent frame rate.
4. WHEN a Transition occurs, THE Game SHALL render the Transition smoothly without visible stutter.
5. THE Game SHALL load assets efficiently to avoid gameplay interruption.
6. THE Game SHALL implement obstacle and ability systems as reusable modules so that new abilities and obstacles can be added without rewriting the game.
7. THE Game SHALL apply consistent collision detection across all Movement_Modes.
8. THE Game SHALL read per-World difficulty from scalable configuration values.
9. WHILE gameplay is active, THE Game SHALL target 60 frames per second, and IF the Game is under load, THEN THE Game SHALL degrade gracefully by reducing non-essential visual effects rather than stalling.
10. THE Game SHALL render an Adaptive_Layout that resizes to fit the available screen rather than a fixed phone-sized viewport.
11. THE Game SHALL target a squarish desktop-style aspect ratio and SHALL remain usable across common desktop and tablet screen sizes.
12. WHEN the screen size changes, THE Game SHALL reposition and rescale UI and gameplay elements proportionally.

### Requirement 27: World Theming and Mentors

**User Story:** As a player, I want each world to have a distinct theme and mentor, so that progression feels varied and characterful.

#### Acceptance Criteria

1. THE Game SHALL theme World 1 as a Desert tied to the Networking service family (Route 53, VPC, CloudFront) and introduce the Jumping ability.
2. THE Game SHALL theme World 2 as a Foundry tied to the Compute service family (EC2, Lambda, ECS) and introduce the Flight ability.
3. THE Game SHALL theme World 3 as a Memory Jungle tied to the Databases service family (RDS, DynamoDB, ElastiCache) and introduce the Zigzag ability.
4. THE Game SHALL theme World 4 as Ice & Underwater tied to the Storage service family (S3, S3 Glacier, EBS) and introduce the Underwater_Buoyancy ability.
5. THE Game SHALL theme World 5 as a Security Citadel tied to the Security service family (IAM, KMS, WAF, Shield, GuardDuty) and combine all four abilities, with the Jumping ability returning at the finale.
6. WHEN a World intro plays, THE Game SHALL present that World's themed Mentor.
7. THE Game SHALL present AWS references as in-world flavor rather than instructional tutorial content.
8. THE Game SHALL render World 1 environment elements including a long desert highway, Route 53 road signs, cacti, rocks, and tumbleweeds.
9. THE Game SHALL render World 2 environment elements including mountains, lava rocks, industrial pipes, and mechanical compute structures.
10. THE Game SHALL render World 3 environment elements including dense jungle, vines, caves, and interconnected paths that require the correct route.
11. THE Game SHALL render World 4 environment elements including icebergs, icy structures, a water surface, and underwater obstacles, with an icy surface navigated before entering the water.
12. THE Game SHALL render World 5 environment elements including a futuristic data center, security infrastructure, defensive barriers, and restricted zones.
13. THE Game SHALL apply each World's Color_Palette from the Config_File, defaulting World 1 to warm orange and sandy yellow, World 2 to industrial orange-red with steel grey and lava glow, World 3 to deep blue and jungle green, World 4 to glacier cyan with teal and icy white, and World 5 to dark steel with red alert accents, where each per-World Color_Palette defines element-level color treatment for background, Obstacles, and Kino rather than a background color alone.
14. THE Game SHALL include element-level overlay/tint treatment in each World's Color_Palette default, defaulting the underwater sequences to a blue overlay applied over the Obstacles and Kino.
15. WHEN the player advances past a story World, THE Game SHALL mark that earlier World as left behind and SHALL NOT allow replaying that World in story mode, leaving Endless_Mode as the only way to replay a completed World.
16. WHEN a World is marked left behind, THE Game SHALL block story-mode replay access to that World only, and SHALL keep all rewards and unlocks previously earned from that World valid and unaffected.

### Requirement 28: High-Score Tracking

**User Story:** As a player, I want my best scores tracked per world and mode, so that I can measure my improvement over time.

#### Acceptance Criteria

1. THE Game SHALL persist a High_Score per story World in the Save_Store.
2. THE Game SHALL persist a High_Score per Endless_Mode World in the Save_Store, stored separately from story High_Scores.
3. WHEN a run ends with a score exceeding the stored High_Score for that mode and World, THE Game SHALL update and persist the new High_Score.
4. WHEN the player views the menu or the run-end screen, THE Game SHALL display the relevant High_Score for the selected mode and World.

### Requirement 29: Mentors and Evolution

**User Story:** As a player, I want a distinct mentor to introduce each world's ability followed by an evolution, so that learning each movement feels characterful and earned.

#### Acceptance Criteria

1. THE Game SHALL provide five Mentors, each of the Kino species, with one Mentor assigned per World, each Mentor having a distinct profession and an associated AWS symbol.
2. THE Game SHALL assign the World 1 Mentor as a networking specialist with the Route 53 symbol, defaulting to the name "Officer Kino-Route-53" read from the Config_File.
3. THE Game SHALL assign the World 2 Mentor as an industrial engineer with the EC2 symbol who introduces Flight, defaulting to the name "Engineer Kino-EC2" read from the Config_File.
4. THE Game SHALL assign the World 3 Mentor as an archivist with a Databases symbol who introduces Zigzag, defaulting to the name "Archivist Kino" read from the Config_File.
5. THE Game SHALL assign the World 4 Mentor as a storage keeper with a Glacier symbol who introduces Underwater_Buoyancy, defaulting to the name "Storage Keeper Kino" read from the Config_File.
6. THE Game SHALL assign the World 5 Mentor as a security commander with the IAM symbol, defaulting to the name "Commander Kino-IAM" read from the Config_File.
7. WHEN a World is entered for the first time in the current Generation, THE Game SHALL present that World's Mentor, who introduces the World's required Movement_Mode, immediately before the Evolution.
8. WHEN the Mentor interaction completes, THE Game SHALL play an Evolution animation after which Kino visibly advances form and gains the World's ability for the current Generation.
9. THE Game SHALL read the Evolution animation style from the Config_File, defaulting to an electric-zap, glowing-outline, and energy-burst effect.
10. WHEN the World 1 Evolution plays, THE Game SHALL depict the egg cracking into the walking and jumping baby ghost.
11. WHEN an Evolution plays in Worlds 2 through 5, THE Game SHALL show an evolution effect with a subtle visual change to Kino.
12. THE Game SHALL read the base character name "Kino" and all Mentor names from the Config_File so that they can be renamed without changes to gameplay logic.

### Requirement 30: Visual Direction

**User Story:** As a player, I want a bold, original comic-book art direction, so that the game has a distinctive and cohesive visual identity.

#### Acceptance Criteria

1. THE Game SHALL render characters and environments in an original 2D comic-book aesthetic using thick irregular black outlines, cel-shaded surfaces, halftone shading, and exaggerated facial expressions.
2. THE Game SHALL apply saturated, distinctive per-World Color_Palettes with strong foreground-to-background contrast.
3. THE Game SHALL render multi-layer parallax backgrounds that scroll at different speeds and change per World.
4. THE Game SHALL organize character animation as discrete Animation_Frames per Movement_Mode motion state, including, for the Flight Movement_Mode, frames for ascending, descending, zero vertical velocity, and crashing.
5. THE Game SHALL define, for each Movement_Mode, the set of Animation_Frames that Movement_Mode requires.
6. THE Game SHALL apply the comic-book visual direction to both placeholder and final art, with placeholders approximating the Color_Palettes and contrast and final art swapped in via the Asset_Registry without changes to gameplay logic.
7. THE Game SHALL require the following named Animation_Frames for the Jumping Movement_Mode: run-step-right, run-step-left, jump-go-up, jump-apex, jump-go-down.
8. THE Game SHALL require the following named Animation_Frames for the Flight Movement_Mode: fly-up, fly-apex, fly-down.
9. THE Game SHALL reuse the Flight Animation_Frames (fly-up, fly-apex, fly-down) for the Underwater_Buoyancy Movement_Mode and SHALL NOT require separate Underwater_Buoyancy character Animation_Frames, because the Underwater_Buoyancy movement is the inverse of Flight.
10. THE Game SHALL require the following named Animation_Frames for the Zigzag Movement_Mode: zigzag-up, zigzag-down.
11. THE Game SHALL require the following named Animation_Frames for the Transition spin: spin-1, spin-2.
12. THE Game SHALL require the following named Animation_Frames for the World 5 finale crawl locomotion: crawl-step-right, crawl-step-left.
13. WHILE the Jumping Movement_Mode is active and Kino is moving along the ground and not airborne, THE Game SHALL alternate the run-step-right and run-step-left Animation_Frames as a repeating walk cycle.
14. WHILE Kino is in the World 5 finale restricted locomotion state, THE Game SHALL alternate the crawl-step-right and crawl-step-left Animation_Frames as a repeating crawl cycle.
15. WHILE a Transition spin is playing, THE Game SHALL alternate the spin-1 and spin-2 Animation_Frames as a repeating spin cycle.

### Requirement 31: Run Information Panel

**User Story:** As a player, I want an info panel that summarizes my current run and compares my scores across generations, so that I can track performance at a glance.

#### Acceptance Criteria

1. WHEN the player opens the Info control, THE Game SHALL display current-run statistics including obstacles cleared, active Perk effects expressed as plus or minus percentages, the equipped Skill, and the current score.
2. WHEN the player opens the Info control, THE Game SHALL display High_Scores per World for the current Generation alongside the best High_Scores from past Generations.

### Requirement 32: Generational Naming and Loop

**User Story:** As a player, I want a clear generational naming scheme and a visible egg handoff, so that each playthrough feels like part of a continuing family line.

#### Acceptance Criteria

1. THE Game SHALL compose the Generation_Name from a base character name, an iteration number, and a Junior or Senior suffix.
2. THE Game SHALL read the base character name and the generational naming scheme from the Config_File so that they can be changed without changes to gameplay logic.
3. WHEN a Generation's story is completed, THE Game SHALL change the current Kino's suffix from Junior to Senior while retaining the same iteration number.
4. WHEN the final cinematic shows the next egg being knocked out, THE Game SHALL label that egg with the next iteration number and the Junior suffix.
5. WHEN a new Generation begins, THE Game SHALL render previously discovered Worlds in a greyed state rather than a black silhouette.

### Requirement 33: Central Editable Configuration File

**User Story:** As a user supplying art and text, I want one central editable configuration layer separate from gameplay code, so that I can supply assets and change names, labels, and palettes without editing gameplay logic.

#### Acceptance Criteria

1. THE Game SHALL provide a Config_File that declares, as named editable variables, asset paths for Kino Animation_Frames per Movement_Mode and per required frame, cosmetic and hat image paths, Mentor image paths, per-World background and obstacle sprite paths, and audio paths.
2. THE Game SHALL declare in the Config_File the exact set of Animation_Frames required per Movement_Mode, each mapped to a clearly named key.
3. THE Game SHALL read all user-facing names and labels from the Config_File, including the base character name, Mentor names, World names, the generational naming scheme, UI labels such as the "CONTINUE STORY" label, and the permission-denied gag text.
4. THE Game SHALL read each per-World placeholder Color_Palette from the Config_File, including element-level color treatment for background, Obstacles, and Kino rather than a background color alone.
5. THE Game SHALL read element-level overlay/tint treatments from the Config_File so that they can be adjusted or replaced without changes to gameplay logic.
6. WHEN a Config_File value for an asset path, name, label, or Color_Palette is changed, THE Game SHALL use the new value without changes to gameplay logic.
7. WHERE a configured asset path in the Config_File is missing or empty, THE Game SHALL fall back to the corresponding placeholder so that the Game remains functional.
8. IF the Asset_Registry is populated from the Config_File, THEN THE Game SHALL hold both role properties: the Config_File is the user-facing editable source and the Asset_Registry is the internal mapping populated from the Config_File.
9. THE Game SHALL declare the following named Animation_Frame Config_File keys for the Jumping Movement_Mode: run-step-right, run-step-left, jump-go-up, jump-apex, jump-go-down.
10. THE Game SHALL declare the following named Animation_Frame Config_File keys for the Flight Movement_Mode: fly-up, fly-apex, fly-down.
11. THE Game SHALL reuse the Flight Animation_Frame Config_File keys (fly-up, fly-apex, fly-down) for the Underwater_Buoyancy Movement_Mode and SHALL NOT require separate Underwater_Buoyancy character Animation_Frame Config_File keys.
12. THE Game SHALL declare the following named Animation_Frame Config_File keys for the Zigzag Movement_Mode: zigzag-up, zigzag-down.
13. THE Game SHALL declare the following named Animation_Frame Config_File keys for the Transition spin: spin-1, spin-2.
14. THE Game SHALL declare the following named Animation_Frame Config_File keys for the World 5 finale crawl locomotion: crawl-step-right, crawl-step-left.
15. THE Game SHALL declare a named "menu-equip-jiggle" Config_File key for the menu equip jiggle animation asset.
16. WHERE the configured "menu-equip-jiggle" Config_File key is missing or empty, THE Game SHALL fall back to the corresponding placeholder so that the Game remains functional.

### Requirement 34: World Selection Lock-In

**User Story:** As a player, I want to pick which world to play by scrolling the treasure map and confirming the centered world, so that launching a run is a deliberate, clear choice.

#### Acceptance Criteria

1. WHILE the player scrolls the World map, THE Game SHALL snap the center position to the nearest discovered World, which becomes the Locked_In_World, and SHALL highlight the Locked_In_World with a side glow.
2. WHEN the player presses the Play control while a discovered World is locked in, THE Game SHALL launch the Locked_In_World.
3. WHILE an undiscovered silhouette World is centered on the map, THE Game SHALL show no side glow, SHALL leave no World locked in, SHALL visually indicate that the centered World cannot be selected, and SHALL disable or ignore the Play control so that no run launches.

### Requirement 35: Active Skill — Nuke

**User Story:** As a player, I want a skill that clears every obstacle on screen and credits me for them, so that I can escape a crowded section while still earning score.

#### Acceptance Criteria

1. WHEN the player activates Nuke, THE Game SHALL emit a radiation blast that destroys all Obstacles currently visible on screen.
2. WHEN Nuke destroys the visible Obstacles, THE Game SHALL award the Scoring_Events for every destroyed Obstacle_Unit as if Kino had cleared them.
3. WHILE a score multiplier is active when Nuke resolves, THE Game SHALL apply the active multiplier to each Scoring_Event awarded by Nuke.
4. WHEN Nuke awards a Scoring_Event for a destroyed Obstacle_Unit, THE Game SHALL trigger that Scoring_Event exactly once and SHALL NOT award it again if Kino later passes the cleared position.
5. WHEN Nuke resolves, THE Game SHALL place Nuke on cooldown.
6. WHILE a Transition is in progress, THE Game SHALL disable Nuke activation.
7. WHERE a cooldown-reduction Perk is active, THE Game SHALL reduce Nuke's cooldown accordingly.
8. WHILE a run is active with Nuke equipped, THE Game SHALL display Nuke's icon, availability, cooldown, and effect duration in the equipped-Skill HUD.

### Requirement 36: Skill Acquisition and Rarity Labeling

**User Story:** As a player, I want to earn active Skills by completing Worlds and Generations and to see each Skill's rarity as flavor, so that unlocking Skills feels like earned progression without rarity affecting balance.

#### Acceptance Criteria

1. THE Game SHALL unlock active Skills through World and Generation completion milestones, read from the Skill_Unlock_Schedule in the Config_File.
2. THE Game SHALL determine which Skill unlocks at each World by World order alone, assigning Skills from a fixed list order that matches the configured World order, such that completing each of the five Worlds for the first time unlocks one Skill each in that fixed list order, completing Generation 1 unlocks the sixth Skill, and completing Generation 2 unlocks the seventh Skill, across the seven Skills Second Chance, Time Erase, Dash, Time Slow, Score Multiplier, Ultra Instinct, and Nuke, with the Skill_Unlock_Schedule editable in the Config_File.
3. WHEN a Skill-unlock milestone defined in the Skill_Unlock_Schedule is reached, THE Game SHALL unlock the Skill mapped to that milestone and persist that Skill permanently in the Save_Store across Generations.
4. THE Game SHALL assign each Skill a rarity tier read from the Config_File and SHALL use that rarity tier for display and flavor only.
5. THE Game SHALL NOT let a Skill's rarity tier change that Skill's gameplay effect.
6. WHERE a Skill is displayed in the Inventory_Panel, THE Game SHALL indicate that Skill's rarity tier by color, consistent with how Cosmetic rarity is shown.
7. THE Game SHALL offer only Cosmetics in the perk-choice drop and SHALL NOT offer Skills in the perk-choice drop.

### Requirement 37: Loading Screen and Asset Preload

**User Story:** As a player, I want the game to preload assets behind a loading screen, so that moving between menus, cinematics, and gameplay happens without asset-load stalls.

#### Acceptance Criteria

1. WHEN the Game starts, THE Game SHALL display the Loading_Screen while it preloads the assets required for play.
2. WHILE assets are loading, THE Game SHALL display loading progress to the player.
3. WHEN all required assets have finished loading, THE Game SHALL enable entry to the main menu.
4. THE Game SHALL preload assets so that transitions between the menu, cinematic, and gameplay states occur without asset-load stalls.
5. WHERE an asset fails to load, THE Game SHALL fall back to that asset's placeholder, consistent with Requirement 24 criterion 10 and Requirement 33 criterion 7, and SHALL continue rather than blocking the Game.

### Requirement 38: Obstacle Categories and Placeholder Overlay Treatment

**User Story:** As a user supplying art, I want each obstacle type to have a named category key and each World's placeholder palette to define per-element color and overlay treatment, so that I can swap art per obstacle type and adjust scene tints without editing gameplay logic.

#### Acceptance Criteria

1. THE Game SHALL assign every Obstacle type across all Worlds a named Obstacle_Category key in the Config_File / Asset_Registry, following a consistent naming convention, so that each Obstacle type's art can be replaced independently without changes to gameplay logic.
2. THE Game SHALL categorize underwater Obstacles as named Obstacle_Category types including "ceiling_underwater_obstacle" attached to the top of the underwater area and "floor_underwater_obstacle" rising from the bottom of the underwater area, each mapped to a named Config_File key for art replacement, where both Obstacle_Category types appear within the underwater Sequence but SHALL NOT be required to appear at the same time.
3. THE Game SHALL define, as part of each World's placeholder Color_Palette in the Config_File, element-level color treatment for background, Obstacles, and Kino rather than a background color alone.
4. WHILE the Underwater_Buoyancy Movement_Mode is active or an underwater Sequence is active, THE Game SHALL apply the blue overlay/tint to both the Obstacles and Kino together as one atomic underwater treatment so that the scene reads as underwater.
5. THE Game SHALL read element-level overlay/tint treatments from the Config_File so that they can be adjusted or replaced without changes to gameplay logic.
6. WHEN a Config_File Obstacle_Category key or overlay/tint treatment value is changed, THE Game SHALL use the new value without changes to gameplay logic.

### Requirement 39: Run-End Screen

**User Story:** As a player, I want a clear screen when my run ends by collision, so that I can see how I did and quickly retry or return to the menu.

#### Acceptance Criteria

1. WHEN a run ends by collision, THE Game SHALL display the Run_End_Screen showing the final score, the relevant High_Score for that mode and World, the number of obstacles cleared, and the time spent in the run.
2. THE Game SHALL present a Retry control on the Run_End_Screen that starts a new run of the same World and mode.
3. THE Game SHALL present a Menu control on the Run_End_Screen that returns the player to the main menu.
4. WHEN the player retries from the Run_End_Screen within the same Generation and Kino is already evolved for that World, THE Game SHALL skip the mentor cutscene consistent with Requirement 21 criterion 4.

### Requirement 40: First-Launch Default State

**User Story:** As a new player, I want the game to start in a clean initial state on a brand-new save, so that my first playthrough begins at the start of the story.

#### Acceptance Criteria

1. WHEN the Game starts with no existing Save_Store data, THE Game SHALL initialize the First_Launch_State consisting of Generation 1 with the Junior suffix, no unlocked Skills, no unlocked Cosmetics, only World 1 available, and default control bindings.
2. WHEN the First_Launch_State is initialized, THE Game SHALL play the opening cinematic consistent with Requirement 21.

### Requirement 41: Collision Fairness

**User Story:** As a player, I want collisions to feel fair rather than punishing near-misses, so that the arcade movement feels responsive and forgiving.

#### Acceptance Criteria

1. THE Game SHALL use a collision hitbox for Kino that is read from configurable balance values and MAY be smaller than Kino's rendered sprite to keep collisions fair.
2. WHERE a Movement_Mode defines its own collision hitbox value, THE Game SHALL read that per-Movement_Mode hitbox value from configurable balance values, provided each per-Movement_Mode hitbox independently satisfies the collision-fairness intent.
3. THE Game SHALL hold both the collision-fairness consistency and the consistency required by Requirement 26 criterion 7 at all times.
4. THE Game SHALL detect collisions only between Kino's body hitbox and Obstacles, and SHALL NOT include any Cosmetic layer in collision detection.
5. IF a Cosmetic layer visually overlaps an Obstacle while Kino's body hitbox does not overlap that Obstacle, THEN THE Game SHALL NOT register a collision.

### Requirement 42: Mentor Dialogue Content

**User Story:** As a player, I want mentor cutscenes to include dialogue that shows the serious mentor against the confused baby Kino, so that the game's humor and identity come through.

#### Acceptance Criteria

1. WHEN a Mentor cutscene plays, THE Game SHALL present Mentor dialogue text for that World, read from the Config_File so that the dialogue can be edited without changes to gameplay logic.
2. THE Game SHALL support the comedic contrast between the serious Mentor and the confused baby Kino through the Config_File-supplied dialogue content.
3. WHILE a Mentor cutscene dialogue is playing, THE Game SHALL render the animated World background behind the dialogue.
4. WHEN the Mentor is the current speaker, THE Game SHALL display the Mentor sprite together with the Mentor's teaching text chatbox, and SHALL render Kino greyed in a background corner position.
5. WHEN Kino is the current speaker, THE Game SHALL display the Baby Kino sprite together with Kino's learning text chatbox, and SHALL render the Mentor greyed in a background corner position.
6. WHEN the current speaker changes, THE Game SHALL switch to that speaker's layout, alternating between the Mentor-speaking layout and the Kino-speaking layout as the dialogue progresses.

### Requirement 43: Menu Equip Jiggle Animation

**User Story:** As a player, I want visual feedback when I equip a cosmetic or skill in the menu, so that I can tell my selection registered.

#### Acceptance Criteria

1. WHEN the player equips a Cosmetic in the main menu, THE Game SHALL play a jiggle animation in which Kino bobs up and down like jello as equip feedback.
2. WHEN the player equips a Skill in the main menu, THE Game SHALL play a jiggle animation in which Kino bobs up and down like jello as equip feedback.
3. THE Game SHALL treat the menu equip jiggle as a menu-only feedback animation distinct from the gameplay Movement_Mode Animation_Frames.
4. THE Game SHALL read the menu equip jiggle animation asset from the "menu-equip-jiggle" Config_File key.
5. WHERE the configured "menu-equip-jiggle" Config_File key is missing or empty, THE Game SHALL fall back to the corresponding placeholder so that the Game remains functional.

### Requirement 44: Collision Resolution and Safe Reposition

**User Story:** As a player, I want collisions to end my run consistently across every movement mode and protective skills to drop me into a genuinely safe spot, so that failure and rescue both feel fair and predictable.

#### Acceptance Criteria

1. WHEN Kino collides with an Obstacle while no Protective_Skill is active, THE Game SHALL end the current run, consistent with Requirement 7 criterion 7.
2. WHILE the Jumping Movement_Mode is active, THE Game SHALL move Kino along the ground and SHALL apply the primary action as a jump used to dodge incoming Obstacles, consistent with Requirement 2.
3. WHEN Kino touches a Jumping Obstacle while no Protective_Skill is active, THE Game SHALL end the current run.
4. WHILE the Zigzag Movement_Mode is active, IF Kino contacts any surface boundary while no Protective_Skill is active, THEN THE Game SHALL end the current run.
5. WHILE the Flight Movement_Mode is active, IF Kino collides with an Obstacle_Unit while no Protective_Skill is active, THEN THE Game SHALL end the current run.
6. WHILE the Underwater_Buoyancy Movement_Mode is active, IF Kino collides with an Obstacle_Unit while no Protective_Skill is active, THEN THE Game SHALL end the current run.
7. WHILE the Jumping Movement_Mode is active, WHEN a Protective_Skill prevents a Jumping collision, THE Game SHALL place Kino directly to the right of the Obstacle Kino would have hit, in a position clear of that Obstacle.
8. WHILE the Flight Movement_Mode is active, WHEN a Protective_Skill prevents a collision, THE Game SHALL place Kino in a safe position that does not overlap any Obstacle, consistent with Requirement 14 criterion 3.
9. WHILE the Underwater_Buoyancy Movement_Mode is active, WHEN a Protective_Skill prevents a collision, THE Game SHALL place Kino in a safe position that does not overlap any Obstacle, consistent with Requirement 14 criterion 3.
10. WHILE the Zigzag Movement_Mode is active, WHEN a Protective_Skill prevents a collision, THE Game SHALL place Kino in a safe position already moving along the up or down diagonal that maximizes clearance from the surface Kino nearly contacted.
11. WHILE the Zigzag Movement_Mode is active and a Protective_Skill has repositioned Kino, THE Game SHALL return directional control to the player so that the player resumes changing Kino's diagonal direction with the primary action.
12. THE Game SHALL apply the Time Erase reposition defined in Requirement 14 and the Ultra Instinct vertical-axis teleport defined in Requirement 18 subject to the mode-specific safe-reposition rules in this Requirement, where a mode-specific rule in this Requirement states the more specific placement for that Movement_Mode.
13. THE Game SHALL evaluate every collision that ends a run or triggers a Protective_Skill reposition in this Requirement using only Kino's body hitbox against Obstacles, excluding every Cosmetic layer, consistent with Requirement 41 criteria 4 and 5.

### Requirement 45: Scrolling and Camera Model

**User Story:** As a player, I want Kino to stay in one spot on screen while the world moves past, so that the game reads as a classic side-scroller and forward progress feels consistent across every movement mode.

#### Acceptance Criteria

1. WHILE a gameplay run is active, THE Game SHALL keep Kino at a fixed horizontal screen position and SHALL simulate forward progress by scrolling the World background and Obstacles horizontally past Kino.
2. WHILE a gameplay run is active, THE Game SHALL move Kino only vertically or diagonally according to the active Movement_Mode and SHALL hold Kino's horizontal screen position fixed under normal movement.
3. WHERE the Dash Skill defined in Requirement 15 is activated, THE Game MAY temporarily displace Kino from the fixed horizontal screen position horizontally while the Jumping, Flight, or Underwater_Buoyancy Movement_Mode is active, or along Kino's current diagonal trajectory while the Zigzag Movement_Mode is active, as an intentional exception to criterion 2 consistent with Requirement 15.
4. THE Game SHALL apply the fixed-horizontal-position, scrolling-background model to the Jumping, Flight, Zigzag, and Underwater_Buoyancy Movement_Modes.
5. WHILE the World 5 auto-controlled finale defined in Requirement 8 criteria 8 through 12 is playing, THE Game MAY move Kino horizontally through the scripted crawl, run, and jump locomotion rather than holding Kino at a fixed horizontal screen position.

### Requirement 46: Obstacle Path Layouts

**User Story:** As a player, I want each movement mode to present its own recognizable obstacle layout, so that each world reads distinctly and the required movement is clear.

#### Acceptance Criteria

1. WHILE the Jumping Movement_Mode is active, THE Game SHALL rest Obstacles on the ground, SHALL require Kino at the fixed horizontal screen position to jump to clear the Obstacles, and SHALL scroll a dynamic background past Kino, consistent with Requirement 2 and Requirement 45.
2. WHILE the Flight Movement_Mode is active, THE Game SHALL present Obstacles as vertical pillars extending from the top and from the bottom with a gap through which Kino passes, SHALL render a ground at the bottom, and SHALL scroll a dynamic background past Kino, consistent with Requirement 3.
3. WHILE the Zigzag Movement_Mode is active, THE Game SHALL bound the play area with a top wall and a bottom wall, SHALL move Kino on a diagonal that bounces between the walls, and IF Kino contacts either wall while no Protective_Skill is active, THEN THE Game SHALL end the current run, consistent with Requirement 4 and Requirement 44 criterion 4.
4. WHILE the Underwater_Buoyancy Movement_Mode is active, THE Game SHALL render a Transition_Pane at the water surface and SHALL present ceiling_underwater_obstacle hazards extending from the top and floor_underwater_obstacle hazards extending from the bottom with a gap navigated using inverted buoyancy, consistent with Requirement 5 criteria 11 and 12 and Requirement 38 criterion 2.

# Bugfix Requirements Document

## Introduction

The main menu of the Flappy Bird RPG (Kino game) does not lay out its primary elements the way it should. When the menu opens, three things are wrong:

1. Kino (the character) is drawn as a bare sprite/placeholder rather than being presented on or within a rectangle panel.
2. The scrollable world list (the vertical treasure-map) is not positioned underneath Kino's rectangle — instead it is vertically centered and overlaps Kino.
3. The Cosmetics and Skills buttons are placed at a fixed horizontal offset from the center of the screen, so they drift close to the center instead of being anchored to the screen edges. On top of that, the sides are swapped relative to the intended layout: Cosmetics should be anchored to the right edge and Skills to the left edge.

This is a visual/layout defect in the menu rendering. The relevant rendering lives in `src/engine/scenes/MainMenuScene.ts` (`create`, `drawKino`, `buildTreasureMap`, `buildCosmeticsControl`, `buildSkillsControl`), where Kino is drawn at `height * 0.4` with no panel, the world list is centered at `height / 2`, and the two flanking buttons are placed at a fixed `centerX ± 150`. The pure fit-math modules `src/core/adaptiveLayout.ts` and `src/engine/adaptiveLayout.ts` compute an aspect-preserving contain fit and are not themselves defective; the defect is in where the scene places these elements within the design surface. The fix must correct the placement of Kino's panel, the world list, and the two flanking buttons while leaving all other menu behavior unchanged.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN the main menu opens THEN the system draws Kino as a standalone sprite/placeholder with no rectangle panel behind or around it
1.2 WHEN the main menu opens THEN the system positions the scrollable world list centered vertically around the screen mid-line so it overlaps Kino instead of sitting underneath Kino's panel
1.3 WHEN the main menu opens THEN the system positions the Cosmetics and Skills buttons at a fixed offset from screen center so they drift close to the center rather than being anchored to the screen edges
1.4 WHEN the main menu opens THEN the system places Cosmetics on the left and Skills on the right, the opposite of the intended sides

### Expected Behavior (Correct)

2.1 WHEN the main menu opens THEN the system SHALL display Kino on or within a rectangle panel in the upper area of the menu
2.2 WHEN the main menu opens THEN the system SHALL position the scrollable world list directly underneath Kino's rectangle panel, without overlapping it, and keep it scrollable up and down
2.3 WHEN the main menu opens THEN the system SHALL anchor the Cosmetics and Skills buttons to the screen edges so they do not drift toward the center
2.4 WHEN the main menu opens THEN the system SHALL place the Cosmetics button anchored to the right edge and the Skills button anchored to the left edge

### Unchanged Behavior (Regression Prevention)

3.1 WHEN the player scrolls the world list up or down THEN the system SHALL CONTINUE TO scroll the map and resolve the locked-in world and side glow as before
3.2 WHEN the player presses the Cosmetics or Skills button THEN the system SHALL CONTINUE TO open the Inventory_Panel on the corresponding tab
3.3 WHEN the player presses the Play or bottom primary Start/Continue button THEN the system SHALL CONTINUE TO launch the locked-in or next story world with the existing transition
3.4 WHEN the main menu opens THEN the system SHALL CONTINUE TO render the Stats control, Settings control, Generation pill, replay control, and endless-mode triggers with their existing behavior
3.5 WHEN the screen is resized THEN the system SHALL CONTINUE TO apply the aspect-preserving centered contain fit without stretching

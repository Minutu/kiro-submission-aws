# Main Menu Layout Fix Bugfix Design

## Overview

The main menu (`src/engine/scenes/MainMenuScene.ts`) lays out three of its primary elements incorrectly. Kino is drawn as a bare sprite/placeholder with no panel, the scrollable world list is vertically centered on the screen mid-line so it overlaps Kino, and the two flanking buttons are placed at a fixed horizontal offset from the center (`centerX ± 150`) with their sides swapped.

The fix is a targeted placement correction inside the scene's `create` / `drawKino` / `buildTreasureMap` / `buildCosmeticsControl` / `buildSkillsControl` methods. The strategy is:

1. Draw a rectangle panel behind/around Kino in the **upper** area of the menu, so Kino reads as presented on a panel rather than floating.
2. Position the scrollable world list's center line **directly beneath** that panel instead of at `height / 2`, so the list no longer overlaps Kino while remaining scrollable up and down.
3. Anchor the two flanking buttons to the **screen edges** instead of a fixed center offset, and fix the swap: **Cosmetics anchored to the right edge, Skills anchored to the left edge** (the user's authoritative decision for this fix, which overrides the conflicting kino-game Req 20.26).

The pure fit-math modules `src/core/adaptiveLayout.ts` and `src/engine/adaptiveLayout.ts` compute an aspect-preserving centered contain fit and are **not** defective. They remain untouched; the fix only changes where the scene places elements within the design surface.

## Glossary

- **Bug_Condition (C)**: The main menu is being built (`MainMenuScene.create` runs and lays out Kino, the world list, and the flanking buttons) — the condition under which the three layout defects manifest.
- **Property (P)**: The desired layout — Kino on/within a rectangle panel in the upper area, the scrollable world list directly beneath that panel with no overlap, Cosmetics anchored to the right edge, Skills anchored to the left edge.
- **Preservation**: All other menu behavior that must remain unchanged — world-list scrolling/lock-in/side glow, the Cosmetics/Skills open-Inventory actions, the Play and bottom primary buttons, the Stats/Settings controls, Generation pill, replay control, endless-mode triggers, and the aspect-preserving contain fit on resize.
- **MainMenuScene**: The engine-layer scene in `src/engine/scenes/MainMenuScene.ts` that renders the menu against the pure treasure-map state from `src/core/treasureMap.ts`.
- **drawKino**: The method in `MainMenuScene` that renders Kino (real texture or geometric placeholder) at a given `(x, y)` and records `kinoMenuPos` for the Play glide transition.
- **buildTreasureMap**: The method that lays out the scrollable world list into `mapContainer`, pins the lock-in glow to `mapCenterY`, and wires wheel/drag scroll.
- **buildCosmeticsControl / buildSkillsControl**: The methods that place the two flanking Inventory_Panel buttons; today called with `cx - 150` and `cx + 150`.
- **mapCenterY**: The vertical line the world list snaps rows to; today set to `height / 2`.

## Bug Details

### Bug Condition

The bug manifests whenever the main menu is opened and `MainMenuScene.create` lays out its elements. The scene draws Kino with no panel at `height * 0.4`, centers the world list's snap line at `height / 2` (so it overlaps Kino), and places the two flanking buttons at a fixed `centerX ± 150` with Cosmetics on the left and Skills on the right — the opposite of the intended sides and not anchored to the edges.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type MenuLayoutRequest  (the menu is being built at design size width x height)
  OUTPUT: boolean

  RETURN menuIsBeingLaidOut(input)
         AND (
              kinoHasNoRectanglePanel(input)                       // defect 1.1
           OR worldListCenterOverlapsKino(input)                   // defect 1.2 (list centered at height/2)
           OR flankingButtonsUseFixedCenterOffset(input)           // defect 1.3 (centerX +/- 150)
           OR cosmeticsOnLeftAndSkillsOnRight(input)               // defect 1.4 (sides swapped)
         )
END FUNCTION
```

### Examples

- **Kino has no panel (1.1)**: On open, `drawKino(cx, height * 0.4, ctx)` renders only the sprite/placeholder (and a tiny "Kino" dev label). Expected: Kino appears on or within a rectangle panel in the upper area. Actual: a bare sprite with no panel.
- **World list overlaps Kino (1.2)**: `mapCenterY = height / 2` and rows lay out around it, while Kino sits at `height * 0.4`; the list's rows render over/through Kino. Expected: the list sits directly beneath Kino's panel with no overlap. Actual: the list is centered on the screen mid-line and overlaps Kino.
- **Buttons drift toward center (1.3)**: `buildCosmeticsControl(cx - 150, kinoY)` and `buildSkillsControl(cx + 150, kinoY)` place both buttons a fixed 150px from center, so on a wide surface they sit close to the middle rather than near the edges. Expected: anchored to the screen edges. Actual: fixed offset from center.
- **Sides swapped (1.4)**: Cosmetics is placed at `cx - 150` (left) and Skills at `cx + 150` (right). Expected: Cosmetics on the right edge, Skills on the left edge. Actual: Cosmetics left, Skills right.
- **Edge case — narrow surface**: When the design surface is narrow, edge anchoring must keep the buttons on-screen (inset by a margin) and must not let them overlap Kino's panel or each other.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- World-list scrolling up/down continues to scroll the map and resolve the locked-in world and side glow exactly as before (wheel + drag + snap-to-row, `scrollBy` / `snapToNearestRow` / `applyLockIn`).
- Pressing Cosmetics or Skills continues to open the Inventory_Panel on the corresponding tab (`openInventory('cosmetics')` / `openInventory('skills')`).
- Pressing Play or the bottom primary Start/Continue button continues to launch the locked-in / next story world with the existing expand/fade/glide transition.
- The Stats control, Settings control, Generation pill, replay control, and endless-mode triggers continue to render and behave exactly as before.
- On resize, the aspect-preserving centered contain fit continues to apply without stretching (the pure `adaptiveLayout` modules are untouched).

**Scope:**
All behavior that does NOT depend on the placement of Kino's panel, the world-list center line, or the two flanking buttons' anchor positions must be completely unaffected by this fix. This includes:
- The treasure-map STATE and lock-in math (`src/core/treasureMap.ts`) — single source of truth, untouched.
- The Inventory open seam and every other control's press action.
- The pure fit-math (`src/core/adaptiveLayout.ts`, `src/engine/adaptiveLayout.ts`) and the resize contain fit.

**Note:** The actual expected correct layout is defined in the Correctness Properties section (Property 1). This section focuses on what must NOT change.

## Hypothesized Root Cause

Based on the bug description and the code in `MainMenuScene.ts`, the defects are all element-placement choices in the scene, not in the pure layout math:

1. **No panel drawn behind Kino (defect 1.1)**: `drawKino` renders only the resolved sprite/placeholder (plus a dev label). There is no `this.add.rectangle(...)` panel behind or around it, and Kino is placed at `height * 0.4` rather than an explicit "upper area" panel slot.

2. **World-list center line fixed to mid-screen (defect 1.2)**: `create` sets `this.mapCenterY = height / 2`, and `buildTreasureMap` lays rows out around `mapCenterY` and pins the glow there. With Kino at `height * 0.4`, the list overlaps Kino because its center is not anchored beneath Kino's panel.

3. **Flanking buttons use a fixed center offset (defect 1.3)**: `buildCosmeticsControl(cx - 150, kinoY)` and `buildSkillsControl(cx + 150, kinoY)` compute positions from `centerX ± 150` rather than from the screen edges, so they drift toward the center on wider surfaces.

4. **Sides swapped (defect 1.4)**: Cosmetics is given the left x (`cx - 150`) and Skills the right x (`cx + 150`), the opposite of the intended Cosmetics-right / Skills-left layout the user confirmed.

## Correctness Properties

Property 1: Bug Condition - Correct Main Menu Layout

_For any_ input where the bug condition holds (isBugCondition returns true — i.e. the menu is being laid out at a given design width x height), the fixed `create` / `drawKino` / `buildTreasureMap` / `buildCosmeticsControl` / `buildSkillsControl` SHALL produce a layout in which (a) Kino is drawn on or within a rectangle panel in the upper area of the menu, (b) the scrollable world list's center line sits directly beneath Kino's panel with no vertical overlap between the list's top and the panel's bottom, (c) the Cosmetics button is anchored to the right edge and the Skills button is anchored to the left edge (each inset by a fixed margin so it stays on-screen), and the two buttons do not overlap each other or Kino's panel.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4**

Property 2: Preservation - Non-Layout Menu Behavior

_For any_ input where the bug condition does NOT hold (isBugCondition returns false — any interaction or state that does not depend on the placement of Kino's panel, the world-list center line, or the flanking-button anchors), the fixed code SHALL produce the same result as the original code, preserving world-list scrolling/lock-in/side glow, the Cosmetics/Skills open-Inventory actions, the Play and bottom primary launch transitions, the Stats/Settings/Generation-pill/replay/endless controls, and the aspect-preserving contain fit on resize.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct, all changes are localized to `MainMenuScene.ts` layout methods. No pure module changes.

**File**: `src/engine/scenes/MainMenuScene.ts`

**Functions**: `create`, `drawKino`, `buildTreasureMap`, `buildCosmeticsControl`, `buildSkillsControl`

**Specific Changes**:

1. **Add a rectangle panel behind/around Kino (2.1)**: In `drawKino` (or just before calling it in `create`), draw a `this.add.rectangle(...)` panel sized to contain Kino, positioned in the **upper area** of the menu, at a lower depth than the Kino sprite/placeholder so Kino renders on top of it. Keep `kinoMenuPos` pointing at the sprite's center so the Play glide origin is unchanged.
   - Define an explicit upper-area Kino slot (panel center + panel width/height) derived from `width`/`height` rather than the ad-hoc `height * 0.4`.
   - Place the sprite/placeholder (and the existing dev label) relative to that panel.

2. **Anchor the world list beneath Kino's panel (2.2)**: In `create`, stop setting `this.mapCenterY = height / 2`. Instead compute `mapCenterY` as a value **below the bottom edge of Kino's panel** (panel bottom + a gap + half a row), so the list's snapped center row sits directly underneath the panel with no overlap. Leave `ROW_SPACING_PX`, `maxScrollOffset`, and the scroll/lock-in wiring in `buildTreasureMap` unchanged — only the center line moves.

3. **Anchor the flanking buttons to the screen edges and fix the swap (2.3, 2.4)**: In `create`, replace the `cx - 150` / `cx + 150` call sites with edge-anchored x positions computed from the screen edges inset by a fixed margin:
   - `buildCosmeticsControl(width - EDGE_MARGIN - halfButton, kinoY)` — anchored to the **right** edge.
   - `buildSkillsControl(EDGE_MARGIN + halfButton, kinoY)` — anchored to the **left** edge.
   - Introduce a small `EDGE_MARGIN` constant and keep the buttons' y aligned with Kino's panel row. Ensure the inset keeps each button fully on-screen and clear of Kino's panel.

4. **Update stale side-comments**: The method doc-comments currently say "Cosmetics to the LEFT of Kino" / "Skills to the RIGHT of Kino" (per kino-game Req 20.26). Update these to reflect the authoritative decision for this fix: **Cosmetics right edge, Skills left edge**, noting it overrides Req 20.26.

5. **No changes to pure modules**: `src/core/adaptiveLayout.ts`, `src/engine/adaptiveLayout.ts`, and `src/core/treasureMap.ts` are not touched; the resize contain fit and lock-in math are preserved.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the layout defects on the unfixed scene, then verify the fix produces the correct layout and preserves all other menu behavior. Because the defects are geometric placement facts computed from `width`/`height`, the most reliable checks assert on the computed positions/sizes of the panel, the world-list center line, and the two button anchors — rather than on pixel rendering.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the bug BEFORE implementing the fix. Confirm or refute the root cause analysis. If we refute, we will need to re-hypothesize.

**Test Plan**: Build the menu (or exercise the extracted placement computation) at a representative design size and assert on the resulting geometry. Run these on the UNFIXED code to observe the failures and confirm the root cause.

**Test Cases**:
1. **Kino panel presence**: Assert a rectangle panel exists behind/around Kino in the upper area (will fail on unfixed code — no panel is drawn).
2. **World-list / Kino overlap**: Assert the world-list center line sits below the bottom of Kino's panel with no overlap (will fail on unfixed code — list centered at `height / 2` overlaps Kino at `height * 0.4`).
3. **Button edge anchoring**: Assert the Cosmetics and Skills x positions are near the screen edges (within `EDGE_MARGIN`) rather than `centerX ± 150` (will fail on unfixed code — fixed center offset).
4. **Button side assignment (edge case)**: Assert Cosmetics x > Skills x (Cosmetics on the right, Skills on the left) (will fail on unfixed code — sides swapped).

**Expected Counterexamples**:
- No panel object is present behind Kino; the world-list center equals `height / 2` and overlaps Kino's `height * 0.4` slot; button x positions equal `centerX ± 150` with Cosmetics on the left.
- Possible causes: missing panel draw in `drawKino`, `mapCenterY` hard-coded to `height / 2`, flanking-button call sites using `cx ± 150` with swapped sides.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed function produces the expected behavior.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := layOutMenu_fixed(input)
  ASSERT expectedBehavior(result)
  // expectedBehavior: Kino panel present in upper area
  //   AND worldListCenterY > kinoPanelBottomY (no overlap)
  //   AND cosmeticsX anchored near right edge AND skillsX anchored near left edge
  //   AND cosmeticsX > skillsX
  //   AND buttons on-screen and clear of Kino's panel
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed function produces the same result as the original function.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT layOutMenu_original(input) = layOutMenu_fixed(input)
  // for every behavior not tied to Kino-panel / list-center / button-anchor placement:
  //   scrolling + lock-in + side glow, Cosmetics/Skills open actions,
  //   Play + primary launch transitions, Stats/Settings/pill/replay/endless,
  //   resize contain fit
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many design sizes and scroll positions automatically across the input domain.
- It catches edge cases (very narrow/wide surfaces, extreme scroll offsets) that manual unit tests might miss.
- It provides strong guarantees that scroll/lock-in and the resize contain fit are unchanged for all non-layout inputs.

**Test Plan**: Observe behavior on the UNFIXED code first for scrolling/lock-in, the open actions, and the resize fit, then write property-based tests capturing that behavior and re-run them against the fixed code.

**Test Cases**:
1. **Scroll + lock-in preservation**: Observe that scrolling resolves the locked-in world + side glow on unfixed code, then verify this is identical after the fix across generated scroll offsets.
2. **Open-action preservation**: Observe that Cosmetics/Skills open the Inventory_Panel on the correct tab on unfixed code, then verify this is unchanged after the fix.
3. **Resize contain-fit preservation**: Observe the aspect-preserving centered contain fit on unfixed code across generated viewport sizes, then verify the pure `computeLayout` output is unchanged after the fix.

### Unit Tests

- Kino panel is drawn in the upper area with Kino rendered on top of it.
- World-list center line is below the bottom of Kino's panel (no overlap) at representative design sizes.
- Cosmetics anchored to the right edge and Skills anchored to the left edge, both inset by `EDGE_MARGIN` and on-screen.
- Edge case: on a narrow surface the buttons stay on-screen and do not overlap each other or Kino's panel.

### Property-Based Tests

- Generate random design sizes and assert the layout invariants hold (panel in upper area, list center below panel bottom, Cosmetics x > Skills x, both near their respective edges).
- Generate random scroll offsets and assert lock-in / side-glow resolution is identical to the original (preservation).
- Generate random viewport sizes and assert the resize contain fit (`computeLayout`) output is unchanged (preservation).

### Integration Tests

- Open the menu, confirm Kino sits on its panel in the upper area with the world list beneath it and no overlap, then scroll and confirm lock-in/glow still work.
- Press Cosmetics (right edge) and Skills (left edge) and confirm each opens the Inventory_Panel on the correct tab.
- Resize the viewport and confirm the whole menu re-fits with the aspect-preserving contain fit, keeping Kino's panel, the list, and the edge-anchored buttons correctly placed.

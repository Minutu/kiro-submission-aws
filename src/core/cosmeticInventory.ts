// Feature: kino-game
//
// CosmeticInventory — the PURE, Phaser-free cosmetic equip/unlock algebra over
// the `kino.save.v1` Save_Store (task 8.2; design: "Perk system (Req 10, 11)"
// cosmetic drop persistence, "Save_Store schema (Req 22, 28, 40)"; Req 19.5,
// 19.7, 10.11).
//
// WHY THIS LIVES IN src/core: cosmetic ownership + the single-equip selection
// are permanent Save_Store fields (Req 22.2), and the rules governing them are
// pure, deterministic state algebra with no Phaser dependency. Keeping them in
// core lets the InventoryScene (equip) and PerkSelectScene (random drop) share
// one source of truth, and lets the persistence round-trip property (Property 8)
// exercise the same permanent fields these functions write.
//
// WHAT IT OWNS (all operating on SaveState's two permanent cosmetic fields —
// `unlockedCosmetics` and `equippedCosmetic`):
//
//   - equip(save, id) — SINGLE-EQUIP (Req 19.7): set `equippedCosmetic` to the
//     given id, which unequips any previously equipped cosmetic (at most one is
//     ever equipped). Unowned cosmetics are NON-SELECTABLE: equipping a cosmetic
//     that is not in `unlockedCosmetics` is a NO-OP (the equipped selection is
//     left unchanged), because a player can only wear what they own.
//   - unequip(save) — clear the equipped selection (`equippedCosmetic = null`).
//   - unlock(save, id) / recordRandomDrop(save, id) — add an id to the PERMANENT
//     owned set `unlockedCosmetics`, idempotently (Req 19.5, 10.11). These are
//     two names for the same permanent-ownership write; `recordRandomDrop` is the
//     perk-slot drop path (Req 10.11) and `unlock` the general unlock path
//     (Req 19.5), kept distinct so call sites read intention-revealingly.
//   - isUnlocked(save, id) / equippedCosmetic(save) / unlockedCosmetics(save) —
//     queries.
//
// PERMANENCE ACROSS GENERATIONS: `unlockedCosmetics` and `equippedCosmetic` are
// schema fields that `advanceGeneration` (generationTransition.ts) carries
// forward verbatim and the `createFirstLaunchState` → serialize → deserialize
// round-trip preserves exactly (Property 8). This module only ever ADDS to the
// owned set and sets/clears the single equipped selection; it never clears owned
// cosmetics, so cosmetics persist permanently across generations (Req 19.5,
// 10.11) by construction.
//
// PURE / Phaser-free: every function returns a NEW SaveState (or a query value)
// and never mutates its input.

import type { SaveState } from './saveStore.ts';

/**
 * Whether `cosmeticId` is in the player's PERMANENT owned set (Req 19.5). An
 * empty id is never owned (there is no cosmetic with an empty id).
 */
export function isUnlocked(save: SaveState, cosmeticId: string): boolean {
  return cosmeticId !== '' && save.unlockedCosmetics.includes(cosmeticId);
}

/** The currently equipped cosmetic id, or null when none is equipped (Req 19.7). */
export function equippedCosmetic(save: SaveState): string | null {
  return save.equippedCosmetic;
}

/** The player's PERMANENT owned cosmetics (a defensive copy; Req 19.5). */
export function unlockedCosmetics(save: SaveState): readonly string[] {
  return [...save.unlockedCosmetics];
}

/**
 * Add `cosmeticId` to the PERMANENT owned set (Req 19.5), idempotently. Returns
 * a NEW save; the equipped selection is left untouched (unlocking does not auto-
 * equip). An empty id, or one already owned, returns an unchanged copy. Pure.
 */
export function unlock(save: SaveState, cosmeticId: string): SaveState {
  if (cosmeticId === '' || save.unlockedCosmetics.includes(cosmeticId)) {
    return { ...save, unlockedCosmetics: [...save.unlockedCosmetics] };
  }
  return { ...save, unlockedCosmetics: [...save.unlockedCosmetics, cosmeticId] };
}

/**
 * Persist a cosmetic obtained from a random Perk-slot drop PERMANENTLY in the
 * Save_Store (Req 10.11). This is the same permanent-ownership write as
 * {@link unlock}; it exists as a distinct, intention-revealing name for the
 * perk-drop call site (PerkSelectScene). Idempotent, pure, equipped selection
 * untouched.
 */
export function recordRandomDrop(save: SaveState, cosmeticId: string): SaveState {
  return unlock(save, cosmeticId);
}

/**
 * Equip `cosmeticId` as the SINGLE equipped cosmetic, unequipping any previously
 * equipped one (Req 19.7) — at most one cosmetic is ever equipped. Owning the
 * cosmetic is required: an UNOWNED cosmetic is non-selectable, so equipping one
 * that is not in `unlockedCosmetics` is a NO-OP (the previous selection stays).
 * Returns a NEW save; the owned set is never changed by equipping. Pure.
 */
export function equip(save: SaveState, cosmeticId: string): SaveState {
  if (!isUnlocked(save, cosmeticId)) {
    // Unowned cosmetics are non-selectable (Req 19.7 "equips a Cosmetic" is a
    // player wearing something they own) — leave the equipped selection as-is.
    return { ...save };
  }
  // Single-equip: this one id replaces whatever was equipped before (Req 19.7).
  return { ...save, equippedCosmetic: cosmeticId };
}

/**
 * Clear the equipped cosmetic (`equippedCosmetic = null`) so Kino wears no
 * cosmetic. Returns a NEW save; the owned set is untouched. Pure.
 */
export function unequip(save: SaveState): SaveState {
  return { ...save, equippedCosmetic: null };
}

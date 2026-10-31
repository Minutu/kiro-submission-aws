// Feature: kino-game
//
// InventoryPanel — the PURE, Phaser-free VIEW-MODEL + selection algebra behind
// the menu's Inventory_Panel (task 9.4; design: "UI / Menu > Inventory_Panel
// (12.8–12.14, 19, 20.42–20.47, 43)"; Req 12.7-12.14, 19.7, 20.44-20.47, 36.6).
//
// WHY THIS LIVES IN src/core: the panel's STATE — which items exist per tab, in
// what order, each item's owned/locked state (greyed non-selectable or
// selectable), which single item is equipped, the rarity-by-color
// classification, and the preview item — is pure, deterministic, config- +
// Save_Store-driven data with NO Phaser dependency. Keeping it here lets the
// engine InventoryScene render a plain object it never has to compute, and lets
// unit tests exercise the selection rules (single-select, ownership gating,
// rarity colors, tab catalogs) in plain Node with no canvas.
//
// REUSE, DO NOT DUPLICATE:
//   - COSMETIC equip reuses `cosmeticInventory.equip` verbatim (single-equip,
//     ownership-gated no-op; Req 19.7). This module never re-implements that
//     algebra — it delegates to it.
//   - SKILL ownership + rarity reuse `skillUnlockSchedule` (`MILESTONE_ORDER` →
//     `skillForMilestone` gives the full seven-skill catalog in acquisition
//     order; `skillRarity` gives each skill's tier). Equipping a skill writes
//     the SAME permanent `Save_Store.equippedSkill` field the SkillSystem reads,
//     with the SAME single-select + ownership rule cosmetics use.
//   - RARITY COLORS reuse `config.cosmeticRarityColors` for BOTH skills and
//     cosmetics, so a skill and a cosmetic of the same tier share one color
//     (Req 12.14, 36.6 "consistent with how Cosmetic rarity is shown").
//
// THE MODEL:
//   - A tab is 'cosmetics' | 'skills'. `buildInventoryViewModel(save, config,
//     tab, options?)` returns the ordered grid for that tab plus the equipped +
//     preview ids. Each grid item is { id, label, rarity, color, owned,
//     equipped, selectable } — `selectable === owned` (locked skills + unowned
//     cosmetics are greyed non-selectable, Req 12.11, 20.46).
//   - `equipItem(save, tab, id, config)` is the single pure write: it equips an
//     OWNED item single-select (replacing the current equipped item OF THAT
//     TYPE only) and is a NO-OP for a locked/unowned item (non-selectable), for
//     cosmetics by delegating to `cosmeticInventory.equip` and for skills by the
//     mirrored save-field rule. Pure — returns a NEW SaveState, never mutates.
//
// SKILL CATALOG / RARITY ARE CONFIG-DRIVEN; COSMETIC CATALOG IS SAVE-DRIVEN:
//   - There are exactly seven Skills (the `SkillId` union) and the config pins
//     each one's unlock milestone and rarity, so the skills tab catalog is fully
//     derivable from the config (every skill shown, owned iff in
//     `save.unlockedSkills`).
//   - Cosmetics have no fixed config catalog (ids are minted by perk drops /
//     generation rewards), so the cosmetics catalog is derived from the save's
//     `unlockedCosmetics` by default. A caller MAY inject a richer catalog (with
//     labels + rarities, e.g. to show not-yet-owned cosmetics greyed) via
//     `options.cosmeticCatalog`; any catalog entry not owned renders greyed
//     non-selectable exactly like a locked skill (Req 20.46).

import type { ConfigFileData, SkillId, RarityTier } from '../config/index.ts';
import type { SaveState } from './saveStore.ts';
import { MILESTONE_ORDER, skillForMilestone, skillRarity } from './skillUnlockSchedule.ts';
import { equip as equipCosmetic, isUnlocked as isCosmeticUnlocked } from './cosmeticInventory.ts';

/** The two Inventory_Panel tabs (Req 20.44). */
export type InventoryTab = 'cosmetics' | 'skills';

/**
 * One cell in the Inventory_Panel grid (Req 20.44-20.47, 12.8-12.14). A plain,
 * serializable descriptor the engine renders verbatim.
 */
export interface InventoryItem {
  /** Stable id — the Save_Store key (a SkillId for skills, a cosmetic id). */
  id: string;
  /** Human-facing label (defaults to the id when no resolver is supplied). */
  label: string;
  /** Rarity tier for color classification (Req 12.12, 12.14, 36.6). */
  rarity: RarityTier;
  /** The rarity color from `config.cosmeticRarityColors` (Req 12.14, 36.6). */
  color: string;
  /** Owned = unlocked skill / owned cosmetic; the gate for selectability. */
  owned: boolean;
  /** True when this is the currently equipped item of its tab's type. */
  equipped: boolean;
  /**
   * Selectable iff owned (Req 12.11, 20.46): locked skills + unowned cosmetics
   * are greyed and non-selectable. Mirrors `owned` by construction, but is kept
   * as its own field so the engine renders "greyed non-selectable" off one flag.
   */
  selectable: boolean;
}

/** The assembled Inventory_Panel view-model for one tab. */
export interface InventoryViewModel {
  /** Which tab this view-model describes (Req 20.42-20.44). */
  tab: InventoryTab;
  /** The ordered grid of items for the tab (scrollable in the engine, Req 20.45). */
  items: InventoryItem[];
  /** The equipped item id for this tab, or null when none is equipped. */
  equippedId: string | null;
  /**
   * The item PREVIEWED above Kino with a highlight (Req 20.9, 20.17, 20.43): the
   * equipped item of this type, or null when nothing is equipped. Single-select
   * means preview tracks the equipped id (Req 12.12, 20.47).
   */
  previewId: string | null;
}

/** A cosmetic catalog entry (optional richer catalog for the cosmetics tab). */
export interface CosmeticCatalogEntry {
  id: string;
  /** Rarity tier; defaults to 'common' when a derived (save-only) id has none. */
  rarity?: RarityTier;
  /** Optional display label; defaults to the id. */
  label?: string;
}

/** Options for {@link buildInventoryViewModel}. */
export interface InventoryViewModelOptions {
  /**
   * Resolve an id to a display label (the engine backs this with Config_File
   * names). Defaults to the id itself when absent.
   */
  labelFor?: (id: string) => string;
  /**
   * An explicit cosmetic catalog (ids + rarities + labels) to show on the
   * cosmetics tab — e.g. to render not-yet-owned cosmetics greyed (Req 20.46).
   * When omitted, the catalog is derived from the save's owned cosmetics so the
   * tab always lists at least everything the player owns.
   */
  cosmeticCatalog?: readonly CosmeticCatalogEntry[];
}

/** The seven skills in acquisition (milestone) order — the full skills catalog. */
export function skillCatalogOrder(config: ConfigFileData): SkillId[] {
  const seen = new Set<SkillId>();
  const order: SkillId[] = [];
  for (const milestone of MILESTONE_ORDER) {
    const id = skillForMilestone(config, milestone);
    if (!seen.has(id)) {
      seen.add(id);
      order.push(id);
    }
  }
  return order;
}

/**
 * Resolve a rarity tier to its display color, shared by skills AND cosmetics so
 * the color meaning is identical across both (Req 12.14, 36.6). Falls back to
 * the common-tier color, then to a neutral grey, so a cell always has a color.
 */
export function rarityColor(config: ConfigFileData, rarity: RarityTier): string {
  const colors = config.cosmeticRarityColors;
  return colors[rarity] ?? colors.common ?? '#B0B0B0';
}

/** Default label resolver — the id verbatim. */
function identityLabel(id: string): string {
  return id;
}

/** Build the ORDERED skills-tab grid from the config catalog + the save. */
function buildSkillItems(
  save: SaveState,
  config: ConfigFileData,
  labelFor: (id: string) => string,
): InventoryItem[] {
  const owned = new Set(save.unlockedSkills);
  const equippedId = save.equippedSkill;
  return skillCatalogOrder(config).map((id) => {
    const rarity = skillRarity(config, id);
    const isOwned = owned.has(id);
    return {
      id,
      label: labelFor(id),
      rarity,
      color: rarityColor(config, rarity),
      owned: isOwned,
      equipped: equippedId === id,
      // Locked skills are greyed, non-selectable (Req 12.11).
      selectable: isOwned,
    };
  });
}

/**
 * Build the ORDERED cosmetics-tab grid. With an injected catalog, every catalog
 * entry is shown (unowned ones greyed, Req 20.46); without one, the grid is
 * derived from the save's owned cosmetics (all owned, all selectable). Either
 * way, owned cosmetics not already in the catalog are appended so the player can
 * always see — and re-equip — everything they own.
 */
function buildCosmeticItems(
  save: SaveState,
  config: ConfigFileData,
  labelFor: (id: string) => string,
  catalog: readonly CosmeticCatalogEntry[] | undefined,
): InventoryItem[] {
  const equippedId = save.equippedCosmetic;
  const items: InventoryItem[] = [];
  const emitted = new Set<string>();

  const emit = (id: string, rarity: RarityTier): void => {
    if (id === '' || emitted.has(id)) return;
    emitted.add(id);
    const isOwned = isCosmeticUnlocked(save, id);
    items.push({
      id,
      label: labelFor(id),
      rarity,
      color: rarityColor(config, rarity),
      owned: isOwned,
      equipped: equippedId === id,
      // Unowned cosmetics are greyed, non-selectable (Req 20.46).
      selectable: isOwned,
    });
  };

  // First the explicit catalog (if any), preserving its order.
  if (catalog) {
    for (const entry of catalog) {
      emit(entry.id, entry.rarity ?? 'common');
    }
  }
  // Then any owned cosmetic not already shown (derived catalog / top-ups).
  for (const id of save.unlockedCosmetics) {
    emit(id, 'common');
  }
  return items;
}

/**
 * Assemble the Inventory_Panel view-model for `tab` (Req 20.42-20.47, 12.7-12.14,
 * 36.6). PURE: reads the save + config (+ optional catalog/label resolver) and
 * returns a plain object; mutates nothing. The preview id tracks the equipped
 * item of the tab's type (single-select), so switching tabs yields the correct
 * catalog AND the correct preview for that type.
 */
export function buildInventoryViewModel(
  save: SaveState,
  config: ConfigFileData,
  tab: InventoryTab,
  options: InventoryViewModelOptions = {},
): InventoryViewModel {
  const labelFor = options.labelFor ?? identityLabel;

  if (tab === 'skills') {
    const items = buildSkillItems(save, config, labelFor);
    const equippedId = save.equippedSkill;
    return { tab, items, equippedId, previewId: equippedId };
  }

  const items = buildCosmeticItems(save, config, labelFor, options.cosmeticCatalog);
  const equippedId = save.equippedCosmetic;
  return { tab, items, equippedId, previewId: equippedId };
}

/**
 * Whether `id` is OWNED for `tab` (unlocked skill / owned cosmetic) — the
 * single gate for selectability + equip. Pure query.
 */
export function isOwned(save: SaveState, tab: InventoryTab, id: string): boolean {
  if (id === '') return false;
  return tab === 'skills'
    ? save.unlockedSkills.includes(id)
    : isCosmeticUnlocked(save, id);
}

/** The currently equipped id for `tab`, or null. */
export function equippedId(save: SaveState, tab: InventoryTab): string | null {
  return tab === 'skills' ? save.equippedSkill : save.equippedCosmetic;
}

/**
 * Equip `id` on `tab` SINGLE-SELECT (Req 12.12, 12.15, 19.7, 20.44, 20.47). The
 * new id replaces whatever was equipped OF THAT TYPE; equipping a locked /
 * unowned (non-selectable) item is a NO-OP that leaves the current selection
 * intact. Equipping only ever changes the ONE equipped field for the tab — it
 * never touches ownership and never affects the other type's equipped item.
 *
 * COSMETICS delegate to `cosmeticInventory.equip` (reused, not duplicated).
 * SKILLS apply the mirrored rule directly to `Save_Store.equippedSkill` — the
 * same field the SkillSystem reads — so there is one equipped-skill source of
 * truth. Pure: returns a NEW SaveState, mutates nothing.
 */
export function equipItem(save: SaveState, tab: InventoryTab, id: string, _config?: ConfigFileData): SaveState {
  if (tab === 'cosmetics') {
    // Reuse the cosmetic equip algebra verbatim (single-equip + unowned no-op).
    return equipCosmetic(save, id);
  }

  // Skills: mirror the cosmetic single-select + ownership rule on the skill
  // field. A locked / unowned skill is non-selectable → no-op.
  if (!isOwned(save, 'skills', id)) {
    return { ...save };
  }
  return { ...save, equippedSkill: id };
}

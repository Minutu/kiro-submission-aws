// Feature: kino-game
//
// Unit tests for the Inventory_Panel view-model + selection algebra (task 9.4;
// design: "UI / Menu > Inventory_Panel (12.8–12.14, 19, 20.42–20.47, 43)";
// Req 12.7-12.14, 19.7, 20.44-20.47, 36.6).
//
// These pin the PURE contract the engine InventoryScene defers to entirely:
//   - owned items are selectable; locked skills + unowned cosmetics are greyed
//     non-selectable (Req 12.11, 20.46).
//   - selecting an owned item equips it SINGLE-SELECT and updates equippedId +
//     previewId (Req 12.15, 19.7, 20.47); the preview tracks the equipped item.
//   - rarity-by-color maps each item to its configured rarity color, shared by
//     skills AND cosmetics (Req 12.12, 12.14, 36.6).
//   - switching tabs yields the correct catalog (skills tab = the seven skills;
//     cosmetics tab = owned/catalog cosmetics).
//   - equipping an unowned/locked item is rejected as a no-op.
//
// Pure / Phaser-free; built from the documented default Config_File.

import { describe, it, expect } from 'vitest';
import {
  buildInventoryViewModel,
  equipItem,
  isOwned,
  equippedId,
  skillCatalogOrder,
  rarityColor,
  createFirstLaunchState,
  serialize,
  type SaveState,
} from '../src/core/index.ts';
import { defaultConfig } from '../src/config/index.ts';

const cfg = defaultConfig;

function freshSave(): SaveState {
  return createFirstLaunchState(cfg);
}

describe('InventoryPanel — skills tab catalog (Req 20.44, 36.2)', () => {
  it('lists all seven skills in acquisition (milestone) order', () => {
    const order = skillCatalogOrder(cfg);
    expect(order).toEqual([
      'secondChance',
      'timeErase',
      'dash',
      'timeSlow',
      'scoreMultiplier',
      'ultraInstinct',
      'nuke',
    ]);
    const vm = buildInventoryViewModel(freshSave(), cfg, 'skills');
    expect(vm.items.map((it) => it.id)).toEqual(order);
    expect(vm.tab).toBe('skills');
  });

  it('a fresh save owns no skills, so every skill is greyed non-selectable (Req 12.11)', () => {
    const vm = buildInventoryViewModel(freshSave(), cfg, 'skills');
    expect(vm.items.every((it) => it.owned === false)).toBe(true);
    expect(vm.items.every((it) => it.selectable === false)).toBe(true);
    expect(vm.equippedId).toBeNull();
    expect(vm.previewId).toBeNull();
  });

  it('unlocked skills are owned + selectable; locked ones stay greyed (Req 12.11)', () => {
    const save: SaveState = { ...freshSave(), unlockedSkills: ['secondChance', 'dash'] };
    const vm = buildInventoryViewModel(save, cfg, 'skills');
    const byId = new Map(vm.items.map((it) => [it.id, it]));
    expect(byId.get('secondChance')?.selectable).toBe(true);
    expect(byId.get('dash')?.selectable).toBe(true);
    expect(byId.get('timeErase')?.selectable).toBe(false);
    expect(byId.get('nuke')?.selectable).toBe(false);
  });
});

describe('InventoryPanel — rarity-by-color (Req 12.12, 12.14, 36.6)', () => {
  it('maps each skill to its configured rarity + rarity color', () => {
    const save: SaveState = { ...freshSave(), unlockedSkills: skillCatalogOrder(cfg) };
    const vm = buildInventoryViewModel(save, cfg, 'skills');
    for (const item of vm.items) {
      const expectedRarity = cfg.skillRarity[item.id as keyof typeof cfg.skillRarity];
      expect(item.rarity).toBe(expectedRarity);
      expect(item.color).toBe(cfg.cosmeticRarityColors[expectedRarity]);
    }
  });

  it('a skill and a cosmetic of the same tier share one color (consistent w/ cosmetics)', () => {
    // ultraInstinct is legendary; a legendary cosmetic uses the SAME color.
    const legendaryColor = rarityColor(cfg, 'legendary');
    expect(legendaryColor).toBe(cfg.cosmeticRarityColors.legendary);

    const save: SaveState = { ...freshSave(), unlockedSkills: ['ultraInstinct'] };
    const skillVm = buildInventoryViewModel(save, cfg, 'skills');
    const ui = skillVm.items.find((it) => it.id === 'ultraInstinct');
    expect(ui?.color).toBe(legendaryColor);

    const cosSave: SaveState = { ...freshSave(), unlockedCosmetics: ['crown'] };
    const cosVm = buildInventoryViewModel(cosSave, cfg, 'cosmetics', {
      cosmeticCatalog: [{ id: 'crown', rarity: 'legendary' }],
    });
    const crown = cosVm.items.find((it) => it.id === 'crown');
    expect(crown?.color).toBe(legendaryColor);
  });

  it('rarityColor falls back for a missing tier (never empty)', () => {
    expect(rarityColor(cfg, 'common')).toBe(cfg.cosmeticRarityColors.common);
    expect(rarityColor(cfg, 'rare')).toBe(cfg.cosmeticRarityColors.rare);
  });
});

describe('InventoryPanel — cosmetics tab catalog (Req 20.45, 20.46)', () => {
  it('derives owned cosmetics when no explicit catalog is supplied (all selectable)', () => {
    const save: SaveState = { ...freshSave(), unlockedCosmetics: ['wizard-hat', 'crown'] };
    const vm = buildInventoryViewModel(save, cfg, 'cosmetics');
    expect(vm.items.map((it) => it.id)).toEqual(['wizard-hat', 'crown']);
    expect(vm.items.every((it) => it.owned && it.selectable)).toBe(true);
  });

  it('an explicit catalog renders unowned cosmetics greyed non-selectable (Req 20.46)', () => {
    const save: SaveState = { ...freshSave(), unlockedCosmetics: ['wizard-hat'] };
    const vm = buildInventoryViewModel(save, cfg, 'cosmetics', {
      cosmeticCatalog: [
        { id: 'wizard-hat', rarity: 'common' },
        { id: 'crown', rarity: 'legendary' },
      ],
    });
    const byId = new Map(vm.items.map((it) => [it.id, it]));
    expect(byId.get('wizard-hat')?.selectable).toBe(true);
    expect(byId.get('crown')?.owned).toBe(false);
    expect(byId.get('crown')?.selectable).toBe(false);
  });

  it('owned cosmetics not in the catalog are still shown so the player can re-equip them', () => {
    const save: SaveState = { ...freshSave(), unlockedCosmetics: ['party-hat'] };
    const vm = buildInventoryViewModel(save, cfg, 'cosmetics', {
      cosmeticCatalog: [{ id: 'crown', rarity: 'legendary' }],
    });
    const ids = vm.items.map((it) => it.id);
    expect(ids).toContain('crown');
    expect(ids).toContain('party-hat');
    expect(vm.items.find((it) => it.id === 'party-hat')?.selectable).toBe(true);
  });
});

describe('InventoryPanel — switching tabs yields the correct catalog', () => {
  it('skills tab shows skills, cosmetics tab shows cosmetics', () => {
    const save: SaveState = {
      ...freshSave(),
      unlockedSkills: ['dash'],
      unlockedCosmetics: ['crown'],
    };
    const skills = buildInventoryViewModel(save, cfg, 'skills');
    const cosmetics = buildInventoryViewModel(save, cfg, 'cosmetics');
    expect(skills.items.map((it) => it.id)).toContain('dash');
    expect(skills.items.map((it) => it.id)).not.toContain('crown');
    expect(cosmetics.items.map((it) => it.id)).toEqual(['crown']);
    expect(cosmetics.items.map((it) => it.id)).not.toContain('dash');
  });
});

describe('InventoryPanel — single-select equip + preview (Req 12.15, 19.7, 20.47)', () => {
  it('selecting an owned skill equips it single-select and updates equippedId/previewId', () => {
    const save: SaveState = { ...freshSave(), unlockedSkills: ['secondChance', 'dash'] };
    const next = equipItem(save, 'skills', 'secondChance', cfg);
    expect(next.equippedSkill).toBe('secondChance');

    const vm = buildInventoryViewModel(next, cfg, 'skills');
    expect(vm.equippedId).toBe('secondChance');
    expect(vm.previewId).toBe('secondChance');
    expect(vm.items.find((it) => it.id === 'secondChance')?.equipped).toBe(true);
    expect(vm.items.find((it) => it.id === 'dash')?.equipped).toBe(false);
  });

  it('equipping a second owned skill replaces the first (at most one equipped)', () => {
    let save: SaveState = { ...freshSave(), unlockedSkills: ['secondChance', 'dash'] };
    save = equipItem(save, 'skills', 'secondChance', cfg);
    save = equipItem(save, 'skills', 'dash', cfg);
    expect(save.equippedSkill).toBe('dash');
    const vm = buildInventoryViewModel(save, cfg, 'skills');
    expect(vm.items.filter((it) => it.equipped).map((it) => it.id)).toEqual(['dash']);
  });

  it('selecting an owned cosmetic equips it single-select and updates the preview', () => {
    const save: SaveState = { ...freshSave(), unlockedCosmetics: ['wizard-hat', 'crown'] };
    let next = equipItem(save, 'cosmetics', 'wizard-hat', cfg);
    expect(next.equippedCosmetic).toBe('wizard-hat');
    next = equipItem(next, 'cosmetics', 'crown', cfg);
    expect(next.equippedCosmetic).toBe('crown');
    const vm = buildInventoryViewModel(next, cfg, 'cosmetics');
    expect(vm.previewId).toBe('crown');
    expect(vm.items.filter((it) => it.equipped).map((it) => it.id)).toEqual(['crown']);
  });

  it('equipping a skill does not touch the equipped cosmetic and vice versa', () => {
    let save: SaveState = {
      ...freshSave(),
      unlockedSkills: ['dash'],
      unlockedCosmetics: ['crown'],
    };
    save = equipItem(save, 'skills', 'dash', cfg);
    save = equipItem(save, 'cosmetics', 'crown', cfg);
    expect(save.equippedSkill).toBe('dash');
    expect(save.equippedCosmetic).toBe('crown');
  });
});

describe('InventoryPanel — equipping a locked/unowned item is a no-op', () => {
  it('equipping a locked skill leaves the equipped skill unchanged (non-selectable)', () => {
    const save: SaveState = {
      ...freshSave(),
      unlockedSkills: ['dash'],
      equippedSkill: 'dash',
    };
    // timeErase is not unlocked → non-selectable → no-op.
    const next = equipItem(save, 'skills', 'timeErase', cfg);
    expect(next.equippedSkill).toBe('dash');
  });

  it('equipping an unowned cosmetic leaves the equipped cosmetic unchanged', () => {
    const save: SaveState = {
      ...freshSave(),
      unlockedCosmetics: ['wizard-hat'],
      equippedCosmetic: 'wizard-hat',
    };
    const next = equipItem(save, 'cosmetics', 'crown', cfg);
    expect(next.equippedCosmetic).toBe('wizard-hat');
  });

  it('equipItem does not mutate its input (pure)', () => {
    const before: SaveState = { ...freshSave(), unlockedSkills: ['dash'] };
    const snapshot = serialize(before);
    equipItem(before, 'skills', 'dash', cfg);
    expect(serialize(before)).toEqual(snapshot);
  });
});

describe('InventoryPanel — ownership + equipped queries', () => {
  it('isOwned reflects per-tab ownership', () => {
    const save: SaveState = {
      ...freshSave(),
      unlockedSkills: ['dash'],
      unlockedCosmetics: ['crown'],
    };
    expect(isOwned(save, 'skills', 'dash')).toBe(true);
    expect(isOwned(save, 'skills', 'nuke')).toBe(false);
    expect(isOwned(save, 'cosmetics', 'crown')).toBe(true);
    expect(isOwned(save, 'cosmetics', 'unknown')).toBe(false);
    expect(isOwned(save, 'skills', '')).toBe(false);
  });

  it('equippedId reads the per-tab equipped field', () => {
    const save: SaveState = {
      ...freshSave(),
      equippedSkill: 'dash',
      equippedCosmetic: 'crown',
    };
    expect(equippedId(save, 'skills')).toBe('dash');
    expect(equippedId(save, 'cosmetics')).toBe('crown');
  });
});

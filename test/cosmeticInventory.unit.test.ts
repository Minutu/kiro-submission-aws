// Feature: kino-game
//
// Unit tests for the CosmeticInventory module (task 8.2; design: "Perk system
// (Req 10, 11)", "Save_Store schema (Req 22, 28, 40)"; Req 19.5, 19.7, 10.11).
//
// These pin the task-8.2 contract on the two PERMANENT cosmetic save fields:
//   - Req 19.7: equipping sets EXACTLY ONE equipped cosmetic and unequips the
//     previous one (single-equip); equipping an UNOWNED cosmetic is a no-op
//     (unowned cosmetics are non-selectable).
//   - Req 19.5 / 10.11: unlocking / recording a random drop adds to the
//     PERMANENT owned set idempotently.
//   - Permanence: owned + equipped cosmetics survive a serialize→deserialize
//     round-trip AND a generation transition (they are permanent, Req 19.5).
//
// Pure / Phaser-free; built from the documented default Config_File.

import { describe, it, expect } from 'vitest';
import {
  isUnlocked,
  equippedCosmetic,
  unlockedCosmetics,
  unlock,
  recordRandomDrop,
  equip,
  unequip,
  serialize,
  deserialize,
  advanceGeneration,
  createFirstLaunchState,
  type SaveState,
} from '../src/core/index.ts';
import { defaultConfig } from '../src/config/index.ts';

const cfg = defaultConfig;

function freshSave(): SaveState {
  return createFirstLaunchState(cfg);
}

/** A save that owns the given cosmetics (nothing equipped). */
function saveOwning(...ids: string[]): SaveState {
  return { ...freshSave(), unlockedCosmetics: [...ids], equippedCosmetic: null };
}

describe('CosmeticInventory — ownership (Req 19.5, 10.11)', () => {
  it('first-launch state owns no cosmetics and has none equipped (Req 40.1)', () => {
    const save = freshSave();
    expect(unlockedCosmetics(save)).toEqual([]);
    expect(equippedCosmetic(save)).toBeNull();
    expect(isUnlocked(save, 'wizard-hat')).toBe(false);
  });

  it('unlock adds a cosmetic to the permanent owned set (Req 19.5)', () => {
    const save = unlock(freshSave(), 'wizard-hat');
    expect(isUnlocked(save, 'wizard-hat')).toBe(true);
    expect(unlockedCosmetics(save)).toEqual(['wizard-hat']);
  });

  it('unlock is idempotent — owning a cosmetic twice does not duplicate it', () => {
    const once = unlock(freshSave(), 'wizard-hat');
    const twice = unlock(once, 'wizard-hat');
    expect(twice.unlockedCosmetics).toEqual(['wizard-hat']);
  });

  it('unlock ignores an empty id', () => {
    const save = unlock(freshSave(), '');
    expect(save.unlockedCosmetics).toEqual([]);
  });

  it('recordRandomDrop persists a perk-slot cosmetic permanently (Req 10.11)', () => {
    const save = recordRandomDrop(freshSave(), 'crown');
    expect(isUnlocked(save, 'crown')).toBe(true);
    expect(unlockedCosmetics(save)).toEqual(['crown']);
  });

  it('unlock does not mutate its input (pure)', () => {
    const before = freshSave();
    const snapshot = serialize(before);
    unlock(before, 'wizard-hat');
    expect(serialize(before)).toEqual(snapshot);
  });

  it('unlock does not auto-equip', () => {
    const save = unlock(freshSave(), 'wizard-hat');
    expect(equippedCosmetic(save)).toBeNull();
  });
});

describe('CosmeticInventory — single-equip (Req 19.7)', () => {
  it('equipping an owned cosmetic sets exactly one equipped cosmetic', () => {
    const save = equip(saveOwning('wizard-hat'), 'wizard-hat');
    expect(equippedCosmetic(save)).toBe('wizard-hat');
  });

  it('equipping a second cosmetic unequips the previous one (at most one)', () => {
    let save = saveOwning('wizard-hat', 'crown');
    save = equip(save, 'wizard-hat');
    expect(equippedCosmetic(save)).toBe('wizard-hat');
    save = equip(save, 'crown');
    // Single-equip: the new selection replaced the old one entirely.
    expect(equippedCosmetic(save)).toBe('crown');
    // The owned set is unchanged by equipping.
    expect(save.unlockedCosmetics).toEqual(['wizard-hat', 'crown']);
  });

  it('equipping a NOT-yet-unlocked cosmetic is a no-op (unowned = non-selectable)', () => {
    const save = equip(saveOwning('wizard-hat'), 'crown');
    // crown is not owned, so nothing changes — wizard-hat stays unequipped.
    expect(equippedCosmetic(save)).toBeNull();
    expect(save.unlockedCosmetics).toEqual(['wizard-hat']);
  });

  it('equipping an unowned cosmetic leaves a previously-equipped one intact', () => {
    let save = equip(saveOwning('wizard-hat'), 'wizard-hat');
    save = equip(save, 'unowned-id');
    expect(equippedCosmetic(save)).toBe('wizard-hat');
  });

  it('unequip clears the single equipped selection', () => {
    let save = equip(saveOwning('wizard-hat'), 'wizard-hat');
    save = unequip(save);
    expect(equippedCosmetic(save)).toBeNull();
    // Unequipping never gives up ownership.
    expect(isUnlocked(save, 'wizard-hat')).toBe(true);
  });

  it('equip does not mutate its input (pure)', () => {
    const before = saveOwning('wizard-hat');
    const snapshot = serialize(before);
    equip(before, 'wizard-hat');
    expect(serialize(before)).toEqual(snapshot);
  });
});

describe('CosmeticInventory — permanence across persistence + generations (Req 19.5)', () => {
  it('owned + equipped cosmetics survive a serialize → deserialize round-trip', () => {
    let save = saveOwning('wizard-hat', 'crown');
    save = equip(save, 'crown');

    const { state, usedFallback } = deserialize(serialize(save), cfg);
    expect(usedFallback).toBe(false);
    expect(unlockedCosmetics(state)).toEqual(['wizard-hat', 'crown']);
    expect(equippedCosmetic(state)).toBe('crown');
  });

  it('cosmetics are preserved through a generation transition (permanent)', () => {
    // Own two cosmetics and equip one, then advance to the next generation.
    let save = saveOwning('wizard-hat', 'crown');
    save = equip(save, 'crown');

    const { save: nextGen } = advanceGeneration(save, cfg, {
      cosmeticPool: ['gen-reward'],
    });

    // Previously-owned cosmetics persist across the generation (Req 19.5), and
    // the just-awarded generation cosmetic is added on top.
    expect(isUnlocked(nextGen, 'wizard-hat')).toBe(true);
    expect(isUnlocked(nextGen, 'crown')).toBe(true);
    expect(isUnlocked(nextGen, 'gen-reward')).toBe(true);
    // The equipped selection is permanent too — it carries forward unchanged.
    expect(equippedCosmetic(nextGen)).toBe('crown');
  });

  it('a cosmetic unlocked via unlock() survives a generation transition', () => {
    const owned = unlock(freshSave(), 'party-hat');
    const { save: nextGen } = advanceGeneration(owned, cfg, { cosmeticPool: ['gen-reward'] });
    expect(isUnlocked(nextGen, 'party-hat')).toBe(true);
  });
});

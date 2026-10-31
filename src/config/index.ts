// Feature: kino-game
//
// Config layer — barrel / public surface.
//
// This folder holds the single user-editable Config_File module plus the
// ConfigFile.loadAndValidate / BalanceTable logic. It is pure data and pure
// TypeScript (Phaser-independent) so the core can read balance tunables without
// pulling in the render layer.
//
// Re-export config modules from this barrel as they are implemented
// (Config_File schema + defaults, loadAndValidate, BalanceTable).

export { defaultConfig } from './config.ts';
export { loadAndValidate } from './loadAndValidate.ts';
export { createBalanceTable } from './balanceTable.ts';
export type { BalanceTable, BalanceKey, HitboxScaleKey } from './balanceTable.ts';
export type {
  ConfigFileData,
  GenerationalScheme,
  PerWorld,
  NamesConfig,
  LabelsConfig,
  AnimationFramesConfig,
  ObstacleCategoriesConfig,
  PaletteOverlay,
  ColorPalette,
  MentorDialogueLine,
  CinematicsConfig,
  AudioConfig,
  StarterAssetsConfig,
  SkillId,
  SkillUnlockSchedule,
  RarityTier,
  MovementBalance,
  DifficultyBalance,
  SkillsBalance,
  PerksBalance,
  HitboxesBalance,
  TransitionsBalance,
  BalanceConfig,
} from './config.ts';

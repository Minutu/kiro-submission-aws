// Feature: kino-game
//
// Asset registry — barrel / public surface.
//
// This folder holds the Asset_Registry: the single choke point mapping config
// asset keys to real loaded art or geometric placeholder factories
// (`AssetRegistry.fromConfig`, `resolve`, `hasReal`). The registry itself is
// data/logic; placeholder factories that construct Phaser display objects live
// with (or are injected by) the engine layer so this registry stays usable from
// pure code where possible.
//
// Re-export asset-registry modules from this barrel as they are implemented.

export { AssetRegistry } from './registry.ts';
export type {
  AssetCategory,
  WorldId,
  PlaceholderKind,
  PlaceholderDescriptor,
  PlaceholderFactory,
  AssetState,
  AssetRecord,
  ResolvedAsset,
} from './registry.ts';

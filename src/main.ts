// Browser entry point — minimal rebuild.
//
// Boots a Phaser game with a world-picker menu and the playable worlds:
//   World 1 — Ground Runner (Chrome-dino style)
//   World 2 — Flappy (classic Flappy Bird)
//   World 3 — Zigzag (Geometry-Dash style)
// The previous complex scene graph under src/core and src/engine is
// intentionally not loaded; those files remain on disk for reference.

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './game/config.ts';
import { MenuScene } from './game/MenuScene.ts';
import { World1Scene } from './game/World1Scene.ts';
import { World2Scene } from './game/World2Scene.ts';
import { World3Scene } from './game/World3Scene.ts';
import { World4Scene } from './game/World4Scene.ts';
import { World5Scene } from './game/World5Scene.ts';

const GAME_ROOT_ID = 'game-root';

export function bootGame(): Phaser.Game {
  const config: Phaser.Types.Core.GameConfig = {
    type: Phaser.AUTO,
    parent: GAME_ROOT_ID,
    backgroundColor: '#000000',
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
    },
    scene: [MenuScene, World1Scene, World2Scene, World3Scene, World4Scene, World5Scene],
  };

  return new Phaser.Game(config);
}

bootGame();

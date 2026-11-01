// Browser entry point — minimal rebuild.
//
// Boots a Phaser game to the title Start screen. Clicking it plays the opening
// cinematic (Intro) on first launch, or goes straight to the world-picker menu
// if the intro was already seen.
//   World 1 — Desert (Ground Runner)
//   World 2 — Foundry (Flappy)
//   World 3 — Memory Jungle (Zigzag)
//   World 4 — Ice & Underwater (chained)
//   World 5 — Security Citadel (chained + reverse gravity)

import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from './game/config.ts';
import { StartScreen } from './game/StartScreen.ts';
import { MuteButtonScene } from './game/MuteButton.ts';
import { IntroScene } from './game/IntroScene.ts';
import { EndCinematicScene } from './game/EndCinematicScene.ts';
import { MenuScene } from './game/MenuScene.ts';
import { MenuBgScene } from './game/menuBackground.ts';
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
    // StartScreen runs first (the title logo + "Click to start"). On click it
    // plays the Intro cinematic (first boot) or jumps straight to the Menu.
    // MuteButtonScene is listed LAST so its always-on overlay renders on top of
    // every other scene.
    scene: [StartScreen, IntroScene, EndCinematicScene, MenuBgScene, MenuScene, World1Scene, World2Scene, World3Scene, World4Scene, World5Scene, MuteButtonScene],
  };

  return new Phaser.Game(config);
}

bootGame();

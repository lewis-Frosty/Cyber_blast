import Phaser from 'phaser';
import { THEME } from './config/theme';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { GameOverScene } from './scenes/GameOverScene';
import { HelpScene } from './scenes/HelpScene';

const game = new Phaser.Game({
  type: Phaser.AUTO,
  parent: 'game',
  width: THEME.layout.canvasWidth,
  height: THEME.layout.canvasHeight,
  backgroundColor: THEME.colours.backgroundDeep,
  scale: {
    mode: Phaser.Scale.FIT,
    autoCenter: Phaser.Scale.CENTER_BOTH,
  },
  render: { antialias: true, pixelArt: false },
  // Needed for the leaderboard name field — a real input gives phones a keyboard.
  dom: { createContainer: true },
  input: { activePointers: 2 },
  scene: [BootScene, GameScene, GameOverScene, HelpScene],
});

// Handy for poking at the running game from devtools / automated smoke tests.
declare global {
  interface Window {
    __cyberBlast: Phaser.Game;
  }
}
window.__cyberBlast = game;

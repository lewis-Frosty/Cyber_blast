import Phaser from 'phaser';
import { THEME } from './config/theme';
import { BootScene } from './scenes/BootScene';
import { GameScene } from './scenes/GameScene';
import { GameOverScene } from './scenes/GameOverScene';
import { HelpScene } from './scenes/HelpScene';
import { ensureSession, isBackendConfigured } from './backend/supabase';
import { flushPendingRuns } from './backend/runSession';
import { smokeTest } from './debug/smokeTest';

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
    __cyberBlast: Phaser.Game & { smokeTest: typeof smokeTest };
  }
}
// The game instance, plus a one-command backend check. Exposed in production
// deliberately: the deployed site is the only place the Supabase round trip can
// actually be exercised, and this grants no access the bundle does not already
// carry — the publishable key is inlined either way and RLS governs everything.
window.__cyberBlast = Object.assign(game, { smokeTest });

// Sign in silently on first launch (backend spec §1). Fired and forgotten: the
// game must start and stay playable whether or not this ever resolves.
if (isBackendConfigured()) {
  void ensureSession().then((session) => {
    if (session) console.info('[cyber-blast] signed in anonymously as', session.userId);
    // Runs post themselves at game over, so a run lost to a dropped connection
    // has no manual retry. Anything queued by a previous session goes now.
    if (session) void flushPendingRuns();
  });
}

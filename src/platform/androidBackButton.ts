import type Phaser from 'phaser';

/**
 * Android's hardware back button.
 *
 * Without this the button closes the app from anywhere, including mid-run —
 * the player loses the game they were playing with no warning and no way to
 * undo it. Play's own quality guidance treats back as "go up one level", and
 * an app that exits from a modal screen reads as broken.
 *
 * The rule here: back closes whatever overlay is open, and on the play screen
 * it does nothing at all rather than exiting. Exiting is what the home button
 * is for, and a puzzle game with a run in progress has no safe exit point.
 *
 * No-ops on the web, where the plugin is absent.
 */

/** Overlay scenes, checked in order — the innermost closes first. */
const OVERLAYS = ['Help', 'Leaderboard', 'League', 'Dashboard', 'GameOver'] as const;

export async function installAndroidBackButton(game: Phaser.Game): Promise<void> {
  let App: typeof import('@capacitor/app').App;
  try {
    ({ App } = await import('@capacitor/app'));
  } catch {
    return; // Web build — the plugin is not bundled.
  }

  try {
    await App.addListener('backButton', () => {
      for (const key of OVERLAYS) {
        const scene = game.scene.getScene(key);
        if (!scene || !game.scene.isActive(key)) continue;
        // GameOver is not dismissible: the run is finished, and backing out
        // of it would leave the player staring at a dead board with no way
        // forward. RESTART and the overlay buttons are the ways on.
        if (key === 'GameOver') return;
        scene.scene.stop();
        return;
      }
      // Play screen: swallow it. Nothing here is worth losing a run over.
    });
  } catch {
    /* Registration failed — a dead button beats a crash on launch. */
  }
}

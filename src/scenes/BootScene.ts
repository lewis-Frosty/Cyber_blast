import Phaser from 'phaser';
import { THEME } from '../config/theme';
import { generateTextures } from '../render/BlockRenderer';

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create(): void {
    generateTextures(this);
    const { canvasWidth, canvasHeight } = THEME.layout;
    const label = this.add
      .text(canvasWidth / 2, canvasHeight / 2, 'LOADING', {
        fontFamily: THEME.fonts.display,
        fontSize: '20px',
        color: THEME.colours.textPrimaryCss,
      })
      .setOrigin(0.5)
      .setAlpha(0.6);

    // Wait for the web fonts so Phaser text measures correctly, but never block
    // the prototype on a font CDN: fall back to system fonts after 1.5s.
    const fontsReady = typeof document !== 'undefined' && 'fonts' in document
      ? Promise.all([document.fonts.load('700 32px Orbitron'), document.fonts.load('600 20px Rajdhani')]).then(() => undefined)
      : Promise.resolve();
    const timeout = new Promise<void>((resolve) => setTimeout(resolve, 1500));

    void Promise.race([fontsReady, timeout]).then(() => {
      label.destroy();
      this.scene.start('Game');
    });
  }
}

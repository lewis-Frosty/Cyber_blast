import Phaser from 'phaser';
import { THEME } from '../config/theme';
import { GAMEPLAY_CONFIG } from '../config/gameplay';
import { TEXTURE } from './BlockRenderer';
import type { ColorId } from '../core/types';

/** Particles, shake, flashes, combo number, scanlines. Owns no game state. */
export class EffectsManager {
  private readonly emitter: Phaser.GameObjects.Particles.ParticleEmitter;
  private comboText: Phaser.GameObjects.Text | null = null;

  constructor(private readonly scene: Phaser.Scene) {
    this.emitter = scene.add.particles(0, 0, TEXTURE.spark, {
      speed: { min: 60, max: 260 },
      angle: { min: 0, max: 360 },
      scale: { start: 1.1, end: 0 },
      alpha: { start: 1, end: 0 },
      lifespan: { min: 260, max: 620 },
      gravityY: 120,
      rotate: { min: 0, max: 360 },
      blendMode: Phaser.BlendModes.ADD,
      emitting: false,
    });
    this.emitter.setDepth(50);
  }

  addScanlines(): void {
    const { canvasWidth, canvasHeight } = THEME.layout;
    const scan = this.scene.add.tileSprite(0, 0, canvasWidth, canvasHeight, TEXTURE.scanline);
    scan.setOrigin(0, 0).setAlpha(THEME.effects.scanlineAlpha).setDepth(900);
    scan.setScrollFactor(0);
  }

  /** Brief scale punch on freshly placed blocks. */
  placementPunch(targets: Phaser.GameObjects.Image[]): void {
    this.scene.tweens.add({
      targets,
      scale: THEME.effects.placementPunchScale,
      duration: THEME.effects.placementPunchMs / 2,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
  }

  /** White flash + burst for one cleared cell. Returns when the visual is done. */
  clearCell(x: number, y: number, color: ColorId, generation: number): void {
    const { cellSize } = THEME.layout;
    const flash = this.scene.add.image(x, y, TEXTURE.white).setDepth(40).setAlpha(0.95);
    flash.setBlendMode(Phaser.BlendModes.ADD);
    this.scene.tweens.add({
      targets: flash,
      alpha: 0,
      scale: 1.25 + generation * 0.1,
      duration: THEME.effects.clearFlashMs + generation * 30,
      ease: 'Quad.easeOut',
      onComplete: () => flash.destroy(),
    });

    const tint = THEME.blocks[color]?.hex ?? 0xffffff;
    this.emitter.setParticleTint(tint);
    const count = THEME.effects.particlesPerCell + generation * 3;
    this.emitter.explode(count, x + Phaser.Math.Between(-cellSize / 4, cellSize / 4), y + Phaser.Math.Between(-cellSize / 4, cellSize / 4));
  }

  /** Camera shake scaled by generation, capped. */
  shake(generation: number): void {
    const amp = Math.min(generation * GAMEPLAY_CONFIG.SCREEN_SHAKE_PER_GENERATION, GAMEPLAY_CONFIG.SCREEN_SHAKE_MAX);
    if (amp <= 0) return;
    // Phaser intensity is a fraction of the viewport size.
    this.scene.cameras.main.shake(120 + generation * 30, amp / THEME.layout.canvasWidth);
  }

  /** Large centre-screen combo number; colour shifts warmer with depth. */
  showCombo(multiplier: number, generation: number, x: number, y: number): void {
    const colour = THEME.effects.comboColours[Math.min(generation, THEME.effects.comboColours.length - 1)] ?? '#FFFFFF';
    if (!this.comboText) {
      this.comboText = this.scene.add
        .text(x, y, '', {
          fontFamily: THEME.fonts.display,
          fontSize: '72px',
          fontStyle: '700',
          color: colour,
          stroke: '#07070F',
          strokeThickness: 8,
        })
        .setOrigin(0.5)
        .setDepth(100);
    }
    const t = this.comboText;
    this.scene.tweens.killTweensOf(t);
    t.setText(`×${multiplier}`).setColor(colour).setPosition(x, y).setAlpha(1).setScale(0.5);
    t.setShadow(0, 0, colour, 18, true, true);
    this.scene.tweens.add({
      targets: t,
      scale: 1.25,
      duration: 160,
      ease: 'Back.easeOut',
      onComplete: () => {
        this.scene.tweens.add({ targets: t, alpha: 0, scale: 1.5, y: y - 40, duration: 650, delay: 250, ease: 'Quad.easeIn' });
      },
    });
  }

  /** Floating score popup near a point. */
  floatScore(x: number, y: number, amount: number, colour = THEME.colours.textPrimaryCss): void {
    const t = this.scene.add
      .text(x, y, `+${amount}`, { fontFamily: THEME.fonts.body, fontSize: '26px', fontStyle: '600', color: colour })
      .setOrigin(0.5)
      .setDepth(90)
      .setAlpha(0);
    this.scene.tweens.add({
      targets: t,
      alpha: { from: 0, to: 1 },
      y: y - 36,
      duration: 500,
      ease: 'Quad.easeOut',
      onComplete: () => this.scene.tweens.add({ targets: t, alpha: 0, duration: 250, onComplete: () => t.destroy() }),
    });
  }
}

import Phaser from 'phaser';
import { THEME } from '../config/theme';
import { POWERUPS, type PowerUpDef } from '../core/powerups';
import type { PowerUpMeters } from '../core/powerups';
import type { ColorId } from '../core/types';

const BTN_H = 60;
const GAP = 5;
/**
 * The tap area is deliberately larger than the drawn button: the canvas is
 * scaled down on a phone, so a hit box that only covers the artwork ends up
 * well under a finger's worth of screen.
 */
const HIT_PAD_X = 4;
const HIT_PAD_Y = 18;

export interface PowerUpButton {
  def: PowerUpDef;
  width: number;
  container: Phaser.GameObjects.Container;
  fill: Phaser.GameObjects.Rectangle;
  frame: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  counter: Phaser.GameObjects.Text;
  glow: Phaser.GameObjects.Rectangle;
  ready: boolean;
  selected: boolean;
}

/**
 * The five colour meters. Each fills as you clear that colour, and lights up
 * when its ability is ready — so the cluster you keep detonating is visibly
 * the tool you keep earning.
 */
export class PowerUpBar {
  readonly buttons: PowerUpButton[] = [];

  constructor(
    scene: Phaser.Scene,
    centreY: number,
    width: number,
    private readonly onTap: (colour: ColorId) => void,
  ) {
    const btnW = (width - GAP * (POWERUPS.length - 1)) / POWERUPS.length;
    const left = (THEME.layout.canvasWidth - width) / 2;

    POWERUPS.forEach((def, i) => {
      const x = left + btnW / 2 + i * (btnW + GAP);
      const container = scene.add.container(x, centreY).setDepth(30);
      const css = THEME.blocks[def.colour]?.css ?? '#FFFFFF';
      const hex = THEME.blocks[def.colour]?.hex ?? 0xffffff;

      const glow = scene.add
        .rectangle(0, 0, btnW + 6, BTN_H + 6, hex, 0.0)
        .setStrokeStyle(2, hex, 0)
        .setOrigin(0.5);
      const bg = scene.add.rectangle(0, 0, btnW, BTN_H, THEME.colours.backgroundPanel, 1).setOrigin(0.5);
      // Charge fill grows from the bottom, so a glance reads as "how full".
      const fill = scene.add.rectangle(0, BTN_H / 2, btnW, 0, hex, 0.28).setOrigin(0.5, 1);
      const frame = scene.add.rectangle(0, 0, btnW, BTN_H, 0x000000, 0).setStrokeStyle(1, THEME.colours.gridLine, 1).setOrigin(0.5);
      const label = scene.add
        .text(0, -9, def.name.toUpperCase(), {
          fontFamily: THEME.fonts.body,
          fontSize: '14px',
          fontStyle: '700',
          color: '#5B5688',
        })
        .setOrigin(0.5);
      // The meter reads as a number as well as a bar, so "how close am I?" is
      // answerable at a glance instead of by eyeballing a fill height.
      const counter = scene.add
        .text(0, 11, '', {
          fontFamily: THEME.fonts.body,
          fontSize: '12px',
          fontStyle: '600',
          color: '#5B5688',
        })
        .setOrigin(0.5);

      container.add([glow, bg, fill, frame, label, counter]);
      container.setSize(btnW, BTN_H);
      container.setInteractive(
        new Phaser.Geom.Rectangle(
          -btnW / 2 - HIT_PAD_X,
          -BTN_H / 2 - HIT_PAD_Y,
          btnW + HIT_PAD_X * 2,
          BTN_H + HIT_PAD_Y * 2,
        ),
        Phaser.Geom.Rectangle.Contains,
      );
      container.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
        event.stopPropagation();
        this.onTap(def.colour);
      });

      this.buttons.push({ def, width: btnW, container, fill, frame, label, counter, glow, ready: false, selected: false });
      void css;
    });
  }

  /** Redraw meters from state. Call after every turn and every power-up use. */
  refresh(scene: Phaser.Scene, meters: PowerUpMeters, selectedColour: ColorId | null): void {
    for (const b of this.buttons) {
      const charge = meters.charge[b.def.colour] ?? 0;
      const frac = Math.max(0, Math.min(1, charge / meters.cost));
      const ready = frac >= 1;
      const hex = THEME.blocks[b.def.colour]?.hex ?? 0xffffff;

      // setSize (not a bare .height write) so the bottom origin is recomputed
      // and the fill grows upward inside the button instead of below it.
      b.fill.setSize(b.width, BTN_H * frac);
      b.fill.setPosition(0, BTN_H / 2);
      b.fill.fillAlpha = ready ? 0.55 : 0.28;

      const selected = selectedColour === b.def.colour;
      b.frame.setStrokeStyle(ready ? 2 : 1, ready ? hex : THEME.colours.gridLine, ready ? 1 : 1);
      b.label.setColor(ready ? THEME.colours.textPrimaryCss : '#8781b8');
      b.counter.setText(ready ? 'READY' : `${charge}/${meters.cost}`);
      b.counter.setColor(ready ? THEME.blocks[b.def.colour]?.css ?? '#FFFFFF' : '#5B5688');
      b.glow.setStrokeStyle(2, hex, selected ? 1 : 0);

      if (ready && !b.ready) {
        // Just charged — one punch so it reads without watching the meter.
        scene.tweens.add({ targets: b.container, scale: { from: 1, to: 1.12 }, duration: 130, yoyo: true, ease: 'Quad.easeOut' });
      }
      if (selected && !b.selected) {
        scene.tweens.add({ targets: b.glow, alpha: { from: 0.4, to: 1 }, duration: 420, yoyo: true, repeat: -1 });
      }
      if (!selected && b.selected) {
        scene.tweens.killTweensOf(b.glow);
        b.glow.setAlpha(1);
      }
      b.ready = ready;
      b.selected = selected;
    }
  }
}

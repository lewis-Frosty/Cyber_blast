import Phaser from 'phaser';
import { THEME } from '../config/theme';
import { GAMEPLAY_CONFIG } from '../config/gameplay';
import { POWERUPS } from '../core/powerups';
import { blockTextureKey } from '../render/BlockRenderer';

const SEEN_KEY = 'cyber-blast.seenHelp';

export function hasSeenHelp(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markHelpSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* ignore */
  }
}

/**
 * How-to-play overlay. Shown automatically on a player's first ever load, and
 * from the ? button any time after. Pauses the game scene so a stray drag
 * behind the panel can't place a piece.
 */
export class HelpScene extends Phaser.Scene {
  constructor() {
    super('Help');
  }

  create(): void {
    const { canvasWidth: w, canvasHeight: h } = THEME.layout;
    this.add.rectangle(0, 0, w, h, 0x07070f, 0.97).setOrigin(0, 0);

    let y = 44;
    this.add
      .text(w / 2, y, 'HOW TO PLAY', {
        fontFamily: THEME.fonts.display,
        fontSize: '26px',
        fontStyle: '700',
        color: '#00F0FF',
      })
      .setOrigin(0.5)
      .setShadow(0, 0, '#00F0FF', 16, true, true);

    y += 44;
    y = this.section(y, 'THE RULE', [
      'Drag a piece onto the board. Fill a whole row',
      'or column and it clears — but only the tiles',
      'matching the colour you just placed.',
      'Every other colour stays where it is.',
    ]);

    y += 6;
    y = this.section(y, 'THE CHAIN', [
      'The clear spreads to touching tiles of that',
      'same colour, then keeps spreading. Deeper',
      'links are worth more each.',
    ]);

    y += 6;
    y = this.section(y, 'SO THE GAME IS', [
      'Build a blob of one colour, then finish a line',
      'in that colour to set it off.',
    ]);

    // Worked example: a row of mixed colours with one colour highlighted.
    y = this.example(y + 10);

    y += 14;
    this.add
      .text(28, y, 'POWER-UPS', {
        fontFamily: THEME.fonts.body,
        fontSize: '14px',
        fontStyle: '700',
        color: '#FFB627',
      })
      .setOrigin(0, 0);
    y += 22;
    this.add
      .text(28, y, `Clear ${GAMEPLAY_CONFIG.POWERUP_CHARGE_COST} tiles of a colour to charge that`, {
        fontFamily: THEME.fonts.body,
        fontSize: '14px',
        color: '#8781b8',
      })
      .setOrigin(0, 0);
    y += 18;
    this.add
      .text(28, y, `colour's tool. Every ${GAMEPLAY_CONFIG.POWERUP_SCORE_MILESTONE} points tops them all up.`, {
        fontFamily: THEME.fonts.body,
        fontSize: '14px',
        color: '#8781b8',
      })
      .setOrigin(0, 0);
    y += 26;

    for (const def of POWERUPS) {
      this.add.image(40, y + 8, blockTextureKey(def.colour, false)).setScale(0.42);
      this.add
        .text(62, y, def.name.toUpperCase(), {
          fontFamily: THEME.fonts.body,
          fontSize: '14px',
          fontStyle: '700',
          color: THEME.blocks[def.colour]?.css ?? '#FFFFFF',
        })
        .setOrigin(0, 0);
      this.add
        .text(138, y + 1, def.blurb, { fontFamily: THEME.fonts.body, fontSize: '13px', color: '#B9B4E0' })
        .setOrigin(0, 0);
      y += 24;
    }

    const btn = this.add
      .text(w / 2, h - 44, 'GOT IT', {
        fontFamily: THEME.fonts.body,
        fontSize: '19px',
        fontStyle: '700',
        color: '#07070F',
        backgroundColor: '#00F0FF',
        padding: { x: 34, y: 12 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    const close = (): void => {
      markHelpSeen();
      this.scene.resume('Game');
      this.scene.stop();
    };
    btn.on('pointerdown', close);
    this.input.keyboard?.on('keydown-ESC', close);
    this.input.keyboard?.on('keydown-H', close);
  }

  private section(y: number, heading: string, lines: string[]): number {
    this.add
      .text(28, y, heading, { fontFamily: THEME.fonts.body, fontSize: '14px', fontStyle: '700', color: '#FFB627' })
      .setOrigin(0, 0);
    let cursor = y + 22;
    for (const line of lines) {
      this.add
        .text(28, cursor, line, { fontFamily: THEME.fonts.body, fontSize: '14px', color: '#E8E6FF' })
        .setOrigin(0, 0);
      cursor += 19;
    }
    return cursor;
  }

  /** Before/after strip showing one colour lifting out of a mixed row. */
  private example(y: number): number {
    const scale = 0.4;
    const step = 22;
    const before: (number | null)[] = [0, 2, 1, 2, 3, 2, 4, 2];
    const after: (number | null)[] = [0, null, 1, null, 3, null, 4, null];

    this.add
      .text(28, y + 6, 'BEFORE', { fontFamily: THEME.fonts.body, fontSize: '11px', color: '#5B5688' })
      .setOrigin(0, 0.5);
    before.forEach((c, i) => {
      if (c !== null) this.add.image(112 + i * step, y + 6, blockTextureKey(c, false)).setScale(scale);
    });

    this.add
      .text(28, y + 40, 'AFTER', { fontFamily: THEME.fonts.body, fontSize: '11px', color: '#5B5688' })
      .setOrigin(0, 0.5);
    after.forEach((c, i) => {
      if (c !== null) {
        this.add.image(112 + i * step, y + 40, blockTextureKey(c, false)).setScale(scale);
      } else {
        this.add
          .rectangle(112 + i * step, y + 40, 17, 17, THEME.colours.gridCellEmpty)
          .setStrokeStyle(1, THEME.colours.gridLine);
      }
    });

    this.add
      .text(112 + 8 * step + 4, y + 23, 'lime\nonly', {
        fontFamily: THEME.fonts.body,
        fontSize: '11px',
        color: '#A8FF3E',
        align: 'left',
      })
      .setOrigin(0, 0.5);

    return y + 58;
  }
}

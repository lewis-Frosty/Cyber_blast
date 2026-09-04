import Phaser from 'phaser';
import { THEME, type GlyphName } from '../config/theme';
import type { ColorId } from '../core/types';
import { renderSettings } from './settings';

/**
 * Generates and serves block textures. Every block on screen (board, tray,
 * drag ghost) goes through here so the glyph accessibility mode is applied
 * uniformly — the glyph is baked into the texture, not bolted on afterwards.
 */

export const TEXTURE = {
  emptyCell: 'cell-empty',
  spark: 'spark',
  scanline: 'scanline',
  white: 'white-cell',
} as const;

const GLOW_PAD = THEME.effects.glowBlurPx + 4;

/** Total texture size including glow padding. */
export function blockTextureSize(): number {
  return THEME.layout.cellSize + GLOW_PAD * 2;
}

export function blockTextureKey(color: ColorId, glyph: boolean = renderSettings.glyphMode): string {
  return `block-${color}-${glyph ? 'glyph' : 'plain'}`;
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawGlyph(ctx: CanvasRenderingContext2D, glyph: GlyphName, cx: number, cy: number, size: number): void {
  const s = size / 2;
  ctx.beginPath();
  switch (glyph) {
    case 'circle':
      ctx.arc(cx, cy, s, 0, Math.PI * 2);
      break;
    case 'triangle':
      ctx.moveTo(cx, cy - s);
      ctx.lineTo(cx + s, cy + s);
      ctx.lineTo(cx - s, cy + s);
      ctx.closePath();
      break;
    case 'square':
      ctx.rect(cx - s * 0.85, cy - s * 0.85, s * 1.7, s * 1.7);
      break;
    case 'diamond':
      ctx.moveTo(cx, cy - s);
      ctx.lineTo(cx + s, cy);
      ctx.lineTo(cx, cy + s);
      ctx.lineTo(cx - s, cy);
      ctx.closePath();
      break;
    case 'cross': {
      const t = s * 0.35;
      ctx.rect(cx - t, cy - s, t * 2, s * 2);
      ctx.rect(cx - s, cy - t, s * 2, t * 2);
      break;
    }
  }
  ctx.fill();
}

function drawBlock(ctx: CanvasRenderingContext2D, colourCss: string, glyph: GlyphName | null): void {
  const cell = THEME.layout.cellSize;
  const x = GLOW_PAD;
  const y = GLOW_PAD;
  const radius = 5;

  // Outer glow in own colour.
  ctx.save();
  ctx.shadowColor = colourCss;
  ctx.shadowBlur = THEME.effects.glowBlurPx;
  ctx.fillStyle = colourCss;
  roundedRectPath(ctx, x, y, cell, cell, radius);
  ctx.fill();
  ctx.fill(); // second pass thickens the glow
  ctx.restore();

  // Flat fill on top (so glow doesn't muddy the face).
  ctx.fillStyle = colourCss;
  roundedRectPath(ctx, x, y, cell, cell, radius);
  ctx.fill();

  // 2px inner border at 40% white.
  const b = THEME.effects.innerBorderPx;
  ctx.strokeStyle = `rgba(255,255,255,${THEME.effects.innerBorderAlpha})`;
  ctx.lineWidth = b;
  roundedRectPath(ctx, x + b / 2 + 1, y + b / 2 + 1, cell - b - 2, cell - b - 2, radius - 1);
  ctx.stroke();

  // Faint top highlight for a little depth.
  const grad = ctx.createLinearGradient(0, y, 0, y + cell);
  grad.addColorStop(0, 'rgba(255,255,255,0.18)');
  grad.addColorStop(0.5, 'rgba(255,255,255,0)');
  ctx.fillStyle = grad;
  roundedRectPath(ctx, x, y, cell, cell, radius);
  ctx.fill();

  if (glyph) {
    ctx.fillStyle = `rgba(255,255,255,${THEME.effects.glyphAlpha})`;
    drawGlyph(ctx, glyph, x + cell / 2, y + cell / 2, cell * 0.42);
  }
}

/** Call once in BootScene. Idempotent. */
export function generateTextures(scene: Phaser.Scene): void {
  const tm = scene.textures;
  const size = blockTextureSize();
  const cell = THEME.layout.cellSize;

  THEME.blocks.forEach((block, id) => {
    for (const glyph of [false, true]) {
      const key = blockTextureKey(id, glyph);
      if (tm.exists(key)) continue;
      const tex = tm.createCanvas(key, size, size);
      if (!tex) throw new Error(`Could not create texture ${key}`);
      drawBlock(tex.getContext(), block.css, glyph ? block.glyph : null);
      tex.refresh();
    }
  });

  if (!tm.exists(TEXTURE.emptyCell)) {
    const tex = tm.createCanvas(TEXTURE.emptyCell, cell, cell);
    if (!tex) throw new Error('Could not create empty cell texture');
    const ctx = tex.getContext();
    ctx.fillStyle = '#12102A';
    roundedRectPath(ctx, 0.5, 0.5, cell - 1, cell - 1, 4);
    ctx.fill();
    ctx.strokeStyle = 'rgba(31,27,58,0.9)'; // #1F1B3A grid line, subtle
    ctx.lineWidth = 1;
    ctx.stroke();
    tex.refresh();
  }

  if (!tm.exists(TEXTURE.white)) {
    const tex = tm.createCanvas(TEXTURE.white, cell, cell);
    if (!tex) throw new Error('Could not create white texture');
    const ctx = tex.getContext();
    ctx.fillStyle = '#FFFFFF';
    roundedRectPath(ctx, 0, 0, cell, cell, 5);
    ctx.fill();
    tex.refresh();
  }

  if (!tm.exists(TEXTURE.spark)) {
    const tex = tm.createCanvas(TEXTURE.spark, 8, 8);
    if (!tex) throw new Error('Could not create spark texture');
    const ctx = tex.getContext();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(1, 1, 6, 6);
    tex.refresh();
  }

  if (!tm.exists(TEXTURE.scanline)) {
    const tex = tm.createCanvas(TEXTURE.scanline, 4, 4);
    if (!tex) throw new Error('Could not create scanline texture');
    const ctx = tex.getContext();
    ctx.clearRect(0, 0, 4, 4);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, 4, 1);
    ctx.fillStyle = 'rgba(255,255,255,0.5)';
    ctx.fillRect(0, 2, 4, 1);
    tex.refresh();
  }
}

/** Create a block image centred at (x, y). Honours the current glyph setting. */
export function createBlock(scene: Phaser.Scene, color: ColorId, x: number, y: number): Phaser.GameObjects.Image {
  return scene.add.image(x, y, blockTextureKey(color));
}

/** Swap every block image in a container/list to the current glyph-mode texture. */
export function retextureBlocks(images: Iterable<Phaser.GameObjects.Image>): void {
  for (const img of images) {
    const color = img.getData('color') as ColorId | undefined;
    if (color !== undefined) img.setTexture(blockTextureKey(color));
  }
}

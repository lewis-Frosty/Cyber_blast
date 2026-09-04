/**
 * Neon arcade visual spec (§4). Palette, fonts, layout and effect parameters.
 * Pure data — safe to import from anywhere.
 */
export const THEME = {
  colours: {
    backgroundDeep: 0x07070f,
    backgroundPanel: 0x0d0b1f,
    gridLine: 0x1f1b3a,
    gridCellEmpty: 0x12102a,
    textPrimary: 0xe8e6ff,
    textPrimaryCss: '#E8E6FF',
    backgroundDeepCss: '#07070F',
    danger: 0xff3b3b,
    /** Obstacle cube — deliberately unlit, so it reads as wall, not as a colour. */
    blocked: 0x51506b,
    blockedCss: '#51506B',
  },

  /** Five block colours, indexed by ColorId 0–4. */
  blocks: [
    { name: 'Cyan', hex: 0x00f0ff, css: '#00F0FF', glyph: 'circle' },
    { name: 'Magenta', hex: 0xff2e9f, css: '#FF2E9F', glyph: 'triangle' },
    { name: 'Lime', hex: 0xa8ff3e, css: '#A8FF3E', glyph: 'square' },
    { name: 'Amber', hex: 0xffb627, css: '#FFB627', glyph: 'diamond' },
    { name: 'Violet', hex: 0x9d4edd, css: '#9D4EDD', glyph: 'cross' },
  ] as const,

  fonts: {
    display: '"Orbitron", "Chakra Petch", "Rajdhani", monospace',
    body: '"Rajdhani", "Chakra Petch", "Orbitron", sans-serif',
  },

  layout: {
    canvasWidth: 480,
    canvasHeight: 820,
    cellSize: 46,
    cellGap: 3,
    boardTop: 120,
    trayTop: 600,
    trayScale: 0.55,
    /** Lift the dragged piece above the finger on touch so it isn't hidden. */
    touchDragLiftPx: 90,
  },

  effects: {
    glowBlurPx: 14,
    innerBorderPx: 2,
    innerBorderAlpha: 0.4,
    glyphAlpha: 0.38,
    placementPunchScale: 1.08,
    placementPunchMs: 120,
    scanlineAlpha: 0.04,
    particlesPerCell: 7,
    clearFlashMs: 90,
    /** Combo number colour per generation depth (shifts warmer with depth). */
    comboColours: ['#00F0FF', '#A8FF3E', '#FFB627', '#FF7A2E', '#FF2E9F'],
  },
};

export type GlyphName = (typeof THEME.blocks)[number]['glyph'];

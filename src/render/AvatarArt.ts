import Phaser from 'phaser';

/**
 * The twelve avatars, drawn rather than shipped.
 *
 * Procedural art keeps the bundle free of twelve sprite files and keeps every
 * avatar in the game's own visual language — the same neon-on-dark geometry as
 * the board. Each is generated once into a texture and reused, so a leaderboard
 * of fifty rows costs twelve draws, not fifty.
 *
 * The ids match the `avatars` catalogue seeded in the database.
 */

export interface AvatarStyle {
  id: string;
  colour: number;
  /** Second accent, used by the shapes that need contrast. */
  accent: number;
}

export const AVATAR_STYLES: readonly AvatarStyle[] = [
  { id: 'circuit', colour: 0x00f0ff, accent: 0x0aa6b8 },
  { id: 'prism', colour: 0xff2e9f, accent: 0xffb627 },
  { id: 'vector', colour: 0xa8ff3e, accent: 0x00f0ff },
  { id: 'pulse', colour: 0xffb627, accent: 0xff2e9f },
  { id: 'helix', colour: 0x9d4edd, accent: 0x00f0ff },
  { id: 'nova', colour: 0xff7a2e, accent: 0xffb627 },
  { id: 'glitch', colour: 0x00f0ff, accent: 0xff2e9f },
  { id: 'cascade', colour: 0xa8ff3e, accent: 0x00f0ff },
  { id: 'lattice', colour: 0x00f0ff, accent: 0x9d4edd },
  { id: 'phantom', colour: 0xc4bfeb, accent: 0x9d4edd },
  { id: 'binary', colour: 0xa8ff3e, accent: 0xffb627 },
  { id: 'overdrive', colour: 0xff2e9f, accent: 0x00f0ff },
];

const TEXTURE_PREFIX = 'avatar:';
export const AVATAR_TEXTURE_SIZE = 64;

export function avatarTextureKey(id: string): string {
  return `${TEXTURE_PREFIX}${id}`;
}

function styleFor(id: string): AvatarStyle {
  return AVATAR_STYLES.find((s) => s.id === id) ?? AVATAR_STYLES[0]!;
}

/** Draw one avatar into `g`, filling a `size` box anchored at the origin. */
function drawAvatar(g: Phaser.GameObjects.Graphics, id: string, size: number): void {
  const s = styleFor(id);
  const c = size / 2;
  const u = size / 8; // one grid unit — every shape is laid out on this

  g.fillStyle(0x0d0b1f, 1);
  g.fillRoundedRect(0, 0, size, size, u);
  g.lineStyle(Math.max(1, u * 0.22), s.colour, 0.9);
  g.strokeRoundedRect(0, 0, size, size, u);

  const line = (w: number, colour: number, alpha = 1): void => {
    g.lineStyle(w, colour, alpha);
  };

  switch (id) {
    case 'circuit': {
      line(u * 0.4, s.colour);
      g.beginPath();
      g.moveTo(u * 1.5, u * 2);
      g.lineTo(u * 4, u * 2);
      g.lineTo(u * 4, u * 4.5);
      g.lineTo(u * 6.5, u * 4.5);
      g.strokePath();
      g.fillStyle(s.colour, 1);
      g.fillCircle(u * 1.5, u * 2, u * 0.5);
      g.fillCircle(u * 6.5, u * 4.5, u * 0.5);
      g.fillStyle(s.accent, 1);
      g.fillCircle(u * 4, u * 6.2, u * 0.5);
      break;
    }
    case 'prism': {
      g.fillStyle(s.colour, 0.85);
      g.fillTriangle(c, u * 1.6, u * 6.6, u * 6, u * 1.4, u * 6);
      g.fillStyle(s.accent, 0.75);
      g.fillTriangle(c, u * 3.4, u * 5.6, u * 6, u * 2.4, u * 6);
      break;
    }
    case 'vector': {
      g.fillStyle(s.colour, 0.95);
      g.fillTriangle(u * 6.4, c, u * 2.2, u * 1.8, u * 2.2, u * 6.2);
      g.fillStyle(0x0d0b1f, 1);
      g.fillTriangle(u * 4.6, c, u * 3.2, u * 3.1, u * 3.2, u * 4.9);
      break;
    }
    case 'pulse': {
      line(u * 0.45, s.colour);
      g.beginPath();
      g.moveTo(u, c);
      g.lineTo(u * 2.4, c);
      g.lineTo(u * 3.2, u * 2.2);
      g.lineTo(u * 4.2, u * 5.9);
      g.lineTo(u * 5, c);
      g.lineTo(u * 7, c);
      g.strokePath();
      break;
    }
    case 'helix': {
      line(u * 0.36, s.colour);
      g.beginPath();
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const x = u * 1.6 + t * u * 4.8;
        const y = c + Math.sin(t * Math.PI * 2) * u * 2;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokePath();
      line(u * 0.36, s.accent);
      g.beginPath();
      for (let i = 0; i <= 24; i++) {
        const t = i / 24;
        const x = u * 1.6 + t * u * 4.8;
        const y = c - Math.sin(t * Math.PI * 2) * u * 2;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.strokePath();
      break;
    }
    case 'nova': {
      line(u * 0.34, s.colour);
      for (let i = 0; i < 8; i++) {
        const a = (i / 8) * Math.PI * 2;
        g.beginPath();
        g.moveTo(c + Math.cos(a) * u * 1.1, c + Math.sin(a) * u * 1.1);
        g.lineTo(c + Math.cos(a) * u * 3, c + Math.sin(a) * u * 3);
        g.strokePath();
      }
      g.fillStyle(s.accent, 1);
      g.fillCircle(c, c, u * 0.8);
      break;
    }
    case 'glitch': {
      g.fillStyle(s.colour, 0.9);
      g.fillRect(u * 1.4, u * 2.2, u * 4, u * 0.9);
      g.fillRect(u * 2.6, u * 3.6, u * 4, u * 0.9);
      g.fillStyle(s.accent, 0.9);
      g.fillRect(u * 1.8, u * 5, u * 3.4, u * 0.9);
      break;
    }
    case 'cascade': {
      const sq = u * 1.5;
      g.fillStyle(s.colour, 0.95);
      g.fillRect(u * 1.4, u * 1.6, sq, sq);
      g.fillStyle(s.colour, 0.7);
      g.fillRect(u * 3.2, u * 3.3, sq, sq);
      g.fillStyle(s.accent, 0.85);
      g.fillRect(u * 5, u * 5, sq, sq);
      break;
    }
    case 'lattice': {
      line(u * 0.3, s.colour, 0.95);
      for (let i = 0; i < 3; i++) {
        const o = u * (2 + i * 1.5);
        g.strokeRect(o - u * 0.9, c - u * 0.9, u * 1.8, u * 1.8);
      }
      line(u * 0.3, s.accent, 0.9);
      g.strokeRect(c - u * 0.9, u * 1.6, u * 1.8, u * 1.8);
      g.strokeRect(c - u * 0.9, u * 4.6, u * 1.8, u * 1.8);
      break;
    }
    case 'phantom': {
      line(u * 0.4, s.colour, 0.9);
      g.strokeCircle(c, c, u * 2.4);
      line(u * 0.3, s.accent, 0.7);
      g.strokeCircle(c, c, u * 1.3);
      g.fillStyle(0x0d0b1f, 1);
      g.fillRect(u * 0.8, c - u * 0.4, size - u * 1.6, u * 0.8);
      break;
    }
    case 'binary': {
      g.fillStyle(s.colour, 0.95);
      g.fillRect(u * 1.6, u * 1.8, u * 1.1, u * 4.4);
      line(u * 0.42, s.accent, 0.95);
      g.strokeRoundedRect(u * 4, u * 1.8, u * 2.4, u * 4.4, u * 1.1);
      break;
    }
    case 'overdrive': {
      for (let i = 3; i >= 1; i--) {
        line(u * 0.34, i % 2 === 0 ? s.accent : s.colour, 0.35 + i * 0.2);
        g.strokeCircle(c, c, u * i);
      }
      g.fillStyle(s.colour, 1);
      g.fillCircle(c, c, u * 0.55);
      break;
    }
    default: {
      g.fillStyle(s.colour, 0.9);
      g.fillCircle(c, c, u * 2);
    }
  }
}

/**
 * Generate every avatar texture once. Safe to call repeatedly — a scene
 * restart must not redraw twelve textures it already has.
 */
export function ensureAvatarTextures(scene: Phaser.Scene, size = AVATAR_TEXTURE_SIZE): void {
  for (const style of AVATAR_STYLES) {
    const key = avatarTextureKey(style.id);
    if (scene.textures.exists(key)) continue;
    const g = scene.make.graphics({ x: 0, y: 0 }, false);
    drawAvatar(g, style.id, size);
    g.generateTexture(key, size, size);
    g.destroy();
  }
}

/** A known avatar id, or the first one when the id is unknown or missing. */
export function resolveAvatarId(id: string | null | undefined): string {
  return AVATAR_STYLES.some((s) => s.id === id) ? (id as string) : AVATAR_STYLES[0]!.id;
}

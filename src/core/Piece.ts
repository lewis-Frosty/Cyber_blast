import type { Board } from './Board';
import { BLOCKED, type ColorId } from './types';
import type { Rng } from './rng';

/** A polyomino shape. Cells are [dRow, dCol] offsets, normalised so min row = min col = 0. */
export interface Shape {
  readonly name: string;
  readonly cells: readonly (readonly [number, number])[];
  readonly width: number;
  readonly height: number;
}

/** A single-coloured piece in the tray. */
export interface Piece {
  readonly shape: Shape;
  readonly color: ColorId;
}

function shapeFromRows(name: string, rows: readonly string[]): Shape {
  const cells: [number, number][] = [];
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r] ?? '';
    for (let c = 0; c < row.length; c++) {
      if (row[c] === '#') cells.push([r, c]);
    }
  }
  if (cells.length === 0) throw new Error(`Shape ${name} has no cells`);
  const height = Math.max(...cells.map(([r]) => r)) + 1;
  const width = Math.max(...cells.map(([, c]) => c)) + 1;
  return { name, cells, width, height };
}

function bar(name: string, w: number, h: number): Shape {
  const rows: string[] = [];
  for (let r = 0; r < h; r++) rows.push('#'.repeat(w));
  return shapeFromRows(name, rows);
}

/**
 * Starting shape set (§2.2). Orientations are distinct pieces because there is
 * no rotation. Expand after playtesting.
 */
export const SHAPES: readonly Shape[] = [
  bar('1x1', 1, 1),
  bar('1x2', 2, 1),
  bar('2x1', 1, 2),
  bar('1x3', 3, 1),
  bar('3x1', 1, 3),
  bar('1x4', 4, 1),
  bar('4x1', 1, 4),
  bar('1x5', 5, 1),
  bar('5x1', 1, 5),
  bar('2x2', 2, 2),
  bar('3x3', 3, 3),
  // L-tromino, 4 orientations
  shapeFromRows('L3-a', ['#.', '##']),
  shapeFromRows('L3-b', ['##', '#.']),
  shapeFromRows('L3-c', ['##', '.#']),
  shapeFromRows('L3-d', ['.#', '##']),
  // T-tetromino, 4 orientations
  shapeFromRows('T-up', ['.#.', '###']),
  shapeFromRows('T-down', ['###', '.#.']),
  shapeFromRows('T-left', ['.#', '##', '.#']),
  shapeFromRows('T-right', ['#.', '##', '#.']),
  // S / Z tetrominoes, 2 orientations each
  shapeFromRows('S-h', ['.##', '##.']),
  shapeFromRows('S-v', ['#.', '##', '.#']),
  shapeFromRows('Z-h', ['##.', '.##']),
  shapeFromRows('Z-v', ['.#', '##', '#.']),
];

/** The single grey cube. Placing it writes a permanent wall cell. */
export const OBSTACLE_PIECE: Piece = { shape: bar('1x1', 1, 1), color: BLOCKED };

/** True if this tray piece is the grey cube rather than a coloured piece. */
export function isObstacle(piece: Piece): boolean {
  return piece.color === BLOCKED;
}

export function shapeByName(name: string): Shape {
  const s = SHAPES.find((x) => x.name === name);
  if (!s) throw new Error(`Unknown shape ${name}`);
  return s;
}

export interface ColourPickOptions {
  paletteSize: number;
  /** 0 = uniform, 1 = always the most common colour on the board. */
  affinity: number;
  /**
   * Relative spawn weight per colour id. Integers, so the running total and the
   * comparison stay exact. Omitted means every colour is equally likely.
   */
  weights?: readonly number[];
}

/**
 * Draw a colour from the weight table using one integer from the stream.
 * Falls back to a uniform draw if the weights are missing or sum to nothing.
 */
function weightedColour(rng: Rng, paletteSize: number, weights: readonly number[] | undefined): ColorId {
  if (!weights) return rng.int(paletteSize);
  let total = 0;
  for (let i = 0; i < paletteSize; i++) total += Math.max(0, Math.trunc(weights[i] ?? 0));
  if (total <= 0) return rng.int(paletteSize);

  let roll = rng.int(total);
  for (let i = 0; i < paletteSize; i++) {
    roll -= Math.max(0, Math.trunc(weights[i] ?? 0));
    if (roll < 0) return i;
  }
  return paletteSize - 1;
}

/**
 * Pick a colour for a spawning piece, weighted toward colours already on the
 * board (§2.2 / §3). With probability `affinity` the most common board colour
 * is chosen (ties broken randomly); otherwise a uniform random colour.
 * An empty board always yields a uniform random colour.
 */
export function pickColour(board: Board, rng: Rng, opts: ColourPickOptions): ColorId {
  const { paletteSize, affinity, weights } = opts;
  if (affinity > 0 && rng.next() < affinity) {
    const counts = board.colourCounts(paletteSize);
    const max = Math.max(...counts);
    if (max > 0) {
      const leaders: ColorId[] = [];
      counts.forEach((n, id) => {
        if (n === max) leaders.push(id);
      });
      return rng.pick(leaders);
    }
  }
  return weightedColour(rng, paletteSize, weights);
}

export function spawnPiece(board: Board, rng: Rng, opts: ColourPickOptions, shapes: readonly Shape[] = SHAPES): Piece {
  return { shape: rng.pick(shapes), color: pickColour(board, rng, opts) };
}

/** Colour identifier 0–4. */
export type ColorId = number;

/** Sentinel value for an empty cell. */
export const EMPTY = -1;

/**
 * A permanent obstacle. Counts as filled for line completion, matches no
 * colour, and can never be removed — not by a clear, a cascade, or a power-up.
 * It is the only thing on the board that accumulates without limit, which is
 * what makes it a pressure mechanic rather than another kind of block.
 */
export const BLOCKED = -2;

/** A cell holds EMPTY, BLOCKED, or a ColorId. */
export type Cell = number;

/** True for a real colour, as opposed to EMPTY or BLOCKED. */
export function isColour(cell: Cell): boolean {
  return cell >= 0;
}

/** Row/column coordinate on the board. */
export interface Coord {
  row: number;
  col: number;
}

/** Flat cell index = row * size + col. */
export type CellIndex = number;

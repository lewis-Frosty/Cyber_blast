/** Colour identifier 0–4. */
export type ColorId = number;

/** Sentinel value for an empty cell. */
export const EMPTY = -1;

/** A cell holds either EMPTY or a ColorId. */
export type Cell = number;

/** Row/column coordinate on the board. */
export interface Coord {
  row: number;
  col: number;
}

/** Flat cell index = row * size + col. */
export type CellIndex = number;

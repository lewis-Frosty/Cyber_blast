import { BLOCKED, EMPTY, type Cell, type CellIndex, type ColorId, type Coord } from './types';
import type { Shape } from './Piece';

/**
 * 8×8 (configurable) grid state with placement validation.
 * No gravity: cleared cells simply become EMPTY.
 * Pure — no engine dependencies.
 */
export class Board {
  readonly size: number;
  private readonly cells: Cell[];

  constructor(size: number, cells?: readonly Cell[]) {
    if (!Number.isInteger(size) || size <= 0) throw new Error(`Invalid board size ${size}`);
    this.size = size;
    if (cells) {
      if (cells.length !== size * size) throw new Error('Cell array length does not match board size');
      this.cells = [...cells];
    } else {
      this.cells = new Array<Cell>(size * size).fill(EMPTY);
    }
  }

  /**
   * Build a board from ASCII rows. '.' = empty, '#' = a permanent obstacle,
   * digits = colour ids. Whitespace is ignored so rows can be indented.
   */
  static fromRows(rows: readonly string[]): Board {
    const size = rows.length;
    const cells: Cell[] = [];
    for (const raw of rows) {
      const row = raw.replace(/\s+/g, '');
      if (row.length !== size) throw new Error(`Row "${row}" length ${row.length} != ${size}`);
      for (const ch of row) {
        cells.push(ch === '.' ? EMPTY : ch === '#' ? BLOCKED : Number.parseInt(ch, 10));
      }
    }
    return new Board(size, cells);
  }

  clone(): Board {
    return new Board(this.size, this.cells);
  }

  index(row: number, col: number): CellIndex {
    return row * this.size + col;
  }

  coord(index: CellIndex): Coord {
    return { row: Math.floor(index / this.size), col: index % this.size };
  }

  inBounds(row: number, col: number): boolean {
    return row >= 0 && row < this.size && col >= 0 && col < this.size;
  }

  get(row: number, col: number): Cell {
    if (!this.inBounds(row, col)) throw new RangeError(`Cell (${row},${col}) out of bounds`);
    return this.cells[this.index(row, col)] as Cell;
  }

  getAt(index: CellIndex): Cell {
    const v = this.cells[index];
    if (v === undefined) throw new RangeError(`Index ${index} out of bounds`);
    return v;
  }

  set(row: number, col: number, value: Cell): void {
    if (!this.inBounds(row, col)) throw new RangeError(`Cell (${row},${col}) out of bounds`);
    this.cells[this.index(row, col)] = value;
  }

  isEmpty(row: number, col: number): boolean {
    return this.get(row, col) === EMPTY;
  }

  /** Filled includes obstacles: a wall cube completes a line like anything else. */
  isFilled(row: number, col: number): boolean {
    return this.get(row, col) !== EMPTY;
  }

  /** True for a permanent obstacle — filled, but never a colour and never cleared. */
  isBlocked(row: number, col: number): boolean {
    return this.get(row, col) === BLOCKED;
  }

  blockedCount(): number {
    let n = 0;
    for (const v of this.toArray()) if (v === BLOCKED) n++;
    return n;
  }

  /** True if every cell of `shape` anchored at (row, col) is in bounds and empty. */
  canPlace(shape: Shape, row: number, col: number): boolean {
    for (const [dr, dc] of shape.cells) {
      const r = row + dr;
      const c = col + dc;
      if (!this.inBounds(r, c) || this.cells[this.index(r, c)] !== EMPTY) return false;
    }
    return true;
  }

  /** True if there is at least one legal anchor for `shape` anywhere on the board. */
  canPlaceAnywhere(shape: Shape): boolean {
    for (let r = 0; r < this.size; r++) {
      for (let c = 0; c < this.size; c++) {
        if (this.canPlace(shape, r, c)) return true;
      }
    }
    return false;
  }

  /**
   * Place a shape with the given colour. Returns the indexes of the cells filled.
   * Throws if the placement is illegal — callers must validate with canPlace first.
   */
  place(shape: Shape, color: ColorId, row: number, col: number): CellIndex[] {
    if (!this.canPlace(shape, row, col)) {
      throw new Error(`Illegal placement of ${shape.name} at (${row},${col})`);
    }
    const placed: CellIndex[] = [];
    for (const [dr, dc] of shape.cells) {
      const i = this.index(row + dr, col + dc);
      this.cells[i] = color;
      placed.push(i);
    }
    return placed;
  }

  /**
   * Set every listed cell to EMPTY. Obstacles are skipped: nothing in the game
   * may remove one, and enforcing that here means no caller can get it wrong.
   */
  clearCells(indexes: Iterable<CellIndex>): void {
    for (const i of indexes) {
      if (i < 0 || i >= this.cells.length) throw new RangeError(`Index ${i} out of bounds`);
      if (this.cells[i] === BLOCKED) continue;
      this.cells[i] = EMPTY;
    }
  }

  /** Indexes of all rows that are completely filled. */
  fullRows(): number[] {
    const rows: number[] = [];
    for (let r = 0; r < this.size; r++) {
      let full = true;
      for (let c = 0; c < this.size; c++) {
        if (this.cells[this.index(r, c)] === EMPTY) {
          full = false;
          break;
        }
      }
      if (full) rows.push(r);
    }
    return rows;
  }

  /** Indexes of all columns that are completely filled. */
  fullCols(): number[] {
    const cols: number[] = [];
    for (let c = 0; c < this.size; c++) {
      let full = true;
      for (let r = 0; r < this.size; r++) {
        if (this.cells[this.index(r, c)] === EMPTY) {
          full = false;
          break;
        }
      }
      if (full) cols.push(c);
    }
    return cols;
  }

  filledCount(): number {
    let n = 0;
    for (const v of this.cells) if (v !== EMPTY) n++;
    return n;
  }

  /** Count of filled cells per colour id, indexed by colour. */
  colourCounts(paletteSize: number): number[] {
    const counts = new Array<number>(paletteSize).fill(0);
    for (const v of this.cells) {
      if (v !== EMPTY && v >= 0 && v < paletteSize) counts[v] = (counts[v] ?? 0) + 1;
    }
    return counts;
  }

  /** Read-only snapshot of the raw cell array. */
  toArray(): readonly Cell[] {
    return [...this.cells];
  }

  /** ASCII rendering, inverse of fromRows. Handy for test failure output. */
  toRows(): string[] {
    const out: string[] = [];
    for (let r = 0; r < this.size; r++) {
      let s = '';
      for (let c = 0; c < this.size; c++) {
        const v = this.cells[this.index(r, c)];
        s += v === EMPTY ? '.' : v === BLOCKED ? '#' : String(v);
      }
      out.push(s);
    }
    return out;
  }
}

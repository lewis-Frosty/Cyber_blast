// GENERATED FILE — do not edit.
// Copied from src/core/cascade.ts by scripts/build-edge-shared.mjs so the Edge Function
// runs the SAME logic as the client. Edit the source, then re-run the script.

import type { Board } from './Board.ts';
import { BLOCKED, EMPTY, type CellIndex, type ColorId } from './types.ts';
import type { NeighbourMode } from '../config/gameplay.ts';

/**
 * THE Color Cascade resolver (§2.4). Pure, engine-free, unit-tested.
 *
 * Generation 0 = the cells of the PLACED PIECE'S COLOUR in completely filled
 * rows/columns. Every other colour in those lines survives the clear.
 *
 * Generation N = filled cells orthogonally adjacent to a generation N-1 cell,
 * of the SAME colour as that specific neighbouring cell (per-cell comparison).
 * Colour-locking needs no special case in the walk: if every generation-0 cell
 * is one colour, per-cell propagation can never leave that colour.
 */

export interface CascadeOptions {
  /** Maximum generation number that may be produced (generations 1..maxDepth). */
  maxDepth: number;
  neighbourMode: NeighbourMode;
}

export interface LineOptions {
  /** The colour that completed the line — the placed piece's colour. */
  lockedColour: ColorId;
}

export interface Generation0 {
  rows: number[];
  cols: number[];
  /** Union of all cells in full rows and columns; shared cells appear once. */
  cells: Set<CellIndex>;
}

export interface CascadeResult {
  /** generations[g] = cell indexes cleared at generation g (g = 0 is the line clear). */
  generations: CellIndex[][];
  /** Every cleared cell mapped to the generation it was cleared in. */
  cleared: Map<CellIndex, number>;
  /** Highest generation that actually cleared at least one cell. */
  maxGeneration: number;
  /** True if the cascade was cut off by maxDepth while more cells could have cleared. */
  truncated: boolean;
}

const ORTHOGONAL: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];
const DIAGONAL: readonly (readonly [number, number])[] = [
  ...ORTHOGONAL,
  [-1, -1],
  [-1, 1],
  [1, -1],
  [1, 1],
];

export function neighbourOffsets(mode: NeighbourMode): readonly (readonly [number, number])[] {
  return mode === 'diagonal' ? DIAGONAL : ORTHOGONAL;
}

/**
 * Scan rows and columns simultaneously from the current board state (§2.3).
 * Rows and columns are evaluated from the same pre-clear snapshot, so a cell in
 * both a full row and a full column is only counted once.
 */
export function findGeneration0(board: Board, opts: LineOptions): Generation0 {
  const { lockedColour } = opts;
  if (!Number.isInteger(lockedColour)) {
    throw new TypeError(`lockedColour must be an integer colour id, got ${lockedColour}`);
  }
  const rows = board.fullRows();
  const cols = board.fullCols();
  const cells = new Set<CellIndex>();

  const take = (i: CellIndex): void => {
    const v = board.getAt(i);
    // An obstacle is never a clear target, even if lockedColour were somehow
    // BLOCKED — a grey piece completing a line must not dissolve the wall.
    if (v === EMPTY || v === BLOCKED) return;
    if (v === lockedColour) cells.add(i);
  };

  for (const r of rows) for (let c = 0; c < board.size; c++) take(board.index(r, c));
  for (const c of cols) for (let r = 0; r < board.size; r++) take(board.index(r, c));
  return { rows, cols, cells };
}

/**
 * Breadth-first cascade from a generation-0 clear set. Does NOT mutate the board;
 * colour comparisons use the pre-clear state. The visited set (`cleared`) is what
 * prevents infinite loops on same-coloured regions.
 */
export function resolveClears(board: Board, generation0: ReadonlySet<CellIndex>, opts: CascadeOptions): CascadeResult {
  const size = board.size;
  const offsets = neighbourOffsets(opts.neighbourMode);

  const cleared = new Map<CellIndex, number>();
  const generations: CellIndex[][] = [];

  const gen0: CellIndex[] = [];
  for (const i of generation0) {
    if (i < 0 || i >= size * size) throw new RangeError(`Generation-0 index ${i} out of bounds`);
    const seed = board.getAt(i);
    if (seed === EMPTY || seed === BLOCKED) continue; // never clear empty or wall
    if (!cleared.has(i)) {
      cleared.set(i, 0);
      gen0.push(i);
    }
  }
  if (gen0.length === 0) {
    return { generations: [], cleared, maxGeneration: -1, truncated: false };
  }
  generations.push(gen0);

  let frontier = gen0;
  let generation = 0;
  let truncated = false;

  while (frontier.length > 0) {
    if (generation >= opts.maxDepth) {
      // Would the cascade have continued? Only report truncation if so.
      truncated = frontierHasUnclearedSameColourNeighbour(board, frontier, cleared, offsets);
      break;
    }
    generation += 1;
    const next: CellIndex[] = [];

    for (const c of frontier) {
      const { row, col } = board.coord(c);
      const colour = board.getAt(c);
      for (const [dr, dc] of offsets) {
        const nr = row + dr;
        const nc = col + dc;
        if (!board.inBounds(nr, nc)) continue;
        const n = board.index(nr, nc);
        if (cleared.has(n)) continue;
        const nColour = board.getAt(n);
        if (nColour === EMPTY || nColour === BLOCKED || nColour !== colour) continue;
        cleared.set(n, generation);
        next.push(n);
      }
    }

    if (next.length === 0) break;
    generations.push(next);
    frontier = next;
  }

  return { generations, cleared, maxGeneration: generations.length - 1, truncated };
}

function frontierHasUnclearedSameColourNeighbour(
  board: Board,
  frontier: readonly CellIndex[],
  cleared: ReadonlyMap<CellIndex, number>,
  offsets: readonly (readonly [number, number])[],
): boolean {
  for (const c of frontier) {
    const { row, col } = board.coord(c);
    const colour = board.getAt(c);
    for (const [dr, dc] of offsets) {
      const nr = row + dr;
      const nc = col + dc;
      if (!board.inBounds(nr, nc)) continue;
      const n = board.index(nr, nc);
      if (!cleared.has(n) && board.getAt(n) === colour) return true;
    }
  }
  return false;
}

/** Convenience: find full lines on the board and resolve the full cascade from them. */
export function resolveBoard(
  board: Board,
  opts: CascadeOptions & LineOptions,
): CascadeResult & { generation0: Generation0 } {
  const generation0 = findGeneration0(board, { lockedColour: opts.lockedColour });
  const result = resolveClears(board, generation0.cells, opts);
  return { ...result, generation0 };
}

import type { Board } from './Board';
import { EMPTY, type CellIndex, type ColorId } from './types';

/**
 * Per-colour power-ups. Pure — no engine dependencies.
 *
 * Design intent: in colour-locked clearing you win by *building* a single-colour
 * cluster and then completing a line with that colour to detonate it. Every
 * ability below therefore serves cluster-building or residue relief, and the
 * colour you keep detonating is the ability you keep earning.
 */

export type PowerUpId = 'flush' | 'nova' | 'paint' | 'reroll' | 'pluck';

/** How the player aims the ability. */
export type Targeting = 'cell' | 'none';

export interface PowerUpDef {
  readonly id: PowerUpId;
  /** The colour whose meter charges this ability. */
  readonly colour: ColorId;
  readonly name: string;
  /** One line shown in the UI — say what it does, not what it is. */
  readonly blurb: string;
  readonly targeting: Targeting;
}

export const POWERUPS: readonly PowerUpDef[] = [
  { id: 'flush', colour: 0, name: 'Flush', blurb: 'Clears a full row and column, every colour', targeting: 'cell' },
  { id: 'nova', colour: 1, name: 'Nova', blurb: 'Blows a 3×3 hole, every colour', targeting: 'cell' },
  { id: 'paint', colour: 2, name: 'Paint', blurb: 'Recolours a tile to match its neighbours', targeting: 'cell' },
  { id: 'reroll', colour: 3, name: 'Reroll', blurb: 'Swaps the tray for three new pieces', targeting: 'none' },
  { id: 'pluck', colour: 4, name: 'Pluck', blurb: 'Deletes a whole connected blob of one colour', targeting: 'cell' },
];

export function powerUpForColour(colour: ColorId): PowerUpDef {
  const p = POWERUPS.find((x) => x.colour === colour);
  if (!p) throw new Error(`No power-up defined for colour ${colour}`);
  return p;
}

export function powerUpById(id: PowerUpId): PowerUpDef {
  const p = POWERUPS.find((x) => x.id === id);
  if (!p) throw new Error(`Unknown power-up ${id}`);
  return p;
}

/** What an ability did, so the renderer can animate it and the scorer can price it. */
export interface PowerUpEffect {
  readonly id: PowerUpId;
  /** Cells emptied by the ability. */
  readonly cleared: CellIndex[];
  /** Cells whose colour changed, with the colour they became. */
  readonly recoloured: { index: CellIndex; colour: ColorId }[];
  /** True if the ability asked the caller to refill the tray. */
  readonly rerollTray: boolean;
}

const ORTHOGONAL: readonly (readonly [number, number])[] = [
  [-1, 0],
  [1, 0],
  [0, -1],
  [0, 1],
];

/**
 * Colour a Paint target should become: the most common colour among its
 * orthogonal neighbours, so one tap merges the tile into the blob beside it.
 * Ties break toward the colour with the larger cluster touching the target.
 * Returns null when the tile has no filled neighbours (nothing to merge into).
 */
export function paintTargetColour(board: Board, row: number, col: number): ColorId | null {
  const counts = new Map<ColorId, number>();
  for (const [dr, dc] of ORTHOGONAL) {
    const r = row + dr;
    const c = col + dc;
    if (!board.inBounds(r, c)) continue;
    const v = board.get(r, c);
    if (v === EMPTY) continue;
    counts.set(v, (counts.get(v) ?? 0) + 1);
  }
  if (counts.size === 0) return null;

  let best: ColorId | null = null;
  let bestCount = -1;
  let bestCluster = -1;
  for (const [colour, count] of counts) {
    const cluster = clusterSize(board, row, col, colour);
    if (count > bestCount || (count === bestCount && cluster > bestCluster)) {
      best = colour;
      bestCount = count;
      bestCluster = cluster;
    }
  }
  return best;
}

/**
 * Every filled cell orthogonally connected to (row, col) sharing its colour,
 * including the cell itself. Empty seed cell yields an empty list.
 */
export function connectedRegion(board: Board, row: number, col: number): CellIndex[] {
  if (!board.inBounds(row, col) || board.isEmpty(row, col)) return [];
  const colour = board.get(row, col);
  const start = board.index(row, col);
  const seen = new Set<CellIndex>([start]);
  const stack: CellIndex[] = [start];
  const out: CellIndex[] = [];
  while (stack.length > 0) {
    const i = stack.pop() as CellIndex;
    out.push(i);
    const { row: r, col: c } = board.coord(i);
    for (const [dr, dc] of ORTHOGONAL) {
      const nr = r + dr;
      const nc = c + dc;
      if (!board.inBounds(nr, nc)) continue;
      const ni = board.index(nr, nc);
      if (seen.has(ni) || board.getAt(ni) !== colour) continue;
      seen.add(ni);
      stack.push(ni);
    }
  }
  return out;
}

/** Size of the same-colour region that would include (row, col) if it were `colour`. */
function clusterSize(board: Board, row: number, col: number, colour: ColorId): number {
  const seen = new Set<CellIndex>([board.index(row, col)]);
  const stack: CellIndex[] = [board.index(row, col)];
  let n = 0;
  while (stack.length > 0) {
    const i = stack.pop() as CellIndex;
    n += 1;
    const { row: r, col: c } = board.coord(i);
    for (const [dr, dc] of ORTHOGONAL) {
      const nr = r + dr;
      const nc = c + dc;
      if (!board.inBounds(nr, nc)) continue;
      const ni = board.index(nr, nc);
      if (seen.has(ni) || board.getAt(ni) !== colour) continue;
      seen.add(ni);
      stack.push(ni);
    }
  }
  return n;
}

/** True if aiming this ability at (row, col) would actually do something. */
export function canApply(board: Board, id: PowerUpId, row: number, col: number): boolean {
  if (!board.inBounds(row, col)) return false;
  switch (id) {
    case 'flush':
    case 'nova':
      return true;
    case 'pluck':
      return board.isFilled(row, col);
    case 'paint':
      return board.isFilled(row, col) && paintTargetColour(board, row, col) !== null;
    case 'reroll':
      return true;
  }
}

/**
 * Apply an ability to the board. Mutates the board and reports what changed.
 * Power-up clears deliberately do NOT seed a cascade: these are surgical tools,
 * and a predictable tool is what makes them plannable.
 */
export function applyPowerUp(board: Board, id: PowerUpId, row: number, col: number): PowerUpEffect {
  const cleared: CellIndex[] = [];
  const recoloured: { index: CellIndex; colour: ColorId }[] = [];
  let rerollTray = false;

  const clearAt = (r: number, c: number): void => {
    if (!board.inBounds(r, c) || board.isEmpty(r, c)) return;
    cleared.push(board.index(r, c));
  };

  switch (id) {
    case 'flush': {
      for (let c = 0; c < board.size; c++) clearAt(row, c);
      for (let r = 0; r < board.size; r++) if (r !== row) clearAt(r, col);
      break;
    }
    case 'nova': {
      for (let r = row - 1; r <= row + 1; r++) {
        for (let c = col - 1; c <= col + 1; c++) clearAt(r, c);
      }
      break;
    }
    case 'pluck': {
      // The whole connected blob of that colour, not one tile — a single tile
      // barely dents the residue that colour-locked clearing leaves behind.
      for (const i of connectedRegion(board, row, col)) cleared.push(i);
      break;
    }
    case 'paint': {
      const colour = paintTargetColour(board, row, col);
      if (colour !== null && board.isFilled(row, col)) {
        board.set(row, col, colour);
        recoloured.push({ index: board.index(row, col), colour });
      }
      break;
    }
    case 'reroll': {
      rerollTray = true;
      break;
    }
  }

  board.clearCells(cleared);
  return { id, cleared, recoloured, rerollTray };
}

// ── Charge meters ────────────────────────────────────────────────────────

export interface PowerUpMeters {
  /** Charge progress per colour, indexed by ColorId. */
  charge: number[];
  /** Cost of one charge, mirrored here so the UI can draw the meter. */
  cost: number;
}

export function createMeters(paletteSize: number, cost: number): PowerUpMeters {
  return { charge: new Array<number>(paletteSize).fill(0), cost };
}

export function isReady(meters: PowerUpMeters, colour: ColorId): boolean {
  return (meters.charge[colour] ?? 0) >= meters.cost;
}

/** Add progress to one colour's meter, capped at a single stored charge. */
export function addCharge(meters: PowerUpMeters, colour: ColorId, amount: number): void {
  if (colour < 0 || colour >= meters.charge.length) return;
  meters.charge[colour] = Math.min(meters.cost, (meters.charge[colour] ?? 0) + amount);
}

/** Top every meter up — used for score milestones. */
export function addChargeAll(meters: PowerUpMeters, amount: number): void {
  for (let i = 0; i < meters.charge.length; i++) addCharge(meters, i, amount);
}

/** Spend a full charge. Returns false (and changes nothing) if it isn't ready. */
export function spendCharge(meters: PowerUpMeters, colour: ColorId): boolean {
  if (!isReady(meters, colour)) return false;
  meters.charge[colour] = 0;
  return true;
}

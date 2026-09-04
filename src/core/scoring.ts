import type { CascadeResult } from './cascade';
import type { CellIndex, ColorId } from './types';

export interface ScoringConfig {
  POINTS_PER_CELL_BASE: number;
  POINTS_PER_CELL_PLACED: number;
  /** Integer multiplier per colour id. Missing or absent entries count as 1. */
  COLOUR_SCORE_MULTIPLIER?: readonly number[];
}

/** Look up the colour of a cleared cell. Read before the board is wiped. */
export type ColourLookup = (index: CellIndex) => ColorId;

/** Integer score multiplier for a colour; 1 when nothing is configured. */
export function colourMultiplier(colour: ColorId, cfg: ScoringConfig): number {
  const m = cfg.COLOUR_SCORE_MULTIPLIER?.[colour];
  return Number.isInteger(m) && (m as number) > 0 ? (m as number) : 1;
}

export interface ScoreBreakdown {
  /** Points for the cells placed this turn. */
  placement: number;
  /** Points per generation, index = generation. */
  perGeneration: number[];
  /** Sum of perGeneration. */
  clears: number;
  total: number;
  /** Displayed combo multiplier = maxGeneration + 1 (0 when nothing cleared). */
  multiplier: number;
}

/** Points for a single cell cleared at the given generation. */
export function pointsForCell(generation: number, cfg: ScoringConfig): number {
  return cfg.POINTS_PER_CELL_BASE * (generation + 1);
}

/**
 * Score a completed turn (§2.5). Pure.
 *
 * `colourAt` must read the PRE-clear board, since the cells it names are about
 * to be emptied. Omit it and every colour scores at 1x.
 */
export function scoreTurn(
  placedCellCount: number,
  cascade: CascadeResult,
  cfg: ScoringConfig,
  colourAt?: ColourLookup,
): ScoreBreakdown {
  const placement = placedCellCount * cfg.POINTS_PER_CELL_PLACED;
  const perGeneration = cascade.generations.map((cells, g) => {
    const per = pointsForCell(g, cfg);
    if (!colourAt) return cells.length * per;
    let sum = 0;
    for (const i of cells) sum += per * colourMultiplier(colourAt(i), cfg);
    return sum;
  });
  const clears = perGeneration.reduce((a, b) => a + b, 0);
  const multiplier = cascade.maxGeneration >= 0 ? cascade.maxGeneration + 1 : 0;
  return { placement, perGeneration, clears, total: placement + clears, multiplier };
}

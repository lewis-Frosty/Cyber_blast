import type { CascadeResult } from './cascade';

export interface ScoringConfig {
  POINTS_PER_CELL_BASE: number;
  POINTS_PER_CELL_PLACED: number;
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

/** Score a completed turn (§2.5). Pure. */
export function scoreTurn(placedCellCount: number, cascade: CascadeResult, cfg: ScoringConfig): ScoreBreakdown {
  const placement = placedCellCount * cfg.POINTS_PER_CELL_PLACED;
  const perGeneration = cascade.generations.map((cells, g) => cells.length * pointsForCell(g, cfg));
  const clears = perGeneration.reduce((a, b) => a + b, 0);
  const multiplier = cascade.maxGeneration >= 0 ? cascade.maxGeneration + 1 : 0;
  return { placement, perGeneration, clears, total: placement + clears, multiplier };
}

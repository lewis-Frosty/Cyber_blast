import { describe, expect, it } from 'vitest';
import { colourMultiplier, pointsForCell, scoreTurn } from '../src/core/scoring';
import type { CascadeResult } from '../src/core/cascade';

const CFG = { POINTS_PER_CELL_BASE: 10, POINTS_PER_CELL_PLACED: 1 };
const LIME_CFG = { ...CFG, COLOUR_SCORE_MULTIPLIER: [1, 1, 2, 1, 1] };

function cascade(generations: number[][]): CascadeResult {
  const cleared = new Map<number, number>();
  generations.forEach((g, i) => g.forEach((c) => cleared.set(c, i)));
  return { generations, cleared, maxGeneration: generations.length - 1, truncated: false };
}

describe('scoring (§2.5)', () => {
  it('scales per-cell points by generation', () => {
    expect(pointsForCell(0, CFG)).toBe(10);
    expect(pointsForCell(1, CFG)).toBe(20);
    expect(pointsForCell(4, CFG)).toBe(50);
  });

  it('awards only placement points when nothing clears', () => {
    const s = scoreTurn(4, cascade([]), CFG);
    expect(s.placement).toBe(4);
    expect(s.clears).toBe(0);
    expect(s.total).toBe(4);
    expect(s.multiplier).toBe(0);
  });

  it('sums placement and per-generation clears', () => {
    const s = scoreTurn(3, cascade([[0, 1, 2, 3, 4, 5, 6, 7], [8, 9], [10]]), CFG);
    expect(s.perGeneration).toEqual([80, 40, 30]);
    expect(s.total).toBe(153);
    expect(s.multiplier).toBe(3);
  });

  it('doubles lime and leaves every other colour alone', () => {
    const c = cascade([[0, 1, 2, 3, 4, 5, 6, 7]]);
    // All lime: 8 cells x 10 x 2.
    expect(scoreTurn(0, c, LIME_CFG, () => 2).clears).toBe(160);
    // All cyan: unchanged.
    expect(scoreTurn(0, c, LIME_CFG, () => 0).clears).toBe(80);
    // No lookup at all means no multiplier.
    expect(scoreTurn(0, c, LIME_CFG).clears).toBe(80);
  });

  it('applies the multiplier per cell and per generation', () => {
    // gen0 two lime, gen1 one cyan: 2x10x2 + 1x20x1 = 60.
    const c = cascade([[0, 1], [2]]);
    const colour = (i: number) => (i < 2 ? 2 : 0);
    const s = scoreTurn(0, c, LIME_CFG, colour);
    expect(s.perGeneration).toEqual([40, 20]);
    expect(s.clears).toBe(60);
  });

  it('scores stay integral under every multiplier', () => {
    const c = cascade([[0], [1], [2]]);
    for (const colour of [0, 1, 2, 3, 4]) {
      const s = scoreTurn(3, c, LIME_CFG, () => colour);
      expect(Number.isInteger(s.total)).toBe(true);
      for (const g of s.perGeneration) expect(Number.isInteger(g)).toBe(true);
    }
  });

  it('treats a missing or invalid multiplier as 1x', () => {
    const c = cascade([[0]]);
    expect(scoreTurn(0, c, { ...CFG, COLOUR_SCORE_MULTIPLIER: [] }, () => 3).clears).toBe(10);
    expect(colourMultiplier(9, LIME_CFG)).toBe(1);
    expect(colourMultiplier(2, LIME_CFG)).toBe(2);
  });

  it('multiplier is maxGeneration + 1', () => {
    expect(scoreTurn(1, cascade([[0]]), CFG).multiplier).toBe(1);
    expect(scoreTurn(1, cascade([[0], [1], [2], [3], [4]]), CFG).multiplier).toBe(5);
  });
});

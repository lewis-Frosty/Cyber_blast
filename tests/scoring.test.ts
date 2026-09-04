import { describe, expect, it } from 'vitest';
import { pointsForCell, scoreTurn } from '../src/core/scoring';
import type { CascadeResult } from '../src/core/cascade';

const CFG = { POINTS_PER_CELL_BASE: 10, POINTS_PER_CELL_PLACED: 1 };

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

  it('multiplier is maxGeneration + 1', () => {
    expect(scoreTurn(1, cascade([[0]]), CFG).multiplier).toBe(1);
    expect(scoreTurn(1, cascade([[0], [1], [2], [3], [4]]), CFG).multiplier).toBe(5);
  });
});

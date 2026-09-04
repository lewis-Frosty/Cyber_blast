import { describe, expect, it } from 'vitest';
import { Board } from '../src/core/Board';
import { findGeneration0, resolveBoard, resolveClears, type CascadeOptions } from '../src/core/cascade';
import { scoreTurn } from '../src/core/scoring';
import { GAMEPLAY_CONFIG } from '../src/config/gameplay';
import { EMPTY } from '../src/core/types';

/**
 * Cascade resolver tests, spec §6, written against the colour-locked rule:
 * a completed line removes only the placed piece's colour, and the chain then
 * spreads through that one colour.
 */
const opts = (maxDepth = 4): CascadeOptions => ({ maxDepth, neighbourMode: 'orthogonal' });

const idx = (b: Board, r: number, c: number) => b.index(r, c);
const genOf = (result: { cleared: ReadonlyMap<number, number> }, b: Board, r: number, c: number) =>
  result.cleared.get(idx(b, r, c));

describe('cascade resolver (§2.4, colour-locked)', () => {
  // ── Test 6 first: without a visited set the resolver hangs the game. ──
  it('6. does not revisit already-cleared cells (no infinite loop)', () => {
    // Whole board one colour: every cell neighbours a same-colour cell, so an
    // unguarded walk never terminates.
    const b = new Board(8, new Array(64).fill(0));
    const started = Date.now();
    const result = resolveBoard(b, { ...opts(1000), lockedColour: 0 });
    expect(Date.now() - started).toBeLessThan(1000);
    expect(result.cleared.size).toBe(64);

    // No cell appears in more than one generation.
    const seen = new Set<number>();
    for (const gen of result.generations) {
      for (const i of gen) {
        expect(seen.has(i)).toBe(false);
        seen.add(i);
      }
    }

    // And when the walk must actually travel: a ring of one colour.
    const ring = Board.fromRows([
      '00000000',
      '0......0',
      '0......0',
      '0......0',
      '0......0',
      '0......0',
      '0......0',
      '00000000',
    ]);
    const r2 = resolveBoard(ring, { ...opts(1000), lockedColour: 0 });
    const seen2 = new Set<number>();
    for (const gen of r2.generations) {
      for (const i of gen) {
        expect(seen2.has(i)).toBe(false);
        seen2.add(i);
      }
    }
    expect(r2.cleared.size).toBe(28);
  });

  it('1. full row clears only the locked colour, with no cascade', () => {
    const b = Board.fromRows([
      '........',
      '........',
      '........',
      '01234012', // full row; locked colour 0 appears at cols 0 and 5
      '1314131.', // no colour 0 below at all; trailing gap keeps row 4 unfilled
      '........',
      '........',
      '........',
    ]);
    const result = resolveBoard(b, { ...opts(), lockedColour: 0 });
    expect(result.generation0.rows).toEqual([3]);
    expect(result.generation0.cols).toEqual([]);
    expect(result.cleared.size).toBe(2);
    expect(result.maxGeneration).toBe(0);
    expect(genOf(result, b, 3, 0)).toBe(0);
    expect(genOf(result, b, 3, 5)).toBe(0);
    // Every other colour in the completed line is untouched.
    expect(genOf(result, b, 3, 1)).toBeUndefined();
    expect(genOf(result, b, 3, 4)).toBeUndefined();
  });

  it('2. one adjacent same-colour cell cascades (depth 1)', () => {
    const b = Board.fromRows([
      '........',
      '........',
      '........',
      '01234012',
      '0.......', // (4,0)=0 sits under (3,0)=0
      '........',
      '........',
      '........',
    ]);
    const result = resolveBoard(b, { ...opts(), lockedColour: 0 });
    expect(result.maxGeneration).toBe(1);
    expect(result.cleared.size).toBe(3); // (3,0) (3,5) gen 0, (4,0) gen 1
    expect(genOf(result, b, 4, 0)).toBe(1);
    expect(result.generations[1]).toEqual([idx(b, 4, 0)]);
  });

  it('3. multi-generation chain reaches exactly MAX_CASCADE_DEPTH', () => {
    const b = Board.fromRows([
      '........',
      '........',
      '........',
      '01234312', // locked colour 0 only at col 0
      '0.......',
      '0.......',
      '0.......',
      '0.......',
    ]);
    const result = resolveBoard(b, { ...opts(4), lockedColour: 0 });
    expect(result.maxGeneration).toBe(4);
    expect(result.truncated).toBe(false);
    expect(genOf(result, b, 4, 0)).toBe(1);
    expect(genOf(result, b, 5, 0)).toBe(2);
    expect(genOf(result, b, 6, 0)).toBe(3);
    expect(genOf(result, b, 7, 0)).toBe(4);
  });

  it('4. a chain that would exceed MAX_CASCADE_DEPTH is truncated', () => {
    const b = Board.fromRows([
      '01234312',
      '0.......',
      '0.......',
      '0.......',
      '0.......',
      '0.......',
      '0.......',
      '........', // col 0 not itself a full line
    ]);
    const result = resolveBoard(b, { ...opts(4), lockedColour: 0 });
    expect(result.maxGeneration).toBe(4);
    expect(result.truncated).toBe(true);
    expect(result.cleared.size).toBe(5); // gen0 (0,0) + four generations
    expect(genOf(result, b, 4, 0)).toBe(4);
    expect(genOf(result, b, 5, 0)).toBeUndefined();

    // maxDepth 0 means "clear the line, never chain".
    const none = resolveBoard(b, { ...opts(0), lockedColour: 0 });
    expect(none.maxGeneration).toBe(0);
    expect(none.cleared.size).toBe(1);
    expect(none.truncated).toBe(true);
  });

  it('5. simultaneous row + column clear counts the shared cell exactly once', () => {
    // Row 3 and column 2 are both full, and both carry the locked colour 0,
    // including the cell they share at (3,2).
    const b = Board.fromRows([
      '..0.....',
      '..1.....',
      '..0.....',
      '01034012',
      '..0.....',
      '..1.....',
      '..0.....',
      '..1.....',
    ]);
    const g0 = findGeneration0(b, { lockedColour: 0 });
    expect(g0.rows).toEqual([3]);
    expect(g0.cols).toEqual([2]);

    const result = resolveClears(b, g0.cells, opts());
    // Row 3 gives (3,0) (3,2) (3,5); column 2 gives (0,2) (2,2) (3,2) (4,2) (6,2).
    // (3,2) is in both and must be counted once → 7 distinct cells.
    expect(g0.cells.size).toBe(7);
    expect(result.generations[0]).toHaveLength(7);
    expect(genOf(result, b, 3, 2)).toBe(0);
    // Scoring must count it once too: 7 × 10.
    expect(scoreTurn(0, result, GAMEPLAY_CONFIG).clears).toBe(70);
  });

  it('7. does not propagate diagonally in orthogonal mode', () => {
    const b = Board.fromRows([
      '........',
      '........',
      '........',
      '01234312',
      '.0......', // (4,1)=0 touches (3,0)=0 only diagonally
      '........',
      '........',
      '........',
    ]);
    const ortho = resolveBoard(b, { ...opts(), lockedColour: 0 });
    expect(ortho.maxGeneration).toBe(0);
    expect(genOf(ortho, b, 4, 1)).toBeUndefined();

    const diag = resolveBoard(b, { maxDepth: 4, neighbourMode: 'diagonal', lockedColour: 0 });
    expect(diag.maxGeneration).toBe(1);
    expect(genOf(diag, b, 4, 1)).toBe(1);
  });

  it('8. board-edge cells do not read out of bounds', () => {
    const b = Board.fromRows([
      '00000000',
      '0.....00',
      '0......0',
      '0......0',
      '0......0',
      '0......0',
      '00.....0',
      '00000000',
    ]);
    expect(() => resolveBoard(b, { ...opts(), lockedColour: 0 })).not.toThrow();
    const result = resolveBoard(b, { ...opts(), lockedColour: 0 });
    expect(result.cleared.size).toBe(30);
    expect(genOf(result, b, 1, 6)).toBe(1);
    expect(genOf(result, b, 6, 1)).toBe(1);
  });

  it('9. full-board clear resolves without error', () => {
    const b = new Board(8, new Array(64).fill(3));
    const result = resolveBoard(b, { ...opts(1000), lockedColour: 3 });
    expect(result.generation0.rows).toHaveLength(8);
    expect(result.generation0.cols).toHaveLength(8);
    expect(result.cleared.size).toBe(64);
    expect(result.truncated).toBe(false);
    b.clearCells(result.cleared.keys());
    expect(b.filledCount()).toBe(0);
  });

  it('10. scoring matches expected value for a known board and placement', () => {
    // Placing a colour-2 tile at (3,7) completes row 3.
    // Row 3 then reads 2 1 2 3 4 3 1 2 → locked colour 2 at cols 0, 2 and 7.
    // Below: (4,0)=2 → gen 1, (5,0)=2 → gen 2. (4,3)=2 touches nothing locked.
    const b = Board.fromRows([
      '........',
      '........',
      '........',
      '2123431.',
      '2..2....',
      '2.......',
      '........',
      '........',
    ]);
    const placed = b.place({ name: '1x1', cells: [[0, 0]], width: 1, height: 1 }, 2, 3, 7);
    const result = resolveBoard(b, { ...opts(), lockedColour: 2 });

    expect(result.generations.map((g) => g.length)).toEqual([3, 1, 1]);
    expect(result.maxGeneration).toBe(2);

    const score = scoreTurn(placed.length, result, GAMEPLAY_CONFIG);
    // placement 1 · gen0 3×10=30 · gen1 1×20=20 · gen2 1×30=30
    expect(score.placement).toBe(1);
    expect(score.perGeneration).toEqual([30, 20, 30]);
    expect(score.clears).toBe(80);
    expect(score.total).toBe(81);
    expect(score.multiplier).toBe(3);
  });

  // ── Colour-locking itself (supplementary to the §6 list) ──
  it('leaves every other colour in the completed line standing', () => {
    const b = Board.fromRows([
      '........',
      '........',
      '........',
      '01234012',
      '........',
      '........',
      '........',
      '........',
    ]);
    const result = resolveBoard(b, { ...opts(), lockedColour: 3 });
    expect(result.cleared.size).toBe(1);
    b.clearCells(result.cleared.keys());
    expect(b.get(3, 3)).toBe(EMPTY);
    expect(b.filledCount()).toBe(7);
    expect(b.toRows()[3]).toBe('012.4012');
  });

  it('clears nothing when the locked colour is absent from the full line', () => {
    const b = Board.fromRows([
      '........',
      '........',
      '........',
      '01234012',
      '........',
      '........',
      '........',
      '........',
    ]);
    // Colour 3 is present; colour 4 is at index 4. Lock a colour that is not
    // in the row at all by using a full row without it.
    const noFour = Board.fromRows([
      '........',
      '........',
      '........',
      '01230123',
      '........',
      '........',
      '........',
      '........',
    ]);
    const result = resolveBoard(noFour, { ...opts(), lockedColour: 4 });
    expect(result.generations).toEqual([]);
    expect(result.maxGeneration).toBe(-1);
    expect(result.cleared.size).toBe(0);
    expect(resolveBoard(b, { ...opts(), lockedColour: 4 }).cleared.size).toBe(1);
  });

  it('requires a locked colour rather than silently clearing everything', () => {
    const b = new Board(8, new Array(64).fill(1));
    // @ts-expect-error — the guard exists for callers that skip type checking.
    expect(() => findGeneration0(b, {})).toThrow(TypeError);
  });
});

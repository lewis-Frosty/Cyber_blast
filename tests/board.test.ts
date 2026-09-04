import { describe, expect, it } from 'vitest';
import { Board } from '../src/core/Board';
import { shapeByName, SHAPES } from '../src/core/Piece';
import { EMPTY } from '../src/core/types';

describe('Board', () => {
  it('starts empty and round-trips through fromRows/toRows', () => {
    const b = new Board(8);
    expect(b.filledCount()).toBe(0);
    const rows = ['0.......', '.1......', '..2.....', '...3....', '....4...', '........', '........', '.......0'];
    expect(Board.fromRows(rows).toRows()).toEqual(rows);
  });

  it('validates placement against bounds and occupancy', () => {
    const b = new Board(8);
    const bar = shapeByName('1x5');
    expect(b.canPlace(bar, 0, 0)).toBe(true);
    expect(b.canPlace(bar, 0, 3)).toBe(true);
    expect(b.canPlace(bar, 0, 4)).toBe(false); // would extend to col 8
    expect(b.canPlace(bar, -1, 0)).toBe(false);
    expect(b.canPlace(bar, 8, 0)).toBe(false);
    b.set(0, 2, 1);
    expect(b.canPlace(bar, 0, 0)).toBe(false);
    expect(b.canPlace(bar, 1, 0)).toBe(true);
  });

  it('place fills exactly the shape cells and throws on illegal placement', () => {
    const b = new Board(8);
    const t = shapeByName('T-up'); // .#. / ###
    const placed = b.place(t, 3, 2, 2);
    expect(placed.sort((a, z) => a - z)).toEqual([b.index(2, 3), b.index(3, 2), b.index(3, 3), b.index(3, 4)].sort((a, z) => a - z));
    expect(b.get(2, 3)).toBe(3);
    expect(b.get(2, 2)).toBe(EMPTY);
    expect(b.filledCount()).toBe(4);
    expect(() => b.place(t, 3, 2, 2)).toThrow();
  });

  it('detects full rows and columns', () => {
    const b = Board.fromRows(['01234012', '1.......', '1.......', '1.......', '1.......', '1.......', '1.......', '1.......']);
    expect(b.fullRows()).toEqual([0]);
    expect(b.fullCols()).toEqual([0]);
  });

  it('canPlaceAnywhere reports false only when no anchor exists', () => {
    const b = new Board(8, new Array(64).fill(0));
    expect(b.canPlaceAnywhere(shapeByName('1x1'))).toBe(false);
    b.set(4, 4, EMPTY);
    expect(b.canPlaceAnywhere(shapeByName('1x1'))).toBe(true);
    expect(b.canPlaceAnywhere(shapeByName('1x2'))).toBe(false);
  });

  it('clearCells empties only the given cells', () => {
    const b = new Board(8, new Array(64).fill(2));
    b.clearCells([0, 63]);
    expect(b.get(0, 0)).toBe(EMPTY);
    expect(b.get(7, 7)).toBe(EMPTY);
    expect(b.filledCount()).toBe(62);
  });

  it('colourCounts counts filled cells per colour', () => {
    const b = Board.fromRows(['0011....', '2.......', '........', '........', '........', '........', '........', '........']);
    expect(b.colourCounts(5)).toEqual([2, 2, 1, 0, 0]);
  });

  it('shape set is normalised (min row/col 0) with correct dimensions', () => {
    for (const s of SHAPES) {
      expect(Math.min(...s.cells.map(([r]) => r))).toBe(0);
      expect(Math.min(...s.cells.map(([, c]) => c))).toBe(0);
      expect(s.width).toBe(Math.max(...s.cells.map(([, c]) => c)) + 1);
      expect(s.height).toBe(Math.max(...s.cells.map(([r]) => r)) + 1);
    }
    expect(SHAPES.length).toBe(23);
    expect(shapeByName('3x3').cells).toHaveLength(9);
    expect(shapeByName('S-h').cells).toHaveLength(4);
  });
});

import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core/gameState';
import { OBSTACLE_PIECE, shapeByName } from '../src/core/Piece';
import { GAMEPLAY_CONFIG } from '../src/config/gameplay';
import { BLOCKED, EMPTY } from '../src/core/types';
import { Board } from '../src/core/Board';
import { createRng } from '../src/core/rng';
import { pickColour } from '../src/core/Piece';

describe('GameState turn flow', () => {
  it('starts with a full tray and an empty board', () => {
    const g = new GameState({ seed: 1 });
    expect(g.tray.filter(Boolean)).toHaveLength(3);
    expect(g.board.filledCount()).toBe(0);
    expect(g.gameOver).toBe(false);
    expect(g.score).toBe(0);
  });

  it('is deterministic for a given seed', () => {
    const a = new GameState({ seed: 42 });
    const b = new GameState({ seed: 42 });
    expect(a.tray).toEqual(b.tray);
  });

  it('rejects illegal placements and returns null', () => {
    const g = new GameState({ seed: 1 });
    g.setTrayPiece(0, { shape: shapeByName('1x5'), color: 0 });
    expect(g.placePiece(0, 0, 5)).toBeNull();
    expect(g.placePiece(5, 0, 0)).toBeNull();
    expect(g.board.filledCount()).toBe(0);
  });

  it('places, scores, empties the slot, and refills when the tray is exhausted', () => {
    const g = new GameState({ seed: 1 });
    g.setTrayPiece(0, { shape: shapeByName('1x1'), color: 0 });
    g.setTrayPiece(1, { shape: shapeByName('1x1'), color: 1 });
    g.setTrayPiece(2, { shape: shapeByName('1x1'), color: 2 });

    const r1 = g.placePiece(0, 0, 0);
    expect(r1).not.toBeNull();
    expect(r1!.score.total).toBe(1);
    expect(r1!.trayRefilled).toBe(false);
    expect(g.tray[0]).toBeNull();
    expect(g.score).toBe(1);

    g.placePiece(1, 0, 1);
    const r3 = g.placePiece(2, 0, 2);
    expect(r3!.trayRefilled).toBe(true);
    expect(g.tray.filter(Boolean)).toHaveLength(3);
    expect(g.stats.placements).toBe(3);
  });

  it('clears only the completing colour from the line, leaving other colours standing', () => {
    const g = new GameState({ seed: 1 });
    // Row 7 = colours 0,1,2,3,4,0,1 with the last cell open. A colour-3 cell
    // hangs above (7,3) so the locked cascade has somewhere to spread.
    for (let c = 0; c < 7; c++) g.board.set(7, c, c % 5);
    g.board.set(6, 3, 3);
    g.setTrayPiece(0, { shape: shapeByName('1x1'), color: 3 });

    const r = g.placePiece(0, 7, 7);
    expect(r).not.toBeNull();
    expect(r!.generation0.rows).toEqual([7]);
    // Generation 0 takes only the colour-3 cells from the full row: (7,3) and (7,7).
    expect(r!.generation0.cells.size).toBe(2);
    // Then it spreads through colour 3 only: (6,3).
    expect(r!.cascade.maxGeneration).toBe(1);
    expect(r!.cascade.cleared.size).toBe(3);
    // 1 placed + 2×10 (gen 0) + 1×20 (gen 1) = 41
    expect(r!.score.total).toBe(41);

    // Every other colour in that row survived — this is the whole point.
    expect(g.board.get(7, 0)).toBe(0);
    expect(g.board.get(7, 1)).toBe(1);
    expect(g.board.get(7, 2)).toBe(2);
    expect(g.board.get(7, 4)).toBe(4);
    expect(g.board.filledCount()).toBe(6);
    expect(g.board.get(7, 3)).toBe(EMPTY);
    expect(g.board.get(7, 7)).toBe(EMPTY);
    expect(g.board.get(6, 3)).toBe(EMPTY);
  });

  /** Board: a 3x3 colour-2 blob, and a row needing only its last cell. */
  function blobAndLine(depth: number): GameState {
    const g = new GameState({ seed: 1, config: { ...GAMEPLAY_CONFIG, MAX_CASCADE_DEPTH: depth } });
    for (let r = 2; r <= 4; r++) for (let c = 2; c <= 4; c++) g.board.set(r, c, 2);
    for (let c = 0; c < 7; c++) g.board.set(5, c, c === 3 ? 2 : 1);
    g.setTrayPiece(0, { shape: shapeByName('1x1'), color: 2 });
    return g;
  }

  it('detonates a whole cluster when the line is completed in that colour', () => {
    // Depth is pinned rather than inherited: this test is about the mechanic,
    // and it should not fail every time MAX_CASCADE_DEPTH is re-tuned.
    const g = blobAndLine(10);
    const r = g.placePiece(0, 5, 7);
    expect(r).not.toBeNull();
    // gen0 = the two colour-2 cells in row 5; the chain then eats the 3x3 blob.
    expect(r!.cascade.cleared.size).toBe(11);
    expect(r!.cascade.maxGeneration).toBeGreaterThanOrEqual(2);
    // The colour-1 residue in row 5 is untouched.
    expect(g.board.get(5, 0)).toBe(1);
    expect(g.board.filledCount()).toBe(6);
  });

  it('leaves the far side of a cluster standing when the depth cap bites', () => {
    // The same board at the shipped depth of 3: the chain reaches the near part
    // of the blob and stops, so a big cluster is only fully cashed in when it
    // is reachable within the cap. This is the tuning knob doing its job.
    const g = blobAndLine(3);
    const r = g.placePiece(0, 5, 7);
    expect(r).not.toBeNull();
    expect(r!.cascade.cleared.size).toBe(9);
    expect(r!.cascade.maxGeneration).toBe(3);
    expect(r!.cascade.truncated).toBe(true);
    // Two colour-2 cells survive out at the far edge of the blob.
    expect(g.board.colourCounts(GAMEPLAY_CONFIG.PALETTE_SIZE)[2]).toBe(2);
  });

  it('detonates an entire connected blob with no depth truncation', () => {
    const g = new GameState({ seed: 1 });
    // A snake of colour 4 far longer than the old depth cap of 3, hanging off a
    // row that needs one more cell.
    for (let c = 0; c < 7; c++) g.board.set(7, c, c === 0 ? 4 : 1);
    // Tail up column 0, leaving row 0 empty so the column is NOT itself a full
    // line — otherwise the whole tail would be generation 0 and prove nothing.
    for (let r = 1; r <= 6; r++) g.board.set(r, 0, 4);
    g.setTrayPiece(0, { shape: shapeByName('1x1'), color: 4 });

    const r = g.placePiece(0, 7, 7);
    expect(r).not.toBeNull();
    // gen0 = (7,0) and the placed (7,7); the chain then walks all six tail cells.
    expect(r!.cascade.cleared.size).toBe(8);
    expect(r!.cascade.maxGeneration).toBe(6);
    expect(r!.cascade.truncated).toBe(false);
    // Nothing of that colour is left standing anywhere.
    expect(g.board.colourCounts(GAMEPLAY_CONFIG.PALETTE_SIZE)[4]).toBe(0);
  });

  it('pays double for lime and normal rate for other colours', () => {
    const lime = new GameState({ seed: 1 });
    for (let c = 0; c < 7; c++) lime.board.set(7, c, 2);
    lime.setTrayPiece(0, { shape: shapeByName('1x1'), color: 2 });
    const limeTurn = lime.placePiece(0, 7, 7);
    // 8 lime cells at generation 0: 8 x 10 x 2, plus 1 for the placement.
    expect(limeTurn!.score.clears).toBe(160);
    expect(limeTurn!.score.total).toBe(161);

    const cyan = new GameState({ seed: 1 });
    for (let c = 0; c < 7; c++) cyan.board.set(7, c, 0);
    cyan.setTrayPiece(0, { shape: shapeByName('1x1'), color: 0 });
    const cyanTurn = cyan.placePiece(0, 7, 7);
    expect(cyanTurn!.score.clears).toBe(80);
  });

  it('detects game over when no remaining tray piece fits', () => {
    const g = new GameState({ seed: 1 });
    // Fill the board, then punch two isolated holes into every row and column
    // so no line is full and no two holes are orthogonally adjacent.
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) g.board.set(r, c, (r * 3 + c) % 5);
    for (let r = 0; r < 8; r++) {
      g.board.set(r, r, EMPTY);
      g.board.set(r, (r + 3) % 8, EMPTY);
    }
    expect(g.board.fullRows()).toEqual([]);
    expect(g.board.fullCols()).toEqual([]);
    g.setTrayPiece(0, { shape: shapeByName('1x1'), color: 0 });
    g.setTrayPiece(1, { shape: shapeByName('3x3'), color: 0 });
    g.setTrayPiece(2, { shape: shapeByName('2x2'), color: 0 });
    expect(g.checkGameOver()).toBe(false);

    const r = g.placePiece(0, 0, 0);
    expect(r).not.toBeNull();
    // Row 0 still has (0,3) empty and column 0 has (5,0) empty — nothing clears.
    expect(r!.cascade.maxGeneration).toBe(-1);
    expect(r!.gameOver).toBe(true);
    expect(g.gameOver).toBe(true);
    // Further placements are refused.
    expect(g.placePiece(1, 0, 0)).toBeNull();
  });

  it('checks game over after a tray refill too', () => {
    const g = new GameState({
      seed: 7,
      shapes: [shapeByName('3x3')],
      config: { ...GAMEPLAY_CONFIG },
    });
    // Board with exactly one 3×3 hole; every refill spawns only 3×3s.
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) g.board.set(r, c, (r + 2 * c) % 5);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) g.board.set(r, c, EMPTY);
    g.setTrayPiece(0, { shape: shapeByName('3x3'), color: 4 });
    g.setTrayPiece(1, null);
    g.setTrayPiece(2, null);
    // Ensure nothing clears: rows/cols 0-2 have holes... after placing, rows 0-2
    // become full → they clear, so the hole reopens. Use a hole that doesn't complete lines:
    g.board.set(7, 7, EMPTY);
    const r = g.placePiece(0, 0, 0);
    expect(r).not.toBeNull();
    expect(r!.trayRefilled).toBe(true);
    // Rows 0-2 are not full because (7,7)... rows 0-2 don't include (7,7). Let the
    // result decide: if lines cleared there is space; otherwise no 3×3 fits → game over.
    const anySpace = g.board.canPlaceAnywhere(shapeByName('3x3'));
    expect(r!.gameOver).toBe(!anySpace);
  });
});

describe('colour affinity (§3)', () => {
  it('affinity 0 is uniform; affinity 1 always picks the most common board colour', () => {
    const b = Board.fromRows(['33333...', '........', '........', '........', '........', '........', '........', '........']);
    const rng = createRng(3);
    for (let i = 0; i < 50; i++) {
      expect(pickColour(b, rng, { paletteSize: 5, affinity: 1 })).toBe(3);
    }
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(pickColour(b, rng, { paletteSize: 5, affinity: 0 }));
    expect(seen.size).toBe(5);
  });

  it('honours integer spawn weights, holding violet below the rest', () => {
    const b = new Board(8);
    const rng = createRng(4242);
    const counts = new Array<number>(5).fill(0);
    const draws = 60000;
    for (let i = 0; i < draws; i++) {
      const c = pickColour(b, rng, {
        paletteSize: 5,
        affinity: 0,
        weights: GAMEPLAY_CONFIG.COLOUR_SPAWN_WEIGHTS,
      });
      counts[c] = (counts[c] ?? 0) + 1;
    }
    // Weights [100,100,100,100,90] → violet ≈ 90/490 = 18.4%, others ≈ 20.4%.
    const share = (i: number) => (counts[i] ?? 0) / draws;
    expect(share(4)).toBeGreaterThan(0.170);
    expect(share(4)).toBeLessThan(0.198);
    for (const i of [0, 1, 2, 3]) {
      expect(share(i)).toBeGreaterThan(0.190);
      expect(share(i)).toBeLessThan(0.218);
    }
    // Violet must actually be the rarest.
    expect(counts[4]).toBeLessThan(Math.min(...[0, 1, 2, 3].map((i) => counts[i] ?? 0)));
  });

  it('equal weights and no weights both give a uniform draw', () => {
    const b = new Board(8);
    for (const weights of [undefined, [1, 1, 1, 1, 1]]) {
      const rng = createRng(99);
      const counts = new Array<number>(5).fill(0);
      for (let i = 0; i < 30000; i++) {
        const c = pickColour(b, rng, { paletteSize: 5, affinity: 0, weights });
        counts[c] = (counts[c] ?? 0) + 1;
      }
      for (const n of counts) expect(n / 30000).toBeGreaterThan(0.185);
    }
  });

  it('empty board falls back to uniform even at affinity 1', () => {
    const b = new Board(8);
    const rng = createRng(9);
    const seen = new Set<number>();
    for (let i = 0; i < 500; i++) seen.add(pickColour(b, rng, { paletteSize: 5, affinity: 1 }));
    expect(seen.size).toBe(5);
  });
});

describe('obstacle scheduling', () => {
  const cfg = (over: Partial<typeof GAMEPLAY_CONFIG>) => ({ ...GAMEPLAY_CONFIG, ...over });

  /** Place any legal piece, preferring tray slot `want` when it fits. */
  function placeAny(g: GameState, want = 0): boolean {
    for (const t of [want, 0, 1, 2]) {
      const piece = g.tray[t];
      if (!piece) continue;
      for (let r = 0; r < 8; r++) {
        for (let c = 0; c < 8; c++) {
          if (g.board.canPlace(piece.shape, r, c) && g.placePiece(t, r, c)) return true;
        }
      }
    }
    return false;
  }

  it('grants a grey cube every N placements and hands it over at the next refill', () => {
    const g = new GameState({
      seed: 5,
      config: cfg({ OBSTACLE_TRIGGER: 'placements', OBSTACLE_EVERY_PLACEMENTS: 4 }),
    });
    for (let i = 0; i < 3; i++) placeAny(g);
    expect(g.stats.obstaclesGranted).toBe(0);

    // The 4th placement earns one; it arrives with the tray refill that follows.
    for (let i = 0; i < 9; i++) placeAny(g);
    expect(g.stats.obstaclesGranted).toBeGreaterThanOrEqual(1);
    expect(g.stats.obstaclesGranted).toBeLessThanOrEqual(3);
  });

  it('grants on score instead when the trigger is points', () => {
    const g = new GameState({
      seed: 5,
      config: cfg({ OBSTACLE_TRIGGER: 'points', OBSTACLE_EVERY_POINTS: 50 }),
    });
    // A full cyan row scores 8 x 10 + 1 = 81, crossing the 50-point threshold.
    for (let c = 0; c < 7; c++) g.board.set(7, c, 0);
    g.setTrayPiece(0, { shape: shapeByName('1x1'), color: 0 });
    expect(g.placePiece(0, 7, 7)!.score.total).toBe(81);

    // Owed now, handed over at the refill that follows the next two placements.
    expect(g.stats.obstaclesGranted).toBe(0);
    placeAny(g);
    placeAny(g);
    expect(g.stats.obstaclesGranted).toBe(1);
    expect(g.tray.some((p) => p !== null && p.color === BLOCKED)).toBe(true);
  });

  it('does not grant on placements when the trigger is points', () => {
    const g = new GameState({
      seed: 5,
      config: cfg({ OBSTACLE_TRIGGER: 'points', OBSTACLE_EVERY_POINTS: 100000 }),
    });
    for (let i = 0; i < 24; i++) if (!placeAny(g)) break;
    expect(g.stats.obstaclesGranted).toBe(0);
  });

  it('grants nothing when obstacles are disabled', () => {
    const g = new GameState({ seed: 5, config: cfg({ OBSTACLES_ENABLED: false }) });
    for (let i = 0; i < 20; i++) if (!placeAny(g)) break;
    expect(g.stats.obstaclesGranted).toBe(0);
    expect(g.board.blockedCount()).toBe(0);
  });

  it('placing a grey cube completes a line but clears nothing', () => {
    const g = new GameState({ seed: 5 });
    // Row 7 full of colour 0 except the last cell.
    for (let c = 0; c < 7; c++) g.board.set(7, c, 0);
    g.setTrayPiece(0, OBSTACLE_PIECE);

    const r = g.placePiece(0, 7, 7);
    expect(r).not.toBeNull();
    // The row IS full — but grey is not a colour, so nothing detonates.
    expect(r!.generation0.rows).toEqual([7]);
    expect(r!.cascade.cleared.size).toBe(0);
    expect(r!.score.clears).toBe(0);
    // Every cell in that row survives, wall included.
    expect(g.board.toRows()[7]).toBe('0000000#');
    expect(g.board.blockedCount()).toBe(1);
  });

  it('an obstacle severs a chain that would otherwise run through it', () => {
    const g = new GameState({ seed: 5 });
    for (let c = 0; c < 7; c++) g.board.set(7, c, c === 0 ? 3 : 1);
    g.board.set(6, 0, 3);
    g.board.set(5, 0, BLOCKED); // wall
    g.board.set(4, 0, 3); // stranded on the far side
    g.setTrayPiece(0, { shape: shapeByName('1x1'), color: 3 });

    const r = g.placePiece(0, 7, 7);
    expect(r).not.toBeNull();
    // gen0 is (7,0) plus the placed (7,7); (6,0) follows at gen1. The wall at
    // (5,0) stops the chain, so (4,0) survives on the far side of it.
    expect(r!.cascade.cleared.size).toBe(3);
    expect(r!.cascade.maxGeneration).toBe(1);
    expect(g.board.get(4, 0)).toBe(3);
    expect(g.board.get(5, 0)).toBe(BLOCKED);
  });
});

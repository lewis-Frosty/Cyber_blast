import { describe, expect, it } from 'vitest';
import { Board } from '../src/core/Board';
import {
  addCharge,
  colourHasPowerUp,
  connectedRegion,
  powerUpForColourOrNull,
  addChargeAll,
  applyPowerUp,
  canApply,
  createMeters,
  isReady,
  POWERUPS,
  powerUpForColour,
  spendCharge,
} from '../src/core/powerups';
import { GameState } from '../src/core/gameState';
import { shapeByName } from '../src/core/Piece';
import { GAMEPLAY_CONFIG } from '../src/config/gameplay';
import { EMPTY } from '../src/core/types';

describe('power-up abilities', () => {
  it('covers every colour except lime, which deliberately has none', () => {
    expect(POWERUPS).toHaveLength(4);
    expect(POWERUPS.map((p) => p.colour).sort()).toEqual([0, 1, 3, 4]);
    for (const c of [0, 1, 3, 4]) expect(powerUpForColour(c).colour).toBe(c);

    // Lime charges nothing. This must be handled, not thrown past.
    expect(colourHasPowerUp(2)).toBe(false);
    expect(powerUpForColourOrNull(2)).toBeNull();
    expect(() => powerUpForColour(2)).toThrow();
  });

  it('Flush clears the target row and column once each, every colour', () => {
    const b = new Board(8, new Array(64).fill(1));
    const effect = applyPowerUp(b, 'flush', 3, 4);
    // 8 + 8 - 1 shared cell.
    expect(effect.cleared).toHaveLength(15);
    expect(new Set(effect.cleared).size).toBe(15);
    expect(b.filledCount()).toBe(64 - 15);
    expect(b.get(3, 4)).toBe(EMPTY);
    expect(b.get(3, 0)).toBe(EMPTY);
    expect(b.get(0, 4)).toBe(EMPTY);
    expect(b.get(0, 0)).toBe(1);
  });

  it('Nova clears a 3x3 and clips at the board edge without reading out of bounds', () => {
    const b = new Board(8, new Array(64).fill(2));
    expect(applyPowerUp(b, 'nova', 4, 4).cleared).toHaveLength(9);

    const edge = new Board(8, new Array(64).fill(2));
    const corner = applyPowerUp(edge, 'nova', 0, 0);
    expect(corner.cleared).toHaveLength(4);
    expect(edge.get(0, 0)).toBe(EMPTY);
    expect(edge.get(1, 1)).toBe(EMPTY);
    expect(edge.get(2, 2)).toBe(2);
  });

  it('Pluck removes the whole connected blob of that colour, and nothing else', () => {
    // An L-shaped colour-3 blob, a colour-3 tile that only touches it
    // diagonally, and a colour-1 neighbour that must survive.
    const b = Board.fromRows([
      '33......',
      '31......',
      '3.3.....',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    expect(canApply(b, 'pluck', 0, 5)).toBe(false); // empty cell
    expect(canApply(b, 'pluck', 0, 0)).toBe(true);

    const effect = applyPowerUp(b, 'pluck', 0, 0);
    expect(effect.cleared).toHaveLength(4); // (0,0) (0,1) (1,0) (2,0)
    expect(b.get(1, 1)).toBe(1); // different colour, untouched
    expect(b.get(2, 2)).toBe(3); // same colour but only diagonally connected
    expect(b.filledCount()).toBe(2);
  });

  it('Pluck on a lone tile still takes just that tile', () => {
    const b = Board.fromRows(['3.......', '........', '........', '........', '........', '........', '........', '........']);
    expect(applyPowerUp(b, 'pluck', 0, 0).cleared).toEqual([b.index(0, 0)]);
    expect(b.filledCount()).toBe(0);
  });

  it('a full lime meter never becomes usable', () => {
    const g = new GameState({ seed: 3 });
    addCharge(g.meters, 2, g.meters.cost * 2);
    expect(g.meters.charge[2]).toBe(g.meters.cost);
    expect(g.readyColours()).not.toContain(2);
    expect(g.usePowerUp(2, 0, 0)).toBeNull();
  });

  it('clearing lime does not charge any other colour', () => {
    const g = new GameState({ seed: 3 });
    // Row 7 all lime but one cell; completing it clears 8 lime tiles.
    for (let c = 0; c < 7; c++) g.board.set(7, c, 2);
    g.setTrayPiece(0, { shape: shapeByName('1x1'), color: 2 });
    const before = [...g.meters.charge];
    const r = g.placePiece(0, 7, 7);
    expect(r!.cascade.cleared.size).toBe(8);
    expect(g.meters.charge).toEqual(before);
    expect(r!.chargedColours).toEqual([]);
  });

  it('power-up clears never cascade — the tools stay predictable', () => {
    // A big colour-1 blob touching the flushed row would cascade under the
    // placement rules; a power-up must take only what it names.
    const b = new Board(8, new Array(64).fill(1));
    const effect = applyPowerUp(b, 'flush', 0, 0);
    expect(effect.cleared).toHaveLength(15);
    expect(b.filledCount()).toBe(49);
  });
});

describe('connected regions', () => {
  it('walks orthogonally only and stops at other colours and the board edge', () => {
    const b = Board.fromRows([
      '22.2....',
      '2.......',
      '22......',
      '........',
      '........',
      '........',
      '........',
      '........',
    ]);
    expect(connectedRegion(b, 0, 0)).toHaveLength(5);
    expect(connectedRegion(b, 0, 3)).toHaveLength(1);
    expect(connectedRegion(b, 5, 5)).toEqual([]);
  });
});

describe('charge meters', () => {
  it('fills to the cost, caps at one stored charge, and spends cleanly', () => {
    const m = createMeters(5, 10);
    expect(isReady(m, 2)).toBe(false);
    addCharge(m, 2, 4);
    expect(isReady(m, 2)).toBe(false);
    addCharge(m, 2, 40);
    expect(m.charge[2]).toBe(10);
    expect(isReady(m, 2)).toBe(true);
    expect(spendCharge(m, 2)).toBe(true);
    expect(m.charge[2]).toBe(0);
    expect(spendCharge(m, 2)).toBe(false);
  });

  it('milestone top-ups touch every colour', () => {
    const m = createMeters(5, 10);
    addChargeAll(m, 3);
    expect(m.charge).toEqual([3, 3, 3, 3, 3]);
  });
});

describe('power-ups in the turn flow', () => {
  it('charges the colour you actually cleared, then fires it', () => {
    const config = { ...GAMEPLAY_CONFIG, POWERUP_CHARGE_COST: 3 };
    const g = new GameState({ seed: 5, config });
    // Row 7 needs one cell; four colour-4 cells in it will clear (Pluck's colour).
    for (let c = 0; c < 7; c++) g.board.set(7, c, c < 4 ? 4 : 1);
    g.setTrayPiece(0, { shape: shapeByName('1x1'), color: 4 });

    const r = g.placePiece(0, 7, 7);
    expect(r).not.toBeNull();
    expect(r!.cascade.cleared.size).toBe(5);
    expect(r!.chargedColours).toContain(4);
    expect(g.readyColours()).toContain(4);

    g.board.set(0, 0, 2);
    const used = g.usePowerUp(4, 0, 0);
    expect(used).not.toBeNull();
    expect(used!.effect.id).toBe('pluck');
    expect(g.board.get(0, 0)).toBe(EMPTY);
    expect(g.readyColours()).not.toContain(4);
    expect(g.stats.powerUpsUsed).toBe(1);
  });

  it('refuses an uncharged power-up and one aimed at an illegal cell', () => {
    const g = new GameState({ seed: 5 });
    expect(g.usePowerUp(0, 0, 0)).toBeNull();
    addCharge(g.meters, 4, g.meters.cost); // charge Pluck
    expect(g.usePowerUp(4, 0, 0)).toBeNull(); // empty cell — nothing to pluck
    expect(g.readyColours()).toContain(4); // charge not consumed by a refusal
  });

  it('a ready power-up keeps a stuck board from being game over', () => {
    const g = new GameState({ seed: 5 });
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) g.board.set(r, c, (r * 3 + c) % 5);
    for (let r = 0; r < 8; r++) { g.board.set(r, r, EMPTY); g.board.set(r, (r + 3) % 8, EMPTY); }
    g.setTrayPiece(0, { shape: shapeByName('3x3'), color: 0 });
    g.setTrayPiece(1, null);
    g.setTrayPiece(2, null);
    expect(g.checkGameOver()).toBe(true);

    addCharge(g.meters, 0, g.meters.cost); // Flush can open the board back up
    expect(g.checkGameOver()).toBe(false);
  });

  it('score milestones top every meter up', () => {
    const config = { ...GAMEPLAY_CONFIG, POWERUP_SCORE_MILESTONE: 50, POWERUP_MILESTONE_BONUS: 5 };
    const g = new GameState({ seed: 5, config });
    for (let c = 0; c < 7; c++) g.board.set(7, c, 0);
    g.setTrayPiece(0, { shape: shapeByName('1x1'), color: 0 });
    const r = g.placePiece(0, 7, 7);
    expect(r!.score.total).toBeGreaterThanOrEqual(50);
    expect(g.stats.milestonesHit).toBeGreaterThanOrEqual(1);
    // Every colour got the milestone bonus, not just the one that cleared.
    expect(g.meters.charge[3]).toBeGreaterThanOrEqual(5);
  });

  it('Reroll swaps the tray without touching the board', () => {
    const config = { ...GAMEPLAY_CONFIG, POWERUP_CHARGE_COST: 1 };
    const g = new GameState({ seed: 11, config });
    g.board.set(4, 4, 1);
    addCharge(g.meters, 3, 1); // colour 3 = Reroll
    const before = g.tray.map((p) => p?.shape.name);
    const used = g.usePowerUp(3);
    expect(used).not.toBeNull();
    expect(used!.trayRefilled).toBe(true);
    expect(used!.effect.cleared).toHaveLength(0);
    expect(g.board.get(4, 4)).toBe(1);
    expect(g.tray.filter(Boolean)).toHaveLength(3);
    expect(g.tray.map((p) => p?.shape.name)).not.toEqual(before);
  });
});

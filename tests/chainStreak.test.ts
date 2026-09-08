import { describe, expect, it } from 'vitest';
import { createStats, recordPlacement } from '../src/core/stats';
import { GameState } from '../src/core/gameState';
import { createRng } from '../src/core/rng';
import { replay, type GameAction } from '../src/core/replay';

/**
 * "Chains in a row": consecutive PLACEMENTS that each completed a chain.
 * A placement clearing nothing breaks the run; a power-up does not, because
 * the achievement is about chaining placements, not about abstaining from
 * tools.
 */
describe('chain streak', () => {
  const clear = (s: ReturnType<typeof createStats>) => recordPlacement(s, 0, 4, 40);
  const dud = (s: ReturnType<typeof createStats>) => recordPlacement(s, -1, 0, 3);

  it('counts consecutive clearing placements', () => {
    const s = createStats();
    clear(s); clear(s); clear(s);
    expect(s.clearStreak).toBe(3);
    expect(s.bestClearStreak).toBe(3);
  });

  it('resets on a placement that clears nothing', () => {
    const s = createStats();
    clear(s); clear(s); clear(s);
    dud(s);
    expect(s.clearStreak).toBe(0);
    expect(s.bestClearStreak).toBe(3);
  });

  it('remembers the best run, not the last', () => {
    const s = createStats();
    clear(s); clear(s); clear(s); clear(s); // 4
    dud(s);
    clear(s); clear(s);                      // 2
    expect(s.clearStreak).toBe(2);
    expect(s.bestClearStreak).toBe(4);
  });

  it('starts at zero and stays zero through a game with no clears', () => {
    const s = createStats();
    dud(s); dud(s); dud(s);
    expect(s.bestClearStreak).toBe(0);
  });

  it('is reproduced exactly by a replay', () => {
    // The whole anti-cheat scheme rests on the server deriving this itself.
    for (const seed of [0x5eed, 0xc0ffee, 4242]) {
      const state = new GameState({ seed });
      const chooser = createRng(seed ^ 0x99);
      const actions: GameAction[] = [];
      let guard = 0;
      while (!state.gameOver && guard++ < 120) {
        const legal: Array<{ t: number; r: number; c: number }> = [];
        for (let t = 0; t < state.tray.length; t++) {
          const piece = state.tray[t];
          if (!piece) continue;
          for (let r = 0; r < state.board.size; r++)
            for (let c = 0; c < state.board.size; c++)
              if (state.board.canPlace(piece.shape, r, c)) legal.push({ t, r, c });
        }
        if (legal.length === 0) break;
        const m = legal[chooser.int(legal.length)]!;
        if (!state.placePiece(m.t, m.r, m.c)) break;
        actions.push({ type: 'place', pieceIndex: m.t, gridX: m.c, gridY: m.r });
      }
      const truth = replay(seed, actions);
      expect(truth.rejected, `seed ${seed}`).toBe(0);
      expect(truth.bestClearStreak, `seed ${seed}: streak drifted`).toBe(state.stats.bestClearStreak);
    }
  });

  it('a power-up between two chains does not break the run', () => {
    const s = createStats();
    clear(s); clear(s);
    // Power-ups never call recordPlacement, so the streak is untouched by one.
    clear(s);
    expect(s.bestClearStreak).toBe(3);
  });
});

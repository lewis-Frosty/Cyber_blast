import { describe, expect, it } from 'vitest';
import { RunSession } from '../src/backend/moveLog';
import { GameState } from '../src/core/gameState';
import { createRng } from '../src/core/rng';
import { replay } from '../src/core/replay';
import { GAMEPLAY_CONFIG } from '../src/config/gameplay';

/**
 * The premise of the whole anti-cheat scheme: a run recorded the way the game
 * records it must replay to the SAME score on the server.
 *
 * These tests drive RunSession with (row, col) exactly as GameScene does, so
 * an axis swap between the game's (row, col) and the log's (gridX, gridY)
 * fails here rather than silently rejecting every honest player's score.
 */

const handle = (seed: number) => ({ runId: 'run-1', seed, mode: 'endless' as const, moveLimit: null });

/** Play a game, recording through RunSession the way the scene does. */
function playAndRecord(seed: number, chooserSeed: number, maxMoves: number) {
  const state = new GameState({ seed });
  const session = new RunSession(handle(seed));
  const chooser = createRng(chooserSeed);

  while (!state.gameOver && session.moves.length < maxMoves) {
    const legal: Array<{ t: number; r: number; c: number }> = [];
    for (let t = 0; t < state.tray.length; t++) {
      const piece = state.tray[t];
      if (!piece) continue;
      for (let r = 0; r < state.board.size; r++) {
        for (let c = 0; c < state.board.size; c++) {
          if (state.board.canPlace(piece.shape, r, c)) legal.push({ t, r, c });
        }
      }
    }
    if (legal.length === 0) break;
    const m = legal[chooser.int(legal.length)]!;
    // Mirrors GameScene.runTurn: record only what the engine accepted.
    if (!state.placePiece(m.t, m.r, m.c)) break;
    session.recordPlacement(m.t, m.r, m.c);
  }
  return { state, session };
}

describe('a recorded run replays to the same score', () => {
  it('matches score, placements and chain depth across several seeds', () => {
    for (const seed of [0x5eed, 0xc0ffee, 12345, 999]) {
      const { state, session } = playAndRecord(seed, seed ^ 0x1234, 80);
      expect(session.moves.length, `seed ${seed} produced no moves`).toBeGreaterThan(5);

      const truth = replay(seed, session.moves, { config: GAMEPLAY_CONFIG });
      expect(truth.rejected, `seed ${seed}: server rejected a legitimately recorded move`).toBe(0);
      expect(truth.score, `seed ${seed}: score disagreed`).toBe(state.score);
      expect(truth.placements).toBe(session.moves.length);
      expect(Math.max(0, truth.maxCascade)).toBe(state.stats.maxDepthThisGame);
    }
  });

  it('records power-ups, without which the replay would diverge', () => {
    const seed = 0x5eed;
    const { state, session } = playAndRecord(seed, 77, 40);
    const before = session.moves.length;

    // Fire whichever power-up is charged, if any, and record it.
    let fired = false;
    for (const colour of [0, 1, 3, 4] as const) {
      for (let r = 0; r < state.board.size && !fired; r++) {
        for (let c = 0; c < state.board.size && !fired; c++) {
          if (state.usePowerUp(colour, r, c)) {
            session.recordPowerUp(colour, r, c);
            fired = true;
          }
        }
      }
      if (fired) break;
    }

    const truth = replay(seed, session.moves, { config: GAMEPLAY_CONFIG });
    expect(truth.rejected).toBe(0);
    expect(truth.score).toBe(state.score);
    if (fired) expect(session.moves.length).toBe(before + 1);

    // The client self-reports stats.placements; the server derives its own
    // placement count from the log. If a power-up made these disagree, every
    // honest run that used one would be rejected.
    expect(truth.placements).toBe(state.stats.placements);
    expect(Math.max(0, truth.maxCascade)).toBe(state.stats.maxDepthThisGame);
  });

  it('would fail if row and column were swapped — the guard is real', () => {
    const seed = 0xc0ffee;
    const { session } = playAndRecord(seed, 4242, 40);
    const swapped = session.moves.map((m) => ({ ...m, gridX: m.gridY, gridY: m.gridX }));
    const truth = replay(seed, swapped, { config: GAMEPLAY_CONFIG });
    // Either illegal moves or a different score; a silent match would mean the
    // test above proves nothing.
    expect(truth.rejected > 0 || truth.score !== replay(seed, session.moves).score).toBe(true);
  });
});

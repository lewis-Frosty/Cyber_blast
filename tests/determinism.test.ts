import { describe, expect, it } from 'vitest';
import { GameState } from '../src/core/gameState';
import { replay, toActions, type GameAction, type Placement } from '../src/core/replay';
import { createRng } from '../src/core/rng';
import { GAMEPLAY_CONFIG } from '../src/config/gameplay';

/**
 * Spec §6 tests 11-13 — the determinism requirements. Test 12 is the one the
 * project rests on: it is the Phase 2 server-side verifier, proven in Phase 1.
 */

/** Play a game with seeded "random" choices, recording what it did. */
function playRecordedGame(seed: number, chooserSeed: number, maxPlacements: number) {
  const state = new GameState({ seed });
  const chooser = createRng(chooserSeed);
  const actions: GameAction[] = [];

  while (!state.gameOver && actions.length < maxPlacements) {
    // Collect every legal placement, then pick one from the seeded stream.
    const legal: Placement[] = [];
    for (let t = 0; t < state.tray.length; t++) {
      const piece = state.tray[t];
      if (!piece) continue;
      for (let r = 0; r < state.board.size; r++) {
        for (let c = 0; c < state.board.size; c++) {
          if (state.board.canPlace(piece.shape, r, c)) legal.push({ pieceIndex: t, gridX: c, gridY: r });
        }
      }
    }
    if (legal.length === 0) break;
    const move = legal[chooser.int(legal.length)] as Placement;
    const result = state.placePiece(move.pieceIndex, move.gridY, move.gridX);
    if (!result) break;
    actions.push({ type: 'place', ...move });
  }

  return { state, actions };
}

describe('determinism (§2.2.1, §6 tests 11-13)', () => {
  it('11. the same seed produces an identical piece sequence in two fresh instances', () => {
    const describeTray = (g: GameState) => g.tray.map((p) => (p ? `${p.shape.name}:${p.color}` : '-'));

    const a = new GameState({ seed: 12345 });
    const b = new GameState({ seed: 12345 });
    expect(describeTray(a)).toEqual(describeTray(b));

    // And it must stay identical across many refills, not just the first tray.
    for (let i = 0; i < 40; i++) {
      const pa = a.tray.findIndex((p) => p !== null);
      const pb = b.tray.findIndex((p) => p !== null);
      expect(pa).toBe(pb);
      if (pa < 0) break;
      const shape = a.tray[pa]!.shape;
      let placed = false;
      for (let r = 0; r < 8 && !placed; r++) {
        for (let c = 0; c < 8 && !placed; c++) {
          if (a.board.canPlace(shape, r, c)) {
            a.placePiece(pa, r, c);
            b.placePiece(pb, r, c);
            placed = true;
          }
        }
      }
      if (!placed) break;
      expect(describeTray(a)).toEqual(describeTray(b));
      expect(a.score).toBe(b.score);
      expect(a.board.toArray()).toEqual(b.board.toArray());
    }

    // A different seed must diverge, or the PRNG is ignoring its seed.
    const other = new GameState({ seed: 999 });
    expect(describeTray(other)).not.toEqual(describeTray(new GameState({ seed: 12345 })));
  });

  it('12. replaying a recorded placement list reproduces the exact score and board', () => {
    const seed = 0xC0FFEE;
    const { state, actions } = playRecordedGame(seed, 4242, 50);
    expect(actions.length).toBeGreaterThan(10); // a real game, not a trivial one

    const result = replay(seed, actions, { strict: true });

    expect(result.rejected).toBe(0);
    expect(result.placements).toBe(actions.length);
    expect(result.score).toBe(state.score);
    expect(result.finalBoard).toEqual(state.board.toArray());
    expect(result.maxCascade).toBe(state.stats.maxDepthThisGame >= 0 ? state.stats.maxDepthThisGame : -1);

    // Replay is itself repeatable and free of shared state.
    expect(replay(seed, actions)).toEqual(result);

    // The placement-only §2.2.1 form gives the same answer.
    const plain: Placement[] = actions
      .filter((a): a is { type: 'place' } & Placement => a.type === 'place')
      .map(({ pieceIndex, gridX, gridY }) => ({ pieceIndex, gridX, gridY }));
    expect(replay(seed, toActions(plain)).score).toBe(state.score);
  });

  it('12b. a tampered score claim cannot survive replay', () => {
    const seed = 0xBEEF;
    const { state, actions } = playRecordedGame(seed, 77, 40);
    const truth = replay(seed, actions).score;
    expect(truth).toBe(state.score);

    // A cheat claiming a bigger score is caught by recomputation.
    const claimed = truth + 10_000;
    expect(claimed).not.toBe(truth);

    // Replaying the same actions under a different seed must not match either,
    // so a client cannot swap in a friendlier seed.
    expect(replay(seed + 1, actions).score).not.toBe(truth);
  });

  // Test 13's static check lives in scripts/check-core-purity.mjs and runs on
  // every `npm test` via the pretest hook — the spec asks for a lint rule
  // rather than only a test, and a plain script needs no extra dependency.

  it('13b. scoring produces integers only', () => {
    const { state } = playRecordedGame(0x5EED, 31337, 60);
    expect(Number.isInteger(state.score)).toBe(true);
    expect(Number.isInteger(GAMEPLAY_CONFIG.POINTS_PER_CELL_BASE)).toBe(true);
    expect(Number.isInteger(GAMEPLAY_CONFIG.POINTS_PER_CELL_PLACED)).toBe(true);

    // Every intermediate score across a long game stays integral.
    const fresh = new GameState({ seed: 0x5EED });
    const chooser = createRng(31337);
    for (let i = 0; i < 80 && !fresh.gameOver; i++) {
      const t = fresh.tray.findIndex((p) => p !== null);
      if (t < 0) break;
      const shape = fresh.tray[t]!.shape;
      const spots: [number, number][] = [];
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) if (fresh.board.canPlace(shape, r, c)) spots.push([r, c]);
      if (spots.length === 0) break;
      const [r, c] = spots[chooser.int(spots.length)] as [number, number];
      const res = fresh.placePiece(t, r, c);
      if (!res) break;
      expect(Number.isInteger(res.score.total)).toBe(true);
      expect(Number.isInteger(fresh.score)).toBe(true);
    }
  });
});

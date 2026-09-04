// GENERATED FILE — do not edit.
// Copied from src/core/replay.ts by scripts/build-edge-shared.mjs so the Edge Function
// runs the SAME logic as the client. Edit the source, then re-run the script.

import { Board } from './Board.ts';
import { GameState } from './gameState.ts';
import type { GameplayConfig } from '../config/gameplay.ts';
import type { Cell, ColorId } from './types.ts';

/**
 * Deterministic replay — spec §2.2.1.
 *
 * This is the Phase 2 anti-cheat verifier in embryo: the server generates the
 * seed, the client returns its ordered action list, and the server re-runs THIS
 * function to compute the true score. A claimed score that doesn't match is
 * rejected.
 *
 * It only works because src/core/ obeys the five architectural rules — no
 * engine imports, one seeded PRNG, integer maths, no wall-clock reads. If this
 * module ever disagrees with live play, determinism is broken somewhere and the
 * whole anti-cheat scheme is void.
 */

/**
 * One placement. Named per §2.2.1's `(pieceIndex, gridX, gridY)`:
 * `gridX` is the column and `gridY` the row of the piece's top-left cell.
 */
export interface Placement {
  pieceIndex: number;
  gridX: number;
  gridY: number;
}

/**
 * A power-up activation. Power-ups are a post-spec addition, but they change
 * the score and the board, so a replay that ignored them could not reproduce a
 * real game — and rule 5 would be unenforceable.
 */
export interface PowerUpAction {
  colour: ColorId;
  gridX: number;
  gridY: number;
}

export type GameAction = ({ type: 'place' } & Placement) | ({ type: 'power' } & PowerUpAction);

export interface ReplayResult {
  score: number;
  /** Flat cell array of the final board, comparable with toEqual. */
  finalBoard: readonly Cell[];
  /** Deepest cascade generation reached across the whole run. */
  maxCascade: number;
  /** Actions that were rejected as illegal — a legitimate client produces none. */
  rejected: number;
  placements: number;
}

export interface ReplayOptions {
  config?: GameplayConfig;
  /**
   * Stop at the first illegal action instead of skipping it. The server wants
   * this: an illegal action means the client is lying or out of sync.
   */
  strict?: boolean;
}

/** Convenience for the common placement-only case in §2.2.1. */
export function toActions(placements: readonly Placement[]): GameAction[] {
  return placements.map((p) => ({ type: 'place', ...p }));
}

/**
 * Re-run a game from its seed and ordered action list.
 * Pure: no clock reads, no engine, no shared state between calls.
 */
export function replay(
  seed: number,
  actions: readonly GameAction[],
  opts: ReplayOptions = {},
): ReplayResult {
  const state = new GameState({ seed, ...(opts.config ? { config: opts.config } : {}) });
  let maxCascade = -1;
  let rejected = 0;
  let placements = 0;

  for (const action of actions) {
    if (action.type === 'place') {
      const result = state.placePiece(action.pieceIndex, action.gridY, action.gridX);
      if (!result) {
        rejected += 1;
        if (opts.strict) break;
        continue;
      }
      placements += 1;
      if (result.cascade.maxGeneration > maxCascade) maxCascade = result.cascade.maxGeneration;
    } else {
      const result = state.usePowerUp(action.colour, action.gridY, action.gridX);
      if (!result) {
        rejected += 1;
        if (opts.strict) break;
      }
    }
  }

  return {
    score: state.score,
    finalBoard: state.board.toArray(),
    maxCascade,
    rejected,
    placements,
  };
}

/** Rebuild a Board from a replay result, for callers that want to inspect it. */
export function boardFromReplay(result: ReplayResult, size: number): Board {
  return new Board(size, result.finalBoard);
}

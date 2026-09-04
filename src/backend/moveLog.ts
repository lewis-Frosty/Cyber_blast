import type { GameAction } from '../core/replay';
import type { ColorId } from '../core/types';

/**
 * The recorded shape of a run — the thing that becomes the score.
 *
 * Deliberately free of network and engine imports so it can be unit-tested
 * against replay() directly. The axis convention is the whole risk here:
 * the game thinks in (row, col) and the replay format is (gridX, gridY), so
 * the translation happens in exactly one place, right here.
 */

export type RunMode = 'endless' | 'daily' | 'limited';

export interface RunHandle {
  /** Server run id, or null for an offline run that cannot be submitted. */
  runId: string | null;
  seed: number;
  mode: RunMode;
  moveLimit: number | null;
}

export class RunSession {
  private readonly log: GameAction[] = [];

  constructor(readonly handle: RunHandle) {}

  /** True when this run can actually be submitted. */
  get rankable(): boolean {
    return this.handle.runId !== null;
  }

  get moves(): readonly GameAction[] {
    return this.log;
  }

  /**
   * Record a placement the engine ACCEPTED. Callers must not record rejected
   * moves: the server replays with the same engine, so a log containing an
   * illegal action is indistinguishable from a tampered one.
   */
  recordPlacement(pieceIndex: number, row: number, col: number): void {
    this.log.push({ type: 'place', pieceIndex, gridX: col, gridY: row });
  }

  /** Record a power-up the engine accepted. Power-ups change the score too. */
  recordPowerUp(colour: ColorId, row: number, col: number): void {
    this.log.push({ type: 'power', colour, gridX: col, gridY: row });
  }
}

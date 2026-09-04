import { Board } from './Board';
import { resolveBoard, type CascadeResult, type Generation0 } from './cascade';
import { spawnPiece, SHAPES, type Piece, type Shape } from './Piece';
import { scoreTurn, type ScoreBreakdown } from './scoring';
import { createRng, type Rng } from './rng';
import { createStats, recordPlacement, type GameStats } from './stats';
import {
  addCharge,
  addChargeAll,
  applyPowerUp,
  canApply,
  createMeters,
  isReady,
  powerUpById,
  spendCharge,
  type PowerUpEffect,
  type PowerUpId,
  type PowerUpMeters,
} from './powerups';
import { GAMEPLAY_CONFIG, type GameplayConfig } from '../config/gameplay';
import type { CellIndex, ColorId } from './types';

/** Everything the renderer needs to animate one turn. */
export interface TurnResult {
  piece: Piece;
  trayIndex: number;
  anchor: { row: number; col: number };
  placedCells: CellIndex[];
  generation0: Generation0;
  cascade: CascadeResult;
  score: ScoreBreakdown;
  /** Colours whose power-up became ready as a result of this placement. */
  chargedColours: ColorId[];
  /** True if the tray was emptied and refilled after this placement. */
  trayRefilled: boolean;
  gameOver: boolean;
}

/** Everything the renderer needs to animate one power-up use. */
export interface PowerUpResult {
  effect: PowerUpEffect;
  colour: ColorId;
  scoreGained: number;
  trayRefilled: boolean;
  gameOver: boolean;
}

export interface GameStateOptions {
  config?: GameplayConfig;
  rng?: Rng;
  /** Omitted means GAMEPLAY_CONFIG.DEFAULT_SEED — never a clock read. */
  seed?: number;
  shapes?: readonly Shape[];
}

/**
 * Turn flow: placement → line detection → cascade → score → power-up charge →
 * tray refill → game-over check. Pure; the scene drives it and animates the
 * returned result objects.
 */
export class GameState {
  readonly config: GameplayConfig;
  readonly board: Board;
  readonly tray: (Piece | null)[];
  readonly stats: GameStats;
  readonly meters: PowerUpMeters;
  score = 0;
  gameOver = false;
  private nextMilestone: number;
  private readonly rng: Rng;
  private readonly shapes: readonly Shape[];

  constructor(opts: GameStateOptions = {}) {
    this.config = opts.config ?? GAMEPLAY_CONFIG;
    this.rng = opts.rng ?? createRng(opts.seed ?? this.config.DEFAULT_SEED);
    this.shapes = opts.shapes ?? SHAPES;
    this.board = new Board(this.config.BOARD_SIZE);
    this.stats = createStats();
    this.meters = createMeters(this.config.PALETTE_SIZE, this.config.POWERUP_CHARGE_COST);
    this.nextMilestone = this.config.POWERUP_SCORE_MILESTONE;
    this.tray = new Array<Piece | null>(this.config.TRAY_SIZE).fill(null);
    this.refillTray();
    this.gameOver = this.checkGameOver();
  }

  private spawn(): Piece {
    return spawnPiece(
      this.board,
      this.rng,
      { paletteSize: this.config.PALETTE_SIZE, affinity: this.config.COLOUR_AFFINITY },
      this.shapes,
    );
  }

  private refillTray(): void {
    for (let i = 0; i < this.tray.length; i++) this.tray[i] = this.spawn();
  }

  /** Force a specific piece into a tray slot (tests / debug). */
  setTrayPiece(index: number, piece: Piece | null): void {
    if (index < 0 || index >= this.tray.length) throw new RangeError(`Tray index ${index} out of range`);
    this.tray[index] = piece;
  }

  remainingPieces(): Piece[] {
    return this.tray.filter((p): p is Piece => p !== null);
  }

  canPlace(trayIndex: number, row: number, col: number): boolean {
    const piece = this.tray[trayIndex];
    if (!piece || this.gameOver) return false;
    return this.board.canPlace(piece.shape, row, col);
  }

  /** True when no remaining tray piece fits anywhere (§2.6). */
  checkGameOver(): boolean {
    const remaining = this.remainingPieces();
    if (remaining.length === 0) return false;
    if (remaining.some((p) => this.board.canPlaceAnywhere(p.shape))) return false;
    // A ready power-up can still open the board back up, so it isn't over yet.
    return !this.hasUsablePowerUp();
  }

  // ── Power-ups ──────────────────────────────────────────────────────────

  /** Colours whose power-up is charged and ready to fire. */
  readyColours(): ColorId[] {
    if (!this.config.POWERUPS_ENABLED) return [];
    const out: ColorId[] = [];
    for (let c = 0; c < this.config.PALETTE_SIZE; c++) if (isReady(this.meters, c)) out.push(c);
    return out;
  }

  /** True if any charged power-up could change the board (so the game isn't stuck). */
  hasUsablePowerUp(): boolean {
    return this.readyColours().some((c) => {
      const def = powerUpById(powerUpIdForColour(c));
      // 'none' targeting (reroll) always does something; targeted abilities need
      // at least one legal cell, which a non-empty board always has.
      return def.targeting === 'none' || this.board.filledCount() > 0;
    });
  }

  /**
   * Fire a charged power-up at (row, col). Non-targeted abilities ignore the
   * coordinates. Returns null if the ability isn't charged or can't apply there.
   */
  usePowerUp(colour: ColorId, row = 0, col = 0): PowerUpResult | null {
    if (!this.config.POWERUPS_ENABLED || this.gameOver) return null;
    if (!isReady(this.meters, colour)) return null;
    const id = powerUpIdForColour(colour);
    if (!canApply(this.board, id, row, col)) return null;

    spendCharge(this.meters, colour);
    const effect = applyPowerUp(this.board, id, row, col);

    const scoreGained = effect.cleared.length * this.config.POINTS_PER_CELL_POWERUP;
    this.score += scoreGained;
    this.stats.totalScore += scoreGained;
    this.stats.cellsCleared += effect.cleared.length;
    this.stats.powerUpsUsed += 1;
    this.applyMilestones();

    let trayRefilled = false;
    if (effect.rerollTray || this.remainingPieces().length === 0) {
      this.refillTray();
      trayRefilled = true;
    }

    this.gameOver = this.checkGameOver();
    return { effect, colour, scoreGained, trayRefilled, gameOver: this.gameOver };
  }

  /** Top every meter up each time the score crosses a milestone. */
  private applyMilestones(): void {
    const step = this.config.POWERUP_SCORE_MILESTONE;
    if (!this.config.POWERUPS_ENABLED || step <= 0) return;
    while (this.score >= this.nextMilestone) {
      addChargeAll(this.meters, this.config.POWERUP_MILESTONE_BONUS);
      this.stats.milestonesHit += 1;
      this.nextMilestone += step;
    }
  }

  // ── Placement ──────────────────────────────────────────────────────────

  /**
   * Place tray piece `trayIndex` with its top-left anchored at (row, col).
   * Returns null if the placement is illegal.
   */
  placePiece(trayIndex: number, row: number, col: number): TurnResult | null {
    const piece = this.tray[trayIndex];
    if (!piece || this.gameOver || !this.board.canPlace(piece.shape, row, col)) return null;

    const placedCells = this.board.place(piece.shape, piece.color, row, col);
    this.tray[trayIndex] = null;

    const { generation0, ...cascade } = resolveBoard(this.board, {
      maxDepth: this.config.MAX_CASCADE_DEPTH,
      neighbourMode: this.config.NEIGHBOUR_MODE,
      lockedColour: piece.color,
    });

    // Charge meters by the colour of what actually cleared, before the board is
    // wiped — in colour-locked mode that is always the placed piece's colour.
    const before = this.readyColours();
    if (this.config.POWERUPS_ENABLED) {
      for (const i of cascade.cleared.keys()) addCharge(this.meters, this.board.getAt(i), 1);
    }

    this.board.clearCells(cascade.cleared.keys());

    const score = scoreTurn(placedCells.length, cascade, this.config);
    this.score += score.total;
    recordPlacement(this.stats, cascade.maxGeneration, cascade.cleared.size, score.total);
    this.applyMilestones();

    const chargedColours = this.readyColours().filter((c) => !before.includes(c));

    let trayRefilled = false;
    if (this.remainingPieces().length === 0) {
      this.refillTray();
      trayRefilled = true;
    }

    this.gameOver = this.checkGameOver();

    return {
      piece,
      trayIndex,
      anchor: { row, col },
      placedCells,
      generation0,
      cascade,
      score,
      chargedColours,
      trayRefilled,
      gameOver: this.gameOver,
    };
  }
}

function powerUpIdForColour(colour: ColorId): PowerUpId {
  // Kept local so gameState doesn't re-export the power-up table.
  const ids: PowerUpId[] = ['flush', 'nova', 'paint', 'reroll', 'pluck'];
  return ids[colour] ?? 'pluck';
}

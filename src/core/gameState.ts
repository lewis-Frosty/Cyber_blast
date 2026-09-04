import { Board } from './Board';
import { resolveBoard, type CascadeResult, type Generation0 } from './cascade';
import { isObstacle, OBSTACLE_PIECE, spawnPiece, SHAPES, type Piece, type Shape } from './Piece';
import { colourMultiplier, scoreTurn, type ScoreBreakdown } from './scoring';
import { createRng, type Rng } from './rng';
import { createStats, recordPlacement, type GameStats } from './stats';
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
  /** Grey cubes earned but not yet handed to the tray. */
  private pendingObstacles = 0;
  private nextObstacleAt: number;
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
    this.nextObstacleAt = this.obstacleInterval();
    this.tray = new Array<Piece | null>(this.config.TRAY_SIZE).fill(null);
    this.refillTray();
    this.gameOver = this.checkGameOver();
  }

  private spawn(): Piece {
    return spawnPiece(
      this.board,
      this.rng,
      {
        paletteSize: this.config.PALETTE_SIZE,
        affinity: this.config.COLOUR_AFFINITY,
        weights: this.config.COLOUR_SPAWN_WEIGHTS,
      },
      this.shapes,
    );
  }

  private refillTray(): void {
    for (let i = 0; i < this.tray.length; i++) this.tray[i] = this.spawn();

    // Hand over earned grey cubes, at most one per refill so a bad run never
    // arrives as a tray of nothing but wall.
    if (this.pendingObstacles > 0) {
      this.tray[this.tray.length - 1] = OBSTACLE_PIECE;
      this.pendingObstacles -= 1;
      this.stats.obstaclesGranted += 1;
    }
  }

  private obstacleInterval(): number {
    return this.config.OBSTACLE_TRIGGER === 'points'
      ? this.config.OBSTACLE_EVERY_POINTS
      : this.config.OBSTACLE_EVERY_PLACEMENTS;
  }

  /**
   * Award grey cubes once the configured threshold is crossed. Driven by the
   * placement count or the score depending on OBSTACLE_TRIGGER; both are
   * monotonic, so this stays deterministic and replayable.
   */
  private accrueObstacles(): void {
    if (!this.config.OBSTACLES_ENABLED) return;
    const step = this.obstacleInterval();
    if (step <= 0) return;
    const progress = this.config.OBSTACLE_TRIGGER === 'points' ? this.score : this.stats.placements;
    while (progress >= this.nextObstacleAt) {
      this.pendingObstacles += 1;
      this.nextObstacleAt += step;
    }
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
    // A colour with no ability (lime) can never be 'ready', however full its meter.
    for (let c = 0; c < this.config.PALETTE_SIZE; c++) {
      if (colourHasPowerUp(c) && isReady(this.meters, c)) out.push(c);
    }
    return out;
  }

  /** True if any charged power-up could change the board (so the game isn't stuck). */
  hasUsablePowerUp(): boolean {
    return this.readyColours().some((c) => {
      const def = powerUpForColourOrNull(c);
      if (!def) return false;
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
    const def = powerUpForColourOrNull(colour);
    if (!def || !canApply(this.board, def.id, row, col)) return null;

    spendCharge(this.meters, colour);
    // Read colours before applyPowerUp empties the cells.
    const clearedColours = canApply(this.board, def.id, row, col)
      ? collectColours(this.board, def.id, row, col)
      : [];
    const effect = applyPowerUp(this.board, def.id, row, col);

    let scoreGained = 0;
    for (const c of clearedColours) {
      scoreGained += this.config.POINTS_PER_CELL_POWERUP * colourMultiplier(c, this.config);
    }
    this.score += scoreGained;
    this.stats.totalScore += scoreGained;
    this.accrueObstacles();
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

    // A grey cube can complete a line, but it is not a colour, so nothing
    // clears. That is the trade the player makes when they spend one there.
    const { generation0, ...cascade } = resolveBoard(this.board, {
      maxDepth: this.config.MAX_CASCADE_DEPTH,
      neighbourMode: this.config.NEIGHBOUR_MODE,
      lockedColour: piece.color,
    });

    // Charge meters by the colour of what actually cleared, before the board is
    // wiped — in colour-locked mode that is always the placed piece's colour.
    const before = this.readyColours();
    if (this.config.POWERUPS_ENABLED) {
      for (const i of cascade.cleared.keys()) {
        const colour = this.board.getAt(i);
        if (colourHasPowerUp(colour)) addCharge(this.meters, colour, 1);
      }
    }

    // Score before wiping: scoreTurn needs each cleared cell's colour for the
    // per-colour multiplier, and those cells are about to become EMPTY.
    const score = scoreTurn(placedCells.length, cascade, this.config, (i) => this.board.getAt(i));

    this.board.clearCells(cascade.cleared.keys());
    this.score += score.total;
    recordPlacement(this.stats, cascade.maxGeneration, cascade.cleared.size, score.total);
    if (isObstacle(piece)) this.stats.obstaclesPlaced += 1;
    this.applyMilestones();
    this.accrueObstacles();

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

/**
 * Colours the ability is about to remove, read while the board still holds
 * them. Mirrors applyPowerUp's own targeting so the two cannot drift.
 */
function collectColours(board: Board, id: PowerUpId, row: number, col: number): ColorId[] {
  const out: ColorId[] = [];
  const take = (r: number, c: number): void => {
    if (board.inBounds(r, c) && board.isFilled(r, c)) out.push(board.get(r, c));
  };
  switch (id) {
    case 'flush':
      for (let c = 0; c < board.size; c++) take(row, c);
      for (let r = 0; r < board.size; r++) if (r !== row) take(r, col);
      break;
    case 'nova':
      for (let r = row - 1; r <= row + 1; r++) for (let c = col - 1; c <= col + 1; c++) take(r, c);
      break;
    case 'pluck':
      for (const i of connectedRegion(board, row, col)) out.push(board.getAt(i));
      break;
    case 'reroll':
      break;
  }
  return out;
}

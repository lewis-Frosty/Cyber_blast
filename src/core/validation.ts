import { GAMEPLAY_CONFIG, type GameplayConfig } from '../config/gameplay';
import { SHAPES } from './Piece';
import { replay, type GameAction } from './replay';

/**
 * The anti-cheat validation chain — backend spec §4.2.
 *
 * Pure and clock-free on purpose: every time value arrives as an argument, so
 * this obeys rule 4 and can be unit-tested exhaustively instead of only being
 * exercised over HTTP. The Edge Function is a thin wrapper around it, and the
 * same module runs unchanged in Deno and in the browser.
 */

export type RunMode = 'endless' | 'daily' | 'limited';
export type RunStatus = 'active' | 'submitted' | 'rejected' | 'expired';

/** The server's record of the run, as stored in `runs`. */
export interface RunRecord {
  id: string;
  user_id: string;
  status: RunStatus;
  mode: RunMode;
  /** Epoch milliseconds. */
  started_at: number;
  seed: number;
  challenge_date: string | null;
  move_limit: number | null;
}

/**
 * What the client submits. Every field is untrusted.
 *
 * The move log is REQUIRED and is the only thing that determines the score:
 * the server replays it against the run's own seed and takes its own number.
 * There is deliberately no way to submit a score — a client that could name
 * its own score would make every check above the replay a formality, since a
 * patient attacker can pick a value that satisfies all of them.
 */
export interface SubmitClaim {
  runId: string;
  /** Ordered action list. The score is computed from this, never sent. */
  moveLog: GameAction[];
  /**
   * The client's own tally, for diagnostics only. It never becomes the score.
   * When present it must agree with the replay: a client whose engine disagrees
   * with the server's is out of sync, and its runs must not reach a leaderboard
   * that the server's numbers rank.
   */
  selfReport?: { score: number; placements: number; maxCascade: number };
}

export interface ValidationLimits {
  maxScorePerPlacement: number;
  /** Hard cap on actions accepted for replay — replay is CPU work. */
  maxMoveLogLength: number;
  minMsPerPlacement: number;
  maxPlausiblePlacements: number;
  maxCascadeDepth: number;
  freshnessMs: number;
  maxSubmissionsPerHour: number;
}

export interface ValidationContext {
  /** Epoch milliseconds, supplied by the caller. */
  now: number;
  /** auth.uid() of the caller. */
  callerId: string;
  /** Submissions by this user in the last hour, excluding this one. */
  submissionsLastHour: number;
  /** True if the user already has a submitted daily run for this date. */
  hasDailyAlready: boolean;
  limits?: ValidationLimits;
  config?: GameplayConfig;
}

export type RejectCode =
  | 'ownership'
  | 'state'
  | 'types'
  | 'freshness'
  | 'ceiling'
  | 'cascade'
  | 'pacing'
  | 'board_limit'
  | 'daily_once'
  | 'rate_limit'
  | 'move_limit'
  | 'no_move_log'
  | 'move_log_size'
  | 'replay_mismatch';

export type ValidationResult =
  | {
      ok: true;
      durationMs: number;
      /** Always true: nothing reaches this branch without a verified replay. */
      verified: true;
      /** The SERVER's score, computed from the move log. */
      score: number;
      placements: number;
      maxCascade: number;
    }
  | { ok: false; code: RejectCode; reason: string };

const HOUR_MS = 60 * 60 * 1000;

/**
 * Derive the ceiling constants from the gameplay config rather than hardcoding
 * them. The spec's worked example assumed a depth cap of 4 and a 5-cell maximum
 * piece; both have since changed, and a stale constant is a silent hole.
 */
export function deriveLimits(config: GameplayConfig = GAMEPLAY_CONFIG): ValidationLimits {
  const cells = config.BOARD_SIZE * config.BOARD_SIZE;
  // A cell's generation cannot exceed a path through every cell, and the depth
  // cap may bind first.
  const maxGeneration = Math.min(config.MAX_CASCADE_DEPTH, cells - 1);
  const maxColourMultiplier = Math.max(1, ...config.COLOUR_SCORE_MULTIPLIER);
  const maxCellPoints = config.POINTS_PER_CELL_BASE * (maxGeneration + 1) * maxColourMultiplier;
  const maxPieceCells = Math.max(...SHAPES.map((s) => s.cells.length));

  return {
    // Whole board cleared at the richest possible generation, plus the placement.
    maxScorePerPlacement: cells * maxCellPoints + maxPieceCells * config.POINTS_PER_CELL_PLACED,
    minMsPerPlacement: 250,
    maxPlausiblePlacements: 5000,
    // Every placement can be accompanied by a power-up, so allow twice the
    // placement bound and no more: replaying an unbounded log is a cheap way
    // to burn Edge Function CPU.
    maxMoveLogLength: 5000 * 2,
    maxCascadeDepth: maxGeneration,
    freshnessMs: 2 * HOUR_MS,
    maxSubmissionsPerHour: 20,
  };
}

function isNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/**
 * Run the §4.2 chain in order, rejecting on the first failure.
 *
 * Order matters: cheap identity and state checks come before anything
 * expensive, and the replay — the only genuinely authoritative check — runs
 * last, once the claim is known to be well-formed.
 */
export function validateSubmission(
  run: RunRecord,
  claim: SubmitClaim,
  ctx: ValidationContext,
): ValidationResult {
  const limits = ctx.limits ?? deriveLimits(ctx.config ?? GAMEPLAY_CONFIG);
  const reject = (code: RejectCode, reason: string): ValidationResult => ({ ok: false, code, reason });

  // 1. OWNERSHIP
  if (run.user_id !== ctx.callerId) return reject('ownership', 'run belongs to another user');

  // 2. STATE — also blocks replaying an already-submitted runId.
  if (run.status !== 'active') return reject('state', `run is ${run.status}, not active`);

  // 3. MOVE LOG PRESENT. Without it there is nothing to verify, and every
  // check below is a bound rather than a proof. Refusing here is what makes
  // the score un-nameable by the client.
  if (!Array.isArray(claim.moveLog)) return reject('no_move_log', 'a move log is required');
  if (claim.moveLog.length === 0) return reject('no_move_log', 'move log is empty');
  if (claim.moveLog.length > limits.maxMoveLogLength) {
    return reject('move_log_size', 'move log is longer than any real game');
  }

  // 4. FRESHNESS
  const durationMs = ctx.now - run.started_at;
  if (durationMs < 0) return reject('freshness', 'run started in the future');
  if (durationMs >= limits.freshnessMs) return reject('freshness', 'run is older than the session window');

  // 5. DAILY ONCE — belt and braces; a unique index enforces it in the database.
  if (run.mode === 'daily' && ctx.hasDailyAlready) {
    return reject('daily_once', 'daily challenge already submitted today');
  }

  // 6. RATE LIMIT. Cheap, and it comes before the replay so a flood of
  // submissions cannot be turned into a flood of replays.
  if (ctx.submissionsLastHour >= limits.maxSubmissionsPerHour) {
    return reject('rate_limit', 'too many submissions in the last hour');
  }

  // 7. REPLAY — the authoritative step. Re-runs the log against the server's
  // own seed and produces the numbers the rest of the chain then bounds.
  const truth = replay(run.seed, claim.moveLog, { config: ctx.config ?? GAMEPLAY_CONFIG });
  if (truth.rejected > 0) return reject('replay_mismatch', 'move log contains illegal moves');

  const score = truth.score;
  const placements = truth.placements;
  // replay() reports -1 for a game that never cleared a line; the stats counter
  // reports 0 for the same game. Normalise to the stats convention so the two
  // are comparable and so the stored value is never negative.
  const maxCascade = Math.max(0, truth.maxCascade);

  // 8-12. PHYSICS BOUNDS, applied to the DERIVED numbers. These can now only
  // fail if the engine itself is wrong or the config has drifted, which is
  // exactly when a score should not be banked.
  if (score > limits.maxScorePerPlacement * placements) {
    return reject('ceiling', 'score exceeds the physical maximum for that many placements');
  }
  if (maxCascade > limits.maxCascadeDepth) {
    return reject('cascade', 'maxCascade exceeds the deepest chain the board allows');
  }
  if (placements > limits.maxPlausiblePlacements) {
    return reject('board_limit', 'placement count is implausible');
  }
  // A real player cannot drag faster than this for a whole game.
  if (durationMs < placements * limits.minMsPerPlacement) {
    return reject('pacing', 'elapsed time is too short for that many placements');
  }
  if (run.mode === 'limited') {
    if (run.move_limit === null) return reject('move_limit', 'limited run has no move limit');
    if (placements > run.move_limit) return reject('move_limit', 'more placements than the run allowed');
  }

  // 13. SELF-REPORT CROSS-CHECK. Optional, and it cannot change the score —
  // a disagreement means the client is running a different engine or config,
  // so its runs must not be ranked against everyone else's.
  const self = claim.selfReport;
  if (self) {
    if (!isNonNegativeInt(self.score) || !isNonNegativeInt(self.placements) || !isNonNegativeInt(self.maxCascade)) {
      return reject('types', 'self-reported totals must be non-negative integers');
    }
    if (self.score !== score) {
      return reject('replay_mismatch', `client reported ${self.score}, replay produced ${score}`);
    }
    if (self.placements !== placements) {
      return reject('replay_mismatch', 'client placement count does not match the move log');
    }
    if (self.maxCascade !== maxCascade) {
      return reject('replay_mismatch', 'client chain depth does not match the move log');
    }
  }

  return { ok: true, durationMs, verified: true, score, placements, maxCascade };
}

/** XP and currency are computed from the verified score — never sent by the client. */
export function computeRewards(score: number): { xp: number; currency: number } {
  return { xp: Math.floor(score / 10), currency: Math.floor(score / 500) };
}

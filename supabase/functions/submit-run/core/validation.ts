// GENERATED FILE — do not edit.
// Copied from src/core/validation.ts by scripts/build-edge-shared.mjs so the Edge Function
// runs the SAME logic as the client. Edit the source, then re-run the script.

import { GAMEPLAY_CONFIG, type GameplayConfig } from '../config/gameplay.ts';
import { SHAPES } from './Piece.ts';
import { replay, type GameAction } from './replay.ts';

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

/** What the client claims it achieved. Every field is untrusted. */
export interface SubmitClaim {
  runId: string;
  score: number;
  placements: number;
  maxCascade: number;
  /** Ordered action list. When present the score is recomputed, not trusted. */
  moveLog?: GameAction[];
}

export interface ValidationLimits {
  maxScorePerPlacement: number;
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
  | 'replay_mismatch';

export type ValidationResult =
  | { ok: true; durationMs: number; verified: boolean; score: number }
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

  // 3. TYPES — catches negative, fractional, NaN, Infinity and MAX_SAFE_INTEGER+1.
  if (!isNonNegativeInt(claim.score)) return reject('types', 'score must be a non-negative integer');
  if (!isNonNegativeInt(claim.placements)) return reject('types', 'placements must be a non-negative integer');
  if (!isNonNegativeInt(claim.maxCascade)) return reject('types', 'maxCascade must be a non-negative integer');

  // 4. FRESHNESS
  const durationMs = ctx.now - run.started_at;
  if (durationMs < 0) return reject('freshness', 'run started in the future');
  if (durationMs >= limits.freshnessMs) return reject('freshness', 'run is older than the session window');

  // 5. CEILING
  if (claim.score > limits.maxScorePerPlacement * claim.placements) {
    return reject('ceiling', 'score exceeds the physical maximum for that many placements');
  }

  // 6. CASCADE
  if (claim.maxCascade > limits.maxCascadeDepth) {
    return reject('cascade', 'maxCascade exceeds the deepest chain the board allows');
  }

  // 7. PACING — a real player cannot drag faster than this for a whole game.
  if (durationMs < claim.placements * limits.minMsPerPlacement) {
    return reject('pacing', 'elapsed time is too short for that many placements');
  }

  // 8. BOARD LIMIT
  if (claim.placements > limits.maxPlausiblePlacements) {
    return reject('board_limit', 'placement count is implausible');
  }

  // 9. DAILY ONCE — belt and braces; a unique index enforces it in the database.
  if (run.mode === 'daily' && ctx.hasDailyAlready) {
    return reject('daily_once', 'daily challenge already submitted today');
  }

  // 10. RATE LIMIT
  if (ctx.submissionsLastHour >= limits.maxSubmissionsPerHour) {
    return reject('rate_limit', 'too many submissions in the last hour');
  }

  // 11. MOVE LIMIT — limited mode cannot exceed the moves it was issued.
  if (run.mode === 'limited') {
    if (run.move_limit === null) return reject('move_limit', 'limited run has no move limit');
    if (claim.placements > run.move_limit) {
      return reject('move_limit', 'more placements than the run allowed');
    }
  }

  // 12. REPLAY — the only check that is actually authoritative. Everything
  // above is a physics bound; this recomputes the score from the server's own
  // seed and rejects any disagreement.
  if (claim.moveLog) {
    const truth = replay(run.seed, claim.moveLog, { config: ctx.config ?? GAMEPLAY_CONFIG });
    if (truth.rejected > 0) {
      return reject('replay_mismatch', 'move log contains illegal moves');
    }
    if (truth.score !== claim.score) {
      return reject('replay_mismatch', `claimed ${claim.score}, replay produced ${truth.score}`);
    }
    if (truth.placements !== claim.placements) {
      return reject('replay_mismatch', 'placement count does not match the move log');
    }
    return { ok: true, durationMs, verified: true, score: truth.score };
  }

  return { ok: true, durationMs, verified: false, score: claim.score };
}

/** XP and currency are computed from the verified score — never sent by the client. */
export function computeRewards(score: number): { xp: number; currency: number } {
  return { xp: Math.floor(score / 10), currency: Math.floor(score / 500) };
}

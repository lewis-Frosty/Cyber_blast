import { describe, expect, it } from 'vitest';
import {
  computeRewards,
  deriveLimits,
  validateSubmission,
  type RunRecord,
  type SubmitClaim,
  type ValidationContext,
} from '../src/core/validation';
import { GameState } from '../src/core/gameState';
import { createRng } from '../src/core/rng';
import type { GameAction, Placement } from '../src/core/replay';
import { GAMEPLAY_CONFIG } from '../src/config/gameplay';

/**
 * Hostile suite for the submit-run validation chain (backend spec §4.2).
 *
 * The contract this suite defends: THE CLIENT CANNOT NAME A SCORE. A
 * submission carries a move log and nothing else that counts; the server
 * replays it and takes its own number. Every attack here must be rejected,
 * and the legitimate cases at the end must be accepted — a validator that
 * rejects everything is not secure, it is broken.
 */

const START = 1_700_000_000_000;
const LIMITS = deriveLimits();
const SEED = 0xc0ffee;

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: 'run-1',
  user_id: 'player-1',
  status: 'active',
  mode: 'endless',
  started_at: START,
  seed: SEED,
  challenge_date: null,
  move_limit: null,
  ...over,
});

const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  now: START + 120_000,
  callerId: 'player-1',
  submissionsLastHour: 0,
  hasDailyAlready: false,
  ...over,
});

/** Play a real game and record it, so the replay path is tested honestly. */
function recordRealGame(seed: number, chooserSeed: number, max: number) {
  const state = new GameState({ seed });
  const chooser = createRng(chooserSeed);
  const actions: GameAction[] = [];
  while (!state.gameOver && actions.length < max) {
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
    const m = legal[chooser.int(legal.length)] as Placement;
    if (!state.placePiece(m.pieceIndex, m.gridY, m.gridX)) break;
    actions.push({ type: 'place', ...m });
  }
  return { state, actions };
}

/** One honest game, reused as the baseline every attack is built from. */
const GAME = recordRealGame(SEED, 4242, 60);
/** Enough elapsed time that pacing never fires incidentally. */
const HONEST_CTX = ctx({ now: START + GAME.actions.length * 1000 });
const honest = (over: Partial<SubmitClaim> = {}): SubmitClaim => ({
  runId: 'run-1',
  moveLog: GAME.actions,
  ...over,
});

describe('the client cannot name a score', () => {
  it('has no score field to send — the accepted score is always the replay', () => {
    const r = validateSubmission(run(), honest(), HONEST_CTX);
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.score).toBe(GAME.state.score);
    expect(r.ok === true && r.verified).toBe(true);
  });

  it('rejects a submission with no move log at all', () => {
    const r = validateSubmission(run(), { runId: 'run-1' } as unknown as SubmitClaim, HONEST_CTX);
    expect(r.ok === false && r.code).toBe('no_move_log');
  });

  it('rejects an empty move log', () => {
    const r = validateSubmission(run(), honest({ moveLog: [] }), HONEST_CTX);
    expect(r.ok === false && r.code).toBe('no_move_log');
  });

  it('rejects a move log longer than any real game, before replaying it', () => {
    const huge: GameAction[] = new Array(LIMITS.maxMoveLogLength + 1).fill({
      type: 'place',
      pieceIndex: 0,
      gridX: 0,
      gridY: 0,
    });
    const r = validateSubmission(run(), honest({ moveLog: huge }), HONEST_CTX);
    expect(r.ok === false && r.code).toBe('move_log_size');
  });

  it('rejects an inflated self-report instead of banking it', () => {
    // The exact forgery the physics checks cannot catch: plausible, under the
    // ceiling, paced like a real game — and contradicted by the replay.
    const inflated = GAME.state.score + 5000;
    expect(inflated).toBeLessThan(LIMITS.maxScorePerPlacement * GAME.actions.length);

    const r = validateSubmission(
      run(),
      honest({ selfReport: { score: inflated, placements: GAME.actions.length, maxCascade: 3 } }),
      HONEST_CTX,
    );
    expect(r.ok === false && r.code).toBe('replay_mismatch');
  });

  it('rejects malformed self-reported totals', () => {
    for (const score of [-1, 1.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) {
      const r = validateSubmission(
        run(),
        honest({ selfReport: { score, placements: GAME.actions.length, maxCascade: 0 } }),
        HONEST_CTX,
      );
      expect(r.ok, `self-reported score ${score} must be rejected`).toBe(false);
    }
  });

  it('accepts a self-report that agrees with the replay', () => {
    const r = validateSubmission(
      run(),
      honest({
        selfReport: {
          score: GAME.state.score,
          placements: GAME.actions.length,
          maxCascade: GAME.state.stats.maxDepthThisGame,
        },
      }),
      HONEST_CTX,
    );
    expect(r.ok).toBe(true);
  });
});

describe('submit-run hostile suite (§4.2)', () => {
  it('rejects a replayed runId that was already submitted', () => {
    for (const status of ['submitted', 'rejected', 'expired'] as const) {
      const r = validateSubmission(run({ status }), honest(), HONEST_CTX);
      expect(r.ok === false && r.code).toBe('state');
    }
  });

  it("rejects another user's runId", () => {
    const r = validateSubmission(run({ user_id: 'someone-else' }), honest(), HONEST_CTX);
    expect(r.ok === false && r.code).toBe('ownership');
  });

  it('rejects a second daily submission on the same day', () => {
    const daily = run({ mode: 'daily', challenge_date: '2026-09-04' });
    expect(validateSubmission(daily, honest(), ctx({ ...HONEST_CTX, hasDailyAlready: true })).ok).toBe(false);
    expect(validateSubmission(daily, honest(), ctx({ ...HONEST_CTX, hasDailyAlready: false })).ok).toBe(true);
  });

  it('rejects a stale run and one that claims to start in the future', () => {
    expect(validateSubmission(run(), honest(), ctx({ now: START + 3 * 60 * 60 * 1000 })).ok).toBe(false);
    expect(validateSubmission(run(), honest(), ctx({ now: START - 1000 })).ok).toBe(false);
  });

  it('rejects once the hourly rate limit is reached', () => {
    const r = validateSubmission(run(), honest(), ctx({ ...HONEST_CTX, submissionsLastHour: 20 }));
    expect(r.ok === false && r.code).toBe('rate_limit');
    expect(validateSubmission(run(), honest(), ctx({ ...HONEST_CTX, submissionsLastHour: 19 })).ok).toBe(true);
  });

  it('rejects zero elapsed time for a real game', () => {
    const r = validateSubmission(run(), honest(), ctx({ now: START }));
    expect(r.ok === false && r.code).toBe('pacing');
  });

  it('rejects more placements than a limited run allowed', () => {
    const short = GAME.actions.length - 1;
    const limited = run({ mode: 'limited', move_limit: short });
    const r = validateSubmission(limited, honest(), HONEST_CTX);
    expect(r.ok === false && r.code).toBe('move_limit');
    // Exactly the allowance is fine.
    const exact = run({ mode: 'limited', move_limit: GAME.actions.length });
    expect(validateSubmission(exact, honest(), HONEST_CTX).ok).toBe(true);
  });

  it('rejects a limited run with no move limit recorded', () => {
    const r = validateSubmission(run({ mode: 'limited', move_limit: null }), honest(), HONEST_CTX);
    expect(r.ok === false && r.code).toBe('move_limit');
  });

  it('rejects a move log replayed against a different seed', () => {
    const r = validateSubmission(run({ seed: SEED + 1 }), honest(), HONEST_CTX);
    expect(r.ok === false && r.code).toBe('replay_mismatch');
  });

  it('rejects a move log containing illegal placements', () => {
    const tampered: GameAction[] = [...GAME.actions, { type: 'place', pieceIndex: 0, gridX: 99, gridY: 99 }];
    const r = validateSubmission(run(), honest({ moveLog: tampered }), HONEST_CTX);
    expect(r.ok === false && r.code).toBe('replay_mismatch');
  });
});

/**
 * The physics bounds now run against numbers the SERVER derived, so with a
 * correct engine they are unreachable. They are defence in depth against the
 * engine or the config drifting, and are tested by tightening the limits until
 * an honest game trips them.
 */
describe('physics bounds guard against engine drift', () => {
  it('rejects a derived score above the ceiling', () => {
    const r = validateSubmission(run(), honest(), {
      ...HONEST_CTX,
      limits: { ...LIMITS, maxScorePerPlacement: 0 },
    });
    expect(r.ok === false && r.code).toBe('ceiling');
  });

  it('rejects a derived cascade deeper than the board allows', () => {
    expect(GAME.state.stats.maxDepthThisGame).toBeGreaterThan(0);
    const r = validateSubmission(run(), honest(), { ...HONEST_CTX, limits: { ...LIMITS, maxCascadeDepth: 0 } });
    expect(r.ok === false && r.code).toBe('cascade');
  });

  it('rejects an implausible derived placement count', () => {
    const r = validateSubmission(run(), honest(), {
      ...HONEST_CTX,
      limits: { ...LIMITS, maxPlausiblePlacements: 1 },
    });
    expect(r.ok === false && r.code).toBe('board_limit');
  });
});

describe('derived limits and rewards', () => {
  it('derives the ceiling from config rather than a hardcoded constant', () => {
    const l = deriveLimits();
    expect(l.maxCascadeDepth).toBe(Math.min(GAMEPLAY_CONFIG.MAX_CASCADE_DEPTH, 63));
    expect(l.maxScorePerPlacement).toBeGreaterThan(0);
    const tighter = deriveLimits({ ...GAMEPLAY_CONFIG, MAX_CASCADE_DEPTH: 3 });
    expect(tighter.maxScorePerPlacement).toBeLessThan(l.maxScorePerPlacement);
  });

  it('computes rewards from the score, in integers', () => {
    expect(computeRewards(0)).toEqual({ xp: 0, currency: 0 });
    const r = computeRewards(12_345);
    expect(Number.isInteger(r.xp) && Number.isInteger(r.currency)).toBe(true);
    expect(r).toEqual({ xp: 1234, currency: 24 });
  });
});

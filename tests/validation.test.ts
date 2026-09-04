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
 * Every attack here MUST be rejected. The legitimate cases at the end must be
 * accepted — a validator that rejects everything is not secure, it is broken.
 */

const START = 1_700_000_000_000;
const LIMITS = deriveLimits();

const run = (over: Partial<RunRecord> = {}): RunRecord => ({
  id: 'run-1',
  user_id: 'player-1',
  status: 'active',
  mode: 'endless',
  started_at: START,
  seed: 0x5eed,
  challenge_date: null,
  move_limit: null,
  ...over,
});

const claim = (over: Partial<SubmitClaim> = {}): SubmitClaim => ({
  runId: 'run-1',
  score: 1000,
  placements: 40,
  maxCascade: 3,
  ...over,
});

const ctx = (over: Partial<ValidationContext> = {}): ValidationContext => ({
  now: START + 120_000, // two minutes of play
  callerId: 'player-1',
  submissionsLastHour: 0,
  hasDailyAlready: false,
  ...over,
});

/** Play a real game and record it, so the replay path can be tested honestly. */
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

describe('submit-run hostile suite (§4.2)', () => {
  it('rejects a negative score', () => {
    const r = validateSubmission(run(), claim({ score: -1 }), ctx());
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe('types');
  });

  it('rejects Number.MAX_SAFE_INTEGER and friends', () => {
    for (const score of [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, 1.5, 1e308]) {
      const r = validateSubmission(run(), claim({ score }), ctx());
      expect(r.ok, `score ${score} must be rejected`).toBe(false);
    }
  });

  it('rejects a score above the placement ceiling', () => {
    const placements = 10;
    const justOver = LIMITS.maxScorePerPlacement * placements + 1;
    const r = validateSubmission(
      run(),
      claim({ score: justOver, placements }),
      ctx({ now: START + placements * 1000 }),
    );
    expect(r.ok === false && r.code).toBe('ceiling');
  });

  it('rejects zero elapsed time', () => {
    const r = validateSubmission(run(), claim({ placements: 40 }), ctx({ now: START }));
    expect(r.ok === false && r.code).toBe('pacing');
  });

  it('rejects a replayed runId that was already submitted', () => {
    for (const status of ['submitted', 'rejected', 'expired'] as const) {
      const r = validateSubmission(run({ status }), claim(), ctx());
      expect(r.ok === false && r.code).toBe('state');
    }
  });

  it("rejects another user's runId", () => {
    const r = validateSubmission(run({ user_id: 'someone-else' }), claim(), ctx());
    expect(r.ok === false && r.code).toBe('ownership');
  });

  it('rejects a second daily submission on the same day', () => {
    const daily = run({ mode: 'daily', challenge_date: '2026-09-04' });
    expect(validateSubmission(daily, claim(), ctx({ hasDailyAlready: true })).ok).toBe(false);
    // The first submission of the day still goes through.
    expect(validateSubmission(daily, claim(), ctx({ hasDailyAlready: false })).ok).toBe(true);
  });

  it('rejects 21 placements on a 20-move limited run', () => {
    const limited = run({ mode: 'limited', move_limit: 20 });
    const r = validateSubmission(limited, claim({ placements: 21 }), ctx({ now: START + 60_000 }));
    expect(r.ok === false && r.code).toBe('move_limit');
    // Exactly 20 is fine.
    expect(validateSubmission(limited, claim({ placements: 20 }), ctx({ now: START + 60_000 })).ok).toBe(true);
  });

  // ── Beyond the required list ──
  it('rejects an impossible cascade depth', () => {
    const r = validateSubmission(run(), claim({ maxCascade: 999 }), ctx());
    expect(r.ok === false && r.code).toBe('cascade');
  });

  it('rejects a stale run and one that claims to start in the future', () => {
    expect(validateSubmission(run(), claim(), ctx({ now: START + 3 * 60 * 60 * 1000 })).ok).toBe(false);
    expect(validateSubmission(run(), claim(), ctx({ now: START - 1000 })).ok).toBe(false);
  });

  it('rejects once the hourly rate limit is reached', () => {
    const r = validateSubmission(run(), claim(), ctx({ submissionsLastHour: 20 }));
    expect(r.ok === false && r.code).toBe('rate_limit');
    expect(validateSubmission(run(), claim(), ctx({ submissionsLastHour: 19 })).ok).toBe(true);
  });

  it('rejects a limited run with no move limit recorded', () => {
    const r = validateSubmission(run({ mode: 'limited', move_limit: null }), claim({ placements: 5 }), ctx());
    expect(r.ok === false && r.code).toBe('move_limit');
  });

  it('rejects an implausible placement count', () => {
    const placements = LIMITS.maxPlausiblePlacements + 1;
    const r = validateSubmission(
      run(),
      claim({ score: 0, placements }),
      ctx({ now: START + placements * 300 }),
    );
    expect(r.ok === false && r.code).toBe('board_limit');
  });
});

describe('replay verification — the authoritative check', () => {
  it('accepts a truthfully reported real game', () => {
    const seed = 0xC0FFEE;
    const { state, actions } = recordRealGame(seed, 4242, 60);
    expect(actions.length).toBeGreaterThan(10);

    const r = validateSubmission(
      run({ seed }),
      { runId: 'run-1', score: state.score, placements: actions.length, maxCascade: state.stats.maxDepthThisGame, moveLog: actions },
      ctx({ now: START + actions.length * 1000 }),
    );
    expect(r.ok).toBe(true);
    expect(r.ok === true && r.verified).toBe(true);
    expect(r.ok === true && r.score).toBe(state.score);
  });

  it('rejects an inflated score that passes every heuristic', () => {
    const seed = 0xC0FFEE;
    const { state, actions } = recordRealGame(seed, 4242, 60);
    // Inflated, but still under the ceiling and paced plausibly — exactly the
    // forgery the physics checks cannot catch on their own.
    const inflated = state.score + 5000;
    expect(inflated).toBeLessThan(LIMITS.maxScorePerPlacement * actions.length);

    const withoutLog = validateSubmission(
      run({ seed }),
      { runId: 'run-1', score: inflated, placements: actions.length, maxCascade: 3 },
      ctx({ now: START + actions.length * 1000 }),
    );
    // Heuristics alone let it through — which is why the move log matters.
    expect(withoutLog.ok).toBe(true);
    expect(withoutLog.ok === true && withoutLog.verified).toBe(false);

    const withLog = validateSubmission(
      run({ seed }),
      { runId: 'run-1', score: inflated, placements: actions.length, maxCascade: 3, moveLog: actions },
      ctx({ now: START + actions.length * 1000 }),
    );
    expect(withLog.ok === false && withLog.code).toBe('replay_mismatch');
  });

  it('rejects a move log replayed against a different seed', () => {
    const seed = 0xC0FFEE;
    const { state, actions } = recordRealGame(seed, 4242, 60);
    const r = validateSubmission(
      run({ seed: seed + 1 }),
      { runId: 'run-1', score: state.score, placements: actions.length, maxCascade: 3, moveLog: actions },
      ctx({ now: START + actions.length * 1000 }),
    );
    expect(r.ok === false && r.code).toBe('replay_mismatch');
  });

  it('rejects a move log containing illegal placements', () => {
    const seed = 0xC0FFEE;
    const { actions } = recordRealGame(seed, 4242, 20);
    const tampered: GameAction[] = [...actions, { type: 'place', pieceIndex: 0, gridX: 99, gridY: 99 }];
    const r = validateSubmission(
      run({ seed }),
      { runId: 'run-1', score: 1, placements: tampered.length, maxCascade: 0, moveLog: tampered },
      ctx({ now: START + tampered.length * 1000 }),
    );
    expect(r.ok === false && r.code).toBe('replay_mismatch');
  });
});

describe('derived limits and rewards', () => {
  it('derives the ceiling from config rather than a hardcoded constant', () => {
    const l = deriveLimits();
    expect(l.maxCascadeDepth).toBe(Math.min(GAMEPLAY_CONFIG.MAX_CASCADE_DEPTH, 63));
    expect(l.maxScorePerPlacement).toBeGreaterThan(0);
    // Changing the config must move the ceiling with it.
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

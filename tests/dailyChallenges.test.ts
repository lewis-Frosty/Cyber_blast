import { describe, expect, it } from 'vitest';
import {
  DAILY_CHALLENGES,
  challengeForDate,
  configForDate,
} from '../src/config/dailyChallenges';
import { GAMEPLAY_CONFIG } from '../src/config/gameplay';
import { GameState } from '../src/core/gameState';
import { RunSession } from '../src/backend/moveLog';
import { createRng } from '../src/core/rng';
import { replay } from '../src/core/replay';
import { validateSubmission, type RunRecord } from '../src/core/validation';

/**
 * The rotation's failure mode is total, not gradual: if the config the client
 * plays under and the config the server replays under disagree by one field,
 * EVERY daily run that day is rejected as `replay_mismatch`. So the round trip
 * is tested for all fourteen, not spot-checked.
 */

/** Play a game under `config`, recording the way GameScene records. */
function playUnder(config: typeof GAMEPLAY_CONFIG, seed: number, chooserSeed: number, maxMoves: number) {
  const state = new GameState({ seed, config });
  const session = new RunSession({ runId: 'run-1', seed, mode: 'daily', moveLimit: null, challengeDate: null });
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
    if (!state.placePiece(m.t, m.r, m.c)) break;
    session.recordPlacement(m.t, m.r, m.c);
  }
  return { state, session };
}

describe('the rotation itself', () => {
  it('has fourteen entries with unique ids and names', () => {
    expect(DAILY_CHALLENGES).toHaveLength(14);
    expect(new Set(DAILY_CHALLENGES.map((c) => c.id)).size).toBe(14);
    expect(new Set(DAILY_CHALLENGES.map((c) => c.name)).size).toBe(14);
  });

  it('gives every entry a non-empty patch — a day with no twist is not a challenge', () => {
    for (const c of DAILY_CHALLENGES) {
      expect(Object.keys(c.patch).length, `${c.name} has no modifier`).toBeGreaterThan(0);
    }
  });

  it('never varies BOARD_SIZE, which the renderer holds at module scope', () => {
    for (const c of DAILY_CHALLENGES) {
      expect(c.patch.BOARD_SIZE, `${c.name} varies board size`).toBeUndefined();
    }
  });

  it('patches only fields that already exist in the config', () => {
    // A typo'd key would sit in the patch doing nothing, and the day would
    // silently play as a standard board.
    const known = new Set(Object.keys(GAMEPLAY_CONFIG));
    for (const c of DAILY_CHALLENGES) {
      for (const key of Object.keys(c.patch)) {
        expect(known.has(key), `${c.name} patches unknown key ${key}`).toBe(true);
      }
    }
  });
});

describe('date to challenge', () => {
  it('is a pure function of the date — both ends land on the same day', () => {
    expect(challengeForDate('2026-09-09')?.id).toBe(challengeForDate('2026-09-09')?.id);
  });

  it('rotates every day and repeats after exactly fourteen', () => {
    const ids: number[] = [];
    for (let d = 1; d <= 14; d += 1) {
      const iso = `2026-09-${String(d).padStart(2, '0')}`;
      ids.push(challengeForDate(iso)!.id);
    }
    expect(new Set(ids).size, 'a fortnight should cover all fourteen').toBe(14);
    expect(challengeForDate('2026-09-15')!.id).toBe(ids[0]);
  });

  it('refuses a malformed date rather than defaulting to challenge one', () => {
    expect(challengeForDate('not-a-date')).toBeNull();
    expect(challengeForDate('2026-9-9')).toBeNull();
    expect(challengeForDate('')).toBeNull();
  });

  it('falls back to the unmodified config for an unusable date', () => {
    // The safe direction: a standard board is playable and rankable, whereas
    // guessing at a modifier would desynchronise the replay.
    expect(configForDate('not-a-date')).toEqual(GAMEPLAY_CONFIG);
  });

  it('applies the patch and leaves everything else alone', () => {
    const bareHands = DAILY_CHALLENGES.find((c) => c.name === 'BARE HANDS')!;
    const date = ['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-04', '2026-09-05',
      '2026-09-06', '2026-09-07', '2026-09-08', '2026-09-09', '2026-09-10',
      '2026-09-11', '2026-09-12', '2026-09-13', '2026-09-14']
      .find((d) => challengeForDate(d)!.id === bareHands.id)!;
    const cfg = configForDate(date);
    expect(cfg.POWERUPS_ENABLED).toBe(false);
    expect(cfg.BOARD_SIZE).toBe(GAMEPLAY_CONFIG.BOARD_SIZE);
    expect(cfg.POINTS_PER_CELL_BASE).toBe(GAMEPLAY_CONFIG.POINTS_PER_CELL_BASE);
  });
});

describe('every challenge survives the play-and-replay round trip', () => {
  // If this fails for one entry, that day's dailies are all rejected.
  //
  // Several seeds per challenge, because the chooser here places uniformly at
  // random and a random bot ends a game in a median of ~13 placements (see
  // `npm run sim -- --policy=random`; the config's tuning figures come from
  // the planner policy). One seed would be a five-move game that exercises
  // almost nothing.
  const SEEDS = [0x5eed, 0xc0ffee, 12345, 999, 0xbeef, 0x1234abc];

  for (const challenge of DAILY_CHALLENGES) {
    it(`${challenge.name} replays to the same score`, () => {
      const config = { ...GAMEPLAY_CONFIG, ...challenge.patch };
      let totalMoves = 0;

      for (const seed of SEEDS) {
        const { state, session } = playUnder(config, seed, seed ^ 0x99, 200);
        totalMoves += session.moves.length;

        const truth = replay(seed, session.moves, { config });
        expect(truth.rejected, `${challenge.name} seed ${seed}: rejected a legitimate move`).toBe(0);
        expect(truth.score, `${challenge.name} seed ${seed}: score disagreed`).toBe(state.score);
        expect(truth.placements).toBe(session.moves.length);
        expect(Math.max(0, truth.maxCascade)).toBe(state.stats.maxDepthThisGame);
      }

      // Guards against a vacuous pass: a challenge whose games all end
      // immediately would satisfy every assertion above without testing it.
      expect(totalMoves, `${challenge.name} barely played`).toBeGreaterThan(40);
    });
  }
});

describe('the server derives the twist, the client cannot claim it', () => {
  const run = (challengeDate: string, startedAt: number): RunRecord => ({
    id: 'run-1',
    user_id: 'user-1',
    status: 'active',
    mode: 'daily',
    started_at: startedAt,
    seed: 0x5eed,
    challenge_date: challengeDate,
    move_limit: null,
  });

  const ctx = (config: typeof GAMEPLAY_CONFIG, now: number) => ({
    now,
    callerId: 'user-1',
    submissionsLastHour: 0,
    hasDailyAlready: false,
    config,
  });

  it('accepts a run replayed under the config its own date implies', () => {
    // Find the date whose challenge is TWO COLOURS, then play it.
    const target = DAILY_CHALLENGES.find((c) => c.name === 'TWO COLOURS')!;
    const dates = Array.from({ length: 14 }, (_, i) => `2026-09-${String(i + 1).padStart(2, '0')}`);
    const date = dates.find((d) => challengeForDate(d)!.id === target.id)!;

    const config = configForDate(date);
    expect(config.PALETTE_SIZE).toBe(2);

    const startedAt = 1_700_000_000_000;
    const { state, session } = playUnder(config, 0x5eed, 0x31337, 60);

    const result = validateSubmission(
      run(date, startedAt),
      { runId: 'run-1', moveLog: [...session.moves] },
      ctx(config, startedAt + 120_000),
    );

    expect(result.ok, result.ok ? '' : `${result.code}: ${result.reason}`).toBe(true);
    if (result.ok) expect(result.score).toBe(state.score);
  });

  it('scores a run by the day it belongs to, not the board it was played on', () => {
    // The security property, stated directly rather than hoped for: a player
    // who patches their client to a two-colour board on a standard day gets
    // the standard day's number, whatever their own replay would say.
    const softConfig = { ...GAMEPLAY_CONFIG, PALETTE_SIZE: 2 };
    const honestConfig = configForDate('2026-09-09');
    const startedAt = 1_700_000_000_000;
    const seed = 0x5eed;

    const { session } = playUnder(softConfig, seed, 0x31337, 200);

    const result = validateSubmission(
      run('2026-09-09', startedAt),
      { runId: 'run-1', moveLog: [...session.moves] },
      ctx(honestConfig, startedAt + 120_000),
    );

    if (result.ok) {
      // Whatever number came back, it is the one the SERVER's config produces.
      const serverTruth = replay(seed, session.moves, { config: honestConfig });
      expect(result.score).toBe(serverTruth.score);
    }
    // A rejection is equally correct — the soft board's moves may simply be
    // illegal on the real one. What must never happen is the soft score being
    // banked, which the assertion above rules out.
  });
});

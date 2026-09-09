import { describe, expect, it } from 'vitest';
import { streakIsLive } from '../src/backend/profile';
import { allProgress } from '../src/progress/achievements';

/**
 * The stored `daily_streak_current` is only refreshed when a daily run is
 * submitted, so it goes stale the moment a player misses a day. This is the
 * check that keeps the dashboard honest without a nightly job.
 */
describe('is a daily streak still running', () => {
  const today = new Date('2026-09-09T12:00:00Z');

  it('counts a streak that reaches today', () => {
    expect(streakIsLive('2026-09-09', today)).toBe(true);
  });

  it('counts a streak that reaches yesterday — the day is not over', () => {
    expect(streakIsLive('2026-09-08', today)).toBe(true);
  });

  it('drops a streak that stops two days ago', () => {
    expect(streakIsLive('2026-09-07', today)).toBe(false);
  });

  it('is unaffected by the time of day', () => {
    expect(streakIsLive('2026-09-08', new Date('2026-09-09T00:00:01Z'))).toBe(true);
    expect(streakIsLive('2026-09-08', new Date('2026-09-09T23:59:59Z'))).toBe(true);
  });

  it('handles a month boundary', () => {
    expect(streakIsLive('2026-08-31', new Date('2026-09-01T09:00:00Z'))).toBe(true);
    expect(streakIsLive('2026-08-30', new Date('2026-09-01T09:00:00Z'))).toBe(false);
  });

  it('treats a missing or unusable date as no streak', () => {
    expect(streakIsLive(null, today)).toBe(false);
    expect(streakIsLive('not-a-date', today)).toBe(false);
  });
});

describe('the daily ladder is measured now that the Daily Challenge has shipped', () => {
  it('no longer reports itself as untracked', () => {
    const daily = allProgress({ gamesPlayed: 0, bestChain: 0, dailyStreak: 0, bestClearStreak: 0 })
      .find((p) => p.ladder.id === 'daily');
    expect(daily, 'the daily ladder disappeared').toBeDefined();
    expect(daily!.ladder.tracked, 'still claims the Daily Challenge has not shipped').toBe(true);
  });

  it('awards rungs from a real streak', () => {
    const daily = allProgress({ gamesPlayed: 0, bestChain: 0, dailyStreak: 12, bestClearStreak: 0 })
      .find((p) => p.ladder.id === 'daily')!;
    expect(daily.earned?.name).toBe('10 days');
  });
});

describe('no ladder rung reads as a league tier', () => {
  it('has retired the Bronze / Silver / Gold names', () => {
    // The player page said "Bronze" while the league page said "SPARK", which
    // read as two different answers to the same question.
    const metals = ['bronze', 'silver', 'gold', 'platinum', 'diamond'];
    const progress = allProgress({ gamesPlayed: 0, bestChain: 0, dailyStreak: 0, bestClearStreak: 0 });
    for (const p of progress) {
      for (const tier of p.ladder.tiers) {
        expect(metals, `${p.ladder.name} rung "${tier.name}"`).not.toContain(tier.name.toLowerCase());
      }
    }
  });
});

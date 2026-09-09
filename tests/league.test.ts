import { describe, expect, it } from 'vitest';
import { daysLeft, moversFor, tierName } from '../src/backend/league';

/**
 * `moversFor` is a duplicate of `close_season()`'s `least(7, n / 4)`. It is
 * duplicated because the UI has to draw the promotion and relegation lines
 * before the season ends, and a line in the wrong place is worse than none.
 *
 * These cases are the same ones asserted against the real database in
 * supabase/tests/league_rollover.sql. If one side changes, both must.
 */
describe('league cut lines', () => {
  it('matches the SQL rule at the sizes the rollover suite asserts', () => {
    expect(moversFor(30)).toBe(7); // the spec's full group: 7 up, 7 down, 16 stay
    expect(moversFor(10)).toBe(2);
    expect(moversFor(8)).toBe(2);
    expect(moversFor(4)).toBe(1);
    expect(moversFor(3)).toBe(0); // too small to move anyone
  });

  it('caps at seven however large the group', () => {
    expect(moversFor(28)).toBe(7);
    expect(moversFor(100)).toBe(7);
  });

  it('never lets the promotion and relegation zones overlap', () => {
    // 2 * (n/4) <= n/2 for every n, which is what makes the two sets disjoint.
    for (let n = 0; n <= 60; n += 1) {
      expect(moversFor(n) * 2).toBeLessThanOrEqual(n);
    }
  });

  it('moves nobody in an empty or single-player group', () => {
    expect(moversFor(0)).toBe(0);
    expect(moversFor(1)).toBe(0);
    expect(moversFor(-5)).toBe(0);
  });
});

describe('season countdown', () => {
  it('counts today as a day left', () => {
    expect(daysLeft('2026-01-11', new Date('2026-01-11T09:00:00Z'))).toBe(1);
  });

  it('counts whole days to the end of the last day', () => {
    expect(daysLeft('2026-01-11', new Date('2026-01-05T00:00:00Z'))).toBe(7);
  });

  it('never goes negative once the season has passed', () => {
    expect(daysLeft('2026-01-11', new Date('2026-01-20T00:00:00Z'))).toBe(0);
  });

  it('returns null when the end date is missing or unusable', () => {
    expect(daysLeft(null)).toBeNull();
    expect(daysLeft('not-a-date')).toBeNull();
  });
});

describe('tier names', () => {
  it('names all five tiers', () => {
    expect([1, 2, 3, 4, 5].map(tierName)).toEqual(['SPARK', 'PULSE', 'SURGE', 'NOVA', 'SINGULARITY']);
  });

  it('clamps out-of-range tiers rather than showing undefined', () => {
    expect(tierName(0)).toBe('SPARK');
    expect(tierName(9)).toBe('SINGULARITY');
  });
});

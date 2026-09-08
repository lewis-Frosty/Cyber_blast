import { describe, expect, it } from 'vitest';
import { msUntilTomorrow, todayUtc } from '../src/backend/daily';
import { shareText } from '../src/backend/share';

/**
 * The daily challenge promises one thing: everyone played the same board.
 * That promise is a UTC-date promise. A local-midnight boundary would hand two
 * players in different timezones different "todays" and quietly break it.
 */
describe('daily challenge day boundary', () => {
  it('uses the UTC date, not the local one', () => {
    // 11:30am in Auckland (UTC+13) on the 9th is still the 8th in UTC.
    expect(todayUtc(new Date('2026-09-08T22:30:00Z'))).toBe('2026-09-08');
    expect(todayUtc(new Date('2026-09-09T00:00:00Z'))).toBe('2026-09-09');
  });

  it('rolls over exactly at UTC midnight', () => {
    expect(todayUtc(new Date('2026-09-08T23:59:59Z'))).toBe('2026-09-08');
    expect(todayUtc(new Date('2026-09-09T00:00:01Z'))).toBe('2026-09-09');
  });

  it('counts down to the next UTC midnight', () => {
    expect(msUntilTomorrow(new Date('2026-09-08T23:00:00Z'))).toBe(3600_000);
    expect(msUntilTomorrow(new Date('2026-09-08T00:00:00Z'))).toBe(86_400_000);
  });

  it('never reports a negative or zero countdown', () => {
    for (const h of [0, 1, 12, 23]) {
      const t = new Date(`2026-09-08T${String(h).padStart(2, '0')}:30:00Z`);
      expect(msUntilTomorrow(t)).toBeGreaterThan(0);
      expect(msUntilTomorrow(t)).toBeLessThanOrEqual(86_400_000);
    }
  });

  it('handles a month and year boundary', () => {
    expect(todayUtc(new Date('2026-12-31T23:59:00Z'))).toBe('2026-12-31');
    expect(todayUtc(new Date('2027-01-01T00:01:00Z'))).toBe('2027-01-01');
    expect(msUntilTomorrow(new Date('2026-12-31T23:00:00Z'))).toBe(3600_000);
  });
});

describe('share card', () => {
  it('quotes the chain the way the game shows it', () => {
    // maxDepth is a generation index; the game displays it as depth + 1.
    const text = shareText({ mode: 'endless', score: 8421, maxChain: 7, placements: 97, url: 'https://x' });
    expect(text).toContain('chain ×8');
    expect(text).toContain('8,421');
  });

  it('names the date for a daily card and omits rank when unranked', () => {
    const text = shareText({ mode: 'daily', date: '2026-09-08', score: 100, maxChain: 0, placements: 3, url: 'https://x' });
    expect(text).toContain('Daily 2026-09-08');
    expect(text).not.toContain('Rank');
  });

  it('includes rank only when both rank and total are known', () => {
    const withRank = shareText({
      mode: 'daily', date: '2026-09-08', score: 100, maxChain: 1, placements: 3,
      rank: 3, totalPlayers: 128, url: 'https://x',
    });
    expect(withRank).toContain('Rank 3 of 128');

    const partial = shareText({
      mode: 'endless', score: 100, maxChain: 1, placements: 3,
      rank: 3, totalPlayers: null, url: 'https://x',
    });
    expect(partial).not.toContain('Rank');
  });
});

import { describe, expect, it } from 'vitest';
import { weekStart } from '../src/backend/leaderboard';

/**
 * The weekly board's window. UTC on purpose: every player must roll over at
 * the same instant, or "this week" means something different per timezone and
 * two players comparing boards see different tables.
 */
describe('weekly board window', () => {
  it('starts on Monday 00:00 UTC', () => {
    const wed = new Date('2026-09-09T13:45:00Z'); // a Wednesday
    const start = weekStart(wed);
    expect(start.toISOString()).toBe('2026-09-07T00:00:00.000Z');
    expect(start.getUTCDay()).toBe(1);
  });

  it('treats Sunday as the END of the week, not the start', () => {
    // getUTCDay() returns 0 for Sunday; a naive implementation rolls the week
    // forward a day here and silently drops Sunday's scores.
    const sunday = new Date('2026-09-13T23:59:00Z');
    expect(weekStart(sunday).toISOString()).toBe('2026-09-07T00:00:00.000Z');
  });

  it('puts every day of one week in the same bucket', () => {
    const monday = new Date('2026-09-07T00:00:00Z');
    const buckets = new Set<string>();
    for (let i = 0; i < 7; i++) {
      buckets.add(weekStart(new Date(monday.getTime() + i * 86400000)).toISOString());
    }
    expect(buckets.size).toBe(1);
  });

  it('rolls over to a new bucket the following Monday', () => {
    const thisWeek = weekStart(new Date('2026-09-09T00:00:00Z')).toISOString();
    const nextWeek = weekStart(new Date('2026-09-14T00:00:01Z')).toISOString();
    expect(nextWeek).not.toBe(thisWeek);
    expect(nextWeek).toBe('2026-09-14T00:00:00.000Z');
  });
});

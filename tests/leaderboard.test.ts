import { describe, expect, it } from 'vitest';
import { isoWeekId, mergeEntry, msUntilWeekEnd, sanitiseName, type ScoreEntry } from '../src/leaderboard/types';

const entry = (name: string, score: number, ts = 0, id = `${name}:${score}:${ts}`): ScoreEntry => ({
  id,
  name,
  score,
  placements: 1,
  maxChain: 0,
  ts,
});

describe('weekly bucketing', () => {
  it('formats an ISO week id in UTC', () => {
    expect(isoWeekId(new Date('2026-09-03T12:00:00Z'))).toBe('2026-W36');
    expect(isoWeekId(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01');
  });

  it('puts every day of one UTC week in the same bucket', () => {
    const monday = new Date('2026-08-31T00:00:00Z');
    const ids = new Set<string>();
    for (let i = 0; i < 7; i++) ids.add(isoWeekId(new Date(monday.getTime() + i * 86400000)));
    expect(ids.size).toBe(1);
    expect(isoWeekId(new Date(monday.getTime() + 7 * 86400000))).not.toBe([...ids][0]);
  });

  it('counts down to the Monday rollover', () => {
    expect(msUntilWeekEnd(new Date('2026-09-03T00:00:00Z'))).toBe(4 * 86400000);
    expect(msUntilWeekEnd(new Date('2026-09-06T23:00:00Z'))).toBe(3600000);
  });
});

describe('score table', () => {
  it('sorts best first and breaks ties by who posted first', () => {
    const rows = mergeEntry([entry('A', 100, 5), entry('B', 300, 1)], entry('C', 100, 2));
    expect(rows.map((r) => r.name)).toEqual(['B', 'C', 'A']);
  });

  it('caps the table so one document can hold a whole week', () => {
    let rows: ScoreEntry[] = [];
    for (let i = 0; i < 80; i++) rows = mergeEntry(rows, entry(`P${i}`, i), 50);
    expect(rows).toHaveLength(50);
    expect(rows[0]!.score).toBe(79);
    expect(rows[49]!.score).toBe(30);
  });

  it('sanitises names to arcade-safe characters', () => {
    expect(sanitiseName('  lewis  ')).toBe('LEWIS');
    // Markup characters are stripped, then the 12-char cap applies.
    expect(sanitiseName('<script>alert(1)</script>')).toBe('SCRIPTALERT1');
    expect(sanitiseName('a<b>c')).toBe('ABC');
    expect(sanitiseName('')).toBe('ANON');
    expect(sanitiseName('!!!')).toBe('ANON');
    expect(sanitiseName('ABCDEFGHIJKLMNOP')).toHaveLength(12);
  });
});

describe('re-posting a run under a new name', () => {
  it('updates the existing row instead of adding a second one', () => {
    const rows = mergeEntry([], entry('LEWIS', 900, 1, 'run-a'), 50);
    const renamed = mergeEntry(rows, entry('FROSTY', 900, 1, 'run-a'), 50);
    expect(renamed).toHaveLength(1);
    expect(renamed[0]?.name).toBe('FROSTY');
  });

  it('still keeps two genuinely different runs', () => {
    const rows = mergeEntry([], entry('LEWIS', 900, 1, 'run-a'), 50);
    const both = mergeEntry(rows, entry('LEWIS', 700, 2, 'run-b'), 50);
    expect(both).toHaveLength(2);
  });
});

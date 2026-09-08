import { describe, expect, it } from 'vitest';
import { LADDERS, allProgress, progressFor, type PlayerTotals } from '../src/progress/achievements';

const totals = (over: Partial<PlayerTotals> = {}): PlayerTotals => ({
  gamesPlayed: 0,
  bestChain: 0,
  dailyStreak: 0,
  bestClearStreak: 0,
  ...over,
});

describe('achievement ladders', () => {
  it('has the four ladders the dashboard promises', () => {
    expect(LADDERS.map((l) => l.id)).toEqual(['league', 'chain', 'daily', 'streak']);
  });

  it('marks the two ladders nothing feeds yet as untracked', () => {
    // A dashboard showing "0 / 5" for something nobody counts reports a failure
    // the player never had the chance to avoid.
    const untracked = LADDERS.filter((l) => !l.tracked).map((l) => l.id);
    expect(untracked).toEqual(['daily', 'streak']);
    for (const l of LADDERS.filter((x) => !x.tracked)) {
      expect(l.pending, `${l.id} must explain why it is empty`).toBeTruthy();
    }
  });

  it('earns nothing before the first tier', () => {
    const p = progressFor(LADDERS[1]!, totals({ bestChain: 4 }));
    expect(p.earned).toBeNull();
    expect(p.next?.at).toBe(5);
    expect(p.fraction).toBeCloseTo(4 / 5);
  });

  it('measures the bar from the tier just earned, not from zero', () => {
    // Chain ladder: ×5 earned, working toward ×10. A value of 5 is 0% of the
    // way to ×10 — measuring from zero would show it as half full.
    const justEarned = progressFor(LADDERS[1]!, totals({ bestChain: 5 }));
    expect(justEarned.earned?.name).toBe('×5');
    expect(justEarned.next?.name).toBe('×10');
    expect(justEarned.fraction).toBe(0);

    const halfway = progressFor(LADDERS[1]!, totals({ bestChain: 7 }));
    expect(halfway.fraction).toBeCloseTo(2 / 5);
  });

  it('completes at the top tier and stops asking for more', () => {
    const p = progressFor(LADDERS[1]!, totals({ bestChain: 30 }));
    expect(p.earned?.name).toBe('×30');
    expect(p.next).toBeNull();
    expect(p.fraction).toBe(1);
  });

  it('keeps the top tier when the value exceeds it', () => {
    const p = progressFor(LADDERS[0]!, totals({ gamesPlayed: 9999 }));
    expect(p.earned?.name).toBe('Diamond');
    expect(p.next).toBeNull();
  });

  it('reads the right stat for each ladder', () => {
    const p = allProgress(totals({ gamesPlayed: 12, bestChain: 16, dailyStreak: 6, bestClearStreak: 4 }));
    expect(p.find((x) => x.ladder.id === 'league')?.earned?.name).toBe('Silver');
    expect(p.find((x) => x.ladder.id === 'chain')?.earned?.name).toBe('×15');
    expect(p.find((x) => x.ladder.id === 'daily')?.earned?.name).toBe('5 days');
    expect(p.find((x) => x.ladder.id === 'streak')?.earned?.name).toBe('3 in a row');
  });

  it('never returns a fraction outside 0..1', () => {
    for (const l of LADDERS) {
      for (const v of [-5, 0, 1, 7, 99, 100000]) {
        const p = progressFor(l, totals({ gamesPlayed: v, bestChain: v, dailyStreak: v, bestClearStreak: v }));
        expect(p.fraction).toBeGreaterThanOrEqual(0);
        expect(p.fraction).toBeLessThanOrEqual(1);
      }
    }
  });
});

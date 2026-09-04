/** One posted run. */
export interface ScoreEntry {
  /**
   * Stable per-run id. Runs post automatically now, so a player who then
   * changes their name must update the row they already posted rather than
   * adding a second one for the same game.
   */
  id: string;
  /** Player initials / short name, already sanitised and upper-cased. */
  name: string;
  score: number;
  placements: number;
  /** Deepest cascade generation reached in the run. */
  maxChain: number;
  /** Epoch ms the run was posted. */
  ts: number;
}

export interface Leaderboard {
  /** 'shared' means other players can see it; 'local' is this browser only. */
  readonly kind: 'shared' | 'local';
  /** Post a run. Resolves once stored; rejects only on a real failure. */
  submit(week: string, entry: ScoreEntry): Promise<void>;
  /** Highest scores for a week, best first. */
  top(week: string, limit: number): Promise<ScoreEntry[]>;
}

/** Keep the stored table small — one document per week holds this many rows. */
export const MAX_TABLE_ROWS = 50;

/**
 * ISO-8601 week identifier in UTC, e.g. "2026-W36". UTC so every player lands
 * in the same week regardless of timezone, and weeks roll over Monday 00:00 UTC.
 */
export function isoWeekId(date: Date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  // Thursday of this week determines the ISO year.
  const day = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - day);
  const year = d.getUTCFullYear();
  const jan1 = new Date(Date.UTC(year, 0, 1));
  const week = Math.ceil(((d.getTime() - jan1.getTime()) / 86400000 + 1) / 7);
  return `${year}-W${String(week).padStart(2, '0')}`;
}

/** Milliseconds until the current UTC week rolls over. */
export function msUntilWeekEnd(now: Date = new Date()): number {
  const d = new Date(now.getTime());
  const day = d.getUTCDay() || 7; // Monday = 1
  const daysLeft = 7 - day;
  const end = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + daysLeft + 1, 0, 0, 0);
  return end - now.getTime();
}

/** Trim to at most 12 A–Z/0–9 characters; empty input becomes a house name. */
export function sanitiseName(raw: string): string {
  const cleaned = raw
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, '')
    .trim()
    .slice(0, 12);
  return cleaned.length > 0 ? cleaned : 'ANON';
}

/**
 * Merge a new entry into a table: best first, capped, one row per run.
 * An entry whose id is already present REPLACES it, so re-posting the same run
 * (after a name change) updates that row instead of duplicating the score.
 */
export function mergeEntry(rows: readonly ScoreEntry[], entry: ScoreEntry, max = MAX_TABLE_ROWS): ScoreEntry[] {
  const without = rows.filter((r) => r.id !== entry.id);
  return [...without, entry].sort((a, b) => b.score - a.score || a.ts - b.ts).slice(0, max);
}

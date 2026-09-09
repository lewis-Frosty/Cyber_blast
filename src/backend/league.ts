import { ensureSession, getSupabase } from './supabase';

/**
 * The weekly league, read through `get_my_league()` (migration 0011).
 *
 * A league is thirty players at one tier racing for a week. Points are the SUM
 * of each day's best run, so the standings reward showing up rather than one
 * lucky game — and the function returns the caller's own group only, because a
 * global dump is exactly the demotivating all-time board leagues replace.
 */

export interface LeagueRow {
  rank: number;
  name: string;
  avatarId: string | null;
  country: string | null;
  points: number;
  isMe: boolean;
}

export interface LeagueStanding {
  tier: number;
  rows: LeagueRow[];
  groupSize: number;
  /** ISO date the season ends (inclusive), or null when unknown. */
  seasonEnds: string | null;
}

/** Tier names, low to high. Index 0 is unused so tier N reads as NAMES[N]. */
export const TIER_NAMES: readonly string[] = ['', 'SPARK', 'PULSE', 'SURGE', 'NOVA', 'SINGULARITY'];

export function tierName(tier: number): string {
  return TIER_NAMES[Math.min(Math.max(tier, 1), 5)] ?? 'SPARK';
}

/**
 * How many players promote and relegate in a group of `size`.
 *
 * Mirrors `close_season()`'s `least(7, n / 4)` exactly. Duplicated here rather
 * than fetched because the UI has to draw the cut lines before the season ends,
 * and a wrong line is worse than no line: the two must not drift, so any change
 * to the SQL rule has to change this function in the same commit.
 */
export function moversFor(size: number): number {
  return Math.min(7, Math.floor(Math.max(0, size) / 4));
}

/** Whole days left in the season, counting today as one. Never negative. */
export function daysLeft(seasonEnds: string | null, now: Date = new Date()): number | null {
  if (!seasonEnds) return null;
  const end = Date.parse(`${seasonEnds}T23:59:59Z`);
  if (Number.isNaN(end)) return null;
  return Math.max(0, Math.ceil((end - now.getTime()) / 86_400_000));
}

/**
 * The caller's standings. Resolves to null rather than throwing — a league
 * that cannot load must not take the game down with it, and a player who has
 * not submitted a run this season legitimately has no group yet.
 */
export async function fetchMyLeague(): Promise<LeagueStanding | null> {
  const supabase = getSupabase();
  if (!supabase) return null;
  // `is_me` and the group itself come from auth.uid(); without a session the
  // function returns nothing at all.
  const session = await ensureSession();
  if (!session) return null;

  const { data, error } = await supabase.rpc('get_my_league');
  if (error || !Array.isArray(data) || data.length === 0) {
    if (error) console.warn('[cyber-blast] league unavailable:', error.message);
    return null;
  }

  // Rows describe other players. Treat every field as untrusted input.
  const rows: LeagueRow[] = data.map((r: Record<string, unknown>) => ({
    rank: Math.max(1, Math.floor(Number(r['rank'] ?? 0))),
    name:
      typeof r['display_name'] === 'string' && r['display_name']
        ? String(r['display_name']).slice(0, 12)
        : 'ANON',
    avatarId: typeof r['avatar_id'] === 'string' ? r['avatar_id'] : null,
    country: typeof r['country_code'] === 'string' ? r['country_code'] : null,
    points: Math.max(0, Math.floor(Number(r['points'] ?? 0))),
    isMe: r['is_me'] === true,
  }));

  const first = data[0] as Record<string, unknown>;
  const tier = Math.min(5, Math.max(1, Math.floor(Number(first['tier'] ?? 1))));
  // group_size is the true membership count; rows are capped at 30 for display.
  const groupSize = Math.max(rows.length, Math.floor(Number(first['group_size'] ?? rows.length)));
  const seasonEnds = typeof first['season_ends'] === 'string' ? first['season_ends'] : null;

  return { tier, rows, groupSize, seasonEnds };
}

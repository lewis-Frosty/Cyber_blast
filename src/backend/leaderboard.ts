import { ensureSession, getSupabase } from './supabase';
import { todayUtc } from './daily';

/**
 * The real leaderboard, read through the SECURITY DEFINER functions in
 * migration 0007.
 *
 * The board the game showed until now lived in the player's own browser, so
 * every player was alone at the top of it. These queries read the scores the
 * server verified.
 */

export type BoardScope = 'global' | 'country' | 'weekly' | 'daily';

export interface BoardRow {
  rank: number;
  name: string;
  avatarId: string | null;
  country: string | null;
  score: number;
  maxChain: number;
  placements: number;
  isMe: boolean;
}

export interface MyRank {
  rank: number;
  score: number;
  maxChain: number;
  totalPlayers: number;
}

/** Monday 00:00 UTC of the current ISO week — the weekly board's window. */
export function weekStart(now: Date = new Date()): Date {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const day = d.getUTCDay() || 7; // Monday = 1 … Sunday = 7
  d.setUTCDate(d.getUTCDate() - (day - 1));
  return d;
}

interface Filters {
  mode: 'endless' | 'daily';
  since: string | null;
  country: string | null;
  date: string | null;
}

function filtersFor(scope: BoardScope, country: string | null): Filters {
  switch (scope) {
    case 'weekly':
      return { mode: 'endless', since: weekStart().toISOString(), country: null, date: null };
    case 'country':
      return { mode: 'endless', since: null, country, date: null };
    case 'global':
      return { mode: 'endless', since: null, country: null, date: null };
    case 'daily':
      // A run's daily identity is its challenge_date, not a time window: the
      // board must rank today's board, not everything submitted since midnight.
      return { mode: 'daily', since: null, country: null, date: todayUtc() };
  }
}

/**
 * Top rows for a scope. Resolves to an empty list rather than throwing — a
 * board that cannot load must not take the game down with it.
 */
export async function fetchBoard(
  scope: BoardScope,
  country: string | null,
  limit = 50,
): Promise<BoardRow[]> {
  const supabase = getSupabase();
  if (!supabase) return [];
  // The `is_me` flag is computed from auth.uid(), so the session has to exist
  // before the query or every row comes back as someone else's.
  await ensureSession();

  const { mode, since, country: filterCountry, date } = filtersFor(scope, country);
  if (scope === 'country' && !filterCountry) return [];

  const { data, error } = await supabase.rpc('get_leaderboard', {
    p_mode: mode,
    p_since: since,
    p_country: filterCountry,
    p_limit: limit,
    p_date: date,
  });
  if (error || !Array.isArray(data)) {
    console.warn('[cyber-blast] leaderboard unavailable:', error?.message);
    return [];
  }

  // Rows describe other players. Treat every field as untrusted input.
  return data.map((r: Record<string, unknown>) => ({
    rank: Number(r['rank'] ?? 0),
    name: typeof r['display_name'] === 'string' && r['display_name'] ? String(r['display_name']).slice(0, 12) : 'ANON',
    avatarId: typeof r['avatar_id'] === 'string' ? r['avatar_id'] : null,
    country: typeof r['country_code'] === 'string' ? r['country_code'] : null,
    score: Math.max(0, Math.floor(Number(r['score'] ?? 0))),
    maxChain: Math.max(0, Math.floor(Number(r['max_cascade'] ?? 0))),
    placements: Math.max(0, Math.floor(Number(r['placements'] ?? 0))),
    isMe: r['is_me'] === true,
  }));
}

/** The player's own standing, which matters most when they are not in the top N. */
export async function fetchMyRank(scope: BoardScope, country: string | null): Promise<MyRank | null> {
  const supabase = getSupabase();
  const session = await ensureSession();
  if (!supabase || !session) return null;

  const { mode, since, country: filterCountry, date } = filtersFor(scope, country);
  if (scope === 'country' && !filterCountry) return null;

  const { data, error } = await supabase.rpc('get_my_rank', {
    p_mode: mode,
    p_since: since,
    p_country: filterCountry,
    p_date: date,
  });
  if (error || !Array.isArray(data) || data.length === 0) return null;

  const r = data[0] as Record<string, unknown>;
  return {
    rank: Number(r['rank'] ?? 0),
    score: Number(r['score'] ?? 0),
    maxChain: Number(r['max_cascade'] ?? 0),
    totalPlayers: Number(r['total_players'] ?? 0),
  };
}

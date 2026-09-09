import { ensureSession, getSupabase } from './supabase';

/**
 * The player's profile — name, avatar, country — and the totals the dashboard
 * reads.
 *
 * Until now the name lived only in browser storage, so `profiles.display_name`
 * stayed null and the leaderboard had nothing to label a row with. This is the
 * write path that was missing.
 *
 * Everything degrades to a local-only profile when the backend is unreachable,
 * because the game must stay playable offline.
 */

export interface PlayerProfile {
  displayName: string;
  avatarId: string;
  countryCode: string | null;
}

export interface PlayerTotalsRow {
  gamesPlayed: number;
  bestScore: number;
  bestChain: number;
  bestClearStreak: number;
  /** Best streak ever reached. */
  dailyStreak: number;
  /** The streak running right now — 0 once a day has been missed. */
  dailyStreakCurrent: number;
  xp: number;
  currency: number;
}

export const DEFAULT_AVATAR = 'circuit';

const NAME_KEY = 'cyber-blast.playerName';
const AVATAR_KEY = 'cyber-blast.avatarId';
const COUNTRY_KEY = 'cyber-blast.countryCode';

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocal(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — the value just isn't remembered */
  }
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
 * Guess the player's country from the browser, so country ranking costs them
 * no setup at all. It is a guess and the dashboard lets them change it — the
 * point is that a frictionless default beats an empty field nobody fills in.
 */
export function guessCountry(): string | null {
  try {
    const tags = [
      ...(Array.isArray(navigator.languages) ? navigator.languages : []),
      navigator.language,
    ].filter((t): t is string => typeof t === 'string' && t.length > 0);
    for (const tag of tags) {
      // "en-NZ" -> "NZ". Intl.Locale also resolves "en-Latn-NZ" correctly.
      const region = new Intl.Locale(tag).region;
      if (region && /^[A-Z]{2}$/.test(region)) return region;
    }
  } catch {
    /* Intl.Locale unsupported or a malformed tag — fall through */
  }
  return null;
}

/** The profile as this browser knows it, without touching the network. */
export function localProfile(): PlayerProfile {
  return {
    displayName: sanitiseName(readLocal(NAME_KEY) ?? ''),
    avatarId: readLocal(AVATAR_KEY) ?? DEFAULT_AVATAR,
    countryCode: readLocal(COUNTRY_KEY) ?? guessCountry(),
  };
}

/**
 * Write the profile to the database and remember it locally.
 *
 * Returns false when it could only be saved locally, so the caller can say so
 * rather than implying the change reached the leaderboard.
 */
export async function saveProfile(profile: PlayerProfile): Promise<boolean> {
  writeLocal(NAME_KEY, profile.displayName);
  writeLocal(AVATAR_KEY, profile.avatarId);
  if (profile.countryCode) writeLocal(COUNTRY_KEY, profile.countryCode);

  const supabase = getSupabase();
  const session = await ensureSession();
  if (!supabase || !session) return false;

  const { error } = await supabase
    .from('profiles')
    .update({
      display_name: profile.displayName,
      avatar_id: profile.avatarId,
      country_code: profile.countryCode,
    })
    .eq('id', session.userId);

  if (error) {
    console.warn('[cyber-blast] could not save profile:', error.message);
    return false;
  }
  return true;
}

/**
 * Load the profile from the database, falling back to the local copy.
 *
 * A row with no display_name yet is a first launch: the local name is pushed
 * up so the player's very first score already has a label on the board.
 */
export async function loadProfile(): Promise<PlayerProfile> {
  const local = localProfile();
  const supabase = getSupabase();
  const session = await ensureSession();
  if (!supabase || !session) return local;

  const { data, error } = await supabase
    .from('profiles')
    .select('display_name, avatar_id, country_code')
    .eq('id', session.userId)
    .maybeSingle();

  if (error || !data) return local;

  if (!data.display_name) {
    const seeded: PlayerProfile = { ...local };
    void saveProfile(seeded);
    return seeded;
  }

  const remote: PlayerProfile = {
    displayName: sanitiseName(String(data.display_name)),
    avatarId: typeof data.avatar_id === 'string' ? data.avatar_id : DEFAULT_AVATAR,
    countryCode: typeof data.country_code === 'string' ? data.country_code : local.countryCode,
  };
  writeLocal(NAME_KEY, remote.displayName);
  writeLocal(AVATAR_KEY, remote.avatarId);
  if (remote.countryCode) writeLocal(COUNTRY_KEY, remote.countryCode);
  return remote;
}

/** The dashboard's numbers. Null when the backend is unreachable. */
export async function loadTotals(): Promise<PlayerTotalsRow | null> {
  const supabase = getSupabase();
  const session = await ensureSession();
  if (!supabase || !session) return null;

  const [stats, wallet] = await Promise.all([
    supabase
      .from('player_stats')
      // One string literal: supabase-js infers the row type from it, and a
      // concatenation defeats that and silently degrades every field to never.
      .select('games_played, best_score, best_chain, best_clear_streak, daily_streak_best, daily_streak_current, daily_streak_last')
      .eq('user_id', session.userId)
      .maybeSingle(),
    supabase.from('player_wallet').select('xp, currency').eq('user_id', session.userId).maybeSingle(),
  ]);

  if (stats.error || !stats.data) return null;
  const s = stats.data;
  return {
    gamesPlayed: Number(s.games_played ?? 0),
    bestScore: Number(s.best_score ?? 0),
    bestChain: Number(s.best_chain ?? 0),
    bestClearStreak: Number(s.best_clear_streak ?? 0),
    dailyStreak: Number(s.daily_streak_best ?? 0),
    // The stored current streak is only refreshed when the player plays a
    // daily, so it goes stale the moment they miss a day. Rather than run a
    // nightly job to zero it, check the date it reaches: a streak that does
    // not reach yesterday is over.
    dailyStreakCurrent: streakIsLive(s.daily_streak_last as string | null)
      ? Number(s.daily_streak_current ?? 0)
      : 0,
    xp: Number(wallet.data?.xp ?? 0),
    currency: Number(wallet.data?.currency ?? 0),
  };
}

/**
 * True if a streak whose last day is `lastIso` is still running: it must reach
 * today or yesterday. Yesterday still counts — the player has not missed a day
 * until today ends.
 */
export function streakIsLive(lastIso: string | null, today: Date = new Date()): boolean {
  if (!lastIso) return false;
  const last = Date.parse(`${lastIso}T00:00:00Z`);
  if (Number.isNaN(last)) return false;
  const todayUtcMs = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  const daysAgo = Math.round((todayUtcMs - last) / 86_400_000);
  return daysAgo <= 1;
}

/** The 12 avatars, read from the catalogue the database already seeds. */
export async function loadAvatars(): Promise<Array<{ id: string; name: string }>> {
  const supabase = getSupabase();
  if (!supabase) return [{ id: DEFAULT_AVATAR, name: 'Circuit' }];
  const { data, error } = await supabase.from('avatars').select('id, name').order('sort_order');
  if (error || !data || data.length === 0) return [{ id: DEFAULT_AVATAR, name: 'Circuit' }];
  return data.map((a) => ({ id: String(a.id), name: String(a.name) }));
}

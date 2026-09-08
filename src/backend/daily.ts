import { ensureSession, getSupabase } from './supabase';

/**
 * Daily Challenge state — backend spec §6.1.
 *
 * The seed and the one-attempt rule already live on the server: start-run
 * hands every player the same seed for a given date, and the validation chain
 * refuses a second submission for a date already played. This module only
 * answers the question the UI needs: has today been played, and how did it go?
 *
 * The day is UTC, matching the server exactly. A local-midnight boundary would
 * hand two players in different timezones different "todays" and quietly break
 * the one thing the daily challenge promises — that everyone played the same
 * board.
 */

export interface DailyState {
  /** UTC date, YYYY-MM-DD. */
  date: string;
  played: boolean;
  score: number | null;
  maxChain: number | null;
}

export function todayUtc(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** Milliseconds until the next UTC midnight, for the "resets in" countdown. */
export function msUntilTomorrow(now: Date = new Date()): number {
  const next = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return next - now.getTime();
}

/**
 * Has the player already submitted today's challenge?
 *
 * Returns played:false when the backend is unreachable — offering the run and
 * having the server refuse it is a better failure than hiding the mode because
 * a network call failed.
 */
export async function fetchDailyState(): Promise<DailyState> {
  const date = todayUtc();
  const supabase = getSupabase();
  const session = await ensureSession();
  if (!supabase || !session) return { date, played: false, score: null, maxChain: null };

  const { data, error } = await supabase
    .from('runs')
    .select('score, max_cascade')
    .eq('user_id', session.userId)
    .eq('mode', 'daily')
    .eq('challenge_date', date)
    .eq('status', 'submitted')
    .order('score', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error || !data) return { date, played: false, score: null, maxChain: null };
  return {
    date,
    played: true,
    score: Number(data.score ?? 0),
    maxChain: Number(data.max_cascade ?? 0),
  };
}

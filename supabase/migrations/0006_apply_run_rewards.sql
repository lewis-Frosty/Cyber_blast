-- Phase 2 Step 3 follow-up: make reward application atomic.
--
-- submit-run originally read player_wallet / player_stats, added to the values
-- in TypeScript, and wrote them back. That read-modify-write loses an increment
-- whenever a player has two submissions in flight at once: both read the same
-- starting balance and the second write overwrites the first. Doing the whole
-- update in one statement per row makes the increment atomic in Postgres, so
-- concurrency costs nothing.
--
-- SECURITY DEFINER because it writes tables the player is not allowed to write
-- directly (RLS keeps wallet and stats read-only to their owner — they are the
-- ledger the leaderboard trusts). EXECUTE is therefore revoked from the API
-- roles below: only service_role, i.e. the Edge Function, may call it.
create or replace function public.apply_run_rewards(
  p_user     uuid,
  p_xp       integer,
  p_currency integer,
  p_score    integer,
  p_chain    integer
) returns table (xp integer, currency integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.player_stats s
     set games_played = s.games_played + 1,
         best_score   = greatest(s.best_score, p_score),
         best_chain   = greatest(s.best_chain, p_chain),
         updated_at   = now()
   where s.user_id = p_user;

  return query
  update public.player_wallet w
     set xp       = w.xp + p_xp,
         currency = w.currency + p_currency
   where w.user_id = p_user
  returning w.xp, w.currency;
end;
$$;

revoke all on function public.apply_run_rewards(uuid, integer, integer, integer, integer)
  from public, anon, authenticated;

-- Granted back explicitly rather than relied upon. Supabase's default
-- privileges do grant EXECUTE to service_role, but a REVOKE ... FROM public
-- next to it is close enough to that grant that assuming is not worth it: if
-- service_role lost EXECUTE, every submission would bank its score and then
-- silently fail to pay out. This statement is idempotent.
grant execute on function public.apply_run_rewards(uuid, integer, integer, integer, integer)
  to service_role;

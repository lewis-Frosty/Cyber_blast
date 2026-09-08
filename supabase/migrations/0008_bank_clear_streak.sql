-- Bank the verified chain streak alongside the other bests.
--
-- player_stats.best_clear_streak has existed since the schema was written but
-- nothing ever wrote to it, so the "chains in a row" ladder had no data and the
-- dashboard said so rather than showing a zero. The value now comes from the
-- server's replay, like every other number that reaches this table.
--
-- Definition, confirmed with the designer: consecutive PLACEMENTS that each
-- completed a chain. A placement clearing nothing breaks the run; firing a
-- power-up does not, because the achievement is about chaining placements
-- rather than about abstaining from tools.
--
-- p_streak is defaulted so an older submit-run deployment keeps working during
-- a rollout: it banks no streak rather than failing the call and losing the run.
create or replace function public.apply_run_rewards(
  p_user     uuid,
  p_xp       integer,
  p_currency integer,
  p_score    integer,
  p_chain    integer,
  p_streak   integer default 0
) returns table (xp integer, currency integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  update public.player_stats s
     set games_played      = s.games_played + 1,
         best_score        = greatest(s.best_score, p_score),
         best_chain        = greatest(s.best_chain, p_chain),
         best_clear_streak = greatest(s.best_clear_streak, coalesce(p_streak, 0)),
         updated_at        = now()
   where s.user_id = p_user;

  return query
  update public.player_wallet w
     set xp       = w.xp + p_xp,
         currency = w.currency + p_currency
   where w.user_id = p_user
  returning w.xp, w.currency;
end;
$$;

-- Adding a defaulted argument creates a NEW overload rather than replacing the
-- old one, and two candidates with the same call shape are ambiguous. Drop the
-- five-argument version now that the six-argument one supersedes it.
drop function if exists public.apply_run_rewards(uuid, integer, integer, integer, integer);

revoke all on function public.apply_run_rewards(uuid, integer, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.apply_run_rewards(uuid, integer, integer, integer, integer, integer)
  to service_role;

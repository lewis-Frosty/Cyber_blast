-- Fix a bug in 0013's recompute_daily_streak.
--
-- `daily_streak_best` was being fed the CURRENT streak, which is zeroed when
-- the last day played is older than yesterday. So a player who ran a streak
-- and then missed a day lost their best along with their current — 0013's own
-- backfill recorded a real 1-day streak as best 0.
--
-- `best` is a lifetime high-water mark: the longest island ever, not the
-- newest one. Only `current` cares about whether the streak is still live.
-- Caught by reading the backfilled rows rather than trusting the migration.

create or replace function public.recompute_daily_streak(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cur       integer;
  longest   integer;
  ends_date date;
begin
  with played as (
    select distinct challenge_date as cd
      from public.runs
     where user_id = p_user
       and mode = 'daily'
       and status = 'submitted'
       and challenge_date is not null
  ),
  grouped as (
    select cd, cd - (row_number() over (order by cd))::integer as grp from played
  ),
  islands as (
    select grp, count(*)::integer as len, max(cd) as ends_on
      from grouped group by grp
  )
  select
    -- The newest island is the one that might still be running.
    (select len     from islands order by ends_on desc limit 1),
    (select ends_on from islands order by ends_on desc limit 1),
    -- The longest island ever is the achievement.
    (select max(len) from islands)
  into cur, ends_date, longest;

  -- A streak is only CURRENT if it reaches today or yesterday. Reaching
  -- yesterday still counts: the player has not missed a day until today ends.
  -- This zeroes `current` only — never the lifetime best.
  if ends_date is null or ends_date < current_date - 1 then
    cur := 0;
  end if;

  update public.player_stats
     set daily_streak_current = coalesce(cur, 0),
         daily_streak_last    = ends_date,
         daily_streak_best    = greatest(daily_streak_best, coalesce(longest, 0)),
         updated_at           = now()
   where user_id = p_user;
end;
$$;

revoke all on function public.recompute_daily_streak(uuid) from public, anon, authenticated;

-- Re-run for everyone, to repair the bests 0013's backfill flattened.
do $$
declare u uuid;
begin
  for u in
    select distinct user_id from public.runs
     where mode = 'daily' and status = 'submitted' and challenge_date is not null
  loop
    perform public.recompute_daily_streak(u);
  end loop;
end $$;

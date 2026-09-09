-- Daily streak tracking (backend spec §6.2).
--
-- `player_stats.daily_streak_best` has existed since migration 0003 with a
-- default of 0 and NOTHING has ever written to it. The Daily Challenge shipped
-- in Step 6, so every daily played since then has been recorded in `runs` and
-- then ignored: the player page showed a permanent 0 and the streak ladder
-- said "starts counting when the Daily Challenge ships" long after it had.
--
-- Implemented as a TRIGGER rather than a call from submit-run on purpose. The
-- data needed is already in `runs`, the Edge Function cannot forget to call
-- it, and it needs no redeploy — a run banked by any path updates the streak.

alter table public.player_stats
  add column if not exists daily_streak_current integer not null default 0
    check (daily_streak_current >= 0),
  -- The date the current streak reaches. The client needs it to tell a live
  -- streak from a stale one without a nightly job: a streak whose last day is
  -- older than yesterday is over, and only the player's next play would
  -- otherwise correct the stored number.
  add column if not exists daily_streak_last date;

/**
 * Recompute one player's daily streak from their submitted daily runs.
 *
 * Gaps-and-islands: consecutive dates share `date - row_number()`, so the
 * newest island's length is the streak. Derived from `runs` every time rather
 * than incremented, so it is correct after a backfill, a deleted run or a
 * rejected one — an incrementing counter would drift and could never be
 * trusted to recover.
 */
create or replace function public.recompute_daily_streak(p_user uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  cur       integer;
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
  select len, ends_on into cur, ends_date
    from islands order by ends_on desc limit 1;

  -- A streak is only CURRENT if it reaches today or yesterday. Reaching
  -- yesterday still counts: the player has not missed a day until today ends.
  if ends_date is null or ends_date < current_date - 1 then
    cur := 0;
  end if;

  update public.player_stats
     set daily_streak_current = coalesce(cur, 0),
         daily_streak_last    = ends_date,
         daily_streak_best    = greatest(daily_streak_best, coalesce(cur, 0)),
         updated_at           = now()
   where user_id = p_user;
end;
$$;

revoke all on function public.recompute_daily_streak(uuid) from public, anon, authenticated;

/** Fires when a run BECOMES submitted, not on every touch of the row. */
create or replace function public.on_daily_run_submitted()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if new.mode = 'daily'
     and new.status = 'submitted'
     and new.challenge_date is not null
     and (tg_op = 'INSERT' or old.status is distinct from new.status)
  then
    perform public.recompute_daily_streak(new.user_id);
  end if;
  return new;
end;
$$;

revoke all on function public.on_daily_run_submitted() from public, anon, authenticated;

drop trigger if exists runs_daily_streak on public.runs;
create trigger runs_daily_streak
  after insert or update on public.runs
  for each row execute function public.on_daily_run_submitted();

-- Backfill: every daily already played but never counted. Without this the
-- players who have been testing keep their 0 until they play again.
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

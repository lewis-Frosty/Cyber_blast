-- Phase 2 Step 7 — Leagues (backend spec §5).
--
-- Weekly seasons, groups of 30 at one tier, promotion and relegation. The
-- point of the design is that every player is always in a race of thirty
-- people they can plausibly win, rather than staring at a global board they
-- will never appear on.
--
-- POINTS ARE THE SUM OF EACH DAY'S BEST RUN, not the best single run of the
-- season. Pinned deliberately in the spec: best-single rewards one lucky game
-- and then gives you no reason to come back until Monday, which is the exact
-- opposite of what a retention system is for.

-- ── Schema the design needs and the original migration lacked ────────────

-- The per-day best that league points sum over. Kept separate from `runs`
-- because a player has many runs a day and the league cares about one number.
create table if not exists public.player_daily_best (
  user_id    uuid    not null references public.profiles(id) on delete cascade,
  play_date  date    not null,
  best_score integer not null default 0 check (best_score >= 0),
  primary key (user_id, play_date)
);
alter table public.player_daily_best enable row level security;
create policy "read own daily bests" on public.player_daily_best
  for select using (auth.uid() = user_id);

-- Which tier the player sits in, carried across seasons.
alter table public.player_stats
  add column if not exists league_tier integer not null default 1
  check (league_tier between 1 and 5);

-- One season per week. Without this, two concurrent first-submissions of a
-- new week could each create their own "current" season and split the league.
create unique index if not exists league_seasons_starts_on_key
  on public.league_seasons (starts_on);

-- league_members' primary key is (group_id, user_id), which happily allows the
-- same player in TWO groups of the same season. Denormalise season_id so the
-- real constraint — one membership per player per season — can be enforced.
alter table public.league_members
  add column if not exists season_id uuid references public.league_seasons(id) on delete cascade;

create unique index if not exists league_members_one_per_season
  on public.league_members (season_id, user_id);

-- ── Season maths ─────────────────────────────────────────────────────────

-- Monday of the week containing p_date, in UTC. The database runs UTC, which
-- is what makes this agree with the daily challenge's day boundary.
create or replace function public.season_start(p_date date default current_date)
returns date language sql immutable as $$
  select p_date - ((extract(isodow from p_date)::integer - 1));
$$;

create or replace function public.ensure_season(p_date date default current_date)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s_start date := public.season_start(p_date);
  s_id    uuid;
begin
  insert into public.league_seasons (starts_on, ends_on, is_active)
  values (s_start, s_start + 6, true)
  on conflict (starts_on) do nothing;

  select id into s_id from public.league_seasons where starts_on = s_start;
  return s_id;
end;
$$;

/**
 * Put the player in a group for this season, if they are not in one already.
 *
 * Lazily, on first play of the season, and into the FULLEST group that still
 * has room rather than a fresh one — a group of thirty where twenty-five never
 * showed up feels dead, and spreading players thinly guarantees that.
 */
create or replace function public.ensure_league_membership(p_user uuid, p_season uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  g_id  uuid;
  tier_ integer;
begin
  select group_id into g_id
    from public.league_members
   where season_id = p_season and user_id = p_user;
  if g_id is not null then return g_id; end if;

  select coalesce(league_tier, 1) into tier_ from public.player_stats where user_id = p_user;
  tier_ := coalesce(tier_, 1);

  select g.id into g_id
    from public.league_groups g
    left join public.league_members m on m.group_id = g.id
   where g.season_id = p_season and g.tier = tier_
   group by g.id, g.capacity
  having count(m.user_id) < g.capacity
   order by count(m.user_id) desc
   limit 1;

  if g_id is null then
    insert into public.league_groups (season_id, tier) values (p_season, tier_)
    returning id into g_id;
  end if;

  insert into public.league_members (group_id, user_id, season_id, points)
  values (g_id, p_user, p_season, 0)
  -- Two concurrent submissions from the same player race here; the unique
  -- index decides, and the loser takes the winner's group.
  on conflict (season_id, user_id) do nothing;

  select group_id into g_id
    from public.league_members where season_id = p_season and user_id = p_user;
  return g_id;
end;
$$;

/**
 * Record one submitted run against the league.
 *
 * Upserts the day's best, then recomputes the player's season points as the
 * sum of their daily bests inside the season window.
 */
create or replace function public.record_league_run(
  p_user  uuid,
  p_score integer,
  p_date  date default current_date
) returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  s_id    uuid;
  s_start date;
  s_end   date;
  total   integer;
begin
  insert into public.player_daily_best (user_id, play_date, best_score)
  values (p_user, p_date, greatest(p_score, 0))
  on conflict (user_id, play_date)
  do update set best_score = greatest(public.player_daily_best.best_score, excluded.best_score);

  s_id := public.ensure_season(p_date);
  perform public.ensure_league_membership(p_user, s_id);

  select starts_on, ends_on into s_start, s_end
    from public.league_seasons where id = s_id;

  select coalesce(sum(best_score), 0) into total
    from public.player_daily_best
   where user_id = p_user and play_date between s_start and s_end;

  update public.league_members
     set points = total
   where season_id = s_id and user_id = p_user;
end;
$$;

-- ── Rewards now also feed the league ─────────────────────────────────────
-- Folded in rather than called separately so submit-run needs no change: the
-- Edge Function already calls this once per accepted run.
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

  perform public.record_league_run(p_user, p_score, current_date);

  return query
  update public.player_wallet w
     set xp       = w.xp + p_xp,
         currency = w.currency + p_currency
   where w.user_id = p_user
  returning w.xp, w.currency;
end;
$$;

revoke all on function public.apply_run_rewards(uuid, integer, integer, integer, integer, integer)
  from public, anon, authenticated;
grant execute on function public.apply_run_rewards(uuid, integer, integer, integer, integer, integer)
  to service_role;

revoke all on function public.ensure_season(date)                       from public, anon, authenticated;
revoke all on function public.ensure_league_membership(uuid, uuid)      from public, anon, authenticated;
revoke all on function public.record_league_run(uuid, integer, date)    from public, anon, authenticated;

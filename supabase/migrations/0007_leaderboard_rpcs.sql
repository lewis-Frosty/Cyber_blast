-- Phase 2 Step 5 — the read path (backend spec §4.3).
--
-- SECURITY DEFINER is required, not convenient: RLS on `runs` restricts a
-- player to their OWN rows, which is correct, and a leaderboard by definition
-- reads everyone's. These functions are the one sanctioned way past that, so
-- they expose only what a board needs to render and nothing else. In
-- particular they never return another player's user_id — the caller gets an
-- `is_me` flag instead, which is all the UI needs to highlight its own row.
--
-- One row per PLAYER, not per run. A board that lists every run fills up with
-- one strong player's repeats and stops being a ranking of people.
--
-- `coalesce(... = auth.uid(), false)`: the comparison is NULL, not false, when
-- there is no session, and a NULL flag reaching the UI reads as neither true
-- nor false. Make it total.

create or replace function public.get_leaderboard(
  p_mode    text        default 'endless',
  p_since   timestamptz default null,
  p_country char(2)     default null,
  p_limit   integer     default 100
)
returns table (
  rank         bigint,
  display_name text,
  avatar_id    text,
  country_code char(2),
  score        integer,
  max_cascade  integer,
  placements   integer,
  is_me        boolean
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  with best as (
    select distinct on (r.user_id)
      r.user_id, r.score, r.max_cascade, r.placements, r.submitted_at
    from public.runs r
    join public.profiles p on p.id = r.user_id
    where r.status = 'submitted'
      and r.mode = p_mode
      and (p_since   is null or r.submitted_at >= p_since)
      and (p_country is null or p.country_code = p_country)
      and p.is_shadowbanned = false
    order by r.user_id, r.score desc, r.submitted_at asc
  )
  select
    row_number() over (order by b.score desc, b.submitted_at asc) as rank,
    p.display_name,
    p.avatar_id,
    p.country_code,
    b.score,
    b.max_cascade,
    b.placements,
    coalesce(b.user_id = auth.uid(), false) as is_me
  from best b
  join public.profiles p on p.id = b.user_id
  order by b.score desc, b.submitted_at asc
  -- Capped server-side so the page size is never the caller's to choose.
  limit least(greatest(coalesce(p_limit, 100), 1), 100);
$$;

-- Companion. Without it the board is meaningless to everyone outside the top
-- 100, which is almost everyone: a player needs to see their own standing even
-- when they are 4,000th.
create or replace function public.get_my_rank(
  p_mode    text        default 'endless',
  p_since   timestamptz default null,
  p_country char(2)     default null
)
returns table (
  rank          bigint,
  score         integer,
  max_cascade   integer,
  total_players bigint
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  with best as (
    select distinct on (r.user_id)
      r.user_id, r.score, r.max_cascade, r.submitted_at
    from public.runs r
    join public.profiles p on p.id = r.user_id
    where r.status = 'submitted'
      and r.mode = p_mode
      and (p_since   is null or r.submitted_at >= p_since)
      and (p_country is null or p.country_code = p_country)
      and p.is_shadowbanned = false
    order by r.user_id, r.score desc, r.submitted_at asc
  ),
  ranked as (
    select
      b.user_id, b.score, b.max_cascade,
      row_number() over (order by b.score desc, b.submitted_at asc) as rank,
      count(*) over () as total_players
    from best b
  )
  select r.rank, r.score, r.max_cascade, r.total_players
  from ranked r
  where r.user_id = auth.uid();
$$;

-- The board's own access path. Both are read-only and deliberately readable by
-- signed-in players; the definer rights buy visibility of other people's
-- scores and nothing more.
grant execute on function public.get_leaderboard(text, timestamptz, char, integer) to anon, authenticated;
grant execute on function public.get_my_rank(text, timestamptz, char)              to anon, authenticated;

create index if not exists runs_leaderboard_idx
  on public.runs (mode, status, score desc, submitted_at asc)
  where status = 'submitted';

-- Narrowed after the security advisor flagged it: anonymous sign-in produces
-- the `authenticated` role with an is_anonymous claim — it does NOT leave the
-- caller as `anon`. The game therefore never needs `anon` to execute these,
-- and granting it only exposed two SECURITY DEFINER functions to anyone
-- holding the publishable key with no session at all.
revoke execute on function public.get_leaderboard(text, timestamptz, char, integer) from anon;
revoke execute on function public.get_my_rank(text, timestamptz, char)              from anon;

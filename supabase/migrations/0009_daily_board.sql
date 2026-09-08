-- Phase 2 Step 6 — the Daily Challenge board.
--
-- A daily board is a different question from the all-time one: not "who is
-- best" but "who is best on TODAY'S board", which everyone played identically.
-- That needs its own filter, because a run's daily identity lives in
-- runs.challenge_date rather than in a time window — ranking everything
-- submitted since midnight would mix in endless runs and miss late
-- submissions of yesterday's board.
--
-- Adding a parameter creates a NEW overload rather than replacing the old
-- function, and two candidates reachable by the same call are ambiguous, so
-- the previous signatures are dropped once the new ones exist.
--
-- The two guarantees the daily challenge actually rests on are structural and
-- live elsewhere, which is why they are not re-checked here:
--   daily_challenges: PRIMARY KEY (challenge_date)  — one seed per date
--   runs_one_daily_per_player: UNIQUE (user_id, challenge_date)
--     WHERE mode='daily' AND status='submitted'     — one attempt per day

create or replace function public.get_leaderboard(
  p_mode    text        default 'endless',
  p_since   timestamptz default null,
  p_country char(2)     default null,
  p_limit   integer     default 100,
  p_date    date        default null
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
      and (p_since   is null or r.submitted_at  >= p_since)
      and (p_date    is null or r.challenge_date = p_date)
      and (p_country is null or p.country_code   = p_country)
      and p.is_shadowbanned = false
    order by r.user_id, r.score desc, r.submitted_at asc
  )
  select
    row_number() over (order by b.score desc, b.submitted_at asc) as rank,
    p.display_name, p.avatar_id, p.country_code,
    b.score, b.max_cascade, b.placements,
    coalesce(b.user_id = auth.uid(), false) as is_me
  from best b
  join public.profiles p on p.id = b.user_id
  order by b.score desc, b.submitted_at asc
  limit least(greatest(coalesce(p_limit, 100), 1), 100);
$$;

create or replace function public.get_my_rank(
  p_mode    text        default 'endless',
  p_since   timestamptz default null,
  p_country char(2)     default null,
  p_date    date        default null
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
      and (p_since   is null or r.submitted_at  >= p_since)
      and (p_date    is null or r.challenge_date = p_date)
      and (p_country is null or p.country_code   = p_country)
      and p.is_shadowbanned = false
    order by r.user_id, r.score desc, r.submitted_at asc
  ),
  ranked as (
    select b.user_id, b.score, b.max_cascade,
           row_number() over (order by b.score desc, b.submitted_at asc) as rank,
           count(*) over () as total_players
    from best b
  )
  select r.rank, r.score, r.max_cascade, r.total_players
  from ranked r where r.user_id = auth.uid();
$$;

drop function if exists public.get_leaderboard(text, timestamptz, char, integer);
drop function if exists public.get_my_rank(text, timestamptz, char);

revoke all on function public.get_leaderboard(text, timestamptz, char, integer, date) from public, anon;
revoke all on function public.get_my_rank(text, timestamptz, char, date)              from public, anon;
grant execute on function public.get_leaderboard(text, timestamptz, char, integer, date) to authenticated;
grant execute on function public.get_my_rank(text, timestamptz, char, date)              to authenticated;

create index if not exists runs_daily_board_idx
  on public.runs (challenge_date, score desc, submitted_at asc)
  where status = 'submitted' and mode = 'daily';

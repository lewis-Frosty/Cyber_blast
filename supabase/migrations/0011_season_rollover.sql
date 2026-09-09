-- Season rollover: promotion and relegation (backend spec §5).
--
-- The spec's rule — top 7 promote, bottom 7 relegate, middle stays — is
-- written for a FULL group of thirty. Groups are filled lazily, so most real
-- groups are partial, and applying 7/7 literally to a group of ten would
-- promote and relegate the same people: the two sets overlap once n < 14.
--
-- So the counts scale with the group and cap at the spec's seven:
--   movers = least(7, n / 4)   -- integer division
--     n=30 -> 7 up, 7 down, 16 stay   (exactly the spec)
--     n=10 -> 2 up, 2 down, 6 stay
--     n=4  -> 1 up, 1 down, 2 stay
--     n=3  -> 0 up, 0 down             nobody moves in a group of three
-- Because 2 * (n/4) <= n/2, the two sets can never overlap at any size.
--
-- Ties are broken by user_id so a rollover run twice produces the same result
-- rather than shuffling players who finished level.

create or replace function public.close_season(p_season uuid)
returns table (promoted integer, relegated integer, unchanged integer)
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  g          record;
  n          integer;
  movers     integer;
  n_promoted integer := 0;
  n_relegated integer := 0;
  n_unchanged integer := 0;
begin
  for g in
    select id, tier from public.league_groups where season_id = p_season
  loop
    select count(*) into n from public.league_members where group_id = g.id;
    movers := least(7, n / 4);

    if movers > 0 then
      -- Up. Tier 5 is the top: a player already there stays and is counted
      -- as unchanged rather than silently "promoted" to nowhere.
      with ranked as (
        select user_id,
               row_number() over (order by points desc, user_id asc) as pos
          from public.league_members where group_id = g.id
      ),
      winners as (select user_id from ranked where pos <= movers)
      update public.player_stats s
         set league_tier = least(5, g.tier + 1)
        from winners w
       where s.user_id = w.user_id and g.tier < 5;
      get diagnostics n = row_count;
      n_promoted := n_promoted + n;

      -- Down. Tier 1 is the floor, same reasoning.
      select count(*) into n from public.league_members where group_id = g.id;
      with ranked as (
        select user_id,
               row_number() over (order by points asc, user_id asc) as pos
          from public.league_members where group_id = g.id
      ),
      losers as (select user_id from ranked where pos <= movers)
      update public.player_stats s
         set league_tier = greatest(1, g.tier - 1)
        from losers l
       where s.user_id = l.user_id and g.tier > 1;
      get diagnostics n = row_count;
      n_relegated := n_relegated + n;
    end if;

    select count(*) into n from public.league_members where group_id = g.id;
    n_unchanged := n_unchanged + greatest(0, n - least(7, n / 4) * 2);
  end loop;

  update public.league_seasons set is_active = false where id = p_season;

  promoted := n_promoted;
  relegated := n_relegated;
  unchanged := n_unchanged;
  return next;
end;
$$;

revoke all on function public.close_season(uuid) from public, anon, authenticated;

-- Read paths for the league UI. The standings of the caller's own group only:
-- other groups are none of their business and a global league dump is exactly
-- the demotivating all-time board leagues exist to replace.
create or replace function public.get_my_league()
returns table (
  rank         bigint,
  display_name text,
  avatar_id    text,
  country_code char(2),
  points       integer,
  tier         integer,
  is_me        boolean,
  season_ends  date,
  group_size   bigint
)
language sql
security definer
stable
set search_path = public, pg_temp
as $$
  with me as (
    select m.group_id, g.tier, s.ends_on
      from public.league_members m
      join public.league_groups  g on g.id = m.group_id
      join public.league_seasons s on s.id = m.season_id
     where m.user_id = auth.uid() and s.is_active
     limit 1
  )
  select
    row_number() over (order by m.points desc, m.user_id asc) as rank,
    p.display_name, p.avatar_id, p.country_code,
    m.points,
    me.tier,
    coalesce(m.user_id = auth.uid(), false) as is_me,
    me.ends_on,
    count(*) over () as group_size
  from public.league_members m
  join me on me.group_id = m.group_id
  join public.profiles p on p.id = m.user_id
  where p.is_shadowbanned = false
  order by m.points desc, m.user_id asc
  limit 30;
$$;

revoke all on function public.get_my_league() from public, anon;
grant execute on function public.get_my_league() to authenticated;

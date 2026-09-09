-- LEAGUE SEASON ROLLOVER SUITE (backend spec §5.1, build Step 7).
--
-- Run this against the project after ANY change to close_season(), the group
-- assignment rules, or the league schema:
--   supabase db execute -f supabase/tests/league_rollover.sql
-- or paste it into the SQL editor. It raises on the first failure and cleans
-- up its own users and season either way.
--
-- Covers Phase 2 exit criterion 5: promotion and relegation across a simulated
-- season boundary, INCLUDING partially-full groups — the case where the spec's
-- flat "top 7 / bottom 7" would promote and relegate the same players.
--
-- The expected counts here are the same ones asserted in tests/league.test.ts.
-- The cut-line rule lives in two places on purpose (SQL decides, the UI draws
-- it live); if one changes, both must.

do $$
declare
  season   uuid;
  failures text[] := '{}';
  uids     uuid[] := '{}';
  uid      uuid;
  gid      uuid;
  n        integer;
  i        integer;
  sz       integer;
  res      record;
begin
  insert into public.league_seasons (starts_on, ends_on, is_active)
  values (date '2020-01-06', date '2020-01-12', true)
  returning id into season;

  -- Four groups at ONE tier: full, partial, tiny, and too-small-to-move.
  foreach sz in array array[30, 10, 4, 3] loop
    insert into public.league_groups (season_id, tier) values (season, 3) returning id into gid;
    for i in 1..sz loop
      uid := gen_random_uuid();
      insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at,
                              raw_app_meta_data, raw_user_meta_data)
      values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
              true, now(), now(), '{"provider":"anonymous"}'::jsonb, '{}'::jsonb);
      update public.player_stats set league_tier = 3 where user_id = uid;
      insert into public.league_members (group_id, user_id, season_id, points)
      values (gid, uid, season, i * 100);
      uids := uids || uid;
    end loop;
  end loop;

  -- Ceiling group: tier 5 cannot promote.
  insert into public.league_groups (season_id, tier) values (season, 5) returning id into gid;
  for i in 1..8 loop
    uid := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data)
    values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            true, now(), now(), '{"provider":"anonymous"}'::jsonb, '{}'::jsonb);
    update public.player_stats set league_tier = 5 where user_id = uid;
    insert into public.league_members (group_id, user_id, season_id, points) values (gid, uid, season, i * 100);
    uids := uids || uid;
  end loop;

  -- Floor group: tier 1 cannot relegate.
  insert into public.league_groups (season_id, tier) values (season, 1) returning id into gid;
  for i in 1..8 loop
    uid := gen_random_uuid();
    insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at,
                            raw_app_meta_data, raw_user_meta_data)
    values (uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            true, now(), now(), '{"provider":"anonymous"}'::jsonb, '{}'::jsonb);
    insert into public.league_members (group_id, user_id, season_id, points) values (gid, uid, season, i * 100);
    uids := uids || uid;
  end loop;

  select * into res from public.close_season(season);

  -- movers = least(7, n/4):  30->7, 10->2, 4->1, 3->0, 8->2
  -- promoted: 7+2+1+0 (tier3) + 0 (tier5 blocked) + 2 (tier1) = 12
  -- relegated: 7+2+1+0 (tier3) + 2 (tier5) + 0 (tier1 blocked) = 12
  if res.promoted <> 12 then failures := failures || format('promoted=%s want 12', res.promoted); end if;
  if res.relegated <> 12 then failures := failures || format('relegated=%s want 12', res.relegated); end if;

  select count(*) into n from public.player_stats
   where user_id = any(uids) and (league_tier < 1 or league_tier > 5);
  if n > 0 then failures := failures || format('%s players escaped tier bounds', n); end if;

  select count(*) into n from public.league_seasons where id = season and is_active;
  if n <> 0 then failures := failures || 'season still active'; end if;

  delete from auth.users where id = any(uids);
  delete from public.league_seasons where id = season;

  if array_length(failures, 1) > 0 then
    raise exception 'LEAGUE ROLLOVER FAILED: %', array_to_string(failures, ' | ');
  end if;
end $$;
select 'rollover suite passed' as result;

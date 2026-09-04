-- HOSTILE RLS SUITE (backend spec §3, build Step 2).
--
-- Run this against the project after ANY schema or policy change:
--   supabase db execute -f supabase/tests/rls_hostile.sql
-- or paste it into the SQL editor. It raises on the first breach and cleans up
-- after itself either way.
--
-- Every attack below is performed as the `authenticated` role holding a real
-- uid — exactly what the anon key gives a signed-in client. All twelve must be
-- refused, and the three legitimate actions at the end must still succeed.
-- A suite that only tests refusals will happily pass on a database that has
-- locked the real players out too.
do $$
declare
  uid       uuid := gen_random_uuid();
  other     uuid := gen_random_uuid();
  run_id    uuid;
  failures  text[] := '{}';
  n         integer;
begin
  insert into auth.users (id, instance_id, aud, role, is_anonymous, created_at, updated_at,
                          raw_app_meta_data, raw_user_meta_data)
  values (uid,   '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          true, now(), now(), '{"provider":"anonymous"}'::jsonb, '{}'::jsonb),
         (other, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
          true, now(), now(), '{"provider":"anonymous"}'::jsonb, '{}'::jsonb);

  insert into public.runs (id, user_id, seed, status, mode, score)
  values (gen_random_uuid(), uid, 12345, 'submitted', 'endless', 500)
  returning id into run_id;
  insert into public.daily_challenges (challenge_date, seed)
  values (current_date + 1, 999999);
  update public.player_wallet set currency = 10 where user_id = uid;

  set local role authenticated;
  perform set_config('request.jwt.claims',
    json_build_object('sub', uid::text, 'role', 'authenticated')::text, true);

  begin
    insert into public.runs (user_id, seed, status, score) values (uid, 1, 'submitted', 999999);
    failures := failures || 'ATTACK 1: client inserted a run';
  exception when others then null; end;

  begin
    update public.runs set score = 999999 where id = run_id;
    get diagnostics n = row_count;
    if n > 0 then failures := failures || 'ATTACK 2: client updated a run'; end if;
  exception when others then null; end;

  begin
    update public.player_wallet set currency = 999999 where user_id = uid;
    get diagnostics n = row_count;
    if n > 0 then failures := failures || 'ATTACK 3: client printed currency'; end if;
  exception when others then null; end;

  begin
    update public.profiles set is_shadowbanned = false where id = uid;
    failures := failures || 'ATTACK 4: client unbanned itself';
  exception when others then null; end;

  select count(*) into n from public.daily_challenges where challenge_date > current_date;
  if n > 0 then failures := failures || 'ATTACK 5: client read a future seed'; end if;

  begin
    update public.player_stats set best_chain = 99 where user_id = uid;
    get diagnostics n = row_count;
    if n > 0 then failures := failures || 'ATTACK 6: client wrote its own stats'; end if;
  exception when others then null; end;

  begin
    insert into public.player_unlocks (user_id, unlockable_id) values (uid, 'frame_diamond');
    failures := failures || 'ATTACK 7: client granted itself an unlock';
  exception when others then null; end;

  begin
    update public.profiles set equipped_frame_id = 'frame_diamond' where id = uid;
    failures := failures || 'ATTACK 8: client equipped a locked frame';
  exception when others then null; end;

  select count(*) into n from public.player_wallet where user_id = other;
  if n > 0 then failures := failures || 'ATTACK 9: client read another wallet'; end if;

  select count(*) into n from public.runs where user_id = other;
  if n > 0 then failures := failures || 'ATTACK 10: client read another players runs'; end if;

  begin
    insert into public.unlockables (id, kind, name) values ('frame_cheat', 'frame', 'Cheat');
    failures := failures || 'ATTACK 11: client wrote the unlockables catalogue';
  exception when others then null; end;

  begin
    insert into public.league_members (group_id, user_id, points)
    values (gen_random_uuid(), uid, 99999);
    failures := failures || 'ATTACK 12: client wrote league points';
  exception when others then null; end;

  begin
    perform public.apply_run_rewards(uid, 999999, 999999, 999999, 99);
    failures := failures || 'ATTACK 13: client called apply_run_rewards directly';
  exception when others then null; end;

  -- Things a client legitimately MUST still be able to do.
  update public.profiles set display_name = 'LEWIS', avatar_id = 'nova', country_code = 'NZ'
  where id = uid;
  get diagnostics n = row_count;
  if n <> 1 then failures := failures || 'REGRESSION: client cannot set its own name/avatar/country'; end if;

  select count(*) into n from public.profiles where id = other;
  if n <> 1 then failures := failures || 'REGRESSION: client cannot read another profile for the leaderboard'; end if;

  select count(*) into n from public.avatars;
  if n <> 12 then failures := failures || 'REGRESSION: client cannot read the avatar catalogue'; end if;

  reset role;
  perform set_config('request.jwt.claims', null, true);
  delete from public.daily_challenges where challenge_date > current_date;
  delete from auth.users where id in (uid, other);

  if array_length(failures, 1) > 0 then
    raise exception 'HOSTILE SUITE FAILED: %', array_to_string(failures, ' | ');
  end if;
  raise notice 'PASS: 13 attacks refused, 3 legitimate actions allowed';
end $$;

-- Phase 2 Step 2 — full schema + RLS (backend spec §2, §3).
-- Applied as phase2_step2_full_schema.
--
-- Extended beyond the spec to carry the player dashboard: avatars, country,
-- and achievement frames.

-- ============ PROFILE ADDITIONS ============
-- World-readable alongside display_name, because a leaderboard row renders
-- another player's avatar, frame and country.
alter table public.profiles
  add column avatar_id         text,
  add column country_code      char(2) check (country_code ~ '^[A-Z]{2}$'),
  add column equipped_frame_id text;

-- ============ CATALOGUES (world-readable, nobody writes) ============
create table public.avatars (
  id         text primary key,
  name       text not null,
  sort_order integer not null default 0
);

create table public.unlockables (
  id          text primary key,
  kind        text not null check (kind in ('theme','block_style','trail','frame')),
  name        text not null,
  cost        integer not null default 0 check (cost >= 0),
  unlock_rule jsonb
);

alter table public.profiles
  add constraint profiles_avatar_fk foreign key (avatar_id) references public.avatars(id),
  add constraint profiles_frame_fk  foreign key (equipped_frame_id) references public.unlockables(id);

-- ============ PLAYER STATS (server-write only) ============
-- Separate from player_wallet for the same reason the wallet is separate from
-- profiles: the client must never write anything an achievement is awarded on.
create table public.player_stats (
  user_id           uuid primary key references public.profiles(id) on delete cascade,
  games_played      integer not null default 0 check (games_played >= 0),
  best_score        integer not null default 0 check (best_score >= 0),
  best_chain        integer not null default 0 check (best_chain >= 0),
  best_clear_streak integer not null default 0 check (best_clear_streak >= 0),
  daily_streak_best integer not null default 0 check (daily_streak_best >= 0),
  updated_at        timestamptz not null default now()
);

-- ============ RUNS ============
create table public.runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.profiles(id) on delete cascade,
  started_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  status         text not null default 'active'
                   check (status in ('active','submitted','rejected','expired')),
  mode           text not null default 'endless'
                   check (mode in ('endless','daily','limited')),
  challenge_date date,
  seed           bigint not null,
  move_limit     integer,
  score          integer,
  placements     integer,
  max_cascade    integer,
  duration_ms    integer,
  reject_reason  text
);

create index runs_leaderboard_idx
  on public.runs (mode, challenge_date, score desc)
  where status = 'submitted';

create index runs_user_idx on public.runs (user_id, submitted_at desc);

-- One scored daily attempt per player per day, enforced by the DATABASE.
-- Application code checks this too, but two concurrent submits can both pass
-- that check before either commits. This index makes the race impossible.
create unique index runs_one_daily_per_player
  on public.runs (user_id, challenge_date)
  where mode = 'daily' and status = 'submitted';

-- ============ DAILY CHALLENGE ============
create table public.daily_challenges (
  challenge_date date primary key,
  seed           bigint not null,
  config         jsonb not null default '{}'::jsonb
);

-- ============ LEAGUES ============
create table public.league_seasons (
  id        uuid primary key default gen_random_uuid(),
  starts_on date not null,
  ends_on   date not null,
  is_active boolean not null default true
);

create table public.league_groups (
  id        uuid primary key default gen_random_uuid(),
  season_id uuid not null references public.league_seasons(id) on delete cascade,
  tier      integer not null,
  capacity  integer not null default 30
);

create table public.league_members (
  group_id uuid not null references public.league_groups(id) on delete cascade,
  user_id  uuid not null references public.profiles(id) on delete cascade,
  points   integer not null default 0,
  primary key (group_id, user_id)
);

-- ============ UNLOCKS ============
create table public.player_unlocks (
  user_id       uuid not null references public.profiles(id) on delete cascade,
  unlockable_id text not null references public.unlockables(id) on delete cascade,
  unlocked_at   timestamptz not null default now(),
  primary key (user_id, unlockable_id)
);

-- ============ ROW LEVEL SECURITY ============
alter table public.avatars          enable row level security;
alter table public.unlockables      enable row level security;
alter table public.player_stats     enable row level security;
alter table public.runs             enable row level security;
alter table public.daily_challenges enable row level security;
alter table public.league_seasons   enable row level security;
alter table public.league_groups    enable row level security;
alter table public.league_members   enable row level security;
alter table public.player_unlocks   enable row level security;

create policy "read avatars" on public.avatars for select using (true);
create policy "read unlockables" on public.unlockables for select using (true);

-- Records the client must never write: achievements are awarded from them.
create policy "read own stats" on public.player_stats
  for select using ((select auth.uid()) = user_id);

-- Read own only. There is deliberately NO insert and NO update policy on runs.
-- Only the service_role key (Edge Functions) writes here. This is the entire
-- anti-cheat foundation — do not add a client insert policy "for testing".
create policy "read own runs" on public.runs
  for select using ((select auth.uid()) = user_id);

-- Never expose a future seed: leaking tomorrow's board lets someone pre-solve
-- it offline and post a perfect score the moment it opens.
create policy "read past and present challenges" on public.daily_challenges
  for select using (challenge_date <= current_date);

create policy "read seasons" on public.league_seasons for select using (true);
create policy "read groups" on public.league_groups for select using (true);

-- A player sees the standings of groups they belong to, not every group.
create policy "read own group standings" on public.league_members
  for select using (
    exists (
      select 1 from public.league_members mine
      where mine.group_id = league_members.group_id
        and mine.user_id = (select auth.uid())
    )
  );

create policy "read own unlocks" on public.player_unlocks
  for select using ((select auth.uid()) = user_id);

-- ============ SIGNUP TRIGGER: also create the stats row ============
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  insert into public.player_wallet (user_id) values (new.id) on conflict (user_id) do nothing;
  insert into public.player_stats (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

revoke all on function public.handle_new_user() from public, anon, authenticated;

-- ============ EQUIP GUARD ============
-- equipped_frame_id is world-readable so leaderboards can render it, and the
-- client updates it through the existing profiles UPDATE policy. Without this
-- a player could equip any frame in the catalogue, making every achievement
-- meaningless.
create function public.guard_equipped_frame()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null
     and new.equipped_frame_id is distinct from old.equipped_frame_id
     and new.equipped_frame_id is not null then
    if not exists (
      select 1 from public.player_unlocks
      where user_id = new.id and unlockable_id = new.equipped_frame_id
    ) then
      raise exception 'frame % is not unlocked for this player', new.equipped_frame_id;
    end if;
  end if;
  return new;
end;
$$;

revoke all on function public.guard_equipped_frame() from public, anon, authenticated;

create trigger profiles_guard_equipped_frame
  before update on public.profiles
  for each row execute function public.guard_equipped_frame();

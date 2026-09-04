-- Phase 2 Step 1 — identity model (backend spec §1, §2, §3).
-- Applied to project iniuyjwgnqlieidvhxtf as migration phase2_step1_identity.
--
-- Only the two tables the signup trigger needs. The rest of the schema
-- (runs, daily_challenges, leagues, cosmetics) is Step 2.

create table public.profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text,
  created_at      timestamptz not null default now(),
  is_shadowbanned boolean not null default false
);

-- Deliberately SEPARATE from profiles. The client needs UPDATE on profiles to
-- change its display name; if xp/currency/streak lived there, the same policy
-- would let it print currency and fake streaks.
-- Currency the client can write is currency the client can print.
create table public.player_wallet (
  user_id        uuid primary key references public.profiles(id) on delete cascade,
  xp             integer not null default 0 check (xp >= 0),
  currency       integer not null default 0 check (currency >= 0),
  streak_days    integer not null default 0,
  last_played_on date,
  days_played    date[] not null default '{}'
);

alter table public.profiles      enable row level security;
alter table public.player_wallet enable row level security;

-- Display names must be world-readable: leaderboards render other players'
-- names. Safe only because nothing sensitive lives on this table.
create policy "read all profiles" on public.profiles
  for select using (true);

create policy "update own display name" on public.profiles
  for update using ((select auth.uid()) = id)
  with check ((select auth.uid()) = id);

-- Read own only. There is deliberately NO insert or update policy: xp,
-- currency and streaks are written exclusively by Edge Functions.
create policy "read own wallet" on public.player_wallet
  for select using ((select auth.uid()) = user_id);

-- Every new auth user gets a profile and a wallet, server-side, so the client
-- never needs insert rights on either table.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  insert into public.player_wallet (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- §3 note 4. The UPDATE policy above lets a client write any column it can see
-- on its own row, which includes is_shadowbanned — a player could unban
-- themselves. auth.uid() is null for service_role calls, so Edge Functions stay
-- able to moderate while clients cannot.
create function public.guard_profile_columns()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.uid()) is not null then
    if new.is_shadowbanned is distinct from old.is_shadowbanned then
      raise exception 'is_shadowbanned may not be changed by the client';
    end if;
    if new.id is distinct from old.id or new.created_at is distinct from old.created_at then
      raise exception 'id and created_at are immutable';
    end if;
  end if;
  return new;
end;
$$;

create trigger profiles_guard_columns
  before update on public.profiles
  for each row execute function public.guard_profile_columns();

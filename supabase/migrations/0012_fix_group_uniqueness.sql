-- Fix a design bug in migration 0004.
--
-- That migration replaced a bad foreign key with a UNIQUE index on
-- (season_id, tier), which reads sensibly and is wrong: it permits exactly ONE
-- group per tier per season. The whole point of groups is that a tier holds
-- many of them — thirty players each, a new one created when the last fills.
-- With the unique index in place, tier 3 could never hold a 31st player: the
-- lazy assignment would try to create a second group and hit a constraint
-- violation, and the run would fail at submission time.
--
-- Nothing in production has hit this only because no tier has thirty players
-- yet. Caught by the season-rollover test, which builds four groups at one
-- tier on purpose.
drop index if exists public.league_groups_season_tier_idx;

-- What was actually wanted: fast lookup of a tier's groups, not uniqueness.
create index if not exists league_groups_season_tier_idx
  on public.league_groups (season_id, tier);

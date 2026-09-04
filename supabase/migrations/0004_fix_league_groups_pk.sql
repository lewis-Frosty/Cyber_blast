-- BUG FIX, caught immediately after 0003 was applied.
--
-- league_groups.id was created with a foreign key to league_seasons(id). That
-- would force every group's id to equal a season id, so a season could hold at
-- most one group — the opposite of a tiered league. season_id already carries
-- that relationship correctly.
alter table public.league_groups
  drop constraint league_groups_id_fkey;

-- A season cannot hold two groups at the same tier.
create unique index league_groups_season_tier_idx
  on public.league_groups (season_id, tier);

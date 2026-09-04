-- Phase 2 Step 2 — catalogue seed.
--
-- 12 avatars, on-theme for a neon arcade rather than the cartoon-people set the
-- reference game uses. Names only; the client draws them procedurally, so there
-- are no image assets to ship, host or licence.
insert into public.avatars (id, name, sort_order) values
  ('circuit',   'Circuit',   1),
  ('prism',     'Prism',     2),
  ('vector',    'Vector',    3),
  ('pulse',     'Pulse',     4),
  ('helix',     'Helix',     5),
  ('nova',      'Nova',      6),
  ('glitch',    'Glitch',    7),
  ('cascade',   'Cascade',   8),
  ('lattice',   'Lattice',   9),
  ('phantom',   'Phantom',  10),
  ('binary',    'Binary',   11),
  ('overdrive', 'Overdrive',12)
on conflict (id) do nothing;

-- Achievement frames. unlock_rule is the machine-readable condition an Edge
-- Function evaluates against player_stats — never the client, since a frame the
-- client can award itself is a frame every client will award itself.
insert into public.unlockables (id, kind, name, cost, unlock_rule) values
  -- 1. League rank, by games played.
  ('frame_bronze',   'frame', 'Bronze',   0, '{"type":"games_played","value":1}'),
  ('frame_silver',   'frame', 'Silver',   0, '{"type":"games_played","value":25}'),
  ('frame_gold',     'frame', 'Gold',     0, '{"type":"games_played","value":100}'),
  ('frame_platinum', 'frame', 'Platinum', 0, '{"type":"games_played","value":250}'),
  ('frame_diamond',  'frame', 'Diamond',  0, '{"type":"games_played","value":500}'),

  -- 2. Daily challenge consistency.
  ('frame_daily_5',  'frame', 'Regular',   0, '{"type":"daily_streak","value":5}'),
  ('frame_daily_10', 'frame', 'Devoted',   0, '{"type":"daily_streak","value":10}'),
  ('frame_daily_15', 'frame', 'Relentless',0, '{"type":"daily_streak","value":15}'),
  ('frame_daily_30', 'frame', 'Unbroken',  0, '{"type":"daily_streak","value":30}'),

  -- 3. Biggest chain.
  ('frame_chain_5',  'frame', 'Chain x5',  0, '{"type":"best_chain","value":5}'),
  ('frame_chain_10', 'frame', 'Chain x10', 0, '{"type":"best_chain","value":10}'),
  ('frame_chain_15', 'frame', 'Chain x15', 0, '{"type":"best_chain","value":15}'),
  ('frame_chain_20', 'frame', 'Chain x20', 0, '{"type":"best_chain","value":20}'),
  ('frame_chain_25', 'frame', 'Chain x25', 0, '{"type":"best_chain","value":25}'),
  ('frame_chain_30', 'frame', 'Chain x30', 0, '{"type":"best_chain","value":30}'),

  -- 4. Consecutive clearing placements.
  ('frame_streak_3', 'frame', 'On a Roll',  0, '{"type":"clear_streak","value":3}'),
  ('frame_streak_5', 'frame', 'Unstoppable',0, '{"type":"clear_streak","value":5}'),
  ('frame_streak_8', 'frame', 'Perfect Run',0, '{"type":"clear_streak","value":8}')
on conflict (id) do nothing;

# CYBER BLAST — Backend & Retention Spec
### Phase 2: Supabase Leaderboard, Daily Challenge, Leagues, Progression

*Prerequisite: Phase 1 exit criteria met (see `cyber-blast-prototype-spec.md` §10). Do not start this until the core loop is proven fun.*

---

## 0. Scope and Guiding Principle

**Build order within Phase 2:**
1. Anonymous identity + score submission with server validation
2. Daily Challenge
3. Weekly leagues
4. Streaks + daily quests
5. Cosmetic unlocks (themes)

**The single governing rule of this entire document:**

> The client is hostile. It is a web build — every line of your JavaScript is readable in a browser dev console. Any value the client can compute, a player can forge. The server is the only place truth exists.

A real, documented failure: a developer's game validated scores in the browser, so a player opened the dev console, called the submit function directly with a negative time, and took #1 with a physically impossible score. Design as though this will happen in week one, because if the game gets any traction it will.

---

## 1. Identity Model

**Use Supabase anonymous sign-in.** No email, no password, no signup wall at launch.

Rationale: a signup gate in front of a casual puzzle game is a retention disaster — you lose players before they've played. Anonymous auth gives every device a real `auth.uid()`, which is all RLS and leaderboards need.

Flow:
- First launch → `supabase.auth.signInAnonymously()` → create a `profiles` row
- Player picks a display name at first leaderboard submission (not before)
- Offer optional account linking (email/Apple/Google) later, framed as "save your progress" — this becomes valuable once the player has streaks and unlocks to lose

**Display name moderation:** leaderboards attract abuse. Publicly visible names need a profanity filter and a report path. Log the incident, don't build a bespoke system — a wordlist check in the Edge Function plus a `is_shadowbanned` flag on `profiles` is enough at this stage.

---

## 2. Database Schema

```sql
-- ============ PROFILES ============
create table profiles (
  id              uuid primary key references auth.users(id) on delete cascade,
  display_name    text,
  created_at      timestamptz not null default now(),
  is_shadowbanned boolean not null default false
);

-- ============ PLAYER WALLET (server-write only) ============
-- Deliberately SEPARATE from profiles. The client needs UPDATE on profiles
-- to change its display name; if xp/currency/streak lived there, the client
-- could print currency and fake streaks under that same policy.
-- Currency the client can write is currency the client can print.
create table player_wallet (
  user_id         uuid primary key references profiles(id) on delete cascade,
  xp              integer not null default 0 check (xp >= 0),
  currency        integer not null default 0 check (currency >= 0),
  streak_days     integer not null default 0,
  last_played_on  date,
  days_played     date[] not null default '{}'   -- rolling window, see §6.2
);

-- ============ RUNS (every game session) ============
create table runs (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references profiles(id) on delete cascade,
  -- session integrity
  started_at     timestamptz not null default now(),
  submitted_at   timestamptz,
  status         text not null default 'active'
                   check (status in ('active','submitted','rejected','expired')),
  -- context
  mode           text not null default 'endless'
                   check (mode in ('endless','daily','limited')),
  challenge_date date,          -- non-null only for mode = 'daily'
  seed           bigint not null,
  move_limit     integer,       -- non-null only for mode = 'limited'
  -- results (written only by the server on submit)
  score          integer,
  placements     integer,
  max_cascade    integer,
  duration_ms    integer,
  reject_reason  text
);

create index runs_leaderboard_idx
  on runs (mode, challenge_date, score desc)
  where status = 'submitted';

create index runs_user_idx on runs (user_id, submitted_at desc);

-- One scored daily attempt per player per day, enforced by the DATABASE.
-- §4.2 rule 9 checks this in application code, but two concurrent submits
-- can both pass that check before either commits. This index makes the
-- race impossible rather than unlikely.
create unique index runs_one_daily_per_player
  on runs (user_id, challenge_date)
  where mode = 'daily' and status = 'submitted';

-- ============ DAILY CHALLENGE ============
create table daily_challenges (
  challenge_date date primary key,
  seed           bigint not null,
  config         jsonb not null default '{}'::jsonb  -- board size, blockers, etc.
);

-- ============ LEAGUES ============
create table league_seasons (
  id         uuid primary key default gen_random_uuid(),
  starts_on  date not null,
  ends_on    date not null,
  is_active  boolean not null default true
);

create table league_groups (
  id         uuid primary key default gen_random_uuid(),
  season_id  uuid not null references league_seasons(id) on delete cascade,
  tier       integer not null,        -- 1 = bronze ... n = highest
  capacity   integer not null default 30
);

create table league_members (
  group_id   uuid not null references league_groups(id) on delete cascade,
  user_id    uuid not null references profiles(id) on delete cascade,
  points     integer not null default 0,
  primary key (group_id, user_id)
);

-- ============ COSMETICS ============
create table unlockables (
  id          text primary key,          -- e.g. 'theme_vaporwave'
  kind        text not null,             -- 'theme' | 'block_style' | 'trail'
  cost        integer not null default 0,
  unlock_rule jsonb                      -- e.g. {"type":"cascade_depth","value":5}
);

create table player_unlocks (
  user_id      uuid not null references profiles(id) on delete cascade,
  unlockable_id text not null references unlockables(id) on delete cascade,
  unlocked_at  timestamptz not null default now(),
  primary key (user_id, unlockable_id)
);
```

---

## 3. Row Level Security — The Critical Part

**Default posture: deny everything, then open the minimum.**

```sql
alter table profiles       enable row level security;
alter table player_wallet  enable row level security;
alter table runs           enable row level security;
alter table league_members enable row level security;
alter table player_unlocks enable row level security;
alter table daily_challenges enable row level security;

-- PROFILES: display_name must be world-readable, because leaderboards
-- render other players' names. Only non-sensitive columns live here now.
create policy "read all profiles" on profiles
  for select using (true);

create policy "update own display name" on profiles
  for update using (auth.uid() = id)
  with check (auth.uid() = id);

-- PLAYER WALLET: read own only. NO insert or update policy exists —
-- xp, currency and streaks are written exclusively by Edge Functions.
create policy "read own wallet" on player_wallet
  for select using (auth.uid() = user_id);

-- RUNS: read own only. NO client insert. NO client update. Ever.
create policy "read own runs" on runs
  for select using (auth.uid() = user_id);

-- Note: there is deliberately NO insert or update policy on runs.
-- Only the service_role key (Edge Functions) can write. This is the
-- entire anti-cheat foundation — do not add a client insert policy
-- "temporarily for testing".

-- DAILY CHALLENGES: readable only for today and earlier.
create policy "read past and present challenges" on daily_challenges
  for select using (challenge_date <= current_date);
```

**Guard against these three specific mistakes:**

1. **Never ship the `service_role` key to the client.** It bypasses all RLS. It lives only in Edge Function environment variables.
2. **Never expose future daily seeds.** The policy above is why — leaking tomorrow's seed lets someone pre-solve the board offline.
3. **Never move `xp`, `currency` or streak state back into `profiles`.** They live in `player_wallet` precisely because the client holds UPDATE on `profiles` for display-name changes. Merging the tables for convenience would silently re-open the hole. **Currency the client can write is currency the client can print.**
4. **Add a column-level guard on `profiles` UPDATE.** The policy above lets a client update *any* column it can see on its own row — today that's only `display_name` and `is_shadowbanned`. A player unbanning themselves is a real risk. Enforce with a trigger that rejects any client-originated change to `is_shadowbanned`.

---

## 4. Edge Functions

Three functions. All Deno/TypeScript, all using the `service_role` key.

### 4.1 `start-run`

**Purpose:** issue a server-authored session so a score can never be submitted for a game that was never played.

```
INPUT:  { mode: 'endless' | 'daily' | 'speedrun' }
AUTH:   requires valid JWT (anonymous is fine)

LOGIC:
  1. Reject if user has > 3 'active' runs (prevents token farming)
  2. Expire any active runs older than 2 hours
  3. Determine seed:
       - endless/speedrun → server-generated random bigint
       - daily            → look up daily_challenges for current_date
                            (create it lazily if missing)
  4. INSERT runs row (status='active', started_at=now(), seed)
  5. Return { runId, seed, config }

OUTPUT: { runId: uuid, seed: bigint, config: object }
```

**Design note:** the seed comes *from the server*. The client renders the board from that seed using the same deterministic PRNG the server knows. This means the server can later replay and verify — and it means the daily challenge is genuinely identical for every player worldwide.

### 4.2 `submit-run`

**Purpose:** the anti-cheat chokepoint. This is the most security-sensitive code in the project.

```
INPUT:  { runId, score, placements, maxCascade, moveLog? }
AUTH:   requires valid JWT

VALIDATION CHAIN (reject on first failure, record reject_reason):

  1. OWNERSHIP    run.user_id === auth.uid()
  2. STATE        run.status === 'active'
  3. TYPES        all values are non-negative integers
  4. FRESHNESS    now() - run.started_at < 2 hours
  5. CEILING      score <= MAX_SCORE_PER_PLACEMENT * placements
  6. CASCADE      maxCascade <= MAX_CASCADE_DEPTH (from gameplay config)
  7. PACING       (now() - run.started_at) >= placements * MIN_MS_PER_PLACEMENT
  8. BOARD LIMIT  placements <= MAX_PLAUSIBLE_PLACEMENTS
  9. DAILY ONCE   if mode='daily', reject if user already has a submitted
                  run for this challenge_date
 10. RATE LIMIT   max 20 submissions per user per hour

ON PASS:
  - UPDATE run: status='submitted', score, placements, maxCascade, duration_ms
  - Award XP and currency (server-computed from score — never client-supplied)
  - Update streak (see §6)
  - Add league points (see §5)
  - Return { accepted: true, rank, leagueDelta, rewards }
```

**Deriving the ceiling constants.** Compute these from your gameplay config, don't guess:

```
Board 8×8 = 64 cells
Max points for a single cell = POINTS_PER_CELL_BASE × (MAX_CASCADE_DEPTH + 1)
                             = 10 × 5 = 50
Absolute max cells clearable in one placement = 64 (full board wipe)
Max piece size = 5 cells → 5 placement points

MAX_SCORE_PER_PLACEMENT = (64 × 50) + 5 = 3205  → round to 3300
MIN_MS_PER_PLACEMENT    = 250    (sustained human drag-and-drop floor)
MAX_PLAUSIBLE_PLACEMENTS = 5000
```

These are deliberately generous — they're a physics check, not a skill check. Their job is to eliminate all trivial cheating (setting score to zero, negative, or integer max) with zero false positives against legitimate players. Tighten them later using real telemetry from `runs`, once you know the actual p99.9 of human play.

**Optional hardening (add only if the game gets traction):** have the client send a compressed `moveLog` — the ordered list of placements. The server replays it against the same seed with the same core logic and recomputes the score independently. This is near-unforgeable, because the `src/core/` module from Phase 1 is already pure and engine-free — you can run the exact same TypeScript in the Edge Function. **This is the payoff for the "no Phaser imports in core" architectural rule.** Don't build it at launch; do design so it stays cheap to add.

### 4.3 `get-leaderboard`

Read path. Can be a Postgres RPC rather than an Edge Function.

```sql
create or replace function get_leaderboard(
  p_mode text,
  p_date date default null,
  p_limit int default 100
)
returns table (rank bigint, display_name text, score int, max_cascade int)
language sql security definer stable as $$
  select
    row_number() over (order by r.score desc, r.submitted_at asc) as rank,
    p.display_name, r.score, r.max_cascade
  from runs r
  join profiles p on p.id = r.user_id
  where r.status = 'submitted'
    and r.mode = p_mode
    and (p_date is null or r.challenge_date = p_date)
    and p.is_shadowbanned = false
  order by r.score desc, r.submitted_at asc
  limit least(p_limit, 100);
$$;
```

Always cap the limit server-side. Also expose a companion `get_my_rank()` so a player outside the top 100 still sees their own standing — otherwise the board is meaningless to almost everyone.

---

## 5. Leagues — The Leaderboard That Actually Retains

**Why not a global all-time board:** it is demotivating to the ~99% of players who will never appear on it. A new player looks at an unreachable number and disengages.

**Model:** weekly seasons, players assigned to groups of ~30, promotion and relegation across tiers.

```
Season length:   7 days, Monday 00:00 UTC → Sunday 23:59 UTC
Group size:      30 players, same tier, assigned on first play of the season
Points:          SUM of each day's single best run score, across the season.
                 Pinned deliberately: "best single run of the season" rewards
                 one lucky game and then gives you no reason to return until
                 Monday. Cumulative daily-best rewards showing up every day,
                 which is the behaviour the whole retention model depends on.
                 Implementation: on submit, upsert that day's best for the
                 player, then recompute league_members.points as the sum.
End of season:   top 7 promote, bottom 7 relegate, middle stays
Tiers:           Bronze → Silver → Gold → Neon → Overdrive (5 is enough)
```

Every player is always in a race of 30 people they can plausibly win. This is the Duolingo model, and it is the single highest-value leaderboard *design* decision in this document — the same infrastructure, dramatically better psychology.

**Group assignment:** lazily, on the player's first submission of the season. Fill the newest non-full group at their tier; create a new group when none has space. Avoid pre-allocating groups for dormant players — a group of 30 where 25 are inactive feels dead.

---

## 6. Daily Challenge, Streaks and Quests

### 6.1 Daily Challenge
- One globally-seeded board per UTC day, identical for every player
- One scored attempt per player per day (enforced server-side, §4.2 rule 9)
- Its own leaderboard, resetting daily
- Result is shareable as a spoiler-free text/emoji card (see §7)

This is the highest-leverage single feature in Phase 2. It creates a fair global comparison, a daily conversation, and a concrete reason to open the app *today*.

### 6.2 Streaks
```
On successful submission:
  today = current_date (UTC)
  if last_played_on == today          → no change
  elif last_played_on == today - 1    → streak_days += 1
  elif last_played_on is null         → streak_days = 1
  else                                → streak_days = 1   (broken)
  last_played_on = today
```

**Forgiveness is the design point.** An escalating consecutive-day reward creates loss aversion that consistently outperforms a flat daily bonus, and it's one of the lowest-cost D7 levers available — but a hard 7-day reset breaks habits permanently, whereas a rolling "3 of 7 days this week" framing is more forgiving and more sustainable. Implement the strict counter above for display, but base *rewards* on the rolling weekly count. Add one "streak freeze" item purchasable with currency.

### 6.3 Daily Quests
Three rotating micro-objectives, server-issued and server-verified from `runs` data:
- "Trigger a depth-3 cascade"
- "Clear 50 cyan blocks"
- "Score 4,000 in a single run"

Cheap to build, and they give direction to an otherwise open-ended score chase. Verify against submitted run data only — never trust a client claim of completion.

---

### 6.4 Constraint on unlockable themes

Cosmetic palettes are the meta-progression reward and the eventual monetisation path — but in this game **colour is the core mechanic, not decoration**. Every unlockable theme must independently satisfy the colour-accessibility requirement from the prototype spec (§4.1): five mutually distinguishable hues, plus working glyph mode.

Treat this as a hard gate on shipping a theme, not a polish pass. A palette where two block colours are hard to tell apart isn't a cosmetic variant — it's a broken game state that players have paid for or grinded toward.

---

## 7. Share Card (build this — it is cheap and it is marketing)

Wordle-style, spoiler-free, plain text so it pastes anywhere:

```
CYBER BLAST · Daily #142
Score 8,240 · Chain ×4
🟦🟪🟩🟨🟪
Rank 312 / 18,441
```

Zero backend cost. No image generation. It is simultaneously a retention hook, a social proof mechanism, and organic user acquisition — the cheapest growth lever available to a solo build.

---

## 8. Cost and Scaling

| Concern | Reality |
|---|---|
| Free tier | Comfortably sufficient for prototype and early launch |
| Realtime | Caps around 10,000 concurrent connections on Pro, and degrades before that depending on message volume |
| Do you need Realtime? | **No.** A leaderboard does not need live updates. Fetch on view, cache 30–60s. Add Realtime only if there's a genuine live-competition feature. |
| Vendor lock-in | Low — it's open-source Postgres, self-hostable if you outgrow it |
| Alternatives | Talo and CheddaBoards give server-validated leaderboards in 10–15 minutes with free tiers. Game Center / Google Play Games Services are free but platform-siloed, so no unified cross-platform board. |

**Recommendation:** stay on Supabase. You need a real database anyway for daily challenges, leagues, streaks and unlocks — a leaderboard-only service would leave you running two backends.

---

## 9. Claude Code Build Sequence

**Step 1 — Project + auth.** Supabase project, anonymous sign-in, `profiles` table with trigger-on-signup. Verify a user row is created on first launch.

**Step 2 — Schema + RLS.** All tables from §2, all policies from §3. **Write RLS tests before moving on:** attempt a direct client insert into `runs` with the anon key and assert that it fails. If it succeeds, stop and fix it.

**Step 3 — `start-run` / `submit-run` Edge Functions.** Full validation chain from §4.2. Unit test every rejection branch with a deliberately malicious payload — negative score, integer max, zero elapsed time, replayed token, someone else's `runId`.

**Step 4 — Client integration.** Wire Phase 1's game to call `start-run` on game start and `submit-run` on game over. Handle offline gracefully: queue the submission, retry, never lose a legitimate score.

**Step 5 — Leaderboard UI.** Top 100 + own rank. Neon styling per the Phase 1 theme spec.

**Step 6 — Daily Challenge.** Seeded board, one attempt per day, daily board, share card.

**Step 7 — Leagues.** Group assignment, points accrual, weekly promotion/relegation job (Supabase scheduled function / pg_cron).

**Step 8 — Streaks, quests, cosmetic unlocks.**

**Model note:** Steps 3 and 7 carry the real reasoning load — the validation chain and the season rollover logic both have subtle edge cases (clock boundaries, concurrent submissions, partially-full groups). Worth the strongest model available. Steps 1, 2, 5 are largely conventional and a faster model will handle them fine.

---

## 10. Phase 2 Exit Criteria

1. A direct client write to `runs` with the anon key is rejected. Verified, not assumed.
2. Every rejection branch in `submit-run` has a passing test with a hostile payload.
3. You have personally attempted to cheat your own leaderboard from the browser console and failed.
4. The Daily Challenge produces an identical board for two different devices on the same date.
5. League promotion/relegation runs correctly across a simulated season boundary, including a partially-full group.
6. D1 and D7 retention are being measured. **You cannot tune retention you aren't measuring** — instrument before you optimise.

---

## 11. Explicit Non-Goals for Phase 2

- Real-money transactions or IAP (Phase 3)
- Ad SDKs (Phase 3)
- Friend systems, guilds, chat (Phase 3+, high moderation cost)
- Live multiplayer — Supabase Realtime is a notification channel, not a game networking layer, and this game does not need one
- Cross-device account migration beyond optional auth linking

# CYBER BLAST — Leaderboard Architecture & Retention Mechanics
### Research brief — Phase 2/3 planning

> **Sequencing note:** none of this gets built until Phase 1 clears the §10 exit criteria in the prototype spec. It is researched now so the Phase 1 data model doesn't box you in — specifically the RNG seeding decision in §2.3, which must be made *during* Phase 1 or retrofitting it becomes a rewrite.

---

# PART 1 — GLOBAL LEADERBOARD

## 1. Can Supabase work? Yes — and it's a good fit for this specific game.

Supabase is a Postgres-backed platform with auth, a REST API (PostgREST), serverless Edge Functions, Row Level Security, and realtime subscriptions. It isn't marketed as a game backend, but for persistence-and-leaderboards workloads it handles the job well.

**Why it fits Cyber Blast specifically:**

The decisive question for Supabase suitability is *how chatty your client is*. Per an engineer who shipped a production game on it, the pattern to follow is submitting scores once at the end of a round rather than incrementally during gameplay, and batching reads on login instead of spreading them across screens. Cyber Blast is a single-player, turn-based, offline-capable puzzle game. It talks to the server maybe three times per session: fetch a seed, fetch the leaderboard, submit one score. That is close to the ideal Supabase workload.

Where Supabase is the wrong tool — real-time multiplayer, frame-rate state sync, chatty clients messaging each other multiple times per second — describes nothing you're building.

**Realtime caveat:** Supabase Realtime caps around 10,000 concurrent connections on Pro/Team plans, and performance degrades before that depending on message volume. For a live-updating leaderboard, subscribe only when the player opens the leaderboard screen and unsubscribe when they leave. Never hold persistent subscriptions.

## 2. Anti-cheat — the actual hard problem

### 2.1 The failure mode, documented

Client-submitted scores are inherently untrustworthy. As one analysis puts it plainly: a cheating client can bypass any validation the client performs, so client-side score validation is not useful for anti-cheat purposes.

A concrete, public example: a player topped an indie game's leaderboard with a **negative time score**. They opened browser devtools, found the game validated scores client-side, called the game's own `submitScore()` function directly from the console with a fabricated value, and it wrote straight to Firebase.

**This is not an edge case for you — it is the default outcome.** A Phaser/TypeScript web build wrapped in Capacitor ships its entire logic as readable JavaScript. Anyone with devtools open can call your functions.

Multiple indie developers in the same discussions concluded the cost of anti-cheat wasn't worth it and fell back to local-only leaderboards. That is a legitimate option (see §2.5) — but it's a decision to make deliberately, not to discover after launch.

### 2.2 Layer 1 — Range and sanity validation (mandatory, cheap)

Server-side range checking rejects impossible values without any heuristics: is the submitted score within the range physically possible given the game's rules?

For Cyber Blast, enforce in an Edge Function:
- Score > 0 and integer
- Score ≤ theoretical maximum for the reported number of placements
- Placements ≥ minimum required to reach that score
- Session duration plausible (not 400 placements in 9 seconds)
- Score is achievable given `MAX_CASCADE_DEPTH` and the scoring formula

This kills all trivial cheating — negative scores, `MAX_INT`, zero-second games — for maybe an hour of work. **Do this even if you do nothing else.**

### 2.3 Layer 2 — Deterministic replay verification (the strong option, and viable for this game)

This is where Cyber Blast has a structural advantage most games don't.

Your game is **discrete-turn, deterministic, and low-input-volume**. A full game is roughly 50–150 placements, each expressible as `(pieceIndex, gridX, gridY)`. That's a payload of a few kilobytes.

**The scheme:**
1. Client requests a game session from an Edge Function. Server generates a **random seed**, stores it against a session ID, returns both.
2. Client seeds its piece-generation RNG with the server's seed. All piece shapes and colours are now deterministic and server-known.
3. Player plays. Client records the ordered placement list.
4. On game over, client submits `{sessionId, placements[], claimedScore}`.
5. Edge Function **re-runs the game logic server-side** from the seed and the placement list, and computes the true score. If it doesn't match the claim, reject.

**Why this is genuinely achievable here:** your prototype spec already mandates that `src/core/` contains pure logic with zero Phaser imports. That same TypeScript module can be deployed directly into a Deno Edge Function. You write the verifier once and it *is* the game. This is the single strongest argument for the architecture decision already made in the spec — it wasn't chosen for anti-cheat, but it pays off here.

**Requirements this imposes on Phase 1:**
- Piece generation must use a **seeded, deterministic PRNG** (e.g. mulberry32 or xorshift), never `Math.random()`.
- Core logic must be fully deterministic — no floating-point score maths, no `Date.now()` inside game logic.
- **Make this decision in Phase 1.** Retrofitting determinism after the fact means rewriting piece generation, scoring, and every test.

**What it still doesn't stop:** a botted client that plays legitimately but optimally, or a modified client that replays a genuinely-computed optimal solve. That's a much smaller problem than forged scores and can be handled by anomaly detection (§2.4).

### 2.4 Layer 3 — Rate limiting, anomaly detection, human review

- Rate limit submissions per user and per IP.
- Cap sessions per hour.
- Flag statistical outliers — scores far above the distribution, superhuman placement rates, identical placement sequences across accounts.
- Sign requests (HMAC) — raises the bar, doesn't eliminate the problem, since the key ships with the client.

Critically: automated detection should inform a decision, not make it. Statistical outlier detection, session log analysis, and server-side validation are inputs; the final call on removing a score should involve human review, particularly for scores near the boundary of what's mechanically possible. Build an admin view where you can inspect and remove entries manually.

### 2.5 The pragmatic fallback

If leaderboard integrity proves more work than it's worth, the honest alternatives are:
- **Local/device-only leaderboard** — the classic arcade high-score table. Zero infrastructure, zero cheating incentive, zero social pull.
- **Friends-only leaderboards** — cheating a leaderboard of six people you know is socially self-policing.
- **Platform-native** — Apple Game Center and Google Play Games Services provide leaderboards free, with platform-managed identity. Downside: they don't talk to each other, so you get two separate siloed leaderboards rather than one global one, plus no web build support.

**My recommendation:** Layer 1 at minimum, Layer 2 if the game is doing well enough to be worth cheating on. Don't build Layer 2 speculatively — but *do* make the seeded-PRNG decision in Phase 1 so the option stays open.

## 3. Schema sketch

> ⚠️ **SUPERSEDED — do not build from this.** The schema below was an early
> sketch and uses a `sessions` + `scores` split. The canonical, buildable
> schema is §2 of `cyber-blast-backend-spec.md`, which consolidates both into
> a single `runs` table and adds the wallet separation, league tables and
> daily-challenge guards. This section is retained only for the reasoning
> around read paths, time windows and rank queries.

```sql
-- Player identity
create table profiles (
  id uuid references auth.users primary key,
  display_name text unique not null,
  created_at timestamptz default now()
);

-- Server-issued game sessions (enables replay verification)
create table sessions (
  id uuid primary key default gen_random_uuid(),
  player_id uuid references profiles(id),
  seed bigint not null,
  issued_at timestamptz default now(),
  consumed boolean default false
);

-- Verified scores only
create table scores (
  id bigserial primary key,
  player_id uuid references profiles(id) not null,
  session_id uuid references sessions(id) unique not null,
  score int not null check (score > 0),
  max_cascade int not null,
  placements int not null,
  duration_ms int not null,
  period date not null,              -- for daily/weekly boards
  created_at timestamptz default now()
);

create index scores_leaderboard_idx on scores (period, score desc);
create index scores_player_idx on scores (player_id, score desc);
```

**Write path:** clients have **no INSERT permission** on `scores`. RLS denies all direct writes. The only path in is the Edge Function running with the service role after verification. This is non-negotiable — RLS policies are enforced at the database level, so even a malicious client crafting custom requests is rejected.

**Read path:** `scores` is world-readable via RLS. Index on `(period, score desc)` makes top-N queries trivial. For "my rank and neighbours," use a window function (`rank() over (order by score desc)`) in a Postgres function; if the table grows past a few hundred thousand rows, switch to a periodically-refreshed materialized view or a Redis sorted set rather than computing rank on every read.

**Time windows:** the `period` column gives you daily, weekly, and all-time boards from one table. Daily/weekly resets are strongly preferable to all-time-only — an all-time board becomes a frozen monument to the top 10 within weeks, and every new player is permanently rank 40,000. Rolling boards keep the top spot winnable.

## 4. Alternatives compared

| Platform | Vendor lock | Getting started | Data model | Notes for Cyber Blast |
|---|---|---|---|---|
| **Supabase** | Low | Easy | SQL (Postgres) | Real SQL, RLS, Edge Functions for verification. No official JS SDK issues — it's a web game. **Recommended.** |
| Firebase | Medium | Easy | NoSQL | Firestore is NoSQL; relational game data becomes a fight. Popular but you'd restructure repeatedly. |
| PlayFab | High | Easy | Proprietary | Full-featured, Microsoft-backed, but proprietary entity model and painful migration. Overkill here. |
| Nakama | Low | Medium | SQL/Lua | Open-source, strong realtime — but you're managing game-specific infrastructure you don't need. |
| Game Center / Play Games | N/A | Easy | Platform | Free, identity handled, but two siloed boards and no web support. |
| Custom server | None | Hard | Yours | Maximum flexibility, maximum ops burden. Not for a solo first game. |

## 5. Names, privacy, moderation

- **Display names need moderation.** Cheated leaderboards get used to display abuse — one developer reported people cheating specifically to put racist text on the board. Profanity-filter on write, and keep a manual removal path.
- **Anonymous vs authenticated:** anonymous auth (Supabase supports it) lowers signup friction dramatically but makes ban evasion trivial. Reasonable compromise: anonymous play by default, account required to appear on the global board.
- **Privacy/GDPR:** a display name plus a score is minimal PII, which keeps compliance light. Have a deletion path. If you don't age-gate, assume some players are children — which means COPPA/GDPR-K considerations and, practically, stricter name moderation.

---

# PART 2 — RETENTION MECHANICS

## 6. Benchmarks — and a caution about them

**Puzzle is one of the stickiest mobile genres.** GameAnalytics data across 11,600 games found the best genres for medium and long-term retention are board, card, puzzle and casino games, with puzzle showing the highest D7 retention of any genre. Arcade games lead on D1 but fall away.

**Ballpark figures** (treat as directional, not targets):

| Metric | Typical | Notes |
|---|---|---|
| D1 | ~22% median all-genre; 26–28% top quartile | iOS top quartile 31–33% vs Android 25–27% |
| D7 | ~3.4–3.9% median; 7–8% top quartile | Puzzle above average |
| D28/D30 | 75% of games below 3% | |
| Session length | ~4m45s median | Oceania longest at ~6.9 min |
| Sessions/day | ~3.7–5.5 depending on region | |

**Read this caveat before using any of the above.** One analyst notes bluntly that genre-level D1/D7/D30 tables for 2025–26 don't exist in openly published form, and that essentially every current genre table traces back to AppsFlyer Q3 2022 data wearing a fresh date. The same source flags that a 40% D1 target "matches nothing in the published data," and that pooled medians include a large share of small indie titles which drags them down.

**Practical implication:** benchmark against your own cohorts over time, not against a table. Your first week's D1 is a baseline to beat, not a grade.

**One number that should reframe your expectations:** paid user acquisition economics start working around a D7 of roughly 18%, against a measured top quartile of 7–8%. Most games are structurally organic-first and don't realise it. Assume Cyber Blast is organic-first — ASO, word of mouth, and possibly featuring. Plan retention mechanics to serve *organic* players, not to justify ad spend.

## 7. Your four ideas — assessed

You proposed: challenge unlocks, speed run, moving borders, larger boards, irregular/blocking shapes.

**I disagree with the framing, not the ideas.** Three of the five are *content variety* — they add depth for players already engaged. Only "challenges unlock" is a *retention mechanic* in the sense of creating a reason to return tomorrow. You need both, but conflating them means you'll build a deeper game and wonder why D7 didn't move.

### Assessed individually

**Irregular boards / blocked cells — build first. Highest value per hour.**
Pre-filled obstacle cells and non-rectangular board masks are nearly free: your `Board` class already handles cell states, so a blocked cell is just a third state that can never be filled or cleared. This single feature generates effectively unlimited level variety from code you've already written, and it interacts richly with cascades (obstacles channel chains into unexpected paths). **Strongest of your five.**

**Larger / variable board sizes — cheap, moderate value.**
If `BOARD_SIZE` is already a config constant, this is nearly free. But bigger boards make cascades *easier* and the game *easier*, not harder — more space means fewer forced bad placements. Test carefully; it may need to be paired with obstacles to stay challenging.

**Challenge unlocks — the only true retention mechanic in your list. Build second.**
This maps directly to the evidence. Daily missions act as an appointment mechanic, creating anticipation of time-limited rewards and turning casual players into regulars. Structure as: one daily challenge (a specific seeded board with a target score), plus 2–3 rotating weekly objectives.

**Moving / shrinking borders — high complexity, defer.**
Genuinely novel and would differentiate, but it's the most invasive change to your core loop: every placement-validity check, cascade resolution, and render path has to handle a mutating grid. It's also the hardest to communicate to a player in one glance. Prototype it as a *mode*, late, after the game is proven.

**Speed run — I'd push back on this one.**

**I disagree because it fights your core mechanic.** Colour Cascade rewards deliberate planning — surveying the board, identifying colour clusters, setting up chains several placements ahead. A timer punishes exactly that behaviour and converts the game into fast pattern-matching, which is the generic block-puzzle experience you differentiated *away* from. You'd be adding a mode that showcases your game at its least distinctive.

**What I'd recommend instead:** a **limited-placements challenge** — "score 5,000 in 20 placements." It creates identical tension and urgency (every move matters, there's a fail state, it's leaderboard-friendly) but rewards planning rather than punishing it, which reinforces the cascade mechanic instead of undermining it. It's also trivially easier to implement than a real-time timer.

**The risk in the speed-run approach** is that it becomes the mode people play, your cascade depth statistics collapse because nobody has time to set up chains, and the mechanic you built the game around goes unused.

## 8. What the evidence says actually moves retention

Ranked by evidence strength and effort-to-value for a solo build:

**Tier 1 — build these**

1. **Daily challenge (appointment mechanic).** One seeded board per day, same for every player globally, with a daily leaderboard. This is the highest-leverage single feature available to you: it creates a daily reason to return, it's naturally shareable ("I got 8,400 on today's board"), and it costs almost nothing — the seed is the content. It also pairs perfectly with the §2.3 replay verification, since everyone plays the same seed.

2. **Streaks.** Consecutive-day play counters. Loyalty streaks with escalating value reward consistent engagement, and loss-aversion is a strong driver once a streak has length. Cheap to build. Be careful not to make breaking one feel punitive.

3. **Progression / unlocks.** Neon palette variants, board skins, cascade effect styles, unlocked by cumulative play or challenge completion. Gives long-session players something accruing.

**Tier 2 — build once Tier 1 is live and measured**

4. **Weekly quests / rotating objectives.** Quests are among the most effective live-ops tools for boosting retention. Cheap to configure once the framework exists.

5. **Time-limited events.** Time-limited events create urgency and novelty; daily jackpot events have become a staple of casual puzzle live-ops, deliberately kept brief and solvable in a player's first session of the day so they appeal across all engagement levels. Note that design detail — short and winnable, not a grind.

6. **Board variants as content drops.** Your irregular-board work becomes the payload for events.

**Tier 3 — defer or skip**

7. **Push notifications.** Genuinely effective but now a permission on both platforms, so opt-in rates are far lower than the folklore figures. Requires native wrapping. Meaningful annoyance/uninstall risk if overused.

8. **Battle pass / seasons.** Only sensible with a live audience and real content cadence. Premature for a first title.

9. **Social/teams/gifting.** High build cost, needs population density to work. Skip.

**A caution on all of the above:** no source publishes defensible per-tactic retention lift figures, and tables claiming to are internally inconsistent. Nobody can tell you "daily challenges add 4 points of D7." Ship them, measure your own cohorts, and be willing to remove what doesn't move.

## 9. Recommended build order

```
Phase 1  Core loop prototype                      ← current
         + SEEDED DETERMINISTIC PRNG (decide now)

Phase 2  Irregular boards / blocked cells
         Daily challenge (local, no backend)
         Streak counter (local)
         → measure D1/D7 on your own cohorts

Phase 3  Supabase: auth, sessions, scores table
         Edge Function: range validation (Layer 1)
         Daily + weekly leaderboards
         Name moderation + admin removal

Phase 4  Replay verification (Layer 2) — only if
         the game is popular enough to be cheated
         Progression unlocks, weekly quests, events

Later    Moving borders (as a mode)
         Limited-placement challenge mode
         Push notifications (needs native wrapper)
```

**The one thing that must happen in Phase 1:** seeded deterministic piece generation. Everything else on this list can be added later without a rewrite. That one cannot.

---

## Sources

Primary sources consulted: Adil Bouchnita, *Supabase as a Game Backend: A Practical Guide* (Apr 2026); Bugnet, *Debugging Leaderboard Score Anomalies and Cheating False Positives* (Mar 2026); itch.io developer/player discussion threads on leaderboard cheating; GameAnalytics mobile gaming benchmarks 2025 (11,600 games, 1.48bn MAU) via GameDev Reports; Game Growth Advisor, *Mobile Game Retention Guide 2026* (methodology critique); Deconstructor of Fun on daily missions in puzzle games; Naavik, *Converging Live Ops Trends in Mobile Puzzle*; Supersonic D30 retention playbook; Adjust live-ops guide; Segwise retention benchmarks.

**Reliability note:** several retention sources are vendor blogs (analytics platforms, ad networks, dev agencies) with an interest in the conclusions they publish. The GameAnalytics dataset and the Game Growth Advisor methodology critique are the most trustworthy items in the list. The leaderboard-cheating evidence is first-hand developer accounts, which is weaker than formal research but more directly relevant than either.

# CYBER BLAST — Project Index & System Check
*Working title. Trademark check outstanding — see Phase 3 spec §4.3.*

---

## The Documents

| # | File | What it is | Status |
|---|---|---|---|
| 0 | `00-START-HERE.md` | This file. Index, canonical phase numbering, system check. | Read first |
| 1 | `cyber-blast-prototype-spec.md` | **Phase 1** — core loop prototype | Canonical |
| 2 | `cyber-blast-backend-spec.md` | **Phase 2** — Supabase, leaderboards, retention | Canonical |
| 3 | `cyber-blast-phase3-launch-spec.md` | **Phase 3** — limited-moves mode, ads, IAP, store submission | Canonical |
| 4 | `cyber-blast-leaderboard-retention-research.md` | Research brief — evidence and reasoning | Reference only. §3 superseded. |
| 5 | `claude-code-prompts.md` | Copy-paste prompts, one per build step | Working doc |

**Precedence rule:** where documents disagree, the canonical specs win over the research brief. Where the specs disagree with each other, this file wins.

---

## Canonical Phase Numbering

The three documents were written at different times and used three conflicting numbering schemes. **This is now the only one:**

```
PHASE 1  Core loop prototype. Browser only. No backend, no art polish.
         Gate: is the cascade mechanic actually fun?

PHASE 2  Supabase backend. Auth, server-validated scores, leaderboards,
         daily challenge, leagues, streaks, cosmetic unlocks.
         Gate: can you cheat your own leaderboard? (You must fail.)

PHASE 3  Limited-moves mode, analytics, Capacitor native wrap, ads, IAP,
         store compliance, submission to Google and Apple.
         Gate: shipped and earning.

PHASE 4  Post-launch. Live-ops, content variants (blocked cells, larger
         boards, moving borders), replay-verification anti-cheat if the
         game gets big enough to be worth cheating on.
```

Ignore any other phase numbers appearing inside the individual documents. The prototype spec's reference to "Phase 4 packaging" means Phase 3 here.

---

## System Check — Findings

Full cross-document review completed. Seven defects found; all now fixed.

### Fixed — would have caused real problems

**1. Client could print its own currency.**
`profiles` held `xp` and `currency`, and the client needs UPDATE on `profiles` to change its display name. The same policy therefore allowed a player to set their own balance to anything. The backend spec had flagged this as a risk in prose but left the vulnerable schema in place.
→ **Fixed:** `xp`, `currency` and streak state moved to a separate `player_wallet` table with a read-own policy and no write policy at all. Server-only.

**2. Daily-challenge "one attempt per day" was racy.**
Enforced only in application code. Two concurrent submissions could both pass the check before either committed, giving a player two scored daily attempts.
→ **Fixed:** partial unique index on `(user_id, challenge_date)` where mode is daily and status is submitted. The database now makes it impossible rather than unlikely.

**3. Leaderboards couldn't display names.**
The RLS policy was `select using (auth.uid() = id)` — read your own profile only. Every leaderboard renders *other players'* names, so the board would have shown nothing but your own row.
→ **Fixed:** profiles are world-readable, which is safe now that sensitive columns live in `player_wallet`.

**4. Two incompatible database schemas.**
The research brief specified `sessions` + `scores`; the backend spec specified a single `runs` table. Claude Code following both would have produced a broken hybrid.
→ **Fixed:** research brief §3 marked SUPERSEDED. Backend spec §2 is canonical.

### Fixed — smaller

**5. Speedrun mode still in the schema** after you'd decided against it. → Replaced with `limited`, plus a `move_limit` column and a matching server-side validation rule.

**6. League points were undefined.** The spec offered two options and picked neither. → Pinned to cumulative daily-best, because best-single-run gives a player no reason to return after one lucky game.

**7. A player could unban themselves.** The profiles UPDATE policy permits writing any visible column on your own row, including `is_shadowbanned`. → Trigger guard added to the spec.

### Known gaps — deliberately not fixed

- **No analytics spec.** Phase 2 exit criteria require D1/D7 measurement, but no document said how to instrument it. Now assigned to Phase 3 Step 2. Acceptable, because Phase 1 and 2 are pre-launch.
- **Content variants unspecified.** Blocked cells, larger boards and moving borders are assessed in the research brief but have no build spec. Deferred to Phase 4 — correctly, since they solve content exhaustion rather than habit formation.
- **Ad SDK plugin maturity unverified.** The Capacitor route means native ad SDKs need community plugins. This is the biggest unvalidated assumption in the whole plan. **Verify before Phase 3 Step 4.**

---

## The Riskiest Assumptions

Ordered by how much damage they'd do if wrong.

**1. That the cascade mechanic is fun.** Everything downstream assumes it. Phase 1 exists solely to test it, and the Phase 1 exit criteria include an explicit instruction to stop if it fails. Honour that.

**2. That Capacitor + native ad SDKs work smoothly.** The web stack was chosen for AI-assisted iteration speed, which was the right call for prototyping. The cost lands here. If ad plugins prove unworkable, the fallback is a Unity or Godot rebuild of a proven design — painful but not fatal, and much cheaper than having built in Unity from the start and discovered the game wasn't fun.

**3. That you can reach twelve real Google testers.** Non-negotiable, 14 continuous days, and the most common cause of a surprise month-long launch delay. Start recruiting in Phase 3 Step 1.

**4. That downloads will happen at all.** No document solves discovery. ASO and the share card are the plan; neither is reliable. This is the honest weak point of a solo launch with no UA budget, and it should be treated as an experiment rather than a projection.

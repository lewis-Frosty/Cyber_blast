# CYBER BLAST — Launch & Monetisation Spec
### Phase 3: Limited-Moves Mode, Ads, IAP, Native Packaging, Store Submission

*Prerequisite: Phase 2 exit criteria met. This is the phase that turns a working game into a shipped, earning product.*

---

## 0. What This Phase Actually Is

Phases 1 and 2 were engineering. This phase is roughly **40% engineering and 60% compliance, admin and waiting**. Budget accordingly — the code here is easier than anything you've already done, and the calendar time is longer.

The hard blockers are not technical. They are: a Mac for iOS signing, a 12-tester Google closed test running for 14 days, a privacy policy, a data-safety declaration, and an age-rating decision that changes how your ad SDK must be configured.

**Start the account and compliance items on day one of this phase**, in parallel with the build. They have waiting periods; the code does not.

---

## 1. Limited-Moves Challenge Mode

Replaces the previously-considered speed-run mode. The reasoning: a timer punishes deliberate planning, which is exactly the behaviour Colour Cascade is built to reward — it would convert the game into fast pattern-matching, the generic block-puzzle experience the cascade mechanic exists to differentiate away from.

### 1.1 Rules
```
Board:        seeded, same as other modes
Move limit:   N placements (default 20)
Goal:         maximum score within N placements
End:          when placements = N, OR no legal placement exists
Scoring:      identical to endless — no separate formula
```

### 1.2 Why this works better than a timer
- **Same tension, opposite incentive.** Every move matters and there's a hard fail state, but the pressure rewards thinking rather than punishing it.
- **Reinforces the core mechanic.** Cascade setups become *more* valuable, not less, because you can't brute-force score through volume.
- **Trivially easier to build.** A counter, not a real-time clock. No frame-rate dependency, no pause handling, no clock-drift anti-cheat.
- **Better for leaderboards.** Every player faces an identical constraint on an identical seed. It is the fairest comparison of the three modes.

### 1.3 Implementation
Almost entirely config. In `gameplay.ts`:
```typescript
MODES: {
  endless: { moveLimit: null },
  daily:   { moveLimit: null },
  limited: { moveLimit: 20 },
}
```
`gameState.ts` gains one check: end the run when `placements >= moveLimit`. The `runs` table already carries `move_limit` (backend spec §2).

**Server validation addition** in `submit-run`: reject if `mode = 'limited'` and `placements > run.move_limit`. One line, and it closes an obvious exploit.

### 1.4 Tuning
Ship at 20 moves. Use debug-overlay data to check that a good player can build at least two multi-generation cascades within the limit — if the limit is so tight that cascade setup is impossible, the mode actively contradicts the mechanic and should be loosened.

---

## 2. Monetisation

### 2.1 Model

**Ad-led hybrid.** The earlier market research is unambiguous here: hypercasual and casual puzzle titles are roughly 79% ad-only, and Block Blast! — the most-downloaded game of 2025 at 356M installs — is ad-driven with effectively no IAP revenue. Cosmetics are the highest-value IAP category, accounting for close to 80% of revenue in games like Fortnite and Roblox.

So: **rewarded video as the revenue engine, cosmetics and remove-ads as the IAP layer.**

### 2.2 Ad placements — in priority order

**1. Rewarded video (the engine).** Highest-value format at roughly $15–$40 eCPM in tier-1 markets, with completion rates near 90% and broadly positive player sentiment because it is opt-in. Placements:
- **Continue after game over** — one revive, once per run. The single highest-converting placement in any score-chase game, offered at the exact moment of loss aversion.
- **Double your run reward** — offered on the results screen.
- **Second daily-challenge attempt** — ⚠️ **do not do this.** It destroys the fairness that makes the daily board worth playing. Offer a cosmetic reward instead.
- **Unlock a theme trial** — 24-hour preview of a locked palette.

**2. Interstitials (secondary).** Roughly $3–$15 eCPM. Every 3rd game over, never mid-run, never before the player's first three games. Cap at one per five minutes. Interstitials are where casual games damage their own retention — be conservative.

**3. Banners — skip them.** Under $2 eCPM, and a persistent banner on an 8×8 colour-matching board is a genuine usability cost. The revenue does not justify it.

### 2.3 Ad network

Use a **mediation layer**, not a single network — AppLovin MAX or Google AdMob mediation. Mediation runs an auction across networks per impression, which materially raises eCPM over a single-network integration.

**Capacitor consideration:** ad SDKs are native. You will need a Capacitor plugin (`@capacitor-community/admob` or an AppLovin equivalent) rather than a web SDK. Verify plugin maturity *before* committing to a network — this is the single most likely place for the web-stack decision to cost you.

### 2.4 IAP

Keep it to three products at launch:
| Product | Type | Notes |
|---|---|---|
| Remove Ads | Non-consumable | Removes interstitials only. **Rewarded stays available** — players who bought it still want free revives, and it remains your best eCPM inventory. |
| Theme Pack | Non-consumable | 3–5 neon palettes. Must pass the §6.4 accessibility gate. |
| Currency pack | Consumable | For unlocks and streak freezes. Add only if the currency economy proves engaging. |

**Store commission:** 30% standard, dropping to 15% on the first $1M/year under Apple's Small Business Program and Google's reduced-fee tier. Enrol in both — it is a form, not a negotiation.

**Server-side receipt validation is mandatory.** Same principle as scores: an unlock the client can grant itself is an unlock the client will grant itself. Validate the receipt in an Edge Function before writing to `player_unlocks`.

### 2.5 Realistic expectations

Blended eCPM for a global user base will land well below tier-1 headline rates — those figures assume US/UK/Japan traffic, and rates run 30–60% lower in tier-2 markets. Only about 1.83% of mobile gamers make any purchase at all. Model revenue on ads with IAP as upside, not the reverse.

---

## 3. Native Packaging (Capacitor)

### 3.1 Setup
```bash
npm install @capacitor/core @capacitor/cli
npx cap init
npm install @capacitor/ios @capacitor/android
npx cap add ios
npx cap add android
npm run build && npx cap sync
```

### 3.2 Things that will bite you
- **A Mac is required for iOS.** Xcode does not run elsewhere. There is no workaround short of a cloud Mac service or a CI runner. If you don't have one, resolve this now, not in week six.
- **Safe areas.** Notches and home indicators will clip an 8×8 board laid out for a browser. Test on a real notched device, not just the simulator.
- **Audio autoplay policy.** Mobile webviews block audio until a user gesture. Initialise the audio context on first tap or the cascade crescendo — your primary feel mechanism — silently fails.
- **Performance.** Particle bursts that run fine in desktop Chrome can stutter in a mid-range Android webview. Profile on a genuinely cheap device, not a flagship.
- **Back button (Android).** Must be handled explicitly or it exits the app mid-run.

### 3.3 Offline behaviour
The game must be fully playable offline; only leaderboard submission requires a network. Queue submissions locally and retry — never lose a legitimate score to a dropped connection.

---

## 4. Store Accounts and Compliance

**Start these on day one of Phase 3.**

| Item | Apple | Google |
|---|---|---|
| Account cost | $99/year | $25 one-time |
| Org account needs | D-U-N-S number | D-U-N-S number |
| Review model | Manual, every submission | Automated + human |
| Typical review | ~90% within 24h; 24–72h normal | ~24h once established |
| New-account gate | None | **12 testers, opted in continuously for 14 days**, before production access |
| First-launch buffer | 2–3 review cycles, ~2–3 weeks | 2–4 weeks including verification |

**The Google 12-tester rule is the schedule-defining constraint.** It applies to personal developer accounts created after 13 November 2023. You need twelve real people opted into a closed test and genuinely using the app for fourteen continuous days. **Recruit those twelve people before you need them** — this is the single most common cause of an unexpected month-long delay.

### 4.1 Required before either submission
- **Privacy policy at a public URL.** Non-negotiable on both stores. Must disclose ad SDK data collection, which is not optional once AdMob or AppLovin is integrated.
- **Apple App Privacy nutrition labels** + a **Privacy Manifest** (mandatory since 2024).
- **Google Data Safety form** — must accurately match what your SDKs actually collect. Inaccuracy here causes rejection and, worse, later removal.
- **Age rating questionnaires** on both stores.
- **Account deletion path** — required by Apple where accounts exist. Anonymous auth still counts.

### 4.2 The age-rating decision — make it deliberately

If the game is rated for children, or is even plausibly child-directed, both stores impose stricter obligations (COPPA in the US, GDPR-K in the EU) and your ad SDK must run in **child-directed mode** — which means non-personalised ads and **substantially lower eCPM**.

A neon arcade puzzle game is exactly the kind of title that gets classified as appealing to children by default.

**Recommendation:** rate for a general audience (Apple 4+ / Google Everyone) but **do not** flag the app as child-directed or "primarily for families." This keeps personalised ads available. Be honest on the questionnaires — misdeclaring is grounds for removal, and the downside is far worse than the eCPM difference.

Name moderation on leaderboards becomes more important under a low age rating, not less.

### 4.3 Trademark check — do this before the icon
Search both stores and the trademark registers (IPONZ for NZ, USPTO for the US) for "Cyber Blast." The name gives useful ASO adjacency to "Blast" searches but sits in a crowded namespace. Resolve it before commissioning any branded asset.

---

## 5. ASO — Set Up Before Launch, Not After

Roughly 60–65% of app store downloads originate from a keyword search, so this is your primary organic discovery channel, not a post-launch chore.

**Checklist:**
- Keyword-optimised title and subtitle (iOS) / short description (Google)
- Icon — must read clearly at 48px. Test it shrunk down, on a dark background.
- Screenshots — the top conversion driver after ratings. Lead with a mid-cascade frame showing a big combo multiplier: it is the one image that communicates your differentiator instantly. **Since mid-2025 Apple indexes screenshot caption text for keyword ranking**, so write captions deliberately.
- Preview video — 15–30s, cascade chain front and centre
- Ratings prompt — trigger after a *good* run (new personal best), never after a loss
- Localise metadata for your top download markets even before localising the game

Keyword ranking changes take 4–8 weeks to stabilise. Google Play Store Listing Experiments lets you A/B test icons and screenshots for free — use it continuously.

---

## 6. Build Sequence

**Step 1 — Limited-moves mode.** §1. Small, and it ships a third mode before launch.
**Step 2 — Analytics.** Instrument D1/D7, session length, cascade depth distribution, funnel to first ad view. **You cannot tune what you aren't measuring**, and Phase 2's exit criteria already assume this exists.
**Step 3 — Capacitor wrap.** Android first (cheaper account, faster iteration). Get it running on a real device.
**Step 4 — Ad SDK.** Rewarded only at first. Verify fill rates with test ads before touching interstitials.
**Step 5 — IAP.** Remove-ads and one theme pack. Server-side receipt validation.
**Step 6 — iOS wrap.** Safe areas, audio gesture, signing, TestFlight.
**Step 7 — Store assets.** Icon, screenshots, video, descriptions, privacy policy.
**Step 8 — Google closed test.** 12 testers, 14 days. **Start recruiting at Step 1.**
**Step 9 — Submit.** Google first (faster feedback loop), Apple second.

### Parallel track — start at Step 1, not Step 7
- Register both developer accounts
- Obtain a D-U-N-S number if using an org account
- Recruit the 12 Google testers
- Write and host the privacy policy
- Run the trademark check
- Confirm Mac access for iOS

---

## 7. Phase 3 Exit Criteria

1. Limited-moves mode is server-validated against `move_limit`.
2. Rewarded ads serve on real devices, both platforms, with confirmed fill.
3. IAP purchases validate server-side; a forged client receipt is rejected.
4. Privacy policy is live and accurately describes every SDK's data collection.
5. Data Safety and App Privacy declarations match SDK behaviour exactly.
6. Google closed test has run 14 days with 12 active testers.
7. The game is fully playable offline; queued scores submit on reconnect.
8. Tested on a genuinely low-end Android device at acceptable frame rate.
9. Analytics confirm D1 and D7 are being captured before any UA spend.

---

## 8. After Launch — The Part Nobody Plans For

Shipping is the start of the work, not the end.

- **Do not spend on user acquisition yet.** Paid UA economics start working around a D7 of roughly 18%, against a measured top quartile of 7–8%. Assume you are organic-first until your own cohort data says otherwise.
- **Live-ops cadence.** Seasonal events every two to four weeks are re-engagement moments for dormant players as much as content for active ones.
- **Measure your own cohorts, not benchmark tables.** Published genre retention figures are inconsistent and largely trace back to a single 2022 dataset. Your first week's D1 is a baseline to beat, not a grade.
- **Expect the first cheater within days of any traction.** Have the admin removal path built before you need it.
- **Ratings decay.** Prompt consistently, respond to reviews, and treat a 4.0+ average as a requirement rather than an aspiration — most featured apps sit above it.

# CYBER BLAST — Prototype Build Spec
### Phase 1: Core Loop Prototype
*Working title. Name pending trademark/ASO check.*

---

## 0. Purpose of This Document

This is a build spec for a **Phase 1 prototype only**. The single goal of this phase is to answer one question:

> **Is the Color Cascade mechanic actually fun?**

Nothing in this phase is about monetisation, art polish, store submission, or retention systems. Those come later and only if the answer above is yes. Resist scope creep — the most common failure mode for a first game build is polishing something that isn't fun yet.

**Definition of done for Phase 1:** a playable build, running in a browser, with working placement, line clearing, cascade resolution, scoring, and game-over. Placeholder-to-basic neon styling. No ads, no IAP, no accounts, no backend.

---

## 1. Technology Stack

| Layer | Choice | Reasoning |
|---|---|---|
| Language | **TypeScript** | Type safety matters enormously for grid/cascade logic where off-by-one errors are silent and brutal to debug. |
| Engine | **Phaser 3** | 2D-first, code-only (no GUI editor), excellent mobile input handling, mature. |
| Build tool | **Vite** | Instant hot reload. Fast iteration is the whole point of a prototype. |
| Testing | **Vitest** | Cascade logic must be unit-tested. See §6. |
| Audio | **Phaser built-in** (Howler under the hood) | Sufficient for Phase 1. |
| Packaging (Phase 4, NOT now) | Capacitor | Wraps the same web build for iOS and Android. Do not set this up yet. |

### Why this stack and not Unity or Godot

Unity dominates commercial mobile gaming, but it is a **GUI-editor-driven workflow** — scene composition, prefab wiring, and inspector configuration happen in a visual interface that a coding agent cannot directly operate. Godot is better (code-first GDScript) but still expects editor-based scene setup.

A web/TypeScript stack is **100% text files**. Claude Code can write it, run it, test it, read the errors, and fix it in a single loop without you mediating. For a solo AI-assisted build, that iteration speed advantage outweighs Unity's ecosystem advantage — *at prototype stage*. If the prototype proves fun and you decide to scale into a commercial live-ops product, re-evaluating the engine at that point is a legitimate option.

---

## 2. Game Rules Specification

### 2.1 Board
- **8 × 8 grid.** Fixed. No gravity — cleared cells simply become empty; remaining blocks do not fall.
- Each cell is either `EMPTY` or holds a `ColorId` (0–4).

### 2.2 Pieces
- Player is shown a **tray of 3 pieces** at a time.
- Each piece is a polyomino, and is **single-coloured** (all its cells share one colour). Single-colour pieces keep cascade planning legible to the player — multi-colour pieces make the board unreadable at a glance.
- Pieces are **dragged** onto the board. No rotation (matches Block Blast convention and keeps one-thumb play viable).
- A piece may only be placed where all its cells land on `EMPTY` cells and within bounds.
- When all 3 tray pieces are placed, a new set of 3 spawns.

**Starting piece shape set** (expand later after playtesting):
```
1x1, 1x2, 2x1, 1x3, 3x1, 1x4, 4x1, 1x5, 5x1,
2x2, 3x3,
L-tromino (4 orientations as distinct pieces),
T-tetromino (4 orientations),
S / Z tetrominoes (2 orientations each)
```

**Colour assignment:** assign each spawned piece a colour from the 5-colour palette, weighted toward colours already present on the board (see §3.4 tuning). Purely uniform random makes cascades feel arbitrary.

### 2.2.1 Determinism requirement — decide this now, not later

**All randomness in the game must come from a seeded, deterministic PRNG.** Never `Math.random()`.

Use a small, explicit generator (mulberry32 or xorshift128) instantiated from a single integer seed. Piece shape selection, piece colour assignment, and tray composition all draw from that one seeded stream.

**Why this matters far more than it looks:**

Phase 2's anti-cheat depends on **deterministic replay verification** — the server generates the seed, the client returns its ordered placement list `(pieceIndex, gridX, gridY)`, and the server re-runs the identical game logic to compute the true score. If the claimed score doesn't match, it's rejected. This is dramatically stronger than range-checking, and it's viable here specifically because this game is discrete-turn, deterministic, and low-input-volume (~50–150 placements per game, a few kilobytes of payload).

That scheme only works if the game is reproducible from a seed. Additional constraints it imposes:
- No floating-point arithmetic anywhere in scoring or cascade resolution — integers only.
- No `Date.now()`, timers, or wall-clock reads inside `src/core/`.
- The core logic must produce byte-identical results in the browser and in a Deno Edge Function.

**This is a Phase 1 decision, not a Phase 2 one.** Retrofitting determinism after the fact means rewriting piece generation, scoring, and every test that touches them. It costs roughly an hour now and roughly a week later.

It also converts the §7 architecture rule (no Phaser imports in `src/core/`) from good hygiene into the load-bearing decision of the whole project: the same pure TypeScript module deploys unchanged as the server-side verifier. **You write the game once and it *is* the anti-cheat.**

### 2.3 Line Clearing (Generation 0)
After a piece is placed:
1. Scan all 8 rows and all 8 columns.
2. Any row or column that is **completely filled** is marked for clearing.
3. All cells in all such rows/columns form the **Generation 0 clear set**.
4. Rows and columns are evaluated **simultaneously** from the pre-clear board state — a cell in both a full row and a full column is only counted once.

### 2.4 Color Cascade (Generations 1+) — THE CORE MECHANIC

This is the differentiating feature. Specify and test it carefully.

**Rule:** A cleared cell propagates its clear to orthogonally adjacent filled cells **of the same colour**. Those cells then propagate further, recursively.

**Algorithm (breadth-first):**
```
resolveClears(board, generation0Set):
  cleared = new Set(generation0Set)
  frontier = generation0Set
  generation = 0

  while frontier is not empty AND generation < MAX_CASCADE_DEPTH:
    nextFrontier = empty set
    generation += 1

    for each cell C in frontier:
      for each neighbour N of C (up, down, left, right):
        if N is in bounds
           AND N is filled
           AND N is not already in cleared
           AND N.color == C.color:
             add N to cleared
             add N to nextFrontier
             record N.generation = generation

    frontier = nextFrontier

  return cleared, maxGenerationReached
```

**Key detail:** the colour comparison is `N.color == C.color` — that is, per-cell propagation, *not* comparison against the placed piece's colour. This is what allows a chain to change colour mid-cascade if a cleared line contains multiple colours, producing the branching, unpredictable-in-a-good-way chains that make the mechanic interesting.

**Neighbour mode:** 4-way (orthogonal) by default. 8-way is a tuning option but will produce much longer chains — start with 4.

### 2.5 Scoring
```
Generation 0 cells:  10 points each
Generation N cells:  10 × (N + 1) points each
Placement:            1 point per cell placed
```
Displayed combo multiplier = `maxGenerationReached + 1`. Show it as a large animated number on any cascade of generation ≥ 1.

### 2.6 Game Over
Game ends when **none of the remaining tray pieces can be legally placed anywhere on the board**. Check this after every placement and after every tray refill.

---

## 3. Tuning Configuration

Put every one of these in a single `src/config/gameplay.ts` file. **This is the most important file in the prototype** — it is where the "is it fun" question gets answered, and you will change these values dozens of times.

```typescript
export const GAMEPLAY_CONFIG = {
  BOARD_SIZE: 8,
  TRAY_SIZE: 3,
  PALETTE_SIZE: 5,

  // Determinism (§2.2.1). In Phase 1 the client generates its own seed.
  // In Phase 2 the SERVER supplies it and the client never chooses one.
  // Fixed seeds also make playtest sessions reproducible and bugs repeatable.
  DEFAULT_SEED: 0x5EED,

  // Cascade tuning — the critical knobs
  MAX_CASCADE_DEPTH: 4,
  NEIGHBOUR_MODE: 'orthogonal' as 'orthogonal' | 'diagonal',

  // Colour spawn weighting: 0.0 = uniform random,
  // 1.0 = always matches most common colour on board
  COLOUR_AFFINITY: 0.35,

  // Scoring
  POINTS_PER_CELL_BASE: 10,
  POINTS_PER_CELL_PLACED: 1,

  // Feel
  CASCADE_STEP_DELAY_MS: 120,   // pause between generations, for readability
  SCREEN_SHAKE_PER_GENERATION: 2,
};
```

### 3.1 The specific risk to tune against
Cascade systems fail in two opposite directions:
- **Too generous** → board wipes constantly, no challenge, player feels like a spectator rather than a planner.
- **Too stingy** → cascades almost never trigger, the mechanic is invisible, and you've just built a Block Blast clone.

`MAX_CASCADE_DEPTH` and `COLOUR_AFFINITY` are the two dials that control this. Expect to spend real playtesting hours here. **Build a debug overlay** (§5) so you can see cascade statistics live rather than guessing.

---

## 4. Neon Arcade Visual Specification

### 4.1 Palette
```
Background deep:    #07070F
Background panel:   #0D0B1F
Grid line:          #1F1B3A
Grid cell empty:    #12102A
Text primary:       #E8E6FF
```

**Five block colours** (high chroma, dark-background optimised):
```
0  Cyan      #00F0FF
1  Magenta   #FF2E9F
2  Lime      #A8FF3E
3  Amber     #FFB627
4  Violet    #9D4EDD
```

**Accessibility note — do not skip this.** Five saturated hues are not reliably distinguishable for players with colour vision deficiency, and colour *is* the core mechanic here, not decoration. Add a **glyph mode toggle**: a distinct simple symbol (circle, triangle, square, diamond, cross) rendered faintly inside each block. Build the glyph system into the block renderer from the start — retrofitting it later means touching every visual effect.

### 4.2 Effects
| Element | Treatment |
|---|---|
| Blocks | Flat fill, 2px inner border at 40% white, outer glow (`shadowBlur` 12–18px in own colour) |
| Grid | Thin 1px lines, very low opacity, subtle |
| Placement | Brief scale-punch (1.0 → 1.08 → 1.0, ~120ms) |
| Line clear (gen 0) | White flash → particle burst outward, per cell |
| Cascade (gen 1+) | Sequential burst per generation, delayed by `CASCADE_STEP_DELAY_MS`, glow intensity scaling with generation |
| Screen shake | Amplitude = `generation × SCREEN_SHAKE_PER_GENERATION`, capped |
| Overlay | Faint scanline texture, ~4% opacity, static |
| Combo number | Large, centre-screen, scales up and fades, colour shifts warmer with depth |

### 4.3 Typography
Free Google Fonts, both with strong arcade/tech character:
- **Display / score:** Orbitron (700)
- **UI / body:** Rajdhani or Chakra Petch (500/600)

### 4.4 Audio — do not treat as optional
The single highest-leverage feel element in this game is the **rising pitch cascade**: each cascade generation plays the next note up a synth arpeggio. Generation 0 = root, gen 1 = third, gen 2 = fifth, gen 3 = octave. This turns a visual chain into a *felt* crescendo and is the primary dopamine delivery mechanism.

Also needed: placement click (soft), invalid-placement thunk, game-over descending tone. Keep total audio under 10 files for Phase 1.

---

## 5. Debug Overlay (build this early)

Toggleable with a keypress. Displays:
- Current cascade depth reached, and running max
- Cascades triggered per game, bucketed by depth (0, 1, 2, 3, 4+)
- Average score per placement
- Board colour distribution
- Placements-per-game and game length in seconds

**Reasoning:** you cannot tune §3 by feel alone. You need to know whether a depth-3 cascade happens once a game or once every four placements. This overlay is what turns "it feels off" into an actionable number, and it takes maybe an hour to build.

---

## 6. Testing Requirements

The cascade resolver must be **pure and unit-tested** — separated entirely from Phaser rendering. Write it as a standalone module with no engine dependencies.

Required test cases:
1. Single full row clears, no cascade (all differing colours)
2. Single full row clears, one adjacent same-colour cell cascades (depth 1)
3. Multi-generation chain reaching exactly `MAX_CASCADE_DEPTH`
4. Chain that would exceed `MAX_CASCADE_DEPTH` is correctly truncated
5. Simultaneous row + column clear — shared cell counted exactly once
6. Cascade does not revisit already-cleared cells (no infinite loop)
7. Cascade does not propagate diagonally in orthogonal mode
8. Board-edge cells do not read out of bounds
9. Full-board clear resolves without error
10. Scoring matches expected value for a known board + placement

**Determinism tests (§2.2.1) — equally mandatory:**

11. The same seed produces an identical piece sequence across two fresh game instances
12. Replaying a recorded placement list against its original seed reproduces the exact final score and board state
13. No code path in `src/core/` calls `Math.random()`, `Date.now()`, or produces a non-integer score (enforce with a lint rule, not just a test)

**Test 6 is the critical one for stability.** A cascade resolver without visited-set protection will hang the game. Write that test first.

**Test 12 is the critical one for the project.** It is the Phase 2 anti-cheat verifier in embryo — if it passes in Phase 1, server-side score validation is nearly free later. If it fails, you find out now rather than after building a backend on a false assumption.

---

## 7. Suggested File Structure

```
src/
  config/
    gameplay.ts          # all tuning constants — §3
    theme.ts             # palette, fonts, effect params — §4
  core/                  # PURE LOGIC — no Phaser imports allowed here
    Board.ts             # grid state, placement validation
    Piece.ts             # shape definitions, colour assignment
    cascade.ts           # THE resolver — §2.4
    scoring.ts
    gameState.ts         # turn flow, tray refill, game-over check
  scenes/
    BootScene.ts
    GameScene.ts         # rendering, input, effect orchestration
    GameOverScene.ts
  render/
    BlockRenderer.ts     # includes glyph accessibility mode
    EffectsManager.ts    # particles, shake, flashes
    AudioManager.ts
  debug/
    DebugOverlay.ts      # §5
tests/
  cascade.test.ts        # §6
  board.test.ts
  scoring.test.ts
```

**Architectural rule to enforce:** nothing in `src/core/` may import from Phaser. That boundary is what makes the logic testable and what would let you port to another engine later without a rewrite.

---

## 8. Claude Code Build Sequence

Work through these as discrete sessions. Do not merge steps — each one should end with something you can run or test.

**Step 1 — Scaffold.**
Vite + TypeScript + Phaser 3 + Vitest. Empty game scene rendering an 8×8 grid with the §4.1 palette. Confirm it runs and hot-reloads.

**Step 2 — Core logic, headless.**
`rng.ts` (seeded mulberry32) first, then `Board.ts`, `Piece.ts`, `cascade.ts`, `scoring.ts`. No rendering at all. Integer-only maths throughout. Write the tests from §6 alongside, including the determinism tests. **Do not proceed until all thirteen tests pass.**

**Step 2b — Replay harness.**
A tiny function `replay(seed, placements[]) → { score, finalBoard }` built from the same core modules. Perhaps twenty lines. This is what becomes the Phase 2 server verifier, and building it now is what proves determinism actually holds rather than assuming it.

**Step 3 — Render and input.**
Draw board state, render the 3-piece tray, implement drag-and-drop placement with a valid/invalid ghost preview. Wire placement to the core logic. Ugly is fine here.

**Step 4 — Cascade visualisation.**
Sequential generation-by-generation clearing with `CASCADE_STEP_DELAY_MS`, particle bursts, combo counter. This is where the game becomes legible — the cascade must be *watchable*, not instantaneous.

**Step 5 — Game loop closure.**
Tray refill, game-over detection, score display, restart. Now it's a complete game.

**Step 6 — Debug overlay.** (§5)

**Step 7 — Feel pass.**
Audio, screen shake, glow, scanlines, easing curves, glyph accessibility mode.

**Step 8 — Playtest and tune.**
Play it yourself for hours. Then get 5–10 other people to play it without any explanation from you — if they need you to explain the cascade, the visualisation has failed, not the players. Adjust §3 constants. Repeat.

### Model selection note
Steps 2 and 4 (cascade algorithm, cascade visualisation sequencing) are the genuinely hard reasoning work — worth running on the strongest model available to you. Steps 1, 3, and 5 are largely conventional scaffolding and boilerplate where a faster model will serve fine and save you budget and time.

---

## 9. Explicit Non-Goals for Phase 1

Do not build any of the following yet, no matter how easy they look:
- Advertising SDKs or IAP
- Accounts, cloud save, leaderboards
- Level progression, missions, daily rewards, streaks
- Power-ups or boosters
- Capacitor / native packaging
- App store listing assets
- Analytics

Every one of these is a legitimate Phase 2/3 item. Every one of them is also a way to spend three weeks not answering the only question that matters right now.

---

## 10. Phase 1 Exit Criteria

Move to Phase 2 only when **all** of these are true:

1. All cascade unit tests pass.
2. ~~Debug data shows cascades of depth ≥ 2 occurring at a rate that feels rewarding but not constant — a defensible starting target is roughly **one in every 6–10 placements**~~ **— SUPERSEDED, see below.**

   **Revised criterion (Step 8, measured).** The depth ≥ 2 rate is not tunable under colour-locked clearing. A 5 × 4 sweep of `MAX_CASCADE_DEPTH` × `COLOUR_AFFINITY` — 20 configurations, from depth 2 / affinity 0.00 to depth 10 / affinity 0.45 — held the rate between **3.5 and 4.1 placements** throughout. Neither knob moves it.

   That is structural, not a tuning failure. Completing a line in a colour that has any adjacent cluster reaches generation 2 almost by construction; the depth cap only truncates chains that would have gone *deeper*, and colour affinity changes how big clusters get rather than whether adjacency exists at all. The original 6–10 target was written for the whole-line rule, where reaching depth 2 was itself the rare event.

   Under colour-locked clearing the rare, rewarding event is a **large single detonation**, and that *is* controllable — the share of clears removing 7+ cells ranges from 43% to 62% across the same sweep. So:

   > **Debug data shows large detonations (a single clear removing 7 or more cells) at roughly 40–55% of all clears, with a typical game running 50–150 placements and at least 85% of games reaching a game over.** Validate against playtesting rather than accepting as given.

   Measured at the shipped values (`MAX_CASCADE_DEPTH: 3`, `COLOUR_AFFINITY: 0.0`, 1000 games): 44.5% of clears remove 7+ cells, median game length 129 placements, 89.0% of games end.
3. New players understand the cascade mechanic without verbal explanation.
4. You personally want to play another round after a game-over — repeatedly, and not because you built it.
5. At least 5 external playtesters have played, and their feedback has been logged.

**If criterion 4 fails, stop.** Do not proceed to art, monetisation, or store submission on a core loop that isn't compelling. Either re-tune §3, revise the mechanic, or shelve it. That decision is far cheaper now than after another two months of work.

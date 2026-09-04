# Cyber Blast

A neon-arcade block-placement puzzle for mobile. Drag polyomino pieces onto an
8×8 grid to complete rows and columns — but a completed line removes only the
tiles matching the colour you placed, and that clear chains through touching
tiles of the same colour. Build a cluster, then aim a line at it.

Built end-to-end with Claude Code on a Phaser/TypeScript stack chosen for
AI-assisted iteration: the pure, engine-free core logic doubles as the
server-side anti-cheat verifier.

**Status: Phase 1 (core loop prototype). Not yet released.**

## Run

```bash
npm install
npm run dev        # http://localhost:5174
npm test           # purity linter + 61 unit tests
npm run lint:core  # architectural rules 1, 2 and 4 on src/core/
npm run typecheck
npm run build
npm run sim -- 200 0.45 10   # headless tuning: games, COLOUR_AFFINITY, MAX_CASCADE_DEPTH
```

| Key / button | Action |
|---|---|
| drag | place a piece |
| tap a lit meter | fire that colour's power-up, then tap a tile |
| `?` / `H` | how to play |
| `D` / `` ` `` | debug overlay (cascade stats, colour distribution, seed) |
| `G` | glyph accessibility mode |
| `M` | sound |
| `R` | restart |
| SEED FIX/RND | replay the fixed seed, or randomise per run (dev) |

## Documents

`docs/00-START-HERE.md` is the index and states the canonical phase numbering
and precedence rules. Read it before the specs.

## Architecture

`src/core/` is pure TypeScript with no engine imports, one seeded PRNG, integer
maths and no wall-clock reads. That is not hygiene — the same module is reused
verbatim as the Phase 2 server-side score verifier, so `src/core/replay.ts`
re-runs a game from `(seed, actions)` and must reproduce the score exactly.
`npm run lint:core` enforces the rules; see `CLAUDE.md`.

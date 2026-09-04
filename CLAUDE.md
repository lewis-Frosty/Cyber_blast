# Cyber Blast — Project Rules

## Read first
- docs/00-START-HERE.md — index, canonical phase numbering, system check
- docs/cyber-blast-prototype-spec.md — Phase 1 (current)

## Non-negotiable architectural rules
1. NOTHING in src/core/ may import Phaser. Pure TypeScript only.
   This module is reused verbatim as the server-side anti-cheat verifier.
2. ALL randomness comes from the seeded PRNG in src/core/rng.ts.
   Math.random() is banned everywhere. Enforce with a lint rule.
3. NO floating-point maths in scoring or cascade logic. Integers only.
4. NO Date.now(), timers or wall-clock reads inside src/core/.
5. Same seed + same placement list MUST reproduce the same score. Always.

## Working style
- One build step per session. Do not run ahead into later steps.
- Write tests alongside logic, not after.
- Ask before adding a dependency.
- Commit at the end of each step with a descriptive message.

## Project decisions made outside the specs
These were decided by the project owner during playtesting and OVERRIDE the
written spec where they conflict. The spec documents are being updated to match.

- **Clearing is colour-locked.** A completed line removes only the cells
  matching the placed piece's colour; every other colour stays on the board.
  The cascade then spreads through that one colour. The original
  whole-line-clears rule is retired, not configurable.
- **Per-colour power-ups exist in Phase 1** (Flush / Nova / Paint / Reroll /
  Pluck), charged by clearing tiles of that colour. Not in the written spec.
- **Audio is procedural WebAudio, zero audio files.** The spec's "keep audio
  under 10 files" budget is satisfied by using none.

### The client cannot name a score (Phase 2)

A run is submitted as an ordered move log and nothing else. The server replays
it against the seed IT issued and takes its own number; `submit-run` has no
score parameter to send. The client's own tally travels as `selfReport` for
diagnostics only, and a disagreement rejects the run rather than banking
either number.

This is the reason rules 1-5 exist. If the core ever stops being pure,
deterministic, or integer-only, honest players start getting rejected and the
scheme has to be abandoned — so a change that breaks determinism is not a
gameplay bug, it is an anti-cheat outage.

Practical consequence: an offline run has no server seed, so it cannot be
replayed and is never ranked. The game says so rather than pretending to post.

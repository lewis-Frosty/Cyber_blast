import { GAMEPLAY_CONFIG, type GameplayConfig } from './gameplay';

/**
 * The 14-challenge daily rotation (backend spec §6.1a).
 *
 * A daily that plays identically every day is just a shared seed. Each day
 * gets a twist, and a fortnight passes before one repeats.
 *
 * ── Two properties this file exists to guarantee ────────────────────────
 *
 * 1. **The client cannot choose its own modifiers.** The config is DERIVED
 *    from the challenge date by the pure function below, on both ends. The
 *    server does not read a config the client sent, and does not have to trust
 *    or schema-check a JSON blob out of the database either: it already knows
 *    `runs.challenge_date`, so it derives the same patch this file gives the
 *    client. Anything else would let a player claim "today was Two Colours"
 *    and farm a soft board.
 *
 * 2. **Both ends cannot drift.** This file is copied verbatim into the Edge
 *    Function tree by scripts/build-edge-shared.mjs, and `npm run pretest`
 *    fails if the copy differs. Played and replayed therefore use identical
 *    numbers by construction, not by convention — which matters because a
 *    mismatch does not degrade gracefully, it rejects every daily run of the
 *    day as `replay_mismatch`.
 *
 * ── Constraint on every entry ───────────────────────────────────────────
 *
 * A modifier must be a value `replay()` honours. Nothing cosmetic and nothing
 * client-side: if the twist does not change the simulation, the server's
 * replay diverges from the game the player saw.
 *
 * BOARD_SIZE is deliberately absent. Board-size variants would be the most
 * striking of all, but the renderer holds SIZE at module scope, so a per-run
 * board size is a refactor rather than a config value.
 */

export interface DailyChallenge {
  /** Stable id. Never reused or reordered — the share card quotes it. */
  readonly id: number;
  readonly name: string;
  /** One line, player-facing, shown on the play screen. */
  readonly twist: string;
  readonly patch: Partial<GameplayConfig>;
}

export const DAILY_CHALLENGES: readonly DailyChallenge[] = [
  {
    id: 1,
    name: 'BARE HANDS',
    twist: 'No power-ups. Just you and the chain.',
    patch: { POWERUPS_ENABLED: false },
  },
  {
    id: 2,
    name: 'DIAGONAL DAY',
    twist: 'Chains spread eight directions. Enormous blobs.',
    patch: { NEIGHBOUR_MODE: 'diagonal' },
  },
  {
    id: 3,
    name: 'WALL RUSH',
    twist: 'A grey cube every 500 points. The board closes fast.',
    patch: { OBSTACLE_EVERY_POINTS: 500 },
  },
  {
    id: 4,
    name: 'THREE COLOURS',
    twist: 'Palette cut to three. Dense clusters, huge chains.',
    patch: { PALETTE_SIZE: 3 },
  },
  {
    id: 5,
    name: 'TWO COLOURS',
    twist: 'Palette cut to two. Almost everything connects.',
    patch: { PALETTE_SIZE: 2 },
  },
  {
    id: 6,
    name: 'OVERCHARGED',
    twist: 'Power-ups charge in 15 clears, not 40.',
    patch: { POWERUP_CHARGE_COST: 15 },
  },
  {
    id: 7,
    name: 'COLD TOOLS',
    twist: '90 clears per charge. One tool, maybe.',
    patch: { POWERUP_CHARGE_COST: 90 },
  },
  {
    id: 8,
    name: 'TWO IN HAND',
    twist: 'Tray of two. Far less room to plan.',
    patch: { TRAY_SIZE: 2 },
  },
  {
    id: 9,
    name: 'FOUR IN HAND',
    twist: 'Tray of four. A planner’s day.',
    patch: { TRAY_SIZE: 4 },
  },
  {
    id: 10,
    name: 'NO RESCUE',
    twist: 'No milestone top-ups. What you earn is all you get.',
    patch: { POWERUP_SCORE_MILESTONE: 0 },
  },
  {
    id: 11,
    name: 'LIME FEVER',
    twist: 'Lime pays four times and spawns heavily. Greed day.',
    patch: {
      COLOUR_SCORE_MULTIPLIER: [1, 1, 4, 1, 1],
      COLOUR_SPAWN_WEIGHTS: [80, 80, 160, 80, 80],
    },
  },
  {
    id: 12,
    name: 'CLEAN ROOM',
    twist: 'No obstacles at all. Pure endurance.',
    patch: { OBSTACLES_ENABLED: false },
  },
  {
    id: 13,
    name: 'SUDDEN WALL',
    twist: 'Filler shapes withdrawn after one obstacle, not five.',
    patch: { SHAPE_LIMIT_AFTER_OBSTACLES: 1 },
  },
  {
    id: 14,
    name: 'SLOW BURN',
    twist: 'A grey cube every 4000 points. A long, open board.',
    // Slot 14 was proposed as SHALLOW ({ MAX_CASCADE_DEPTH: 3 }) and is HELD:
    // capping cascade depth contradicts the locked decision that uncapped
    // chains are core, and inverting *that* rule is not a call to make
    // quietly. If it is ever approved, it swaps in here and nothing else
    // changes. Until then this is the patient-play day, using a knob the
    // config already has.
    patch: { OBSTACLE_EVERY_POINTS: 4000 },
  },
];

/** Days between two UTC dates. Both must be YYYY-MM-DD. */
function daysSinceEpoch(dateIso: string): number | null {
  // Parsed strictly: a malformed date must not silently become challenge 1,
  // because the two ends would then disagree about what was played.
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) return null;
  const ms = Date.parse(`${dateIso}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.floor(ms / 86_400_000);
}

/**
 * Which challenge a given UTC date runs, or null if the date is unusable.
 *
 * Rotation is `days since epoch mod 14` — a pure function of the date, so
 * every device and the server land on the same answer with nothing stored and
 * nothing exchanged. No clock is read here; the date is always an argument
 * (core rule 4).
 */
export function challengeForDate(dateIso: string): DailyChallenge | null {
  const days = daysSinceEpoch(dateIso);
  if (days === null) return null;
  const n = DAILY_CHALLENGES.length;
  const i = ((days % n) + n) % n; // correct for dates before 1970
  return DAILY_CHALLENGES[i] ?? null;
}

/**
 * The full config a daily on `dateIso` is played and replayed under.
 *
 * Falls back to the unmodified config when the date is unusable, which is the
 * safe direction: a standard board is playable and rankable, whereas guessing
 * at a modifier would desynchronise the replay.
 */
export function configForDate(dateIso: string): GameplayConfig {
  const challenge = challengeForDate(dateIso);
  if (!challenge) return GAMEPLAY_CONFIG;
  return { ...GAMEPLAY_CONFIG, ...challenge.patch };
}

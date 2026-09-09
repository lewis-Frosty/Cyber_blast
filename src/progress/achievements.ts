/**
 * The four achievement ladders, as pure data and pure functions.
 *
 * Kept free of Phaser and of the network so the tier maths can be tested
 * directly. Each ladder declares whether the game currently MEASURES it: two
 * of the four depend on systems that do not exist yet, and a dashboard that
 * showed "0 / 5" for something nobody is counting would be reporting a
 * failure the player has not had the chance to avoid.
 */

export type LadderId = 'league' | 'daily' | 'chain' | 'streak';

export interface Tier {
  /** Threshold the stat must reach. */
  at: number;
  name: string;
  /** Ring colour, from the game's own palette. */
  colour: string;
}

export interface Ladder {
  id: LadderId;
  name: string;
  /** What the number means, in the player's words. */
  unit: string;
  tiers: readonly Tier[];
  /**
   * False while nothing feeds this ladder yet. The UI must say so rather than
   * render a zero that looks like the player's own result.
   */
  tracked: boolean;
  /** Shown when `tracked` is false. */
  pending?: string;
}

// Ladder rung colours. Neon, ascending — a muddy bronze-silver-gold medal
// ramp was off-theme in a game that looks like this, and the metal NAMES read
// as league tiers now that the game has real ones (SPARK … SINGULARITY).
// Rungs are named after what they measure instead, so nothing on the player
// page can be mistaken for a league standing.
const RUNG_1 = '#4FC3C7';
const RUNG_2 = '#00F0FF';
const RUNG_3 = '#A8FF3E';
const RUNG_4 = '#FFB627';
const RUNG_5 = '#B36BFF';
const RUNG_6 = '#FF2E9F';

export const LADDERS: readonly Ladder[] = [
  {
    id: 'league',
    name: 'Runs logged',
    unit: 'games played',
    tracked: true,
    tiers: [
      { at: 1, name: '1 game', colour: RUNG_1 },
      { at: 10, name: '10 games', colour: RUNG_2 },
      { at: 50, name: '50 games', colour: RUNG_3 },
      { at: 150, name: '150 games', colour: RUNG_4 },
      { at: 400, name: '400 games', colour: RUNG_6 },
    ],
  },
  {
    id: 'chain',
    name: 'Biggest chain',
    unit: 'longest chain',
    tracked: true,
    tiers: [
      { at: 5, name: '×5', colour: RUNG_1 },
      { at: 10, name: '×10', colour: RUNG_2 },
      { at: 15, name: '×15', colour: RUNG_3 },
      { at: 20, name: '×20', colour: RUNG_4 },
      { at: 25, name: '×25', colour: RUNG_5 },
      { at: 30, name: '×30', colour: RUNG_6 },
    ],
  },
  {
    id: 'daily',
    name: 'Daily streak',
    // "best streak", not "days in a row": the STREAK tile above shows the live
    // number and this ladder shows the high-water mark, so on a page carrying
    // both, an unqualified label reads as a contradiction.
    unit: 'best streak',
    tracked: true,
    tiers: [
      { at: 5, name: '5 days', colour: RUNG_2 },
      { at: 10, name: '10 days', colour: RUNG_3 },
      { at: 15, name: '15 days', colour: RUNG_4 },
      { at: 30, name: '30 days', colour: RUNG_6 },
    ],
  },
  {
    id: 'streak',
    name: 'Chains in a row',
    unit: 'consecutive chains',
    tracked: true,
    tiers: [
      { at: 3, name: '3 in a row', colour: RUNG_1 },
      { at: 5, name: '5 in a row', colour: RUNG_3 },
      { at: 8, name: '8 in a row', colour: RUNG_4 },
      { at: 12, name: '12 in a row', colour: RUNG_6 },
    ],
  },
];

export interface LadderProgress {
  ladder: Ladder;
  /** The player's current value for this ladder. */
  value: number;
  /** Highest tier reached, or null before the first. */
  earned: Tier | null;
  /** The tier being worked toward, or null once the ladder is complete. */
  next: Tier | null;
  /** 0–1 toward `next`, measured from the tier just earned. */
  fraction: number;
}

/** Player numbers the ladders read from. */
export interface PlayerTotals {
  gamesPlayed: number;
  bestChain: number;
  dailyStreak: number;
  bestClearStreak: number;
}

function valueFor(id: LadderId, t: PlayerTotals): number {
  switch (id) {
    case 'league':
      return t.gamesPlayed;
    case 'chain':
      return t.bestChain;
    case 'daily':
      return t.dailyStreak;
    case 'streak':
      return t.bestClearStreak;
  }
}

export function progressFor(ladder: Ladder, totals: PlayerTotals): LadderProgress {
  const value = Math.max(0, Math.floor(valueFor(ladder.id, totals)));
  let earned: Tier | null = null;
  let next: Tier | null = null;
  for (const tier of ladder.tiers) {
    if (value >= tier.at) earned = tier;
    else if (next === null) next = tier;
  }
  // Measure the bar from the tier just earned, not from zero — otherwise every
  // late tier looks nearly full the moment the previous one is reached.
  const floor = earned ? earned.at : 0;
  const span = next ? next.at - floor : 0;
  const fraction = next === null ? 1 : span <= 0 ? 0 : Math.min(1, Math.max(0, (value - floor) / span));
  return { ladder, value, earned, next, fraction };
}

export function allProgress(totals: PlayerTotals): LadderProgress[] {
  return LADDERS.map((l) => progressFor(l, totals));
}

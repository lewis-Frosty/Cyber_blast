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

const BRONZE = '#CD7F32';
const SILVER = '#C0C6D8';
const GOLD = '#FFB627';
const PLATINUM = '#00F0FF';
const DIAMOND = '#A8FF3E';
const VIOLET = '#B36BFF';
const MAGENTA = '#FF2E9F';

export const LADDERS: readonly Ladder[] = [
  {
    id: 'league',
    name: 'League',
    unit: 'games played',
    tracked: true,
    tiers: [
      { at: 1, name: 'Bronze', colour: BRONZE },
      { at: 10, name: 'Silver', colour: SILVER },
      { at: 50, name: 'Gold', colour: GOLD },
      { at: 150, name: 'Platinum', colour: PLATINUM },
      { at: 400, name: 'Diamond', colour: DIAMOND },
    ],
  },
  {
    id: 'chain',
    name: 'Biggest chain',
    unit: 'longest chain',
    tracked: true,
    tiers: [
      { at: 5, name: '×5', colour: BRONZE },
      { at: 10, name: '×10', colour: SILVER },
      { at: 15, name: '×15', colour: GOLD },
      { at: 20, name: '×20', colour: PLATINUM },
      { at: 25, name: '×25', colour: VIOLET },
      { at: 30, name: '×30', colour: DIAMOND },
    ],
  },
  {
    id: 'daily',
    name: 'Daily streak',
    unit: 'days in a row',
    tracked: false,
    pending: 'Starts counting when the Daily Challenge ships',
    tiers: [
      { at: 5, name: '5 days', colour: BRONZE },
      { at: 10, name: '10 days', colour: SILVER },
      { at: 15, name: '15 days', colour: GOLD },
      { at: 30, name: '30 days', colour: DIAMOND },
    ],
  },
  {
    id: 'streak',
    name: 'Chains in a row',
    unit: 'consecutive chains',
    tracked: true,
    tiers: [
      { at: 3, name: '3 in a row', colour: BRONZE },
      { at: 5, name: '5 in a row', colour: SILVER },
      { at: 8, name: '8 in a row', colour: GOLD },
      { at: 12, name: '12 in a row', colour: MAGENTA },
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

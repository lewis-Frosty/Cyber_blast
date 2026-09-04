/**
 * Headless tuning simulator — spec §5 / build Step 6.
 *
 * Simulates many games and prints the same statistics the in-game debug overlay
 * shows, so §3 gets tuned with numbers instead of feel.
 *
 *   npm run sim                                  # 1000 games, planner policy
 *   npm run sim -- --games=300 --affinity=0.3 --depth=6
 *   npm run sim -- --policy=random               # skill floor
 *   npm run sim -- --policy=greedy               # myopic score-chaser
 *
 * A bot is only ever a proxy for a player. Running the three policies brackets
 * the range: `random` is the floor, `planner` approximates someone who has
 * understood that the game rewards building a cluster and then detonating it,
 * and `greedy` is the trap of taking every small clear immediately. If a tuning
 * change only helps `greedy`, it is probably making the game more myopic.
 */
import { GAMEPLAY_CONFIG, type GameplayConfig } from '../src/config/gameplay';
import { GameState } from '../src/core/gameState';
import { resolveBoard } from '../src/core/cascade';
import { scoreTurn } from '../src/core/scoring';
import { createRng, type Rng } from '../src/core/rng';
import { connectedRegion, powerUpForColour } from '../src/core/powerups';
import type { Board } from '../src/core/Board';

declare const process: { argv: string[] };

type Policy = 'planner' | 'greedy' | 'random';

interface Options {
  games: number;
  policy: Policy;
  config: GameplayConfig;
  maxPlacements: number;
}

function parseArgs(): Options {
  const args = process.argv.slice(2);
  const flag = (name: string): string | undefined => {
    const hit = args.find((a) => a.startsWith(`--${name}=`));
    return hit?.split('=')[1];
  };
  // Positional form kept for convenience: sim <games> <affinity> <depth>
  const positional = args.filter((a) => !a.startsWith('--'));
  const num = (v: string | undefined, fallback: number): number => (v === undefined ? fallback : Number(v));

  const games = num(flag('games') ?? positional[0], 1000);
  const affinity = num(flag('affinity') ?? positional[1], GAMEPLAY_CONFIG.COLOUR_AFFINITY);
  const depth = num(flag('depth') ?? positional[2], GAMEPLAY_CONFIG.MAX_CASCADE_DEPTH);
  const policy = (flag('policy') ?? 'planner') as Policy;

  return {
    games,
    policy,
    maxPlacements: num(flag('cap'), 500),
    config: { ...GAMEPLAY_CONFIG, COLOUR_AFFINITY: affinity, MAX_CASCADE_DEPTH: depth },
  };
}

interface Candidate {
  tray: number;
  row: number;
  col: number;
  value: number;
  cleared: number;
  depth: number;
}

/** Largest same-colour region touching any of the given cells. */
function largestRegionTouching(board: Board, cells: readonly number[]): number {
  let best = 0;
  const seen = new Set<number>();
  for (const i of cells) {
    if (seen.has(i)) continue;
    const { row, col } = board.coord(i);
    const region = connectedRegion(board, row, col);
    for (const r of region) seen.add(r);
    if (region.length > best) best = region.length;
  }
  return best;
}

/** How many rows/columns sit one cell short of complete. */
function nearlyFullLines(board: Board): number {
  let n = 0;
  for (let r = 0; r < board.size; r++) {
    let filled = 0;
    for (let c = 0; c < board.size; c++) if (board.isFilled(r, c)) filled++;
    if (filled === board.size - 1) n++;
  }
  for (let c = 0; c < board.size; c++) {
    let filled = 0;
    for (let r = 0; r < board.size; r++) if (board.isFilled(r, c)) filled++;
    if (filled === board.size - 1) n++;
  }
  return n;
}

/**
 * Score a hypothetical placement. Mutates the board and undoes itself, which is
 * far cheaper than cloning for every one of ~200 candidates per turn.
 */
function evaluate(state: GameState, tray: number, row: number, col: number, opts: Options): Candidate | null {
  const piece = state.tray[tray];
  if (!piece || !state.board.canPlace(piece.shape, row, col)) return null;
  const board = state.board;

  const placed = board.place(piece.shape, piece.color, row, col);
  const cascade = resolveBoard(board, {
    maxDepth: opts.config.MAX_CASCADE_DEPTH,
    neighbourMode: opts.config.NEIGHBOUR_MODE,
    lockedColour: piece.color,
  });
  const turn = scoreTurn(placed.length, cascade, opts.config);

  let value = turn.total;
  if (opts.policy === 'planner') {
    // Reward growing a same-colour blob, and getting a line close to complete
    // while such a blob exists; penalise clogging the board.
    const blob = largestRegionTouching(board, placed);
    const filledAfter = board.filledCount() - cascade.cleared.size;
    value =
      turn.total * 1.0 +
      blob * 4.0 +
      nearlyFullLines(board) * 2.0 -
      filledAfter * 0.6;
  } else if (opts.policy === 'random') {
    value = 0;
  }

  board.clearCells(placed); // undo
  return { tray, row, col, value, cleared: cascade.cleared.size, depth: cascade.maxGeneration };
}

function chooseMove(state: GameState, opts: Options, rng: Rng): Candidate | null {
  const candidates: Candidate[] = [];
  for (let t = 0; t < state.tray.length; t++) {
    if (!state.tray[t]) continue;
    for (let r = 0; r < state.board.size; r++) {
      for (let c = 0; c < state.board.size; c++) {
        const cand = evaluate(state, t, r, c, opts);
        if (cand) candidates.push(cand);
      }
    }
  }
  if (candidates.length === 0) return null;
  if (opts.policy === 'random') return candidates[rng.int(candidates.length)] as Candidate;

  let best = candidates[0] as Candidate;
  for (const c of candidates) if (c.value > best.value) best = c;
  return best;
}

/** Spend a charged power-up to reopen a stuck board, as a player would. */
function tryPowerUp(state: GameState): boolean {
  for (const colour of state.readyColours()) {
    if (powerUpForColour(colour).targeting === 'none') {
      if (state.usePowerUp(colour)) return true;
      continue;
    }
    // Aim at the densest cell region: the fullest row crossed with the fullest column.
    let bestRow = 0;
    let bestRowN = -1;
    let bestCol = 0;
    let bestColN = -1;
    for (let r = 0; r < state.board.size; r++) {
      let n = 0;
      for (let c = 0; c < state.board.size; c++) if (state.board.isFilled(r, c)) n++;
      if (n > bestRowN) { bestRowN = n; bestRow = r; }
    }
    for (let c = 0; c < state.board.size; c++) {
      let n = 0;
      for (let r = 0; r < state.board.size; r++) if (state.board.isFilled(r, c)) n++;
      if (n > bestColN) { bestColN = n; bestCol = c; }
    }
    if (state.usePowerUp(colour, bestRow, bestCol)) return true;
    for (let r = 0; r < state.board.size; r++) {
      for (let c = 0; c < state.board.size; c++) {
        if (state.board.isFilled(r, c) && state.usePowerUp(colour, r, c)) return true;
      }
    }
  }
  return false;
}

// ── Run ──────────────────────────────────────────────────────────────────

const opts = parseArgs();
const depthBuckets = [0, 0, 0, 0, 0]; // 0, 1, 2, 3, 4+
/** Cells removed in one clear: 1-3, 4-6, 7-10, 11-15, 16+. */
const clusterBuckets = [0, 0, 0, 0, 0];
const totals = {
  games: 0,
  placements: 0,
  score: 0,
  clearing: 0,
  cellsCleared: 0,
  powerUps: 0,
  capped: 0,
  ended: 0,
  deepest: 0,
  biggestClear: 0,
};
const scores: number[] = [];
const lengths: number[] = [];

const startedAt = Date.now();
for (let g = 0; g < opts.games; g++) {
  const state = new GameState({ config: opts.config, seed: 1_000_000 + g });
  const rng = createRng(7_000_000 + g);
  let guard = 0;

  while (!state.gameOver && guard < opts.maxPlacements) {
    const move = chooseMove(state, opts, rng);
    if (!move) {
      if (tryPowerUp(state)) continue;
      break;
    }
    const result = state.placePiece(move.tray, move.row, move.col);
    if (!result) break;
    guard += 1;

    const depth = result.cascade.maxGeneration;
    if (depth >= 0) {
      depthBuckets[Math.min(depth, 4)] = (depthBuckets[Math.min(depth, 4)] ?? 0) + 1;
      const size = result.cascade.cleared.size;
      const b = size <= 3 ? 0 : size <= 6 ? 1 : size <= 10 ? 2 : size <= 15 ? 3 : 4;
      clusterBuckets[b] = (clusterBuckets[b] ?? 0) + 1;
      if (size > totals.biggestClear) totals.biggestClear = size;
      if (depth > totals.deepest) totals.deepest = depth;
    }
  }

  totals.games += 1;
  totals.placements += state.stats.placements;
  totals.score += state.score;
  totals.clearing += state.stats.clearingPlacements;
  totals.cellsCleared += state.stats.cellsCleared;
  totals.powerUps += state.stats.powerUpsUsed;
  if (state.gameOver) totals.ended += 1;
  else if (guard >= opts.maxPlacements) totals.capped += 1;
  scores.push(state.score);
  lengths.push(state.stats.placements);
}

const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
const f = (n: number) => n.toFixed(1);
const pct = (n: number, d: number) => (d === 0 ? '0.0' : ((100 * n) / d).toFixed(1));
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : (s[Math.floor(s.length / 2)] as number);
};

const deep = (depthBuckets[2] ?? 0) + (depthBuckets[3] ?? 0) + (depthBuckets[4] ?? 0);
const clears = depthBuckets.reduce((a, b) => a + b, 0);

console.log('');
console.log(`CYBER BLAST — simulation  policy=${opts.policy}  games=${opts.games}  (${elapsed}s)`);
console.log(`config  MAX_CASCADE_DEPTH=${opts.config.MAX_CASCADE_DEPTH}  COLOUR_AFFINITY=${opts.config.COLOUR_AFFINITY}  ${opts.config.NEIGHBOUR_MODE}`);
console.log('─'.repeat(70));
console.log(`games ended naturally   ${totals.ended}/${totals.games}  (${pct(totals.ended, totals.games)}%), ${totals.capped} hit the ${opts.maxPlacements} cap`);
console.log(`placements per game     mean ${f(totals.placements / totals.games)}   median ${median(lengths)}`);
console.log(`score per game          mean ${f(totals.score / totals.games)}   median ${median(scores)}`);
console.log(`score per placement     ${f(totals.score / Math.max(1, totals.placements))}`);
console.log(`clearing placements     ${pct(totals.clearing, totals.placements)}%`);
console.log(`power-ups per game      ${f(totals.powerUps / totals.games)}`);
console.log('');
console.log('cascade depth (per clearing placement)');
console.log(`  0:${depthBuckets[0]}  1:${depthBuckets[1]}  2:${depthBuckets[2]}  3:${depthBuckets[3]}  4+:${depthBuckets[4]}`);
console.log(`  depth>=2 rate         1 in ${deep === 0 ? '∞' : f(totals.placements / deep)} placements   (spec §10 target: 1 in 6-10)`);
console.log(`  deepest seen          ${totals.deepest}`);
console.log('');
console.log('clear size (cells removed in one clear) — the colour-locked reward signal');
console.log(`  1-3:${clusterBuckets[0]}  4-6:${clusterBuckets[1]}  7-10:${clusterBuckets[2]}  11-15:${clusterBuckets[3]}  16+:${clusterBuckets[4]}`);
console.log(`  clears of 7+          ${pct((clusterBuckets[2] ?? 0) + (clusterBuckets[3] ?? 0) + (clusterBuckets[4] ?? 0), clears)}% of clears`);
console.log(`  biggest single clear  ${totals.biggestClear} cells`);
console.log('');

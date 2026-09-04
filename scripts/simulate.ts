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

/** Set by parseArgs; sweeps the §3 knobs instead of running one config. */
let SWEEP = false;

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
  SWEEP = args.includes('--sweep');

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

const opts = parseArgs();

// ── Batch runner ─────────────────────────────────────────────────────────

interface BatchStats {
  games: number;
  ended: number;
  capped: number;
  placements: number;
  score: number;
  clearing: number;
  powerUps: number;
  deepest: number;
  biggestClear: number;
  depthBuckets: number[];
  clusterBuckets: number[];
  scores: number[];
  lengths: number[];
  seconds: number;
}

function runBatch(opts: Options): BatchStats {
  const depthBuckets = [0, 0, 0, 0, 0]; // 0, 1, 2, 3, 4+
  const clusterBuckets = [0, 0, 0, 0, 0]; // 1-3, 4-6, 7-10, 11-15, 16+
  const st: BatchStats = {
    games: 0, ended: 0, capped: 0, placements: 0, score: 0, clearing: 0,
    powerUps: 0, deepest: 0, biggestClear: 0,
    depthBuckets, clusterBuckets, scores: [], lengths: [], seconds: 0,
  };

  const startedAt = Date.now();
  for (let g = 0; g < opts.games; g++) {
    // Same seed set for every config, so a difference between configs is the
    // config and not the luck of the draw.
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
        const d = Math.min(depth, 4);
        depthBuckets[d] = (depthBuckets[d] ?? 0) + 1;
        const size = result.cascade.cleared.size;
        const b = size <= 3 ? 0 : size <= 6 ? 1 : size <= 10 ? 2 : size <= 15 ? 3 : 4;
        clusterBuckets[b] = (clusterBuckets[b] ?? 0) + 1;
        if (size > st.biggestClear) st.biggestClear = size;
        if (depth > st.deepest) st.deepest = depth;
      }
    }

    st.games += 1;
    st.placements += state.stats.placements;
    st.score += state.score;
    st.clearing += state.stats.clearingPlacements;
    st.powerUps += state.stats.powerUpsUsed;
    if (state.gameOver) st.ended += 1;
    else if (guard >= opts.maxPlacements) st.capped += 1;
    st.scores.push(state.score);
    st.lengths.push(state.stats.placements);
  }
  st.seconds = (Date.now() - startedAt) / 1000;
  return st;
}

const f = (n: number) => n.toFixed(1);
const pct = (n: number, d: number) => (d === 0 ? 0 : (100 * n) / d);
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length === 0 ? 0 : (s[Math.floor(s.length / 2)] as number);
};
const deepRate = (st: BatchStats) => {
  const deep = (st.depthBuckets[2] ?? 0) + (st.depthBuckets[3] ?? 0) + (st.depthBuckets[4] ?? 0);
  return deep === 0 ? Infinity : st.placements / deep;
};

// ── Output ───────────────────────────────────────────────────────────────

function printDetail(st: BatchStats, opts: Options): void {
  const clears = st.depthBuckets.reduce((a, b) => a + b, 0);
  const big = (st.clusterBuckets[2] ?? 0) + (st.clusterBuckets[3] ?? 0) + (st.clusterBuckets[4] ?? 0);
  console.log('');
  console.log(`CYBER BLAST — simulation  policy=${opts.policy}  games=${opts.games}  (${f(st.seconds)}s)`);
  console.log(`config  MAX_CASCADE_DEPTH=${opts.config.MAX_CASCADE_DEPTH}  COLOUR_AFFINITY=${opts.config.COLOUR_AFFINITY}  ${opts.config.NEIGHBOUR_MODE}`);
  console.log('─'.repeat(70));
  console.log(`games ended naturally   ${st.ended}/${st.games}  (${f(pct(st.ended, st.games))}%), ${st.capped} hit the ${opts.maxPlacements} cap`);
  console.log(`placements per game     mean ${f(st.placements / st.games)}   median ${median(st.lengths)}`);
  console.log(`score per game          mean ${f(st.score / st.games)}   median ${median(st.scores)}`);
  console.log(`score per placement     ${f(st.score / Math.max(1, st.placements))}`);
  console.log(`clearing placements     ${f(pct(st.clearing, st.placements))}%`);
  console.log(`power-ups per game      ${f(st.powerUps / st.games)}`);
  console.log('');
  console.log('cascade depth (per clearing placement)');
  console.log(`  0:${st.depthBuckets[0]}  1:${st.depthBuckets[1]}  2:${st.depthBuckets[2]}  3:${st.depthBuckets[3]}  4+:${st.depthBuckets[4]}`);
  console.log(`  depth>=2 rate         1 in ${f(deepRate(st))} placements   (spec §10 target: 1 in 6-10)`);
  console.log(`  deepest seen          ${st.deepest}`);
  console.log('');
  console.log('clear size (cells removed in one clear)');
  console.log(`  1-3:${st.clusterBuckets[0]}  4-6:${st.clusterBuckets[1]}  7-10:${st.clusterBuckets[2]}  11-15:${st.clusterBuckets[3]}  16+:${st.clusterBuckets[4]}`);
  console.log(`  clears of 7+          ${f(pct(big, clears))}% of clears`);
  console.log(`  biggest single clear  ${st.biggestClear} cells`);
  console.log('');
}

/**
 * Sweep the two §3 knobs and print one row per setting.
 *
 * Targets, in the order that matters:
 *   LEN   placements per game, 50-150 per spec §2.2.1
 *   END%  share of games that actually reach a game over
 *   D>=2  a depth-2+ cascade once every 6-10 placements, per spec §10
 */
function runSweep(base: Options): void {
  const depths = [2, 3, 4, 6, 10];
  const affinities = [0, 0.15, 0.35, 0.45];

  console.log('');
  console.log(`CYBER BLAST — tuning sweep  policy=${base.policy}  ${base.games} games per cell  cap=${base.maxPlacements}`);
  console.log('targets:  LEN 50-150 placements   END% high   D>=2 one in 6-10');
  console.log('');
  console.log('DEPTH  AFFIN    LEN   MEDIAN   END%   D>=2     SCORE   CLR%   7+CLR  VERDICT');
  console.log('─'.repeat(80));

  for (const depth of depths) {
    for (const affinity of affinities) {
      const opts: Options = {
        ...base,
        config: { ...base.config, MAX_CASCADE_DEPTH: depth, COLOUR_AFFINITY: affinity },
      };
      const st = runBatch(opts);
      const len = st.placements / st.games;
      const endPct = pct(st.ended, st.games);
      const dr = deepRate(st);
      const clears = st.depthBuckets.reduce((a, b) => a + b, 0);
      const big = (st.clusterBuckets[2] ?? 0) + (st.clusterBuckets[3] ?? 0) + (st.clusterBuckets[4] ?? 0);

      const lenOk = len >= 50 && len <= 150;
      const drOk = dr >= 6 && dr <= 10;
      const endOk = endPct >= 90;
      const hits = [lenOk, drOk, endOk].filter(Boolean).length;
      const verdict = hits === 3 ? '*** ALL 3' : hits === 2 ? '**  2 of 3' : hits === 1 ? '*   1 of 3' : '    none';

      console.log(
        `${String(depth).padStart(5)}  ${affinity.toFixed(2).padStart(5)}  ` +
          `${f(len).padStart(5)}  ${String(median(st.lengths)).padStart(6)}  ` +
          `${f(endPct).padStart(5)}  ${(dr === Infinity ? '  inf' : f(dr)).padStart(5)}  ` +
          `${f(st.score / st.games).padStart(8)}  ${f(pct(st.clearing, st.placements)).padStart(5)}  ` +
          `${f(pct(big, clears)).padStart(5)}  ${verdict}`,
      );
    }
    console.log('');
  }
  console.log('LEN = mean placements per game · END% = games reaching game over');
  console.log('D>=2 = one depth-2+ cascade per N placements · 7+CLR = share of clears removing 7+ cells');
  console.log('');
}

// ── Run ──────────────────────────────────────────────────────────────────

if (SWEEP) {
  runSweep(opts);
} else {
  printDetail(runBatch(opts), opts);
}

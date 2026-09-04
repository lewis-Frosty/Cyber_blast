/**
 * Headless tuning simulator. Plays N games with a simple greedy policy using
 * only the pure core, and prints cascade-depth statistics. Run:
 *
 *   npm run sim                # defaults
 *   npm run sim -- 200 0.5 4   # games, COLOUR_AFFINITY, MAX_CASCADE_DEPTH
 *
 * Caveat: a greedy bot is a rough proxy for a human. Use this to bracket the
 * §3 knobs quickly, then validate against real playtesting (§8).
 */
import { GAMEPLAY_CONFIG } from '../src/config/gameplay';
import { GameState } from '../src/core/gameState';
import { powerUpForColour } from '../src/core/powerups';
import { resolveBoard } from '../src/core/cascade';
import { scoreTurn } from '../src/core/scoring';

declare const process: { argv: string[] };
const [gamesArg, affinityArg, depthArg] = process.argv.slice(2);
const GAMES = Number(gamesArg ?? 100);
const config = {
  ...GAMEPLAY_CONFIG,
  COLOUR_AFFINITY: affinityArg !== undefined ? Number(affinityArg) : GAMEPLAY_CONFIG.COLOUR_AFFINITY,
  MAX_CASCADE_DEPTH: depthArg !== undefined ? Number(depthArg) : GAMEPLAY_CONFIG.MAX_CASCADE_DEPTH,
};

interface Move {
  tray: number;
  row: number;
  col: number;
  score: number;
}

/** Greedy: pick the legal move with the best immediate score; tie-break on keeping the board sparse. */
function chooseMove(g: GameState): Move | null {
  let best: Move | null = null;
  for (let t = 0; t < g.tray.length; t++) {
    const piece = g.tray[t];
    if (!piece) continue;
    for (let r = 0; r < g.board.size; r++) {
      for (let c = 0; c < g.board.size; c++) {
        if (!g.board.canPlace(piece.shape, r, c)) continue;
        const trial = g.board.clone();
        const placed = trial.place(piece.shape, piece.color, r, c);
        const cascade = resolveBoard(trial, {
          maxDepth: config.MAX_CASCADE_DEPTH,
          neighbourMode: config.NEIGHBOUR_MODE,
          lockedColour: piece.color,
        });
        const s = scoreTurn(placed.length, cascade, config);
        // Small bias toward the top-left so the bot packs rather than scatters.
        const score = s.total - (r + c) * 0.01;
        if (!best || score > best.score) best = { tray: t, row: r, col: c, score };
      }
    }
  }
  return best;
}

/** Greedy play rarely dies, so cap game length and report how often the cap hit. */
const MAX_PLACEMENTS = 400;
/**
 * When no placement is legal, fire a charged power-up to open the board back up
 * — the same escape a player has. Returns true if the board changed.
 */
function tryPowerUp(g: GameState): boolean {
  for (const colour of g.readyColours()) {
    const def = powerUpForColour(colour);
    if (def.targeting === 'none') {
      if (g.usePowerUp(colour)) return true;
      continue;
    }
    // Aim at the densest spot: the fullest row crossed with the fullest column.
    let bestRow = 0;
    let bestRowN = -1;
    let bestCol = 0;
    let bestColN = -1;
    for (let r = 0; r < g.board.size; r++) {
      let n = 0;
      for (let c = 0; c < g.board.size; c++) if (g.board.isFilled(r, c)) n++;
      if (n > bestRowN) { bestRowN = n; bestRow = r; }
    }
    for (let c = 0; c < g.board.size; c++) {
      let n = 0;
      for (let r = 0; r < g.board.size; r++) if (g.board.isFilled(r, c)) n++;
      if (n > bestColN) { bestColN = n; bestCol = c; }
    }
    if (g.usePowerUp(colour, bestRow, bestCol)) return true;
    // Fall back to any filled cell (Pluck/Paint need one).
    for (let r = 0; r < g.board.size; r++) {
      for (let c = 0; c < g.board.size; c++) {
        if (g.board.isFilled(r, c) && g.usePowerUp(colour, r, c)) return true;
      }
    }
  }
  return false;
}

const totals = { placements: 0, score: 0, games: 0, capped: 0, stalled: 0, powerUps: 0, depth: [0, 0, 0, 0, 0] as number[], clearing: 0, maxDepth: 0 };
for (let i = 0; i < GAMES; i++) {
  const g = new GameState({ config, seed: 1000 + i });
  let guard = 0;
  while (!g.gameOver && guard++ < MAX_PLACEMENTS) {
    const m = chooseMove(g);
    if (!m) {
      // No legal placement: spend a power-up if one is charged, else we're done.
      if (tryPowerUp(g)) continue;
      break;
    }
    const r = g.placePiece(m.tray, m.row, m.col);
    if (!r) break;
  }
  totals.games += 1;
  if (!g.gameOver && guard >= MAX_PLACEMENTS) totals.capped += 1;
  else if (!g.gameOver) totals.stalled += 1;
  totals.powerUps += g.stats.powerUpsUsed;
  totals.placements += g.stats.placements;
  totals.score += g.score;
  totals.clearing += g.stats.clearingPlacements;
  g.stats.cascadesByDepth.forEach((n, d) => (totals.depth[d] = (totals.depth[d] ?? 0) + n));
  totals.maxDepth = Math.max(totals.maxDepth, g.stats.maxDepthThisGame);
}

const deep = (totals.depth[2] ?? 0) + (totals.depth[3] ?? 0) + (totals.depth[4] ?? 0);
const fmt = (n: number) => n.toFixed(1);
console.log(`games=${totals.games} affinity=${config.COLOUR_AFFINITY} maxDepth=${config.MAX_CASCADE_DEPTH}`);
console.log(`avg placements/game   ${fmt(totals.placements / totals.games)}  (${totals.capped}/${totals.games} hit the ${MAX_PLACEMENTS} cap, ${totals.stalled} stalled)`);
console.log(`avg power-ups/game    ${fmt(totals.powerUps / totals.games)}`);
console.log(`avg score/game        ${fmt(totals.score / totals.games)}`);
console.log(`avg score/placement   ${fmt(totals.score / totals.placements)}`);
console.log(`clearing placements   ${fmt((100 * totals.clearing) / totals.placements)}%`);
console.log(`cascades by depth     0:${totals.depth[0]} 1:${totals.depth[1]} 2:${totals.depth[2]} 3:${totals.depth[3]} 4+:${totals.depth[4]}`);
console.log(`depth>=2 rate         1 in ${deep === 0 ? '∞' : fmt(totals.placements / deep)} placements  (target §10: 1 in 6–10)`);
console.log(`deepest cascade seen  ${totals.maxDepth}`);

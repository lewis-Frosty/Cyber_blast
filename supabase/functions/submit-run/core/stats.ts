// GENERATED FILE — do not edit.
// Copied from src/core/stats.ts by scripts/build-edge-shared.mjs so the Edge Function
// runs the SAME logic as the client. Edit the source, then re-run the script.

/**
 * Per-game statistics for the debug overlay (§5). Pure data.
 */
export interface GameStats {
  placements: number;
  totalScore: number;
  /** Placements that cleared at least one line. */
  clearingPlacements: number;
  /** Bucketed by max cascade generation reached: [0, 1, 2, 3, 4+]. */
  cascadesByDepth: [number, number, number, number, number];
  /** Deepest cascade this game. */
  maxDepthThisGame: number;
  powerUpsUsed: number;
  milestonesHit: number;
  /** Grey cubes handed to the tray, and how many of those reached the board. */
  obstaclesGranted: number;
  obstaclesPlaced: number;
  /** Depth reached on the most recent placement (-1 = no clear). */
  lastDepth: number;
  cellsCleared: number;
}

export function createStats(): GameStats {
  return {
    placements: 0,
    totalScore: 0,
    clearingPlacements: 0,
    cascadesByDepth: [0, 0, 0, 0, 0],
    maxDepthThisGame: 0,
    powerUpsUsed: 0,
    milestonesHit: 0,
    obstaclesGranted: 0,
    obstaclesPlaced: 0,
    lastDepth: -1,
    cellsCleared: 0,
  };
}

export function recordPlacement(stats: GameStats, maxGeneration: number, cellsCleared: number, scoreGained: number): void {
  stats.placements += 1;
  stats.totalScore += scoreGained;
  stats.lastDepth = maxGeneration;
  if (maxGeneration >= 0) {
    stats.clearingPlacements += 1;
    stats.cellsCleared += cellsCleared;
    const bucket = Math.min(maxGeneration, 4) as 0 | 1 | 2 | 3 | 4;
    stats.cascadesByDepth[bucket] += 1;
    if (maxGeneration > stats.maxDepthThisGame) stats.maxDepthThisGame = maxGeneration;
  }
}

export function averageScorePerPlacement(stats: GameStats): number {
  return stats.placements === 0 ? 0 : stats.totalScore / stats.placements;
}

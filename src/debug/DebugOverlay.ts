import Phaser from 'phaser';
import { GAMEPLAY_CONFIG } from '../config/gameplay';
import { THEME } from '../config/theme';
import type { GameState } from '../core/gameState';
import { averageScorePerPlacement } from '../core/stats';

/**
 * Live tuning overlay (§5). Toggle with D or backtick, or the DBG button.
 * Reads pure GameState/GameStats; never mutates anything.
 */
export class DebugOverlay {
  private readonly text: Phaser.GameObjects.Text;
  private readonly bg: Phaser.GameObjects.Rectangle;
  private visible = false;

  constructor(
    scene: Phaser.Scene,
    private readonly getState: () => GameState,
    private readonly getElapsedMs: () => number,
    private readonly getSeed: () => number,
  ) {
    this.bg = scene.add.rectangle(8, 8, 300, 290, 0x000000, 0.72).setOrigin(0, 0).setDepth(950).setVisible(false);
    this.text = scene.add
      .text(14, 12, '', { fontFamily: 'monospace', fontSize: '12px', color: '#A8FF3E', lineSpacing: 2 })
      .setDepth(951)
      .setVisible(false);
  }

  toggle(): void {
    this.visible = !this.visible;
    this.bg.setVisible(this.visible);
    this.text.setVisible(this.visible);
    if (this.visible) this.update();
  }

  isVisible(): boolean {
    return this.visible;
  }

  update(): void {
    if (!this.visible) return;
    const s = this.getState();
    const st = s.stats;
    const secs = Math.floor(this.getElapsedMs() / 1000);
    const [d0, d1, d2, d3, d4] = st.cascadesByDepth;
    const deep = d2 + d3 + d4;
    const deepRate = deep === 0 ? '—' : `1 in ${(st.placements / deep).toFixed(1)}`;
    const clearPct = st.placements === 0 ? 0 : (100 * st.clearingPlacements) / st.placements;
    const counts = s.board.colourCounts(GAMEPLAY_CONFIG.PALETTE_SIZE);
    const colours = counts.map((n, i) => `${THEME.blocks[i]?.name.slice(0, 3) ?? i}:${n}`).join(' ');
    const meters = s.meters.charge
      .map((n, i) => `${THEME.blocks[i]?.name.slice(0, 3) ?? i}:${n >= s.meters.cost ? 'RDY' : n}`)
      .join(' ');

    const lines = [
      'CYBER BLAST // DEBUG',
      `depth  last ${st.lastDepth < 0 ? '-' : st.lastDepth}   max ${st.maxDepthThisGame}`,
      `cascades by depth  0:${d0} 1:${d1} 2:${d2} 3:${d3} 4+:${d4}`,
      `depth>=2 rate      ${deepRate} placements`,
      `clearing turns     ${st.clearingPlacements}/${st.placements} (${clearPct.toFixed(0)}%)`,
      `avg score/place    ${averageScorePerPlacement(st).toFixed(1)}`,
      `cells cleared      ${st.cellsCleared}   filled ${s.board.filledCount()}/64`,
      `board colours      ${colours}`,
      `meters (${s.meters.cost})     ${meters}`,
      `power-ups used     ${st.powerUpsUsed}   milestones ${st.milestonesHit}`,
      `placements ${st.placements}   time ${secs}s`,
      '',
      `cfg depth=${GAMEPLAY_CONFIG.MAX_CASCADE_DEPTH} aff=${GAMEPLAY_CONFIG.COLOUR_AFFINITY}`,
      `seed ${this.getSeed()}`,
      'keys: D debug  G glyphs  M sound  R restart',
    ];
    this.text.setText(lines);
    this.bg.setSize(Math.max(300, this.text.width + 14), this.text.height + 12);
  }
}

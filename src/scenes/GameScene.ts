import Phaser from 'phaser';
import { GAMEPLAY_CONFIG } from '../config/gameplay';
import { THEME } from '../config/theme';
import { GameState, type TurnResult } from '../core/gameState';
import type { Piece } from '../core/Piece';
import type { CellIndex, ColorId } from '../core/types';
import { blockTextureKey, createBlock, retextureBlocks, TEXTURE } from '../render/BlockRenderer';
import { EffectsManager } from '../render/EffectsManager';
import { audio } from '../render/AudioManager';
import { renderSettings, saveRenderSettings } from '../render/settings';
import { PowerUpBar } from '../render/PowerUpBar';
import { canApply, powerUpForColour, type PowerUpDef } from '../core/powerups';
import { DebugOverlay } from '../debug/DebugOverlay';
import { hasSeenHelp } from './HelpScene';

const L = THEME.layout;
const SIZE = GAMEPLAY_CONFIG.BOARD_SIZE;
const PITCH = L.cellSize + L.cellGap;
const BOARD_PX = SIZE * L.cellSize + (SIZE - 1) * L.cellGap;
const BOARD_LEFT = Math.floor((L.canvasWidth - BOARD_PX) / 2);
const BOARD_TOP = L.boardTop;
const TRAY_SLOT_W = L.canvasWidth / GAMEPLAY_CONFIG.TRAY_SIZE;
const TRAY_CENTRE_Y = L.trayTop + 90;
/** Power-up bar sits between the board and the tray. */
const PU_BAR_Y = BOARD_TOP + BOARD_PX + 44;

/** Session best — deliberately not persisted (Phase 1 has no retention systems). */
let sessionBest = 0;

/**
 * The seed this run uses. Fixed to GAMEPLAY_CONFIG.DEFAULT_SEED so playtest
 * sessions are reproducible and bugs repeatable (§2.2.1). Picking a seed is a
 * presentation-layer concern — src/core/ must never read a clock — and in
 * Phase 2 the SERVER supplies this and the client never chooses one.
 */
let currentSeed: number = GAMEPLAY_CONFIG.DEFAULT_SEED;
/** Dev-only: cycle a fresh seed each run instead of replaying the fixed one. */
let randomiseSeed = false;

function nextSeed(): number {
  if (!randomiseSeed) return GAMEPLAY_CONFIG.DEFAULT_SEED;
  // Outside src/core/, so a clock read here breaks no rule.
  return Date.now() >>> 0;
}

interface Drag {
  trayIndex: number;
  piece: Piece;
  container: Phaser.GameObjects.Container;
  lift: number;
  anchor: { row: number; col: number } | null;
  valid: boolean;
}

export class GameScene extends Phaser.Scene {
  private state!: GameState;
  private fx!: EffectsManager;
  private debug!: DebugOverlay;
  private blocks: (Phaser.GameObjects.Image | null)[] = [];
  private trayContainers: (Phaser.GameObjects.Container | null)[] = [];
  private ghost: Phaser.GameObjects.Image[] = [];
  private drag: Drag | null = null;
  private busy = false;
  private scoreText!: Phaser.GameObjects.Text;
  private bestText!: Phaser.GameObjects.Text;
  private powerBar!: PowerUpBar;
  private hintText!: Phaser.GameObjects.Text;
  private targeting: { colour: ColorId; def: PowerUpDef } | null = null;
  private targetHighlight: Phaser.GameObjects.Rectangle[] = [];
  private displayedScore = 0;
  private startedAt = 0;

  constructor() {
    super('Game');
  }

  // ── Layout helpers ─────────────────────────────────────────────────────

  private cellCentre(row: number, col: number): { x: number; y: number } {
    return { x: BOARD_LEFT + col * PITCH + L.cellSize / 2, y: BOARD_TOP + row * PITCH + L.cellSize / 2 };
  }

  private cellCentreByIndex(i: CellIndex): { x: number; y: number } {
    const { row, col } = this.state.board.coord(i);
    return this.cellCentre(row, col);
  }

  private traySlotCentre(i: number): { x: number; y: number } {
    return { x: TRAY_SLOT_W * (i + 0.5), y: TRAY_CENTRE_Y };
  }

  // ── Scene lifecycle ────────────────────────────────────────────────────

  create(): void {
    currentSeed = nextSeed();
    this.state = new GameState({ seed: currentSeed });
    this.blocks = new Array<Phaser.GameObjects.Image | null>(SIZE * SIZE).fill(null);
    this.trayContainers = [];
    this.ghost = [];
    this.drag = null;
    this.busy = false;
    this.targeting = null;
    this.targetHighlight = [];
    this.displayedScore = 0;
    this.startedAt = this.time.now;

    this.cameras.main.setBackgroundColor(THEME.colours.backgroundDeep);
    this.drawChrome();
    this.fx = new EffectsManager(this);
    this.fx.addScanlines();
    if (GAMEPLAY_CONFIG.POWERUPS_ENABLED) {
      this.powerBar = new PowerUpBar(this, PU_BAR_Y, BOARD_PX, (colour) => this.onPowerUpTapped(colour));
      this.powerBar.refresh(this, this.state.meters, null);
    }
    this.renderTray(false);
    this.bindInput();
    this.debug = new DebugOverlay(this, () => this.state, () => this.time.now - this.startedAt, () => currentSeed);

    if (this.state.gameOver) this.endGame();
    else if (!hasSeenHelp()) this.time.delayedCall(420, () => this.openHelp());
  }

  override update(): void {
    this.debug.update();
  }

  private drawChrome(): void {
    const g = this.add.graphics();
    g.fillStyle(THEME.colours.backgroundPanel, 1);
    g.fillRoundedRect(BOARD_LEFT - 12, BOARD_TOP - 12, BOARD_PX + 24, BOARD_PX + 24, 10);
    g.lineStyle(1, THEME.colours.gridLine, 1);
    g.strokeRoundedRect(BOARD_LEFT - 12, BOARD_TOP - 12, BOARD_PX + 24, BOARD_PX + 24, 10);
    g.fillStyle(THEME.colours.backgroundPanel, 0.6);
    g.fillRoundedRect(12, L.trayTop, L.canvasWidth - 24, 180, 10);

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const { x, y } = this.cellCentre(r, c);
        this.add.image(x, y, TEXTURE.emptyCell).setDepth(1);
      }
    }

    this.add
      .text(L.canvasWidth / 2, 34, 'CYBER BLAST', {
        fontFamily: THEME.fonts.display,
        fontSize: '22px',
        fontStyle: '700',
        color: '#00F0FF',
      })
      .setOrigin(0.5)
      .setShadow(0, 0, '#00F0FF', 12, true, true)
      .setAlpha(0.9);

    this.scoreText = this.add
      .text(L.canvasWidth / 2, 80, '0', {
        fontFamily: THEME.fonts.display,
        fontSize: '36px',
        fontStyle: '700',
        color: THEME.colours.textPrimaryCss,
      })
      .setOrigin(0.5);

    this.hintText = this.add
      .text(L.canvasWidth / 2, PU_BAR_Y + 40, '', {
        fontFamily: THEME.fonts.body,
        fontSize: '14px',
        fontStyle: '600',
        color: '#8781b8',
      })
      .setOrigin(0.5)
      .setDepth(31);

    this.bestText = this.add
      .text(BOARD_LEFT, 66, `BEST ${sessionBest}`, {
        fontFamily: THEME.fonts.body,
        fontSize: '16px',
        fontStyle: '600',
        color: '#9D4EDD',
      })
      .setOrigin(0, 0.5);

    // Tiny tap targets so toggles work on a phone as well as via keys.
    this.addToggleButton(L.canvasWidth - BOARD_LEFT, 58, () => (renderSettings.glyphMode ? 'GLYPH ●' : 'GLYPH ○'), () => this.toggleGlyphs());
    this.addToggleButton(L.canvasWidth - BOARD_LEFT, 80, () => (renderSettings.soundOn ? 'SND ●' : 'SND ○'), () => this.toggleSound());
    this.addToggleButton(L.canvasWidth - BOARD_LEFT, 102, () => 'DBG', () => this.debug.toggle());
    this.addToggleButton(
      L.canvasWidth - BOARD_LEFT,
      124,
      () => (randomiseSeed ? 'SEED RND' : 'SEED FIX'),
      () => {
        randomiseSeed = !randomiseSeed;
      },
    );
    // How-to-play: a big, obvious target, not a tiny toggle.
    const help = this.add
      .text(BOARD_LEFT, 100, '?  HOW TO PLAY', {
        fontFamily: THEME.fonts.body,
        fontSize: '14px',
        fontStyle: '700',
        color: '#00F0FF',
      })
      .setOrigin(0, 0.5)
      .setPadding(10, 10)
      .setInteractive({ useHandCursor: true });
    help.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      this.openHelp();
    });
  }

  private addToggleButton(x: number, y: number, label: () => string, onTap: () => void): void {
    const t = this.add
      .text(x, y, label(), { fontFamily: THEME.fonts.body, fontSize: '14px', fontStyle: '600', color: '#6F6A9E' })
      .setOrigin(1, 0.5)
      .setPadding(6, 4)
      .setInteractive({ useHandCursor: true });
    t.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      onTap();
      t.setText(label());
    });
  }

  // ── Toggles ────────────────────────────────────────────────────────────

  private toggleGlyphs(): void {
    renderSettings.glyphMode = !renderSettings.glyphMode;
    saveRenderSettings();
    retextureBlocks(this.allBlockImages());
  }

  private toggleSound(): void {
    renderSettings.soundOn = !renderSettings.soundOn;
    saveRenderSettings();
  }

  private *allBlockImages(): Generator<Phaser.GameObjects.Image> {
    for (const b of this.blocks) if (b) yield b;
    for (const c of this.trayContainers) {
      if (!c) continue;
      for (const child of c.list) if (child instanceof Phaser.GameObjects.Image) yield child;
    }
    if (this.drag) for (const child of this.drag.container.list) if (child instanceof Phaser.GameObjects.Image) yield child;
    for (const g of this.ghost) yield g;
  }

  /**
   * Rebuild every block sprite from the pure board state. Used by the debug
   * tooling and smoke tests after mutating `state.board` directly.
   */
  debugSyncBoard(): void {
    for (const b of this.blocks) b?.destroy();
    this.blocks = new Array<Phaser.GameObjects.Image | null>(SIZE * SIZE).fill(null);
    const board = this.state.board;
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const v = board.get(r, c);
        if (v < 0) continue;
        const { x, y } = this.cellCentre(r, c);
        const img = createBlock(this, v, x, y).setDepth(10);
        img.setData('color', v);
        this.blocks[board.index(r, c)] = img;
      }
    }
    this.renderTray(false);
    if (GAMEPLAY_CONFIG.POWERUPS_ENABLED) this.powerBar.refresh(this, this.state.meters, null);
  }

  // ── Tray ───────────────────────────────────────────────────────────────

  private buildPieceContainer(piece: Piece, x: number, y: number, scale: number): Phaser.GameObjects.Container {
    const container = this.add.container(x, y).setScale(scale);
    const { width: w, height: h } = piece.shape;
    for (const [r, c] of piece.shape.cells) {
      const img = createBlock(this, piece.color, (c - (w - 1) / 2) * PITCH, (r - (h - 1) / 2) * PITCH);
      img.setData('color', piece.color);
      container.add(img);
    }
    return container;
  }

  private renderTray(animate: boolean): void {
    for (const c of this.trayContainers) c?.destroy();
    this.trayContainers = [];
    for (let i = 0; i < this.state.tray.length; i++) {
      const piece = this.state.tray[i];
      if (!piece) {
        this.trayContainers.push(null);
        continue;
      }
      const { x, y } = this.traySlotCentre(i);
      const container = this.buildPieceContainer(piece, x, y, L.trayScale).setDepth(20);
      const hitW = Math.max(piece.shape.width * PITCH, 3 * PITCH);
      const hitH = Math.max(piece.shape.height * PITCH, 3 * PITCH);
      container.setInteractive(new Phaser.Geom.Rectangle(-hitW / 2, -hitH / 2, hitW, hitH), Phaser.Geom.Rectangle.Contains);
      container.on('pointerdown', (pointer: Phaser.Input.Pointer) => this.startDrag(i, pointer));
      this.trayContainers.push(container);
      if (animate) {
        container.setAlpha(0).setY(y + 40);
        this.tweens.add({ targets: container, alpha: 1, y, duration: 220, delay: i * 60, ease: 'Back.easeOut' });
      }
    }
  }

  // ── Input / drag ───────────────────────────────────────────────────────

  private bindInput(): void {
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      audio.unlock();
      if (this.targeting) this.onTargetTap(p);
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => this.onPointerMove(p));
    this.input.on('pointerup', (p: Phaser.Input.Pointer) => this.onPointerUp(p));
    this.input.on('pointerupoutside', (p: Phaser.Input.Pointer) => this.onPointerUp(p));

    const kb = this.input.keyboard;
    kb?.on('keydown-D', () => this.debug.toggle());
    kb?.on('keydown-BACKTICK', () => this.debug.toggle());
    kb?.on('keydown-G', () => this.toggleGlyphs());
    kb?.on('keydown-M', () => this.toggleSound());
    kb?.on('keydown-R', () => {
      if (!this.busy) this.scene.restart();
    });
    kb?.on('keydown-ESC', () => this.cancelTargeting());
    kb?.on('keydown-H', () => this.openHelp());
  }

  private openHelp(): void {
    if (this.scene.isActive('Help')) return;
    this.cancelTargeting();
    this.scene.pause();
    this.scene.launch('Help');
  }

  // ── Power-ups ──────────────────────────────────────────────────────────

  private onPowerUpTapped(colour: ColorId): void {
    if (this.busy || this.drag) return;
    audio.unlock();

    // Tapping the armed ability again puts it away.
    if (this.targeting?.colour === colour) {
      this.cancelTargeting();
      return;
    }
    if (!this.state.readyColours().includes(colour)) {
      audio.invalidThunk();
      const def = powerUpForColour(colour);
      this.flashHint(`${def.name.toUpperCase()} — ${def.blurb}`);
      return;
    }

    const def = powerUpForColour(colour);
    if (def.targeting === 'none') {
      this.firePowerUp(colour, 0, 0);
      return;
    }
    this.targeting = { colour, def };
    this.powerBar.refresh(this, this.state.meters, colour);
    this.showTargetHighlight();
    this.hintText.setText(`${def.name.toUpperCase()} — tap a tile.  ESC to cancel`);
    audio.pickUp();
  }

  private cancelTargeting(): void {
    if (!this.targeting) return;
    this.targeting = null;
    this.clearTargetHighlight();
    this.hintText.setText('');
    this.powerBar.refresh(this, this.state.meters, null);
  }

  private showTargetHighlight(): void {
    this.clearTargetHighlight();
    const rect = this.add
      .rectangle(BOARD_LEFT - 6, BOARD_TOP - 6, BOARD_PX + 12, BOARD_PX + 12, 0x000000, 0)
      .setOrigin(0, 0)
      .setStrokeStyle(2, THEME.blocks[this.targeting?.colour ?? 0]?.hex ?? 0xffffff, 0.9)
      .setDepth(35);
    this.tweens.add({ targets: rect, alpha: { from: 0.45, to: 1 }, duration: 520, yoyo: true, repeat: -1 });
    this.targetHighlight.push(rect);
  }

  private clearTargetHighlight(): void {
    for (const r of this.targetHighlight) {
      this.tweens.killTweensOf(r);
      r.destroy();
    }
    this.targetHighlight = [];
  }

  private flashHint(message: string): void {
    this.hintText.setText(message);
    this.time.delayedCall(1800, () => {
      if (!this.targeting) this.hintText.setText('');
    });
  }

  /** Convert a pointer position to a board cell, or null if it's off the grid. */
  private cellAt(x: number, y: number): { row: number; col: number } | null {
    const col = Math.floor((x - BOARD_LEFT) / PITCH);
    const row = Math.floor((y - BOARD_TOP) / PITCH);
    if (row < 0 || col < 0 || row >= SIZE || col >= SIZE) return null;
    return { row, col };
  }

  private onTargetTap(pointer: Phaser.Input.Pointer): void {
    const t = this.targeting;
    if (!t) return;
    const cell = this.cellAt(pointer.x, pointer.y);
    if (!cell) return; // tap off the board does nothing; use ESC or the button to cancel
    if (!canApply(this.state.board, t.def.id, cell.row, cell.col)) {
      audio.invalidThunk();
      this.flashHint(t.def.id === 'pluck' ? 'Pluck needs a filled tile' : 'Pick a tile');
      return;
    }
    this.firePowerUp(t.colour, cell.row, cell.col);
  }

  private firePowerUp(colour: ColorId, row: number, col: number): void {
    const result = this.state.usePowerUp(colour, row, col);
    if (!result) {
      audio.invalidThunk();
      return;
    }
    this.cancelTargeting();
    this.busy = true;

    audio.cascadeNote(1);
    this.fx.shake(2);
    for (const i of result.effect.cleared) this.clearBlockVisual(i, 1);
    for (const { index, colour: newColour } of result.effect.recoloured) {
      const img = this.blocks[index];
      if (!img) continue;
      img.setTexture(blockTextureKey(newColour));
      img.setData('color', newColour);
      this.tweens.add({ targets: img, scale: { from: 1.25, to: 1 }, duration: 220, ease: 'Back.easeOut' });
      const { x, y } = this.cellCentreByIndex(index);
      this.fx.clearCell(x, y, newColour, 0);
    }

    if (result.scoreGained > 0) {
      const { x, y } = this.cellCentre(row, col);
      this.fx.floatScore(x, y, result.scoreGained, '#FFB627');
    }
    this.tweenScore(this.state.score);
    if (result.trayRefilled) this.renderTray(true);
    this.powerBar.refresh(this, this.state.meters, null);

    this.time.delayedCall(320, () => {
      this.busy = false;
      if (result.gameOver) this.endGame();
    });
  }

  private startDrag(trayIndex: number, pointer: Phaser.Input.Pointer): void {
    if (this.busy || this.drag || this.targeting) return;
    const piece = this.state.tray[trayIndex];
    const tray = this.trayContainers[trayIndex];
    if (!piece || !tray) return;

    audio.unlock();
    audio.pickUp();
    tray.setAlpha(0.25);

    const lift = pointer.wasTouch ? L.touchDragLiftPx : 0;
    const container = this.buildPieceContainer(piece, pointer.x, pointer.y - lift, L.trayScale).setDepth(60);
    this.tweens.add({ targets: container, scale: 1, duration: 90, ease: 'Quad.easeOut' });
    this.drag = { trayIndex, piece, container, lift, anchor: null, valid: false };
    this.updateGhost(pointer);
  }

  private onPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!this.drag) return;
    this.drag.container.setPosition(pointer.x, pointer.y - this.drag.lift);
    this.updateGhost(pointer);
  }

  private clearGhost(): void {
    for (const g of this.ghost) g.destroy();
    this.ghost = [];
  }

  private updateGhost(pointer: Phaser.Input.Pointer): void {
    const d = this.drag;
    if (!d) return;
    this.clearGhost();
    d.anchor = null;
    d.valid = false;

    const { width: w, height: h } = d.piece.shape;
    const cx = pointer.x;
    const cy = pointer.y - d.lift;
    // Top-left cell centre of the dragged piece, snapped to the grid.
    const tlx = cx - ((w - 1) / 2) * PITCH;
    const tly = cy - ((h - 1) / 2) * PITCH;
    const col = Math.round((tlx - (BOARD_LEFT + L.cellSize / 2)) / PITCH);
    const row = Math.round((tly - (BOARD_TOP + L.cellSize / 2)) / PITCH);

    // Only show a ghost when the whole piece is over the board area.
    if (col < -0 || row < 0 || col + w > SIZE || row + h > SIZE) {
      // Allow a little slack: if the pointer is well outside the board, no ghost.
      return;
    }

    const valid = this.state.canPlace(d.trayIndex, row, col);
    d.anchor = { row, col };
    d.valid = valid;
    for (const [r, c] of d.piece.shape.cells) {
      const { x, y } = this.cellCentre(row + r, col + c);
      const img = valid
        ? this.add.image(x, y, blockTextureKey(d.piece.color)).setAlpha(0.42)
        : this.add.image(x, y, TEXTURE.white).setTint(THEME.colours.danger).setAlpha(0.28);
      img.setData('color', d.piece.color).setDepth(5);
      this.ghost.push(img);
    }
  }

  private onPointerUp(_pointer: Phaser.Input.Pointer): void {
    const d = this.drag;
    if (!d) return;
    this.drag = null;
    this.clearGhost();

    if (d.anchor && d.valid) {
      d.container.destroy();
      this.runTurn(d.trayIndex, d.anchor.row, d.anchor.col);
      return;
    }

    if (d.anchor && !d.valid) audio.invalidThunk();
    const tray = this.trayContainers[d.trayIndex];
    const { x, y } = this.traySlotCentre(d.trayIndex);
    this.tweens.add({
      targets: d.container,
      x,
      y,
      scale: L.trayScale,
      duration: 160,
      ease: 'Quad.easeOut',
      onComplete: () => {
        d.container.destroy();
        tray?.setAlpha(1);
      },
    });
  }

  // ── Turn resolution & cascade visualisation ────────────────────────────

  private wait(ms: number): Promise<void> {
    return new Promise((resolve) => this.time.delayedCall(ms, resolve));
  }

  private runTurn(trayIndex: number, row: number, col: number): void {
    const result = this.state.placePiece(trayIndex, row, col);
    if (!result) {
      audio.invalidThunk();
      this.renderTray(false);
      return;
    }
    this.busy = true;
    this.trayContainers[trayIndex]?.destroy();
    this.trayContainers[trayIndex] = null;
    void this.animateTurn(result).finally(() => {
      if (!this.state.gameOver) this.busy = false;
    });
  }

  private async animateTurn(result: TurnResult): Promise<void> {
    // 1. Placement.
    const placed: Phaser.GameObjects.Image[] = [];
    for (const i of result.placedCells) {
      const { x, y } = this.cellCentreByIndex(i);
      const img = createBlock(this, result.piece.color, x, y).setDepth(10);
      img.setData('color', result.piece.color);
      this.blocks[i] = img;
      placed.push(img);
    }
    audio.placeClick();
    this.fx.placementPunch(placed);

    // 2. Cascade, generation by generation.
    const gens = result.cascade.generations;
    const boardCentre = this.cellCentre((SIZE - 1) / 2, (SIZE - 1) / 2);
    for (let g = 0; g < gens.length; g++) {
      if (g > 0) await this.wait(GAMEPLAY_CONFIG.CASCADE_STEP_DELAY_MS);
      else await this.wait(THEME.effects.placementPunchMs);
      const cells = gens[g] ?? [];
      audio.cascadeNote(g);
      this.fx.shake(g);
      for (const i of cells) this.clearBlockVisual(i, g);
      if (g >= 1) this.fx.showCombo(g + 1, g, boardCentre.x, boardCentre.y);
    }

    // 3. Score.
    if (result.score.clears > 0) {
      await this.wait(120);
      this.fx.floatScore(boardCentre.x, boardCentre.y + 70, result.score.clears, '#A8FF3E');
    }
    this.tweenScore(this.state.score);

    // 4. Power-up meters, and a callout for anything that just charged.
    if (GAMEPLAY_CONFIG.POWERUPS_ENABLED) {
      this.powerBar.refresh(this, this.state.meters, null);
      const charged = result.chargedColours[0];
      if (charged !== undefined) {
        const def = powerUpForColour(charged);
        this.flashHint(`${def.name.toUpperCase()} READY — ${def.blurb}`);
        audio.cascadeNote(3);
      }
    }

    // 5. Tray refill.
    if (result.trayRefilled) this.renderTray(true);

    // 6. Game over.
    if (result.gameOver) {
      await this.wait(500);
      this.endGame();
    }
  }

  private clearBlockVisual(i: CellIndex, generation: number): void {
    const img = this.blocks[i];
    if (!img) return;
    this.blocks[i] = null;
    const color = (img.getData('color') as ColorId | undefined) ?? 0;
    this.fx.clearCell(img.x, img.y, color, generation);
    this.tweens.add({
      targets: img,
      scale: 1.3 + generation * 0.1,
      alpha: 0,
      duration: 160,
      ease: 'Quad.easeOut',
      onComplete: () => img.destroy(),
    });
  }

  private tweenScore(target: number): void {
    const from = this.displayedScore;
    const proxy = { v: from };
    this.tweens.add({
      targets: proxy,
      v: target,
      duration: Math.min(600, 120 + Math.abs(target - from) * 2),
      ease: 'Quad.easeOut',
      onUpdate: () => this.scoreText.setText(`${Math.round(proxy.v)}`),
      onComplete: () => this.scoreText.setText(`${target}`),
    });
    this.displayedScore = target;
    if (target > sessionBest) {
      sessionBest = target;
      this.bestText.setText(`BEST ${sessionBest}`);
    }
  }

  private endGame(): void {
    this.busy = true;
    audio.gameOver();
    this.cancelTargeting();
    this.scene.launch('GameOver', {
      score: this.state.score,
      best: sessionBest,
      placements: this.state.stats.placements,
      maxDepth: this.state.stats.maxDepthThisGame,
    });
  }
}

import Phaser from 'phaser';
import { THEME } from '../config/theme';
import {
  getLeaderboard,
  isoWeekId,
  loadPlayerName,
  msUntilWeekEnd,
  sanitiseName,
  savePlayerName,
  type Leaderboard,
  type ScoreEntry,
} from '../leaderboard';

export interface GameOverData {
  score: number;
  best: number;
  placements: number;
  maxDepth: number;
}

const TOP_ROWS = 8;

export class GameOverScene extends Phaser.Scene {
  private run!: GameOverData;
  private board: Leaderboard | null = null;
  private week = '';
  private submitted = false;
  private rowTexts: Phaser.GameObjects.Text[] = [];
  private statusText!: Phaser.GameObjects.Text;
  private noteText!: Phaser.GameObjects.Text;
  private nameInput: Phaser.GameObjects.DOMElement | null = null;
  private submitBtn: Phaser.GameObjects.Text | null = null;
  private prompt!: Phaser.GameObjects.Text;
  private acceptRestart = false;

  constructor() {
    super('GameOver');
  }

  create(data: GameOverData): void {
    this.run = data;
    this.week = isoWeekId();
    this.submitted = false;
    this.rowTexts = [];
    this.acceptRestart = false;

    const { canvasWidth: w, canvasHeight: h } = THEME.layout;
    const dim = this.add.rectangle(0, 0, w, h, 0x07070f, 0).setOrigin(0, 0);
    this.tweens.add({ targets: dim, fillAlpha: 0.96, duration: 400 });

    const title = this.add
      .text(w / 2, 96, 'GAME OVER', {
        fontFamily: THEME.fonts.display,
        fontSize: '38px',
        fontStyle: '700',
        color: '#FF2E9F',
      })
      .setOrigin(0.5)
      .setAlpha(0);
    title.setShadow(0, 0, '#FF2E9F', 22, true, true);

    const score = this.add
      .text(w / 2, 156, `${data.score}`, {
        fontFamily: THEME.fonts.display,
        fontSize: '52px',
        fontStyle: '700',
        color: THEME.colours.textPrimaryCss,
      })
      .setOrigin(0.5)
      .setAlpha(0);
    score.setShadow(0, 0, '#00F0FF', 18, true, true);

    const isBest = data.score > 0 && data.score >= data.best;
    const sub = this.add
      .text(w / 2, 200, `${isBest ? 'NEW BEST' : `BEST ${data.best}`}   ·   ${data.placements} PIECES   ·   MAX CHAIN ×${data.maxDepth + 1}`, {
        fontFamily: THEME.fonts.body,
        fontSize: '16px',
        fontStyle: '600',
        color: '#A8FF3E',
      })
      .setOrigin(0.5)
      .setAlpha(0);

    this.tweens.add({ targets: [title, score, sub], alpha: 1, duration: 320, delay: 200, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: score, scale: { from: 0.6, to: 1 }, duration: 420, delay: 200, ease: 'Back.easeOut' });

    this.buildLeaderboardPanel();
    this.buildNameEntry();

    this.prompt = this.add
      .text(w / 2, h - 46, 'TAP TO PLAY AGAIN', {
        fontFamily: THEME.fonts.body,
        fontSize: '20px',
        fontStyle: '600',
        color: THEME.colours.textPrimaryCss,
      })
      .setOrigin(0.5)
      .setAlpha(0);
    this.tweens.add({ targets: this.prompt, alpha: { from: 0.3, to: 1 }, duration: 600, delay: 900, yoyo: true, repeat: -1 });

    // Delay input so a stray tap from the last move doesn't restart instantly.
    this.time.delayedCall(700, () => {
      this.acceptRestart = true;
      this.input.on('pointerdown', () => this.restart());
      this.input.keyboard?.on('keydown-SPACE', () => this.restart());
      this.input.keyboard?.on('keydown-R', () => this.restart());
    });

    void this.loadBoard();
  }

  // ── Weekly board ───────────────────────────────────────────────────────

  private buildLeaderboardPanel(): void {
    const { canvasWidth: w } = THEME.layout;
    const top = 250;

    this.add
      .rectangle(28, top, w - 56, 250, THEME.colours.backgroundPanel, 0.85)
      .setOrigin(0, 0)
      .setStrokeStyle(1, THEME.colours.gridLine);

    const days = Math.max(0, Math.round(msUntilWeekEnd() / 86400000));
    this.add
      .text(44, top + 14, `WEEKLY TOP  ·  ${this.week}`, {
        fontFamily: THEME.fonts.body,
        fontSize: '15px',
        fontStyle: '700',
        color: '#00F0FF',
      })
      .setOrigin(0, 0);
    this.add
      .text(w - 44, top + 15, days <= 1 ? 'RESETS TODAY' : `RESETS IN ${days}D`, {
        fontFamily: THEME.fonts.body,
        fontSize: '13px',
        fontStyle: '600',
        color: '#8781b8',
      })
      .setOrigin(1, 0);

    this.statusText = this.add
      .text(w / 2, top + 120, 'Loading…', {
        fontFamily: THEME.fonts.body,
        fontSize: '14px',
        fontStyle: '600',
        color: '#8781b8',
      })
      .setOrigin(0.5);

    for (let i = 0; i < TOP_ROWS; i++) {
      const t = this.add
        .text(44, top + 44 + i * 24, '', {
          fontFamily: THEME.fonts.body,
          fontSize: '15px',
          fontStyle: '600',
          color: THEME.colours.textPrimaryCss,
        })
        .setOrigin(0, 0);
      this.rowTexts.push(t);
    }
  }

  private async loadBoard(): Promise<void> {
    try {
      this.board = await getLeaderboard();
      const rows = await this.board.top(this.week, TOP_ROWS);
      this.renderRows(rows);
    } catch {
      this.statusText.setText('Leaderboard unavailable');
    }
  }

  private renderRows(rows: readonly ScoreEntry[]): void {
    const { canvasWidth: w } = THEME.layout;
    if (rows.length === 0) {
      this.statusText.setText('No scores yet this week — post the first');
      for (const t of this.rowTexts) t.setText('');
      return;
    }
    this.statusText.setText('');
    this.rowTexts.forEach((t, i) => {
      const row = rows[i];
      if (!row) {
        t.setText('');
        return;
      }
      // Rank and name on the left, score right-aligned via a padded layout.
      const rank = `${i + 1}`.padStart(2, ' ');
      t.setText(`${rank}  ${row.name}`);
      t.setColor(i === 0 ? '#FFB627' : THEME.colours.textPrimaryCss);

      const existing = t.getData('scoreText') as Phaser.GameObjects.Text | undefined;
      const scoreLabel =
        existing ??
        this.add
          .text(w - 44, t.y, '', { fontFamily: THEME.fonts.body, fontSize: '15px', fontStyle: '700', color: '#A8FF3E' })
          .setOrigin(1, 0);
      scoreLabel.setText(`${row.score}`);
      scoreLabel.setColor(i === 0 ? '#FFB627' : '#A8FF3E');
      t.setData('scoreText', scoreLabel);
    });
  }

  // ── Name entry ─────────────────────────────────────────────────────────

  private buildNameEntry(): void {
    const { canvasWidth: w } = THEME.layout;
    const y = 528;

    this.add
      .text(44, y - 22, 'POST YOUR SCORE', {
        fontFamily: THEME.fonts.body,
        fontSize: '13px',
        fontStyle: '600',
        color: '#8781b8',
      })
      .setOrigin(0, 0);

    // A real DOM input so phones get a proper keyboard.
    const html = `<input type="text" maxlength="12" placeholder="YOUR NAME" value="${escapeAttr(loadPlayerName())}"
      style="width:230px;height:38px;box-sizing:border-box;background:#0d0b1f;border:1px solid #231f45;border-radius:6px;
      color:#E8E6FF;font-family:Rajdhani,sans-serif;font-size:17px;font-weight:600;letter-spacing:0.08em;
      padding:0 12px;outline:none;text-transform:uppercase;">`;
    this.nameInput = this.add.dom(44 + 115, y + 20).createFromHTML(html);
    this.nameInput.setOrigin(0.5);

    const node = this.nameInput.node.querySelector('input');
    if (node instanceof HTMLInputElement) {
      node.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') void this.submit();
      });
    }

    this.submitBtn = this.add
      .text(w - 44, y + 20, 'POST', {
        fontFamily: THEME.fonts.body,
        fontSize: '17px',
        fontStyle: '700',
        color: '#07070F',
        backgroundColor: '#00F0FF',
        padding: { x: 18, y: 9 },
      })
      .setOrigin(1, 0.5)
      .setInteractive({ useHandCursor: true });
    this.noteText = this.add
      .text(44, y + 48, '', { fontFamily: THEME.fonts.body, fontSize: '13px', fontStyle: '600', color: '#8781b8' })
      .setOrigin(0, 0);

    this.submitBtn.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      void this.submit();
    });
  }

  private currentName(): string {
    const node = this.nameInput?.node.querySelector('input');
    return node instanceof HTMLInputElement ? node.value : '';
  }

  private async submit(): Promise<void> {
    if (this.submitted || !this.submitBtn) return;
    this.submitted = true;

    const name = sanitiseName(this.currentName());
    savePlayerName(name);
    this.submitBtn.setText('…').disableInteractive();

    try {
      const board = this.board ?? (await getLeaderboard());
      this.board = board;
      await board.submit(this.week, {
        name,
        score: this.run.score,
        placements: this.run.placements,
        maxChain: this.run.maxDepth,
        ts: Date.now(),
      });
      this.renderRows(await board.top(this.week, TOP_ROWS));
      this.submitBtn.setText('POSTED').setBackgroundColor('#A8FF3E');
      this.noteText.setText(
        board.kind === 'local' ? 'Saved to this browser only — no shared board here' : 'Posted to the shared weekly board',
      );
    } catch {
      this.submitted = false;
      this.noteText.setText("Couldn't post — tap RETRY");
      this.submitBtn.setText('RETRY').setBackgroundColor('#FFB627').setInteractive({ useHandCursor: true });
    }
  }

  private restart(): void {
    if (!this.acceptRestart) return;
    this.acceptRestart = false;
    this.nameInput?.destroy();
    const game = this.scene.get('Game');
    this.scene.stop();
    game.scene.restart();
  }
}

function escapeAttr(v: string): string {
  return v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

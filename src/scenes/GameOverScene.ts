import Phaser from 'phaser';
import { THEME } from '../config/theme';
import { submitRun, type RunSession } from '../backend/runSession';
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
  /** Carries the move log. The score is derived from it, never sent. */
  session: RunSession;
}

const TOP_ROWS = 8;

export class GameOverScene extends Phaser.Scene {
  private run!: GameOverData;
  private board: Leaderboard | null = null;
  private week = '';
  private runId = '';
  private rowTexts: Phaser.GameObjects.Text[] = [];
  private statusText!: Phaser.GameObjects.Text;
  private noteText!: Phaser.GameObjects.Text;
  private nameInput: Phaser.GameObjects.DOMElement | null = null;
  private saveBtn: Phaser.GameObjects.Text | null = null;
  private postedName = '';
  /** Resolves once the automatic post has finished, so a rename can't race it. */
  private posting: Promise<void> | null = null;
  private prompt!: Phaser.GameObjects.Text;
  private acceptRestart = false;

  constructor() {
    super('GameOver');
  }

  create(data: GameOverData): void {
    this.run = data;
    this.week = isoWeekId();
    // Identifies this run's row so a later name change updates it in place.
    this.runId = `${Date.now().toString(36)}-${Math.floor(Math.random() * 1e6).toString(36)}`;
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

    this.posting = this.postRun();
    void this.posting;
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

  /**
   * Post the run automatically.
   *
   * There is no confirm step and nothing to type: the score comes from the
   * game that was just played. The server is authoritative — it replays the
   * move log and derives the number itself — and the weekly board here is
   * written in parallel so the game still shows a table offline.
   */
  private async postRun(): Promise<void> {
    this.postedName = sanitiseName(loadPlayerName());

    try {
      this.board = await getLeaderboard();
      await this.writeLocalRow();
      this.renderRows(await this.board.top(this.week, TOP_ROWS));
    } catch {
      this.statusText.setText('Leaderboard unavailable');
    }

    const outcome = await submitRun(this.run.session, {
      score: this.run.score,
      placements: this.run.placements,
      maxCascade: this.run.maxDepth,
    });

    switch (outcome.status) {
      case 'accepted':
        this.noteText.setText(`Posted · verified score ${outcome.score}`).setColor('#A8FF3E');
        break;
      case 'queued':
        this.noteText.setText("Saved — we'll post it next time you're online").setColor('#FFB627');
        break;
      case 'offline':
        this.noteText
          .setText(this.board?.kind === 'shared' ? 'Posted to this board only' : 'Saved to this browser only')
          .setColor('#8781b8');
        break;
      case 'rejected':
        // Worth showing plainly rather than hiding: if the server refuses an
        // honest run, that is a bug we need reported, not swallowed.
        this.noteText.setText(`Not ranked: ${outcome.reason}`).setColor('#FF2E9F');
        break;
    }
  }

  /** Write (or rewrite) this run's row on the local/shared weekly board. */
  private async writeLocalRow(): Promise<void> {
    const board = this.board ?? (await getLeaderboard());
    this.board = board;
    await board.submit(this.week, {
      id: this.runId,
      name: this.postedName,
      score: this.run.score,
      placements: this.run.placements,
      maxChain: this.run.maxDepth,
      ts: Date.now(),
    });
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

  // ── Name (identity only — never a score) ───────────────────────────────

  private buildNameEntry(): void {
    const { canvasWidth: w } = THEME.layout;
    const y = 528;

    this.add
      .text(44, y - 22, 'POSTED AS', {
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
        if (e.key === 'Enter') void this.rename();
      });
    }

    this.saveBtn = this.add
      .text(w - 44, y + 20, 'SAVE', {
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

    this.saveBtn.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, event: Phaser.Types.Input.EventData) => {
      event.stopPropagation();
      void this.rename();
    });
  }

  private currentName(): string {
    const node = this.nameInput?.node.querySelector('input');
    return node instanceof HTMLInputElement ? node.value : '';
  }

  /**
   * Change the name this run was posted under. It rewrites the row in place
   * (matched on the run id) and cannot touch the score — the score belongs to
   * the game that was played, not to anything typed on this screen.
   */
  private async rename(): Promise<void> {
    // The run posts itself on arrival; renaming before that lands would be
    // overwritten by it.
    await this.posting;
    const name = sanitiseName(this.currentName());
    if (name === this.postedName) return;
    this.postedName = name;
    savePlayerName(name);
    this.saveBtn?.setText('…').disableInteractive();

    try {
      await this.writeLocalRow();
      this.renderRows(await (this.board ?? (await getLeaderboard())).top(this.week, TOP_ROWS));
      this.saveBtn?.setText('SAVED').setBackgroundColor('#A8FF3E');
    } catch {
      this.saveBtn?.setText('RETRY').setBackgroundColor('#FFB627').setInteractive({ useHandCursor: true });
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

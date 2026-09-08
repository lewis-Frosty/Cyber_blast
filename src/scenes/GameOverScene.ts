import Phaser from 'phaser';
import { THEME } from '../config/theme';
import { submitRun, type RunSession } from '../backend/runSession';
import { avatarTextureKey, ensureAvatarTextures, resolveAvatarId } from '../render/AvatarArt';
import { fetchBoard, fetchMyRank, type BoardRow, type BoardScope, type MyRank } from '../backend/leaderboard';
import { loadProfile, type PlayerProfile } from '../backend/profile';

export interface GameOverData {
  score: number;
  best: number;
  placements: number;
  maxDepth: number;
  /** Carries the move log. The score is derived from it, never sent. */
  session: RunSession;
}

const TOP_ROWS = 7;
const L = THEME.layout;

const SCOPES: ReadonlyArray<{ id: BoardScope; label: string }> = [
  { id: 'global', label: 'GLOBAL' },
  { id: 'country', label: 'COUNTRY' },
  { id: 'weekly', label: 'THIS WEEK' },
];

/**
 * Game over, and the board the run just joined.
 *
 * The run posts itself: nothing here is typed, confirmed or claimed. The rows
 * come from the server's own verified scores, so a player sees where they
 * actually stand rather than a table of their own past games.
 */
export class GameOverScene extends Phaser.Scene {
  private run!: GameOverData;
  private profile: PlayerProfile | null = null;
  private scope: BoardScope = 'global';

  private rowItems: Phaser.GameObjects.GameObject[] = [];
  private tabTexts: Phaser.GameObjects.Text[] = [];
  private statusText!: Phaser.GameObjects.Text;
  private noteText!: Phaser.GameObjects.Text;
  private myRankText!: Phaser.GameObjects.Text;
  private prompt!: Phaser.GameObjects.Text;
  private acceptRestart = false;
  private boardTop = 250;

  constructor() {
    super('GameOver');
  }

  create(data: GameOverData): void {
    this.run = data;
    this.scope = 'global';
    this.rowItems = [];
    this.tabTexts = [];
    this.acceptRestart = false;
    ensureAvatarTextures(this);

    const w = L.canvasWidth;
    const h = L.canvasHeight;
    const dim = this.add.rectangle(0, 0, w, h, 0x07070f, 0).setOrigin(0, 0);
    this.tweens.add({ targets: dim, fillAlpha: 0.96, duration: 400 });

    const title = this.add
      .text(w / 2, 84, 'GAME OVER', {
        fontFamily: THEME.fonts.display,
        fontSize: '36px',
        fontStyle: '700',
        color: '#FF2E9F',
      })
      .setOrigin(0.5)
      .setAlpha(0);
    title.setShadow(0, 0, '#FF2E9F', 22, true, true);

    const score = this.add
      .text(w / 2, 140, `${data.score}`, {
        fontFamily: THEME.fonts.display,
        fontSize: '50px',
        fontStyle: '700',
        color: THEME.colours.textPrimaryCss,
      })
      .setOrigin(0.5)
      .setAlpha(0);
    score.setShadow(0, 0, '#00F0FF', 18, true, true);

    const isBest = data.score > 0 && data.score >= data.best;
    const sub = this.add
      .text(
        w / 2,
        182,
        `${isBest ? 'NEW BEST' : `BEST ${data.best}`}   ·   ${data.placements} PIECES   ·   MAX CHAIN ×${data.maxDepth + 1}`,
        { fontFamily: THEME.fonts.body, fontSize: '15px', fontStyle: '600', color: '#A8FF3E' },
      )
      .setOrigin(0.5)
      .setAlpha(0);

    this.tweens.add({ targets: [title, score, sub], alpha: 1, duration: 320, delay: 200, ease: 'Quad.easeOut' });
    this.tweens.add({ targets: score, scale: { from: 0.6, to: 1 }, duration: 420, delay: 200, ease: 'Back.easeOut' });

    this.noteText = this.add
      .text(w / 2, 208, 'Posting…', {
        fontFamily: THEME.fonts.body,
        fontSize: '13px',
        fontStyle: '600',
        color: '#8781b8',
      })
      .setOrigin(0.5);

    this.buildBoardPanel();
    this.buildProfileButton();

    this.prompt = this.add
      .text(w / 2, h - 40, 'TAP TO PLAY AGAIN', {
        fontFamily: THEME.fonts.body,
        fontSize: '19px',
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

    void this.postThenLoad();
  }

  // ── Panel ──────────────────────────────────────────────────────────────

  private buildBoardPanel(): void {
    const w = L.canvasWidth;
    const top = this.boardTop;

    this.add
      .rectangle(24, top, w - 48, 300, THEME.colours.backgroundPanel, 0.9)
      .setOrigin(0, 0)
      .setStrokeStyle(1, THEME.colours.gridLine);

    SCOPES.forEach((s, i) => {
      const x = 40 + i * 132;
      const t = this.add
        .text(x, top + 14, s.label, {
          fontFamily: THEME.fonts.body,
          fontSize: '13px',
          fontStyle: '700',
          color: s.id === this.scope ? '#00F0FF' : '#615c82',
        })
        .setOrigin(0, 0)
        .setInteractive({ useHandCursor: true });
      t.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        this.scope = s.id;
        this.tabTexts.forEach((tt, ti) => tt.setColor(SCOPES[ti]!.id === this.scope ? '#00F0FF' : '#615c82'));
        void this.loadBoard();
      });
      this.tabTexts.push(t);
    });

    this.statusText = this.add
      .text(w / 2, top + 140, 'Loading…', {
        fontFamily: THEME.fonts.body,
        fontSize: '14px',
        fontStyle: '600',
        color: '#8781b8',
      })
      .setOrigin(0.5);

    this.myRankText = this.add
      .text(w / 2, top + 274, '', {
        fontFamily: THEME.fonts.body,
        fontSize: '13px',
        fontStyle: '700',
        color: '#A8FF3E',
      })
      .setOrigin(0.5);
  }

  private buildProfileButton(): void {
    const t = this.add
      .text(L.canvasWidth / 2, this.boardTop + 320, 'PROFILE  ·  AVATAR  ·  SETTINGS', {
        fontFamily: THEME.fonts.body,
        fontSize: '14px',
        fontStyle: '700',
        color: '#07070F',
        backgroundColor: '#00F0FF',
        padding: { x: 16, y: 8 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    t.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      this.scene.launch('Dashboard');
    });
  }

  // ── Post, then show where it landed ────────────────────────────────────

  private async postThenLoad(): Promise<void> {
    this.profile = await loadProfile();

    const outcome = await submitRun(this.run.session, {
      score: this.run.score,
      placements: this.run.placements,
      maxCascade: this.run.maxDepth,
    });
    if (!this.scene.isActive()) return;

    switch (outcome.status) {
      case 'accepted':
        this.noteText.setText(`Posted · verified score ${outcome.score}`).setColor('#A8FF3E');
        break;
      case 'queued':
        this.noteText.setText("Saved — we'll post it next time you're online").setColor('#FFB627');
        break;
      case 'offline':
        this.noteText.setText('Offline — this run was not ranked').setColor('#8781b8');
        break;
      case 'rejected':
        // Shown plainly rather than hidden: if the server refuses an honest
        // run, that is a bug worth reporting, not swallowing.
        this.noteText.setText(`Not ranked: ${outcome.reason}`).setColor('#FF2E9F');
        break;
    }

    await this.loadBoard();
  }

  private async loadBoard(): Promise<void> {
    for (const o of this.rowItems) o.destroy();
    this.rowItems = [];
    this.statusText.setText('Loading…');
    this.myRankText.setText('');

    const country = this.profile?.countryCode ?? null;
    if (this.scope === 'country' && !country) {
      this.statusText.setText('Set your country in PROFILE to see this board');
      return;
    }

    const [rows, mine] = await Promise.all([
      fetchBoard(this.scope, country, TOP_ROWS),
      fetchMyRank(this.scope, country),
    ]);
    if (!this.scene.isActive()) return;

    this.renderRows(rows);
    this.renderMyRank(rows, mine);
  }

  private renderRows(rows: readonly BoardRow[]): void {
    const w = L.canvasWidth;
    const top = this.boardTop;
    if (rows.length === 0) {
      this.statusText.setText('No scores on this board yet — be the first');
      return;
    }
    this.statusText.setText('');

    rows.forEach((row, i) => {
      const y = top + 46 + i * 30;
      const mine = row.isMe;

      if (mine) {
        this.rowItems.push(
          this.add.rectangle(32, y - 3, w - 64, 26, 0x00f0ff, 0.1).setOrigin(0, 0),
        );
      }

      this.rowItems.push(
        this.add.text(40, y, `${row.rank}`.padStart(2, ' '), {
          fontFamily: THEME.fonts.body,
          fontSize: '14px',
          fontStyle: '700',
          color: i === 0 ? '#FFB627' : '#615c82',
        }).setOrigin(0, 0),
      );

      this.rowItems.push(
        this.add.image(78, y + 9, avatarTextureKey(resolveAvatarId(row.avatarId))).setDisplaySize(20, 20),
      );

      const label = row.country ? `${row.name}  ${row.country}` : row.name;
      this.rowItems.push(
        this.add.text(96, y, label, {
          fontFamily: THEME.fonts.body,
          fontSize: '15px',
          fontStyle: mine ? '700' : '600',
          color: i === 0 ? '#FFB627' : mine ? '#00F0FF' : THEME.colours.textPrimaryCss,
        }).setOrigin(0, 0),
      );

      this.rowItems.push(
        this.add.text(w - 40, y, `${row.score}`, {
          fontFamily: THEME.fonts.body,
          fontSize: '15px',
          fontStyle: '700',
          color: i === 0 ? '#FFB627' : mine ? '#00F0FF' : '#A8FF3E',
        }).setOrigin(1, 0),
      );
    });
  }

  /**
   * Pin the player's own standing when they are not in the visible rows.
   * Without this the board is meaningless to everyone outside the top few,
   * which is almost everyone.
   */
  private renderMyRank(rows: readonly BoardRow[], mine: MyRank | null): void {
    if (!mine) {
      this.myRankText.setText('');
      return;
    }
    if (rows.some((r) => r.isMe)) {
      this.myRankText.setText(`You are ${mine.rank} of ${mine.totalPlayers}`).setColor('#8781b8');
      return;
    }
    this.myRankText.setText(`YOU · ${mine.rank} of ${mine.totalPlayers} · ${mine.score}`).setColor('#00F0FF');
  }

  private restart(): void {
    if (!this.acceptRestart) return;
    this.acceptRestart = false;
    const game = this.scene.get('Game');
    this.scene.stop();
    game.scene.restart();
  }
}

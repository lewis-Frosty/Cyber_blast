import Phaser from 'phaser';
import { THEME } from '../config/theme';
import { avatarTextureKey, ensureAvatarTextures, resolveAvatarId } from '../render/AvatarArt';
import { fetchBoard, fetchMyRank, type BoardRow, type BoardScope, type MyRank } from '../backend/leaderboard';
import { loadProfile, type PlayerProfile } from '../backend/profile';

const L = THEME.layout;

const ROW_PITCH = 19;
const ROWS_TOP = 132;
/** How many rows fit between the tabs and the pinned own-rank footer. */
const VISIBLE_ROWS = 32;
/** The spec's "top 100 + own rank". Fetched in full; scrolled, not truncated. */
const FETCH_ROWS = 100;

const SCOPES: ReadonlyArray<{ id: BoardScope; label: string }> = [
  { id: 'global', label: 'GLOBAL' },
  { id: 'daily', label: 'DAILY' },
  { id: 'country', label: 'COUNTRY' },
  { id: 'weekly', label: 'WEEK' },
];

/**
 * The full leaderboard.
 *
 * The game-over screen shows seven rows, which is the right size there — it is
 * a result card, not a browser. This is the page behind the rank on the player
 * dashboard, where "2 of 2" previously led nowhere.
 */
export class LeaderboardScene extends Phaser.Scene {
  private scope: BoardScope = 'global';
  private profile: PlayerProfile | null = null;
  private rows: BoardRow[] = [];
  private myRank: MyRank | null = null;
  private offset = 0;

  private rowItems: Phaser.GameObjects.GameObject[] = [];
  private tabTexts: Phaser.GameObjects.Text[] = [];
  private statusText!: Phaser.GameObjects.Text;
  private footerText!: Phaser.GameObjects.Text;

  constructor() {
    super('Leaderboard');
  }

  create(): void {
    ensureAvatarTextures(this);
    this.scope = 'global';
    this.rows = [];
    this.rowItems = [];
    this.tabTexts = [];
    this.offset = 0;

    this.cameras.main.setBackgroundColor(THEME.colours.backgroundDeep);
    this.add.rectangle(0, 0, L.canvasWidth, L.canvasHeight, 0x07070f, 1).setOrigin(0, 0);

    this.add
      .text(L.canvasWidth / 2, 40, 'LEADERBOARD', {
        fontFamily: THEME.fonts.display,
        fontSize: '24px',
        fontStyle: '700',
        color: '#00F0FF',
      })
      .setOrigin(0.5)
      .setShadow(0, 0, '#00F0FF', 14, true, true);

    this.addButton(L.canvasWidth - 44, 40, 'CLOSE', () => this.scene.stop());
    this.buildTabs();

    this.statusText = this.add
      .text(L.canvasWidth / 2, 300, 'Loading…', {
        fontFamily: THEME.fonts.body,
        fontSize: '14px',
        fontStyle: '600',
        color: '#8781b8',
      })
      .setOrigin(0.5);

    this.footerText = this.add
      .text(L.canvasWidth / 2, L.canvasHeight - 26, '', {
        fontFamily: THEME.fonts.body,
        fontSize: '13px',
        fontStyle: '700',
        color: '#00F0FF',
      })
      .setOrigin(0.5);

    // A hundred rows do not fit on a phone. Drag or wheel to move through them.
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _dx: number, dy: number) => {
      this.scrollBy(dy > 0 ? 3 : -3);
    });
    let dragFrom: number | null = null;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => { dragFrom = p.y; });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (dragFrom === null || !p.isDown) return;
      const steps = Math.trunc((dragFrom - p.y) / ROW_PITCH);
      if (steps !== 0) {
        this.scrollBy(steps);
        dragFrom = p.y;
      }
    });
    this.input.on('pointerup', () => { dragFrom = null; });

    void this.load_();
  }

  private buildTabs(): void {
    const w = L.canvasWidth;
    this.add
      .rectangle(24, 76, w - 48, 32, THEME.colours.backgroundPanel, 0.9)
      .setOrigin(0, 0)
      .setStrokeStyle(1, THEME.colours.gridLine);

    SCOPES.forEach((s, i) => {
      const t = this.add
        .text(40 + i * 104, 84, s.label, {
          fontFamily: THEME.fonts.body,
          fontSize: '13px',
          fontStyle: '700',
          color: s.id === this.scope ? '#00F0FF' : '#615c82',
        })
        .setOrigin(0, 0)
        .setPadding(4, 4)
        .setInteractive({ useHandCursor: true });
      t.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        this.scope = s.id;
        this.offset = 0;
        this.tabTexts.forEach((tt, ti) => tt.setColor(SCOPES[ti]!.id === this.scope ? '#00F0FF' : '#615c82'));
        void this.load_();
      });
      this.tabTexts.push(t);
    });
  }

  private async load_(): Promise<void> {
    this.clearRows();
    this.statusText.setText('Loading…').setVisible(true);
    this.footerText.setText('');

    this.profile ??= await loadProfile();
    if (!this.scene.isActive()) return;
    const country = this.profile?.countryCode ?? null;

    if (this.scope === 'country' && !country) {
      this.statusText.setText('Set your country in PROFILE to see this board');
      return;
    }

    const [rows, mine] = await Promise.all([
      fetchBoard(this.scope, country, FETCH_ROWS),
      fetchMyRank(this.scope, country),
    ]);
    if (!this.scene.isActive()) return;

    this.rows = [...rows];
    this.myRank = mine;

    if (this.rows.length === 0) {
      this.statusText.setText('No scores on this board yet — be the first');
      return;
    }
    this.statusText.setVisible(false);

    // Open on the player's own row when they are past the first screen,
    // because their neighbours are the only rows that mean anything to them.
    const mineIndex = this.rows.findIndex((r) => r.isMe);
    if (mineIndex >= VISIBLE_ROWS) this.offset = mineIndex - Math.floor(VISIBLE_ROWS / 2);
    this.renderRows();
    this.renderFooter();
  }

  private scrollBy(steps: number): void {
    if (this.rows.length <= VISIBLE_ROWS) return;
    const max = this.rows.length - VISIBLE_ROWS;
    const next = Math.min(max, Math.max(0, this.offset + steps));
    if (next === this.offset) return;
    this.offset = next;
    this.renderRows();
  }

  private clearRows(): void {
    for (const o of this.rowItems) o.destroy();
    this.rowItems = [];
  }

  private renderRows(): void {
    this.clearRows();
    const w = L.canvasWidth;
    const slice = this.rows.slice(this.offset, this.offset + VISIBLE_ROWS);

    slice.forEach((row, i) => {
      const y = ROWS_TOP + i * ROW_PITCH;
      const top = row.rank === 1;

      if (row.isMe) {
        this.rowItems.push(this.add.rectangle(28, y - 1, w - 56, ROW_PITCH - 2, 0x00f0ff, 0.14).setOrigin(0, 0));
      }

      this.rowItems.push(
        this.add.text(44, y, `${row.rank}`.padStart(3, ' '), {
          fontFamily: THEME.fonts.body,
          fontSize: '12px',
          fontStyle: '700',
          color: top ? '#FFB627' : row.isMe ? '#00F0FF' : '#615c82',
        }).setOrigin(0, 0),
      );

      this.rowItems.push(
        this.add.image(84, y + 8, avatarTextureKey(resolveAvatarId(row.avatarId))).setDisplaySize(15, 15),
      );

      const label = row.country ? `${row.name}  ${row.country}` : row.name;
      this.rowItems.push(
        this.add.text(100, y, label, {
          fontFamily: THEME.fonts.body,
          fontSize: '13px',
          fontStyle: row.isMe ? '700' : '600',
          color: top ? '#FFB627' : row.isMe ? '#00F0FF' : THEME.colours.textPrimaryCss,
        }).setOrigin(0, 0),
      );

      this.rowItems.push(
        this.add.text(w - 44, y, `${row.score}`, {
          fontFamily: THEME.fonts.body,
          fontSize: '13px',
          fontStyle: '700',
          color: top ? '#FFB627' : row.isMe ? '#00F0FF' : '#A8FF3E',
        }).setOrigin(1, 0),
      );
    });

    // Say so when there is more above or below, rather than leaving the list
    // looking like it ends here.
    if (this.offset > 0) this.rowItems.push(this.hintArrow(ROWS_TOP - 12, '▲ more'));
    if (this.offset + VISIBLE_ROWS < this.rows.length) {
      this.rowItems.push(this.hintArrow(ROWS_TOP + VISIBLE_ROWS * ROW_PITCH + 2, '▼ more'));
    }
  }

  private hintArrow(y: number, label: string): Phaser.GameObjects.Text {
    return this.add
      .text(L.canvasWidth / 2, y, label, {
        fontFamily: THEME.fonts.body,
        fontSize: '10px',
        fontStyle: '700',
        color: '#4b4670',
      })
      .setOrigin(0.5, 0);
  }

  private renderFooter(): void {
    const mine = this.myRank;
    if (!mine) {
      this.footerText.setText('Play a ranked game to enter this board').setColor('#8781b8');
      return;
    }
    this.footerText
      .setText(`YOU · ${mine.rank} of ${mine.totalPlayers} · ${mine.score}`)
      .setColor('#00F0FF');
  }

  private addButton(x: number, y: number, label: string, onTap: () => void): void {
    const t = this.add
      .text(x, y, label, {
        fontFamily: THEME.fonts.body,
        fontSize: '13px',
        fontStyle: '700',
        color: '#07070F',
        backgroundColor: '#00F0FF',
        padding: { x: 10, y: 5 },
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });
    t.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      onTap();
    });
  }
}

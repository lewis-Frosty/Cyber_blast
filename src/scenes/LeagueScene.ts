import Phaser from 'phaser';
import { THEME } from '../config/theme';
import { avatarTextureKey, ensureAvatarTextures, resolveAvatarId } from '../render/AvatarArt';
import {
  daysLeft,
  fetchMyLeague,
  moversFor,
  tierName,
  type LeagueRow,
  type LeagueStanding,
} from '../backend/league';

const L = THEME.layout;

const ROW_PITCH = 19;
const ROWS_TOP = 168;
/** Extra space opened at a cut line so its label sits in a gap, not on a row. */
const CUT_GAP = 15;

const PROMOTE = 0xa8ff3e;
const RELEGATE = 0xff2e9f;

/**
 * The weekly league: your group of thirty, and the cut lines.
 *
 * Its own page rather than a fifth tab on the game-over board, because the
 * thing that makes a league motivating is seeing the whole race at once — who
 * is inside the promotion zone, who is falling out, and how many days are left
 * to do something about it. A top-seven slice of that hides the only part most
 * players care about, which is the line just above and below them.
 */
export class LeagueScene extends Phaser.Scene {
  private bodyItems: Phaser.GameObjects.GameObject[] = [];
  private statusText!: Phaser.GameObjects.Text;

  constructor() {
    super('League');
  }

  create(): void {
    ensureAvatarTextures(this);
    this.bodyItems = [];

    this.cameras.main.setBackgroundColor(THEME.colours.backgroundDeep);
    this.add.rectangle(0, 0, L.canvasWidth, L.canvasHeight, 0x07070f, 1).setOrigin(0, 0);

    this.add
      .text(L.canvasWidth / 2, 40, 'LEAGUE', {
        fontFamily: THEME.fonts.display,
        fontSize: '26px',
        fontStyle: '700',
        color: '#A8FF3E',
      })
      .setOrigin(0.5)
      .setShadow(0, 0, '#A8FF3E', 14, true, true);

    this.addButton(L.canvasWidth - 44, 40, 'CLOSE', () => this.scene.stop());

    this.statusText = this.add
      .text(L.canvasWidth / 2, L.canvasHeight - 26, 'Loading…', {
        fontFamily: THEME.fonts.body,
        fontSize: '13px',
        fontStyle: '600',
        color: '#8781b8',
      })
      .setOrigin(0.5);

    void this.load_();
  }

  private async load_(): Promise<void> {
    const standing = await fetchMyLeague();
    if (!this.scene.isActive()) return;

    if (!standing) {
      // Not an error. A player who has not submitted a run this week has no
      // group yet, and being told to play is more use than "unavailable".
      this.renderEmpty();
      this.statusText.setText('Play a game to join this week’s league').setColor('#FFB627');
      return;
    }

    this.renderStanding(standing);
    const days = daysLeft(standing.seasonEnds);
    this.statusText
      .setText(days === null ? 'Synced' : days <= 1 ? 'Season ends today' : `${days} days left this season`)
      .setColor(days !== null && days <= 1 ? '#FFB627' : '#A8FF3E');
  }

  private track<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.bodyItems.push(o);
    return o;
  }

  // ── Empty state ────────────────────────────────────────────────────────

  private renderEmpty(): void {
    this.track(
      this.add
        .text(L.canvasWidth / 2, 300, 'NO LEAGUE YET', {
          fontFamily: THEME.fonts.display,
          fontSize: '20px',
          fontStyle: '700',
          color: '#615c82',
        })
        .setOrigin(0.5),
    );
    this.track(
      this.add
        .text(
          L.canvasWidth / 2,
          340,
          'Your first ranked run of the week\nputs you in a group of thirty.',
          {
            fontFamily: THEME.fonts.body,
            fontSize: '14px',
            fontStyle: '600',
            color: '#8781b8',
            align: 'center',
          },
        )
        .setOrigin(0.5),
    );
  }

  // ── Standings ──────────────────────────────────────────────────────────

  private renderStanding(s: LeagueStanding): void {
    this.buildHeader(s);

    const movers = moversFor(s.groupSize);
    const canPromote = s.tier < 5 && movers > 0 && movers < s.rows.length;
    const relegateFrom = s.groupSize - movers + 1;
    const canRelegate = s.tier > 1 && movers > 0 && relegateFrom > movers + 1;

    // Rows are laid out with a gap opened at each cut so the label has
    // somewhere to live. Drawing it over a row hides that player's score,
    // which is the one number the row exists to show.
    let y = ROWS_TOP;
    let promoteLineY: number | null = null;
    let relegateLineY: number | null = null;

    s.rows.forEach((row) => {
      if (canPromote && row.rank === movers + 1) {
        promoteLineY = y + CUT_GAP / 2 - 1;
        y += CUT_GAP;
      }
      if (canRelegate && row.rank === relegateFrom) {
        relegateLineY = y + CUT_GAP / 2 - 1;
        y += CUT_GAP;
      }

      const zone = canPromote && row.rank <= movers
        ? PROMOTE
        : canRelegate && row.rank >= relegateFrom
          ? RELEGATE
          : null;
      this.buildRow(row, y, zone);
      y += ROW_PITCH;
    });

    if (promoteLineY !== null) {
      this.buildCutLine(promoteLineY, PROMOTE, `PROMOTION · TOP ${movers}`);
    }
    if (relegateLineY !== null) {
      this.buildCutLine(relegateLineY, RELEGATE, `RELEGATION · BOTTOM ${movers}`);
    }
  }

  private buildHeader(s: LeagueStanding): void {
    const w = L.canvasWidth;

    this.track(
      this.add
        .rectangle(24, 76, w - 48, 76, THEME.colours.backgroundPanel, 0.9)
        .setOrigin(0, 0)
        .setStrokeStyle(1, THEME.colours.gridLine),
    );

    this.track(
      this.add.text(40, 90, `TIER ${s.tier}`, {
        fontFamily: THEME.fonts.body,
        fontSize: '12px',
        fontStyle: '700',
        color: '#8781b8',
      }),
    );

    this.track(
      this.add
        .text(40, 108, tierName(s.tier), {
          fontFamily: THEME.fonts.display,
          fontSize: '24px',
          fontStyle: '700',
          color: '#00F0FF',
        })
        .setShadow(0, 0, '#00F0FF', 10, true, true),
    );

    const me = s.rows.find((r) => r.isMe);
    this.track(
      this.add
        .text(w - 40, 90, me ? `${me.rank} of ${s.groupSize}` : `${s.groupSize} players`, {
          fontFamily: THEME.fonts.body,
          fontSize: '18px',
          fontStyle: '700',
          color: '#A8FF3E',
        })
        .setOrigin(1, 0),
    );

    this.track(
      this.add
        .text(w - 40, 116, me ? `${me.points} PTS` : 'NOT RANKED', {
          fontFamily: THEME.fonts.body,
          fontSize: '13px',
          fontStyle: '600',
          color: '#8781b8',
        })
        .setOrigin(1, 0),
    );

    // The rule that makes daily play matter, stated where it is acted on.
    this.track(
      this.add.text(40, 156, 'POINTS = SUM OF EACH DAY’S BEST RUN', {
        fontFamily: THEME.fonts.body,
        fontSize: '10px',
        fontStyle: '700',
        color: '#4b4670',
      }),
    );
  }

  private buildRow(row: LeagueRow, y: number, zone: number | null): void {
    const w = L.canvasWidth;

    if (zone !== null) {
      this.track(this.add.rectangle(28, y - 1, w - 56, ROW_PITCH - 2, zone, 0.07).setOrigin(0, 0));
    }
    if (row.isMe) {
      this.track(this.add.rectangle(28, y - 1, w - 56, ROW_PITCH - 2, 0x00f0ff, 0.14).setOrigin(0, 0));
    }

    const accent = row.isMe ? '#00F0FF' : zone === PROMOTE ? '#A8FF3E' : zone === RELEGATE ? '#FF2E9F' : '#615c82';

    this.track(
      this.add
        .text(44, y, `${row.rank}`.padStart(2, ' '), {
          fontFamily: THEME.fonts.body,
          fontSize: '12px',
          fontStyle: '700',
          color: accent,
        })
        .setOrigin(0, 0),
    );

    this.track(
      this.add.image(76, y + 8, avatarTextureKey(resolveAvatarId(row.avatarId))).setDisplaySize(16, 16),
    );

    const label = row.country ? `${row.name}  ${row.country}` : row.name;
    this.track(
      this.add
        .text(92, y, label, {
          fontFamily: THEME.fonts.body,
          fontSize: '13px',
          fontStyle: row.isMe ? '700' : '600',
          color: row.isMe ? '#00F0FF' : THEME.colours.textPrimaryCss,
        })
        .setOrigin(0, 0),
    );

    this.track(
      this.add
        .text(w - 44, y, `${row.points}`, {
          fontFamily: THEME.fonts.body,
          fontSize: '13px',
          fontStyle: '700',
          color: row.isMe ? '#00F0FF' : '#A8FF3E',
        })
        .setOrigin(1, 0),
    );
  }

  private buildCutLine(y: number, colour: number, label: string): void {
    const w = L.canvasWidth;
    this.track(this.add.rectangle(28, y, w - 56, 1, colour, 0.55).setOrigin(0, 0));
    this.track(
      this.add
        .text(w - 44, y, label, {
          fontFamily: THEME.fonts.body,
          fontSize: '9px',
          fontStyle: '700',
          color: colour === PROMOTE ? '#A8FF3E' : '#FF2E9F',
          backgroundColor: '#07070F',
          padding: { x: 5, y: 1 },
        })
        .setOrigin(1, 0.5),
    );
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

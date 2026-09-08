import Phaser from 'phaser';
import { THEME } from '../config/theme';
import { renderSettings, saveRenderSettings } from '../render/settings';
import { AVATAR_STYLES, avatarTextureKey, ensureAvatarTextures, resolveAvatarId } from '../render/AvatarArt';
import { allProgress, type LadderProgress } from '../progress/achievements';
import {
  DEFAULT_AVATAR,
  loadProfile,
  loadTotals,
  sanitiseName,
  saveProfile,
  type PlayerProfile,
  type PlayerTotalsRow,
} from '../backend/profile';
import { fetchMyRank, type MyRank } from '../backend/leaderboard';

const L = THEME.layout;

/**
 * The player dashboard.
 *
 * Identity, standing and progress on one screen. Deliberately readable when
 * empty: a brand new player sees their avatar, a name they can change, and
 * four ladders with the first rung named — not a wall of zeroes.
 *
 * Two of the four ladders are not measured yet. They say so in words rather
 * than showing 0, because a zero looks like the player's own result.
 */
export class DashboardScene extends Phaser.Scene {
  private profile: PlayerProfile = { displayName: 'ANON', avatarId: DEFAULT_AVATAR, countryCode: null };
  private totals: PlayerTotalsRow | null = null;
  private myRank: MyRank | null = null;

  private nameInput: Phaser.GameObjects.DOMElement | null = null;
  private avatarButtons: Phaser.GameObjects.Image[] = [];
  private settingsOpen = false;
  private settingsItems: Phaser.GameObjects.GameObject[] = [];
  private bodyItems: Phaser.GameObjects.GameObject[] = [];
  private statusText!: Phaser.GameObjects.Text;

  constructor() {
    super('Dashboard');
  }

  create(): void {
    ensureAvatarTextures(this);
    this.settingsOpen = false;
    this.avatarButtons = [];
    this.settingsItems = [];
    this.bodyItems = [];

    this.cameras.main.setBackgroundColor(THEME.colours.backgroundDeep);
    this.add.rectangle(0, 0, L.canvasWidth, L.canvasHeight, 0x07070f, 1).setOrigin(0, 0);

    this.add
      .text(L.canvasWidth / 2, 40, 'PLAYER', {
        fontFamily: THEME.fonts.display,
        fontSize: '26px',
        fontStyle: '700',
        color: '#00F0FF',
      })
      .setOrigin(0.5)
      .setShadow(0, 0, '#00F0FF', 14, true, true);

    this.addButton(L.canvasWidth - 44, 40, 'CLOSE', () => this.close());
    this.addButton(64, 40, renderSettings.soundOn ? 'SETTINGS' : 'SETTINGS', () => this.toggleSettings());

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
    const [profile, totals] = await Promise.all([loadProfile(), loadTotals()]);
    if (!this.scene.isActive()) return;
    this.profile = { ...profile, avatarId: resolveAvatarId(profile.avatarId) };
    this.totals = totals;
    this.myRank = await fetchMyRank('global', profile.countryCode);
    if (!this.scene.isActive()) return;
    this.renderBody();
    this.statusText.setText(
      totals ? 'Synced' : 'Offline — showing what this browser remembers',
    ).setColor(totals ? '#A8FF3E' : '#FFB627');
  }

  // ── Body ───────────────────────────────────────────────────────────────

  private renderBody(): void {
    for (const o of this.bodyItems) o.destroy();
    this.bodyItems = [];
    this.nameInput?.destroy();
    this.nameInput = null;

    this.buildIdentity(78);
    this.buildStats(250);
    this.buildLadders(324);
  }

  private track<T extends Phaser.GameObjects.GameObject>(o: T): T {
    this.bodyItems.push(o);
    return o;
  }

  private buildIdentity(y: number): void {
    const big = this.track(
      this.add.image(74, y + 46, avatarTextureKey(this.profile.avatarId)).setDisplaySize(76, 76),
    );
    big.setInteractive({ useHandCursor: true });

    const html = `<input type="text" maxlength="12" value="${escapeAttr(this.profile.displayName)}"
      style="width:200px;height:34px;box-sizing:border-box;background:#0d0b1f;border:1px solid #231f45;border-radius:6px;
      color:#E8E6FF;font-family:Rajdhani,sans-serif;font-size:17px;font-weight:700;letter-spacing:0.08em;
      padding:0 10px;outline:none;text-transform:uppercase;">`;
    this.nameInput = this.add.dom(230, y + 22).createFromHTML(html).setOrigin(0, 0.5);
    const node = this.nameInput.node.querySelector('input');
    if (node instanceof HTMLInputElement) {
      node.addEventListener('keydown', (e) => e.stopPropagation());
      node.addEventListener('blur', () => void this.persist());
    }

    const country = this.profile.countryCode ?? '—';
    this.track(
      this.add.text(230, y + 52, `COUNTRY  ${country}`, {
        fontFamily: THEME.fonts.body,
        fontSize: '14px',
        fontStyle: '600',
        color: '#8781b8',
      }),
    );

    const rank = this.myRank
      ? `RANK  ${this.myRank.rank} / ${this.myRank.totalPlayers}`
      : 'RANK  —  play to enter';
    this.track(
      this.add.text(230, y + 74, rank, {
        fontFamily: THEME.fonts.body,
        fontSize: '14px',
        fontStyle: '700',
        color: this.myRank ? '#A8FF3E' : '#615c82',
      }),
    );

    // Avatar picker: 12 in two rows of six.
    this.avatarButtons = [];
    const startX = 34;
    const gap = 35;
    AVATAR_STYLES.forEach((style, i) => {
      const col = i % 6;
      const row = Math.floor(i / 6);
      const x = startX + col * gap + 12;
      const yy = y + 108 + row * 36;
      const img = this.track(
        this.add.image(x, yy, avatarTextureKey(style.id)).setDisplaySize(29, 29),
      ).setInteractive({ useHandCursor: true });
      img.setAlpha(style.id === this.profile.avatarId ? 1 : 0.42);
      img.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        this.profile = { ...this.profile, avatarId: style.id };
        big.setTexture(avatarTextureKey(style.id));
        this.avatarButtons.forEach((b, bi) => b.setAlpha(AVATAR_STYLES[bi]!.id === style.id ? 1 : 0.42));
        void this.persist();
      });
      this.avatarButtons.push(img);
    });
  }

  private buildStats(y: number): void {
    const t = this.totals;
    const cells: Array<[string, string]> = [
      ['BEST', t ? String(t.bestScore) : '—'],
      ['GAMES', t ? String(t.gamesPlayed) : '—'],
      ['BEST CHAIN', t ? `×${t.bestChain}` : '—'],
      ['XP', t ? String(t.xp) : '—'],
    ];
    const w = (L.canvasWidth - 56) / cells.length;
    cells.forEach(([label, value], i) => {
      const x = 28 + i * w;
      this.track(
        this.add.rectangle(x, y, w - 6, 56, THEME.colours.backgroundPanel, 0.9).setOrigin(0, 0).setStrokeStyle(1, 0x1f1b3a),
      );
      this.track(
        this.add.text(x + (w - 6) / 2, y + 14, value, {
          fontFamily: THEME.fonts.display,
          fontSize: '19px',
          fontStyle: '700',
          color: THEME.colours.textPrimaryCss,
        }).setOrigin(0.5, 0),
      );
      this.track(
        this.add.text(x + (w - 6) / 2, y + 38, label, {
          fontFamily: THEME.fonts.body,
          fontSize: '11px',
          fontStyle: '700',
          color: '#8781b8',
        }).setOrigin(0.5, 0),
      );
    });
  }

  private buildLadders(top: number): void {
    const t = this.totals;
    const progress = allProgress({
      gamesPlayed: t?.gamesPlayed ?? 0,
      bestChain: t?.bestChain ?? 0,
      dailyStreak: t?.dailyStreak ?? 0,
      bestClearStreak: t?.bestClearStreak ?? 0,
    });

    this.track(
      this.add.text(28, top, 'ACHIEVEMENTS', {
        fontFamily: THEME.fonts.body,
        fontSize: '13px',
        fontStyle: '700',
        color: '#8781b8',
      }),
    );

    progress.forEach((p, i) => this.buildLadderRow(p, top + 26 + i * 96));
  }

  private buildLadderRow(p: LadderProgress, y: number): void {
    const w = L.canvasWidth - 56;
    this.track(
      this.add.rectangle(28, y, w, 84, THEME.colours.backgroundPanel, 0.75).setOrigin(0, 0).setStrokeStyle(1, 0x1f1b3a),
    );

    const earnedColour = p.earned?.colour ?? '#3a3560';
    this.track(
      this.add.text(42, y + 12, p.ladder.name.toUpperCase(), {
        fontFamily: THEME.fonts.body,
        fontSize: '15px',
        fontStyle: '700',
        color: p.ladder.tracked ? THEME.colours.textPrimaryCss : '#615c82',
      }),
    );
    this.track(
      this.add.text(w - 14, y + 12, p.earned ? p.earned.name : 'LOCKED', {
        fontFamily: THEME.fonts.body,
        fontSize: '15px',
        fontStyle: '700',
        color: earnedColour,
      }).setOrigin(1, 0),
    );

    // Tier pips: every rung of the ladder, filled up to the one earned.
    const pipY = y + 40;
    const pipGap = Math.min(30, (w - 40) / p.ladder.tiers.length);
    p.ladder.tiers.forEach((tier, i) => {
      const x = 46 + i * pipGap;
      const reached = p.value >= tier.at;
      const dot = this.track(this.add.circle(x, pipY, 7, Phaser.Display.Color.HexStringToColor(tier.colour).color, reached ? 1 : 0.16));
      dot.setStrokeStyle(1, Phaser.Display.Color.HexStringToColor(tier.colour).color, reached ? 1 : 0.4);
    });

    if (!p.ladder.tracked) {
      this.track(
        this.add.text(42, y + 60, p.ladder.pending ?? 'Not measured yet', {
          fontFamily: THEME.fonts.body,
          fontSize: '12px',
          fontStyle: '600',
          color: '#FFB627',
        }),
      );
      return;
    }

    // Progress bar toward the next tier.
    const barW = w - 28;
    this.track(this.add.rectangle(42, y + 62, barW, 6, 0x12102a, 1).setOrigin(0, 0));
    if (p.fraction > 0) {
      this.track(
        this.add.rectangle(42, y + 62, Math.max(3, barW * p.fraction), 6, Phaser.Display.Color.HexStringToColor(p.next?.colour ?? '#A8FF3E').color, 1).setOrigin(0, 0),
      );
    }
    const label = p.next ? `${p.value} / ${p.next.at} ${p.ladder.unit}` : `${p.value} ${p.ladder.unit} — complete`;
    this.track(
      this.add.text(42, y + 70, label, {
        fontFamily: THEME.fonts.body,
        fontSize: '12px',
        fontStyle: '600',
        color: '#8781b8',
      }),
    );
  }

  // ── Settings drawer ────────────────────────────────────────────────────

  private toggleSettings(): void {
    this.settingsOpen = !this.settingsOpen;
    for (const o of this.settingsItems) o.destroy();
    this.settingsItems = [];
    if (!this.settingsOpen) return;

    const w = L.canvasWidth - 56;
    const y = 70;
    const panel = this.add.rectangle(28, y, w, 150, 0x0d0b1f, 0.98).setOrigin(0, 0).setStrokeStyle(1, 0x00f0ff).setDepth(60);
    this.settingsItems.push(panel);

    const rows: Array<[string, () => string, () => void]> = [
      ['GLYPHS (colour-blind aid)', () => (renderSettings.glyphMode ? 'ON' : 'OFF'), () => {
        renderSettings.glyphMode = !renderSettings.glyphMode;
        saveRenderSettings();
      }],
      ['SOUND', () => (renderSettings.soundOn ? 'ON' : 'OFF'), () => {
        renderSettings.soundOn = !renderSettings.soundOn;
        saveRenderSettings();
      }],
      ['COUNTRY', () => this.profile.countryCode ?? 'NOT SET', () => this.cycleCountry()],
    ];

    rows.forEach(([label, value, action], i) => {
      const ry = y + 20 + i * 40;
      const t = this.add.text(44, ry, label, {
        fontFamily: THEME.fonts.body,
        fontSize: '14px',
        fontStyle: '600',
        color: '#C4BFEB',
      }).setDepth(61);
      const v = this.add.text(w + 12, ry, value(), {
        fontFamily: THEME.fonts.body,
        fontSize: '14px',
        fontStyle: '700',
        color: '#00F0FF',
      }).setOrigin(1, 0).setDepth(61).setInteractive({ useHandCursor: true });
      v.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();
        action();
        v.setText(value());
      });
      this.settingsItems.push(t, v);
    });
  }

  /**
   * Country is a guess from the browser locale, and a guess needs a way out.
   * Cycling a short list beats a 200-entry dropdown on a phone; a player whose
   * country is missing can still be ranked globally.
   */
  private cycleCountry(): void {
    const common = ['NZ', 'AU', 'GB', 'US', 'CA', 'IE', 'ZA', 'IN', 'SG', 'DE', 'FR', 'JP'];
    const current = this.profile.countryCode;
    const i = current ? common.indexOf(current) : -1;
    const next = common[(i + 1) % common.length]!;
    this.profile = { ...this.profile, countryCode: next };
    void this.persist();
    this.renderBody();
  }

  // ── Persistence ────────────────────────────────────────────────────────

  private currentName(): string {
    const node = this.nameInput?.node.querySelector('input');
    return node instanceof HTMLInputElement ? node.value : this.profile.displayName;
  }

  private async persist(): Promise<void> {
    this.profile = { ...this.profile, displayName: sanitiseName(this.currentName()) };
    const saved = await saveProfile(this.profile);
    if (!this.scene.isActive()) return;
    this.statusText
      .setText(saved ? 'Saved' : 'Saved to this browser only')
      .setColor(saved ? '#A8FF3E' : '#FFB627');
  }

  private addButton(x: number, y: number, label: string, onTap: () => void): void {
    const t = this.add
      .text(x, y, label, {
        fontFamily: THEME.fonts.body,
        fontSize: '13px',
        fontStyle: '700',
        color: '#07070F',
        backgroundColor: '#00F0FF',
        padding: { x: 10, y: 6 },
      })
      .setOrigin(0.5)
      .setDepth(70)
      .setInteractive({ useHandCursor: true });
    t.on('pointerdown', (_p: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
      ev.stopPropagation();
      onTap();
    });
  }

  private close(): void {
    this.nameInput?.destroy();
    this.scene.stop();
  }
}

function escapeAttr(v: string): string {
  return v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

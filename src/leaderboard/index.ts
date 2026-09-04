import { MAX_TABLE_ROWS, mergeEntry, type Leaderboard, type ScoreEntry } from './types';

export * from './types';

/**
 * The published artifact exposes capabilities through `window.claude.use(name)`.
 * Everything here degrades to a per-browser local board when that isn't served,
 * so `npm run dev` behaves the same minus the sharing.
 */
interface ClaudeBridge {
  use(name: string): Promise<unknown>;
}

interface DocSnapshot {
  exists: boolean;
  data?: Record<string, unknown>;
}
interface DocRef {
  get(): Promise<DocSnapshot>;
  set(data: Record<string, unknown>): Promise<void>;
}
interface DbNamespace {
  doc(path: string): DocRef;
}

function isEntry(v: unknown): v is ScoreEntry {
  if (typeof v !== 'object' || v === null) return false;
  const e = v as Partial<ScoreEntry>;
  return typeof e.name === 'string' && typeof e.score === 'number' && Number.isFinite(e.score);
}

/** Rows come from other players — treat every field as untrusted input. */
function readRows(data: Record<string, unknown> | undefined): ScoreEntry[] {
  const raw = data?.['entries'];
  if (!Array.isArray(raw)) return [];
  return raw.filter(isEntry).map((e) => ({
    name: String(e.name).slice(0, 12),
    score: Math.max(0, Math.floor(e.score)),
    placements: Number.isFinite(e.placements) ? Math.floor(e.placements) : 0,
    maxChain: Number.isFinite(e.maxChain) ? Math.floor(e.maxChain) : 0,
    ts: Number.isFinite(e.ts) ? e.ts : 0,
  }));
}

/**
 * Shared weekly board backed by the artifact `db` capability.
 *
 * One document per week holds the whole ranked table. A document per run would
 * blow the 5,000-document budget within a few weeks of real play; a table per
 * week is ~52 documents a year.
 *
 * Writes are last-writer-wins with no transactions, so two runs posted in the
 * same instant can drop one. For a playtest board that's an acceptable trade
 * against the complexity of leasing; revisit if the board ever matters.
 */
class SharedLeaderboard implements Leaderboard {
  readonly kind = 'shared' as const;
  constructor(private readonly db: DbNamespace) {}

  private ref(week: string) {
    return this.db.doc(`leaderboard/${week}`);
  }

  async top(week: string, limit: number): Promise<ScoreEntry[]> {
    const snap = await this.ref(week).get();
    if (!snap.exists) return [];
    return readRows(snap.data).slice(0, limit);
  }

  async submit(week: string, entry: ScoreEntry): Promise<void> {
    const ref = this.ref(week);
    const snap = await ref.get();
    const rows = mergeEntry(snap.exists ? readRows(snap.data) : [], entry, MAX_TABLE_ROWS);
    await ref.set({ week, entries: rows, updated: Date.now() });
  }
}

/** Per-browser fallback so the game is playable and testable without the platform. */
class LocalLeaderboard implements Leaderboard {
  readonly kind = 'local' as const;
  private key(week: string): string {
    return `cyber-blast.leaderboard.${week}`;
  }

  async top(week: string, limit: number): Promise<ScoreEntry[]> {
    try {
      const raw = localStorage.getItem(this.key(week));
      if (!raw) return [];
      return readRows(JSON.parse(raw) as Record<string, unknown>).slice(0, limit);
    } catch {
      return [];
    }
  }

  async submit(week: string, entry: ScoreEntry): Promise<void> {
    try {
      const rows = mergeEntry(await this.top(week, MAX_TABLE_ROWS), entry, MAX_TABLE_ROWS);
      localStorage.setItem(this.key(week), JSON.stringify({ week, entries: rows }));
    } catch {
      /* storage unavailable — the run just isn't recorded */
    }
  }
}

let cached: Promise<Leaderboard> | null = null;

/**
 * Resolve the best available board once per page load. `use()` may take a
 * moment and resolves null when the capability isn't served, so callers should
 * render before awaiting this.
 */
export function getLeaderboard(): Promise<Leaderboard> {
  if (cached) return cached;
  cached = (async (): Promise<Leaderboard> => {
    try {
      const bridge = (globalThis as { claude?: ClaudeBridge }).claude;
      if (bridge?.use) {
        const db = (await bridge.use('db')) as DbNamespace | null;
        if (db?.doc) return new SharedLeaderboard(db);
      }
    } catch {
      /* fall through to local */
    }
    return new LocalLeaderboard();
  })();
  return cached;
}

/** Remembered player name, so repeat runs don't retype it. */
const NAME_KEY = 'cyber-blast.playerName';

export function loadPlayerName(): string {
  try {
    return localStorage.getItem(NAME_KEY) ?? '';
  } catch {
    return '';
  }
}

export function savePlayerName(name: string): void {
  try {
    localStorage.setItem(NAME_KEY, name);
  } catch {
    /* ignore */
  }
}

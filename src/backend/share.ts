import { challengeForDate } from '../config/dailyChallenges';

/**
 * The share card — backend spec §7. Cheap, and it is the only marketing the
 * plan actually has.
 *
 * Text rather than an image on purpose: it pastes into any app, costs no
 * canvas work, and every platform renders it. The score and rank quoted are
 * the SERVER's verified numbers, so a shared card cannot claim a run the
 * leaderboard would not.
 */

export interface ShareCard {
  mode: 'daily' | 'endless';
  date?: string;
  score: number;
  maxChain: number;
  placements: number;
  rank?: number | null;
  totalPlayers?: number | null;
  url: string;
}

export function shareText(card: ShareCard): string {
  const lines: string[] = [];
  if (card.mode === 'daily') {
    // Name the day's twist. It is what makes the card worth reading by
    // someone who has not played yet — "Daily 2026-09-14" says nothing, but
    // "TWO COLOURS" is a reason to open the game — and it stays spoiler-free
    // because it describes the rules, never the board.
    const challenge = card.date ? challengeForDate(card.date) : null;
    const head = `CYBER BLAST · Daily ${card.date ?? ''}`.trim();
    lines.push(challenge ? `${head} · ${challenge.name}` : head);
  } else {
    lines.push('CYBER BLAST');
  }
  lines.push(`${card.score.toLocaleString('en')} · chain ×${card.maxChain + 1} · ${card.placements} pieces`);
  if (card.rank && card.totalPlayers) lines.push(`Rank ${card.rank} of ${card.totalPlayers}`);
  lines.push(card.url);
  return lines.join('\n');
}

export type ShareResult = 'shared' | 'copied' | 'failed';

/**
 * Share, falling back to the clipboard. Both are best-effort: the Web Share
 * API is absent on most desktops and rejects when the user cancels, and
 * clipboard access can be denied outright, so neither is allowed to throw.
 */
export async function shareRun(card: ShareCard): Promise<ShareResult> {
  const text = shareText(card);
  const nav = navigator as Navigator & { share?: (d: { text: string }) => Promise<void> };

  if (typeof nav.share === 'function') {
    try {
      await nav.share({ text });
      return 'shared';
    } catch {
      // A cancelled share is not a failure worth reporting as one; fall through
      // to the clipboard so the player still gets their card.
    }
  }

  try {
    await navigator.clipboard.writeText(text);
    return 'copied';
  } catch {
    return 'failed';
  }
}

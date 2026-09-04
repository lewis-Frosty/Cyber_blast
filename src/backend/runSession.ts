import type { GameAction } from '../core/replay';
import { RunSession, type RunMode } from './moveLog';
import { ensureSession, getSupabase, isBackendConfigured } from './supabase';

/**
 * The run lifecycle as the client sees it — backend spec §4.1/§4.2.
 *
 * The player never types, confirms, or otherwise names a score. The session
 * records the ordered actions the player actually took, and at game over it
 * posts THAT. The server replays the log against the seed it issued and
 * derives the score itself, so the number on the leaderboard is a consequence
 * of play rather than a claim about it.
 *
 * Two consequences worth being explicit about:
 *   - The seed must come from the server, or the replay cannot reproduce the
 *     game. Offline runs therefore cannot be ranked, only played.
 *   - Nothing here may block or break play. Every failure path degrades to a
 *     local run that is still fully playable.
 */

export { RunSession } from './moveLog';
export type { RunHandle, RunMode } from './moveLog';

export type SubmitOutcome =
  | { status: 'accepted'; score: number; rewards: { xp: number; currency: number } | null }
  | { status: 'rejected'; reason: string; code?: string }
  | { status: 'queued' }
  | { status: 'offline' };

/** Fall back to a local, unrankable run so the game always starts. */
function offlineRun(): RunSession {
  // Outside src/core/, so a clock read breaks no rule. This seed is never sent
  // anywhere — an offline run is played and discarded. `|| 1` keeps it away
  // from 0, which is a degenerate seed for the PRNG.
  const seed = (Date.now() >>> 0) || 1;
  return new RunSession({ runId: null, seed, mode: 'endless', moveLimit: null });
}

/**
 * Ask the server for a run. Resolves to an offline session rather than
 * rejecting: a backend problem must never stop someone playing.
 */
export async function startRun(mode: RunMode = 'endless'): Promise<RunSession> {
  if (!isBackendConfigured()) return offlineRun();
  try {
    const supabase = getSupabase();
    const session = await ensureSession();
    if (!supabase || !session) return offlineRun();

    const { data, error } = await supabase.functions.invoke('start-run', { body: { mode } });
    if (error || !data || typeof data.runId !== 'string' || typeof data.seed !== 'number') {
      console.warn('[cyber-blast] start-run unavailable, playing offline:', error?.message);
      return offlineRun();
    }
    return new RunSession({
      runId: data.runId,
      seed: data.seed,
      mode: (data.mode as RunMode) ?? mode,
      moveLimit: typeof data.moveLimit === 'number' ? data.moveLimit : null,
    });
  } catch (e) {
    console.warn('[cyber-blast] could not start a server run, playing offline:', e);
    return offlineRun();
  }
}

// ── Offline queue ────────────────────────────────────────────────────────
//
// Auto-submission removes the player's chance to retry by hand, so a run lost
// to a dropped connection would simply vanish. Pending submissions are held
// here and replayed on the next launch.

const QUEUE_KEY = 'cyber-blast.pendingRuns';
/** Matches the server's freshness window: older entries can only be rejected. */
const QUEUE_TTL_MS = 2 * 60 * 60 * 1000;

interface PendingSubmission {
  runId: string;
  moveLog: GameAction[];
  selfReport: { score: number; placements: number; maxCascade: number };
  queuedAt: number;
}

function readQueue(): PendingSubmission[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (p): p is PendingSubmission =>
        typeof p === 'object' && p !== null && typeof (p as PendingSubmission).runId === 'string',
    );
  } catch {
    return [];
  }
}

function writeQueue(items: PendingSubmission[]): void {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {
    /* storage unavailable — the run just isn't retried */
  }
}

function enqueue(item: PendingSubmission): void {
  const fresh = readQueue().filter((p) => Date.now() - p.queuedAt < QUEUE_TTL_MS);
  fresh.push(item);
  writeQueue(fresh);
}

/** POST one submission. Throws on transport failure so callers can queue it. */
async function postSubmission(body: PendingSubmission): Promise<SubmitOutcome> {
  const supabase = getSupabase();
  const session = await ensureSession();
  if (!supabase || !session) return { status: 'offline' };

  const { data, error } = await supabase.functions.invoke('submit-run', {
    body: { runId: body.runId, moveLog: body.moveLog, selfReport: body.selfReport },
  });
  if (error) throw error;
  if (!data || data.accepted !== true) {
    return { status: 'rejected', reason: String(data?.reason ?? 'rejected'), code: data?.code };
  }
  return {
    status: 'accepted',
    score: Number(data.score),
    rewards: (data.rewards as { xp: number; currency: number } | null) ?? null,
  };
}

/**
 * Submit the run. The score is NOT a parameter — it is whatever the server
 * derives from the move log. `selfReport` travels only so the server can
 * refuse a client whose engine disagrees with its own.
 */
export async function submitRun(
  session: RunSession,
  selfReport: { score: number; placements: number; maxCascade: number },
): Promise<SubmitOutcome> {
  const { runId } = session.handle;
  if (!runId) return { status: 'offline' };

  const body: PendingSubmission = {
    runId,
    moveLog: [...session.moves],
    selfReport,
    queuedAt: Date.now(),
  };

  try {
    return await postSubmission(body);
  } catch (e) {
    console.warn('[cyber-blast] submit failed, queued for retry:', e);
    enqueue(body);
    return { status: 'queued' };
  }
}

/**
 * Retry anything queued by a previous session. Runs past the server's
 * freshness window are dropped rather than posted: they can only be rejected,
 * and each rejection burns the player's hourly submission allowance.
 */
export async function flushPendingRuns(): Promise<void> {
  const queued = readQueue();
  if (queued.length === 0) return;

  const fresh = queued.filter((p) => Date.now() - p.queuedAt < QUEUE_TTL_MS);
  const remaining: PendingSubmission[] = [];
  for (const item of fresh) {
    try {
      const outcome = await postSubmission(item);
      // A rejection is final — retrying it would only waste the rate limit.
      if (outcome.status === 'offline') remaining.push(item);
    } catch {
      remaining.push(item);
    }
  }
  writeQueue(remaining);
}

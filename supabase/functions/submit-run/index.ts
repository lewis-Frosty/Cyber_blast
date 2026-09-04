// submit-run — backend spec §4.2. The anti-cheat chokepoint.
//
// The validation chain itself lives in core/validation.ts, which is a verbatim
// copy of src/core/validation.ts and is unit-tested in the repo. This file only
// gathers the facts the chain needs and applies the outcome, so the security
// logic is exercised by CI rather than only over HTTP.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';
import { computeRewards, validateSubmission, type RunRecord } from './core/validation.ts';
import type { GameAction } from './core/replay.ts';

const HOUR_MS = 60 * 60 * 1000;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
  const authHeader = req.headers.get('Authorization') ?? '';

  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'unauthenticated' }, 401);
  const callerId = userData.user.id;

  let claim: {
    runId?: string; score?: number; placements?: number; maxCascade?: number; moveLog?: GameAction[];
  };
  try {
    claim = await req.json();
  } catch {
    return json({ accepted: false, reason: 'malformed body' }, 400);
  }
  if (typeof claim.runId !== 'string') return json({ accepted: false, reason: 'runId required' }, 400);

  const db = createClient(url, serviceKey);

  const { data: runRow, error: runErr } = await db.from('runs')
    .select('id, user_id, status, mode, started_at, seed, challenge_date, move_limit')
    .eq('id', claim.runId).maybeSingle();
  // Do not distinguish "not found" from "not yours": that difference tells an
  // attacker which runIds exist.
  if (runErr || !runRow) return json({ accepted: false, reason: 'run not found' }, 404);

  const run: RunRecord = {
    id: runRow.id,
    user_id: runRow.user_id,
    status: runRow.status,
    mode: runRow.mode,
    started_at: new Date(runRow.started_at).getTime(),
    seed: Number(runRow.seed),
    challenge_date: runRow.challenge_date,
    move_limit: runRow.move_limit,
  };

  const sinceIso = new Date(Date.now() - HOUR_MS).toISOString();
  const { count: recent } = await db.from('runs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', callerId).eq('status', 'submitted').gte('submitted_at', sinceIso);

  let hasDailyAlready = false;
  if (run.mode === 'daily' && run.challenge_date) {
    const { count: dailies } = await db.from('runs')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', callerId).eq('mode', 'daily')
      .eq('challenge_date', run.challenge_date).eq('status', 'submitted');
    hasDailyAlready = (dailies ?? 0) > 0;
  }

  const result = validateSubmission(
    run,
    {
      runId: claim.runId,
      score: claim.score as number,
      placements: claim.placements as number,
      maxCascade: claim.maxCascade as number,
      ...(claim.moveLog ? { moveLog: claim.moveLog } : {}),
    },
    { now: Date.now(), callerId, submissionsLastHour: recent ?? 0, hasDailyAlready },
  );

  if (!result.ok) {
    // Record the rejection against the run: a run that failed validation must
    // never be left 'active' for a second attempt with different numbers.
    await db.from('runs')
      .update({ status: 'rejected', reject_reason: `${result.code}: ${result.reason}`, submitted_at: new Date().toISOString() })
      .eq('id', run.id).eq('status', 'active');
    return json({ accepted: false, reason: result.reason, code: result.code }, 422);
  }

  // Score is the SERVER's number — the replayed one when a move log was sent.
  const score = result.score;

  const { data: claimed, error: updateErr } = await db.from('runs').update({
    status: 'submitted',
    submitted_at: new Date().toISOString(),
    score,
    placements: claim.placements as number,
    max_cascade: claim.maxCascade as number,
    duration_ms: result.durationMs,
  }).eq('id', run.id).eq('status', 'active').select('id');
  if (updateErr) return json({ accepted: false, reason: 'could not record run' }, 500);
  // The status guard is what makes two concurrent submits resolve to one payout,
  // but ONLY if we check the row count: an update matching zero rows is a
  // success with an empty result, not an error. Without .select() and this
  // check the loser of the race would fall through and be paid a second time.
  if (!claimed || claimed.length === 0) return json({ accepted: false, reason: 'already submitted' }, 409);

  // Rewards are computed here, never accepted from the client, and applied in a
  // single statement per row (see migration 0006) so concurrent submissions
  // cannot lose an increment through read-modify-write.
  const rewards = computeRewards(score);
  const { data: walletRows, error: rewardErr } = await db.rpc('apply_run_rewards', {
    p_user: callerId,
    p_xp: rewards.xp,
    p_currency: rewards.currency,
    p_score: score,
    p_chain: (claim.maxCascade as number) + 1,
  });
  // The run is already banked at this point; a reward failure must be visible
  // rather than silently swallowed, but it does not un-bank the score.
  if (rewardErr) {
    console.error('apply_run_rewards failed', { runId: run.id, error: rewardErr.message });
    return json({ accepted: true, score, verified: result.verified, rewards: null, warning: 'rewards not applied' });
  }

  const wallet = Array.isArray(walletRows) ? walletRows[0] : walletRows;
  return json({ accepted: true, score, verified: result.verified, rewards, wallet: wallet ?? null });
});

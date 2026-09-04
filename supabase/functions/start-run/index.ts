// start-run — backend spec §4.1
//
// Issues a server-authored session, so a score can never be submitted for a
// game that was never played. THE SEED COMES FROM THE SERVER: the client
// renders the board from it, and the server can therefore replay and verify.
// It is also what makes the daily challenge genuinely identical worldwide.
import 'jsr:@supabase/functions-js/edge-runtime.d.ts';
import { createClient } from 'jsr:@supabase/supabase-js@2';

const MAX_ACTIVE_RUNS = 3;
const RUN_TTL_MS = 2 * 60 * 60 * 1000;
const DEFAULT_MOVE_LIMIT = 20;

/**
 * Seeds must be unpredictable, not merely varied. The stdlib PRNG is
 * non-cryptographic: its future output can be recovered from past output. A
 * predictable DAILY seed is a real exploit — an attacker who derives
 * tomorrow's seed can precompute an optimal solve offline and submit it the
 * moment the challenge opens, passing replay verification honestly.
 */
function secureSeed(): number {
  const buf = new Uint32Array(1);
  crypto.getRandomValues(buf);
  // Keep it inside the positive int32 range the runs.seed column stores.
  return buf[0] % 2_147_483_647;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const authHeader = req.headers.get('Authorization') ?? '';
  const url = Deno.env.get('SUPABASE_URL')!;
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

  // Identify the caller from THEIR token; write with service_role.
  const asCaller = createClient(url, Deno.env.get('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !userData.user) return json({ error: 'unauthenticated' }, 401);
  const userId = userData.user.id;

  let body: { mode?: string } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const mode = body.mode === 'daily' || body.mode === 'limited' ? body.mode : 'endless';

  const db = createClient(url, serviceKey);
  const nowIso = new Date().toISOString();
  const cutoff = new Date(Date.now() - RUN_TTL_MS).toISOString();

  // 2. Expire stale active runs before counting them, or a player who closes
  // the app three times is locked out for two hours.
  await db.from('runs').update({ status: 'expired' })
    .eq('user_id', userId).eq('status', 'active').lt('started_at', cutoff);

  // 1. Cap concurrent sessions — this is what stops runId farming.
  const { count, error: countErr } = await db.from('runs')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId).eq('status', 'active');
  if (countErr) return json({ error: 'could not read runs' }, 500);
  if ((count ?? 0) >= MAX_ACTIVE_RUNS) return json({ error: 'too many active runs' }, 429);

  // 3. Determine the seed.
  let seed: number;
  let challengeDate: string | null = null;
  let config: Record<string, unknown> = {};

  if (mode === 'daily') {
    challengeDate = nowIso.slice(0, 10);
    const { data: existing } = await db.from('daily_challenges')
      .select('seed, config').eq('challenge_date', challengeDate).maybeSingle();
    if (existing) {
      seed = Number(existing.seed);
      config = (existing.config ?? {}) as Record<string, unknown>;
    } else {
      seed = secureSeed();
      const { data: created, error: createErr } = await db.from('daily_challenges')
        .insert({ challenge_date: challengeDate, seed })
        .select('seed, config').single();
      if (createErr) {
        // Another request created it first — take theirs, never a second seed.
        const { data: raced } = await db.from('daily_challenges')
          .select('seed, config').eq('challenge_date', challengeDate).single();
        seed = Number(raced?.seed ?? seed);
        config = (raced?.config ?? {}) as Record<string, unknown>;
      } else {
        config = (created.config ?? {}) as Record<string, unknown>;
      }
    }
  } else {
    seed = secureSeed();
  }

  const moveLimit = mode === 'limited' ? DEFAULT_MOVE_LIMIT : null;

  // 4. Create the session.
  const { data: run, error: insertErr } = await db.from('runs')
    .insert({ user_id: userId, mode, seed, challenge_date: challengeDate, move_limit: moveLimit, status: 'active' })
    .select('id, seed, mode, move_limit, started_at').single();
  if (insertErr || !run) return json({ error: 'could not start run' }, 500);

  // 5. Hand back the session. Never echo anything the client did not need.
  return json({
    runId: run.id,
    seed: Number(run.seed),
    mode: run.mode,
    moveLimit: run.move_limit,
    startedAt: run.started_at,
    config,
  });
});

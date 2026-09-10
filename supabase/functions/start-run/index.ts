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

/**
 * CORS. The browser sends a preflight OPTIONS request before any POST that
 * carries an Authorization header, and a function that answers it without
 * these headers is unreachable from a web page — which is exactly how this
 * first failed in production, from https://cyber-blast.vercel.app.
 *
 * The origin is open because CORS is not what protects this endpoint and never
 * was: it is a browser-only restriction that curl ignores entirely. The real
 * gate is `verify_jwt` plus the validation chain. Nor does an open origin leak
 * anything — these functions authenticate from the Authorization header rather
 * than cookies, no credentials flag is set, and a hostile page cannot read the
 * player's token because it lives in localStorage scoped to the game's own
 * origin. Pinning an allowlist here would break every preview deployment and
 * local dev server while buying no security.
 */
const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } });

Deno.serve(async (req: Request): Promise<Response> => {
  // Answer the preflight before any auth or body handling.
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS_HEADERS });
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

  let body: { mode?: string; keepRunIds?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const mode = body.mode === 'daily' || body.mode === 'limited' ? body.mode : 'endless';

  // Runs the client says it still intends to submit (its offline queue).
  // Everything else of theirs is abandoned. Capped and shape-checked: this
  // list can only SPARE a run from expiry, never create or extend one, but an
  // unbounded list would still let a client pin arbitrarily many rows active.
  // Strictly UUIDs: these ids are interpolated into a PostgREST `in.(...)`
  // filter, so a value carrying a quote or a bracket could break out of it.
  // A whitelist beats escaping.
  const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
  const keepRunIds = Array.isArray(body.keepRunIds)
    ? body.keepRunIds.filter((v): v is string => typeof v === 'string' && UUID_RE.test(v)).slice(0, 10)
    : [];

  const db = createClient(url, serviceKey);
  const nowIso = new Date().toISOString();
  const cutoff = new Date(Date.now() - RUN_TTL_MS).toISOString();

  // 2. Expire this player's abandoned runs before counting them.
  //
  // Two rules, and the second is the one that matters. Age alone was not
  // enough: a run abandoned by a reload stays inside the two-hour TTL, so
  // three reloads filled the cap and every later start-run answered 429 —
  // the game then played OFFLINE and could not be ranked at all. A client
  // only ever plays one run at a time, so anything it is not holding for
  // submission is dead the moment it asks for a new one.
  await db.from('runs').update({ status: 'expired' })
    .eq('user_id', userId).eq('status', 'active').lt('started_at', cutoff);

  const keepList = `(${keepRunIds.map((id) => `"${id}"`).join(',')})`;
  const abandoned = db.from('runs').update({ status: 'expired' })
    .eq('user_id', userId).eq('status', 'active');
  await (keepRunIds.length > 0 ? abandoned.not('id', 'in', keepList) : abandoned);

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
    // The date the SERVER stamped on this run. The client must use this and
    // not its own clock to pick the day's modifiers: a run started at
    // 23:59:59 UTC would otherwise be played under tomorrow's twist and
    // replayed under today's, rejecting every such run as replay_mismatch.
    challengeDate,
    config,
  });
});

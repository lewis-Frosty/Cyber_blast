import { ensureSession, getSupabase, isBackendConfigured } from '../backend/supabase';

/**
 * One-command backend smoke test, callable from the browser console on any
 * deployed build: `await __cyberBlast.smokeTest()`.
 *
 * It exists because the build sandbox cannot reach *.supabase.co, so the HTTP
 * path — auth, env vars, the Edge Functions, the RPC — can only be exercised
 * from a real browser on a real network. Asking someone to paste a multi-line
 * snippet invites a typo to look like a backend failure; this makes the check
 * a single call with an unambiguous verdict.
 *
 * It is deliberately hostile: the submissions it sends are the ones a cheater
 * would send, and every one of them MUST be refused.
 */

interface Check {
  name: string;
  pass: boolean;
  detail: string;
}

export async function smokeTest(): Promise<{ passed: number; failed: number; checks: Check[] }> {
  const checks: Check[] = [];
  const add = (name: string, pass: boolean, detail: string): void => {
    checks.push({ name, pass, detail });
    console.log(`${pass ? '✅' : '❌'} ${name} — ${detail}`);
  };

  // 1. Is a backend configured at all? This is the failure that looks like
  // success: the game plays perfectly and posts nothing.
  if (!isBackendConfigured()) {
    add('backend configured', false, 'VITE_SUPABASE_URL / KEY missing from this build — every run is offline');
    return summarise(checks);
  }
  add('backend configured', true, 'project URL and publishable key are present in the bundle');

  const supabase = getSupabase();
  if (!supabase) {
    add('client created', false, 'getSupabase() returned null');
    return summarise(checks);
  }

  // 2. Anonymous auth. If this fails the usual cause is that anonymous
  // sign-ins are switched off for the project, not a bug in the game.
  const session = await ensureSession();
  if (!session) {
    add('anonymous sign-in', false, 'no session — check Auth > Providers > Anonymous sign-ins is ENABLED');
    return summarise(checks);
  }
  add('anonymous sign-in', true, `signed in as ${session.userId}`);

  // 3. start-run must issue a server-authored seed.
  const started = await supabase.functions.invoke('start-run', { body: { mode: 'endless' } });
  const run = started.data as { runId?: string; seed?: number } | null;
  if (started.error || !run?.runId || typeof run.seed !== 'number') {
    add('start-run', false, started.error?.message ?? `unexpected response: ${JSON.stringify(started.data)}`);
    return summarise(checks);
  }
  add('start-run', true, `runId ${run.runId}, server seed ${run.seed}`);

  // 4. A submission with NO move log must be refused. This is the one that
  // matters most: it is the submission a cheater would rather send, because
  // without a log there is nothing to verify and every other check is only a
  // bound on a claim rather than a proof.
  const noLog = await supabase.functions.invoke('submit-run', { body: { runId: run.runId } });
  const noLogBody = noLog.data as { accepted?: boolean; code?: string } | null;
  add(
    'refuses a submission with no move log',
    noLogBody?.accepted === false && noLogBody.code === 'no_move_log',
    `accepted=${String(noLogBody?.accepted)} code=${String(noLogBody?.code)} (want accepted=false, code=no_move_log)`,
  );

  // 5. And a fabricated log must be refused too. A fresh run is needed: the
  // one above is now marked rejected, which is itself the correct behaviour —
  // a failed submission must never stay active for a second attempt with
  // different numbers.
  const second = await supabase.functions.invoke('start-run', { body: { mode: 'endless' } });
  const run2 = second.data as { runId?: string } | null;
  if (run2?.runId) {
    const fake = await supabase.functions.invoke('submit-run', {
      body: { runId: run2.runId, moveLog: [{ type: 'place', pieceIndex: 0, gridX: 99, gridY: 99 }] },
    });
    const fakeBody = fake.data as { accepted?: boolean; code?: string } | null;
    add(
      'refuses a fabricated move log',
      fakeBody?.accepted === false && fakeBody.code === 'replay_mismatch',
      `accepted=${String(fakeBody?.accepted)} code=${String(fakeBody?.code)} (want accepted=false, code=replay_mismatch)`,
    );
  } else {
    add('refuses a fabricated move log', false, 'could not start a second run to test with');
  }

  return summarise(checks);
}

function summarise(checks: Check[]): { passed: number; failed: number; checks: Check[] } {
  const passed = checks.filter((c) => c.pass).length;
  const failed = checks.length - passed;
  console.log(
    `%c${failed === 0 ? 'SMOKE TEST PASSED' : 'SMOKE TEST FAILED'} — ${passed}/${checks.length} checks`,
    `font-weight:bold;color:${failed === 0 ? '#A8FF3E' : '#FF2E9F'}`,
  );
  return { passed, failed, checks };
}

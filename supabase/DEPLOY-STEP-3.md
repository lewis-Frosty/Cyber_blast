# Phase 2 Step 3 — pending deploy

## Status: DEPLOYED

Applied and deployed on 2026-09-05 against project `iniuyjwgnqlieidvhxtf`:

  migration   phase2_step3_apply_run_rewards
  start-run   version 1, ACTIVE, verify_jwt true
  submit-run  version 1, ACTIVE, verify_jwt true

Security advisors return zero lints. `apply_run_rewards` is SECURITY DEFINER
with EXECUTE revoked from anon and authenticated and granted to service_role,
confirmed by querying has_function_privilege directly.

What is NOT yet verified: neither function has been INVOKED. The build sandbox
cannot reach *.supabase.co, so the HTTP path — auth header handling, env vars,
the RPC round trip — is unexercised. The validation chain itself is proven by
the unit suite and by running the bundled output directly, but that is not the
same as a live call. Run the smoke test below.

## Redeploying

`submit-run` is deployed as a single bundled file, because it needs the whole
game engine and the deploy path takes files inline:

    npm run edge:bundle    # regenerates supabase/functions/submit-run/dist/index.ts

The bundle is a build artifact (gitignored). src/core and src/config remain the
single source of truth, and `npm test` fails if the copies under
supabase/functions/ have drifted from them.

Deploying via the Supabase CLI instead uses the multi-file tree directly:

    supabase functions deploy start-run
    supabase functions deploy submit-run

## 4. Smoke test

The client no longer sends a score, so the forgery to test is a fabricated
move log rather than a fabricated number. With a signed-in session in the
browser console:

    const { data: run } = await supabase.functions.invoke('start-run', { body: { mode: 'endless' } });

    // (a) No move log at all — the submission a cheater would rather send.
    await supabase.functions.invoke('submit-run', { body: { runId: run.runId } });
    // expect accepted:false, code 'no_move_log'

    // (b) A log of illegal moves.
    await supabase.functions.invoke('submit-run', {
      body: { runId: run.runId, moveLog: [{ type: 'place', pieceIndex: 0, gridX: 99, gridY: 99 }] },
    });
    // expect accepted:false, code 'replay_mismatch'

Then check the run's status is `rejected`, not `active` — a failed submission
must not be retryable with different numbers.

Finally play one real game to game over and confirm the note under the board
reads "Posted · verified score N", with N equal to the score on screen.

## Known gap

Nothing here was exercised over HTTP from the build sandbox: outbound calls to
`*.supabase.co` are blocked, so the functions have never actually run. The
validation chain is proven by 101 unit tests against the same source the
functions import, but the HTTP wiring — auth header handling, env vars, the
RPC call — is unverified until step 4 above passes.

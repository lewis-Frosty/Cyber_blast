# Phase 2 Step 3 — pending deploy

The code is committed. Two things still need to run against project
`iniuyjwgnqlieidvhxtf`, and they must run **in this order** — `submit-run`
calls `apply_run_rewards`, so deploying it before the migration means every
submission banks the score but returns `"warning": "rewards not applied"`.

## 1. Apply migration 0006

Dashboard → SQL Editor → paste `supabase/migrations/0006_apply_run_rewards.sql`
→ Run. Or with the CLI linked to the project:

    supabase db push

## 2. Deploy both functions

    supabase functions deploy start-run
    supabase functions deploy submit-run

`submit-run` ships the generated `core/` and `config/` trees alongside
`index.ts`. Regenerate them first if you have touched anything in `src/core`
or `src/config`:

    npm run edge:build

`npm test` runs `edge:check`, which fails if the committed copies are stale,
so a forgotten regeneration cannot reach a deploy unnoticed.

## 3. Re-run the security advisor

Expect zero lints. `apply_run_rewards` is SECURITY DEFINER, so if EXECUTE was
not revoked cleanly the advisor will say so.

## 4. Smoke test

Sanity check that the chain rejects. With a signed-in session in the browser
console:

    const { data } = await supabase.functions.invoke('start-run', { body: { mode: 'endless' } });
    // Claim an impossible score for that run:
    await supabase.functions.invoke('submit-run', {
      body: { runId: data.runId, score: 9_999_999, placements: 3, maxCascade: 1 },
    });

Expect `accepted: false` with code `ceiling`. Then check the run's status is
`rejected`, not `active` — a failed submission must not be retryable with
different numbers.

## Known gap

Nothing here was exercised over HTTP from the build sandbox: outbound calls to
`*.supabase.co` are blocked, so the functions have never actually run. The
validation chain is proven by 101 unit tests against the same source the
functions import, but the HTTP wiring — auth header handling, env vars, the
RPC call — is unverified until step 4 above passes.

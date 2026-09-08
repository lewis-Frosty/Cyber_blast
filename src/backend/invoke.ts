import { FunctionsHttpError, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Call an Edge Function and tell a REFUSAL apart from a FAILURE.
 *
 * supabase-js treats any non-2xx response as an error and leaves `data`
 * undefined, putting the response itself on `error.context`. That collapses two
 * completely different outcomes into one:
 *
 *   - the function answered, and refused (422) — final, and the body says why
 *   - the request never arrived (offline, DNS, CORS) — worth retrying
 *
 * Reading only `data` makes a refusal look like an empty success; treating
 * every error as a transport failure makes a refusal look retryable, so a run
 * the server has already rejected gets queued and re-sent until it expires,
 * burning the player's hourly submission allowance for nothing.
 */
export interface InvokeResult {
  /** The function answered with 2xx. */
  ok: boolean;
  /** HTTP status, 0 when the response could not be inspected. */
  status: number;
  /** Parsed JSON body, from either the success or the error response. */
  body: unknown;
}

/** Resolves for any answer the function gave; throws only if it never answered. */
export async function invokeFunction(
  supabase: SupabaseClient,
  name: string,
  body: Record<string, unknown>,
): Promise<InvokeResult> {
  const { data, error } = await supabase.functions.invoke(name, { body });
  if (!error) return { ok: true, status: 200, body: data };

  if (error instanceof FunctionsHttpError) {
    const res = (error as unknown as { context?: Response }).context;
    let parsed: unknown = null;
    if (res && typeof res.json === 'function') {
      // A body can only be read once, and a non-JSON error page must not throw.
      try {
        parsed = await res.json();
      } catch {
        parsed = null;
      }
    }
    return { ok: false, status: res?.status ?? 0, body: parsed };
  }

  // FunctionsFetchError / FunctionsRelayError — the request did not complete.
  throw error;
}

/** Narrow an Edge Function refusal body to the fields every one of ours carries. */
export function refusal(body: unknown): { reason?: string; code?: string } {
  if (typeof body !== 'object' || body === null) return {};
  const b = body as { reason?: unknown; code?: unknown };
  return {
    ...(typeof b.reason === 'string' ? { reason: b.reason } : {}),
    ...(typeof b.code === 'string' ? { code: b.code } : {}),
  };
}

/**
 * Sanitise the "runs I still intend to submit" list that the client sends to
 * `start-run`.
 *
 * The server interpolates these ids into a PostgREST `in.(...)` filter, so a
 * value carrying a quote or a bracket could break out of it. A UUID whitelist
 * beats escaping. The cap matters separately: the list can only SPARE a run
 * from expiry, never create one, but an unbounded list would still let a
 * client pin arbitrarily many rows as active and re-create the very lockout
 * this mechanism exists to prevent.
 *
 * Duplicated verbatim in supabase/functions/start-run/index.ts, which is a
 * single self-contained file with no shared-code build step. If one changes,
 * both must.
 */
const UUID_RE = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

export const MAX_KEEP_RUN_IDS = 10;

export function sanitiseKeepRunIds(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter((v): v is string => typeof v === 'string' && UUID_RE.test(v))
    .slice(0, MAX_KEEP_RUN_IDS);
}

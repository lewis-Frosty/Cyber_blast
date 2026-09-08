import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * Supabase client and silent anonymous sign-in — backend spec §1.
 *
 * No email, no password, no signup wall. A gate in front of a casual puzzle
 * game loses players before they have played one round; anonymous auth still
 * gives every device a real auth.uid(), which is all RLS and the leaderboards
 * need. Account linking comes later, framed as "save your progress", once the
 * player has streaks and unlocks worth keeping.
 *
 * Nothing here is allowed to break the game. Every failure path leaves the
 * player unauthenticated and playing offline rather than stuck on a screen.
 */

/**
 * Project configuration, with a compiled-in default.
 *
 * These are the PUBLIC identifiers for the Cyber Blast project. They are not
 * secrets under any reading: Vite inlines VITE_* values into the client bundle,
 * so shipping the game publishes them either way, and reading them out of the
 * deployed JavaScript is trivial. The publishable key carries no privileges of
 * its own — every table is governed by row level security and the Edge Function
 * is the anti-cheat chokepoint. The service_role key is the one that matters,
 * and it never leaves Edge Function secrets.
 *
 * They are compiled in rather than read only from a .env file because hosts do
 * not agree on dotenv. Vercel, in particular, ignores .env files committed to
 * the repository and injects variables from its own project settings — so a
 * deploy built fine, ran fine, and silently played every run offline, which is
 * the most expensive kind of failure because nothing looks broken.
 *
 * An environment variable still wins where one is set, which keeps a staging or
 * self-hosted project a build-time override away.
 */
const DEFAULT_SUPABASE_URL = 'https://iniuyjwgnqlieidvhxtf.supabase.co';
const DEFAULT_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable__DARbnDT57kgK93iWAsMGQ_FUsLeaGy';

const url = (import.meta.env['VITE_SUPABASE_URL'] as string | undefined) || DEFAULT_SUPABASE_URL;
const key =
  (import.meta.env['VITE_SUPABASE_PUBLISHABLE_KEY'] as string | undefined) ||
  DEFAULT_SUPABASE_PUBLISHABLE_KEY;

export interface Session {
  userId: string;
  /** True when this identity was created by anonymous sign-in. */
  anonymous: boolean;
}

let client: SupabaseClient | null = null;

/** The configured client, or null when the project isn't configured. */
export function getSupabase(): SupabaseClient | null {
  if (client) return client;
  if (!url || !key) return null;
  client = createClient(url, key, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // The game is not an OAuth redirect target; parsing the URL for tokens
      // would only add a way for a stray fragment to confuse the session.
      detectSessionInUrl: false,
      storageKey: 'cyber-blast.auth',
    },
  });
  return client;
}

export function isBackendConfigured(): boolean {
  return Boolean(url && key);
}

let signInPromise: Promise<Session | null> | null = null;

/**
 * Resolve a session, signing in anonymously on first launch. Memoised, so
 * several callers on boot share one round trip rather than racing to create
 * duplicate identities.
 *
 * Returns null when the backend is unconfigured or unreachable — the caller
 * is expected to carry on offline.
 */
export function ensureSession(): Promise<Session | null> {
  if (signInPromise) return signInPromise;
  signInPromise = (async (): Promise<Session | null> => {
    const supabase = getSupabase();
    if (!supabase) return null;
    try {
      const existing = await supabase.auth.getSession();
      const user = existing.data.session?.user;
      if (user) return { userId: user.id, anonymous: user.is_anonymous === true };

      const { data, error } = await supabase.auth.signInAnonymously();
      if (error || !data.user) {
        // Most likely cause: anonymous sign-ins are disabled for the project.
        console.warn('[cyber-blast] anonymous sign-in unavailable:', error?.message);
        return null;
      }
      return { userId: data.user.id, anonymous: data.user.is_anonymous === true };
    } catch (e) {
      console.warn('[cyber-blast] auth unreachable, continuing offline:', e);
      return null;
    }
  })();
  return signInPromise;
}

/** The player's own profile row, or null if unauthenticated or unreachable. */
export async function fetchOwnProfile(): Promise<{ id: string; display_name: string | null } | null> {
  const supabase = getSupabase();
  const session = await ensureSession();
  if (!supabase || !session) return null;
  const { data, error } = await supabase
    .from('profiles')
    .select('id, display_name')
    .eq('id', session.userId)
    .maybeSingle();
  if (error) {
    console.warn('[cyber-blast] could not read profile:', error.message);
    return null;
  }
  return data;
}

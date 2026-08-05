import { SupabaseClient, createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
let client: SupabaseClient | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error(
    "NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are not set. " +
    "Auth and data calls will fail until these are configured for this build."
  );
}

export function getSupabase(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    // Fail loudly rather than silently pointing at a fake project - a build
    // missing these env vars must break visibly, not ship a client that
    // quietly can't authenticate against anything.
    throw new Error(
      "Supabase is not configured: NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY are missing."
    );
  }
  client ??= createClient(supabaseUrl, supabaseAnonKey);
  return client;
}

// Backwards-compatible lazy client. This avoids creating the SDK during Next.js build module evaluation.
export const supabase = new Proxy({} as SupabaseClient, {
  get(_target, property, receiver) {
    const value = Reflect.get(getSupabase(), property, receiver);
    return typeof value === 'function' ? value.bind(getSupabase()) : value;
  },
});

// AuthContext is the single subscriber to onAuthStateChange and keeps this in
// sync with the current session. Every API call used to independently call
// supabase.auth.getSession() to get a token, but firing a dozen-plus
// concurrent getSession() calls per dashboard page load caused the GoTrue
// client to redundantly re-announce SIGNED_IN roughly every 2 seconds
// (same session, unchanged expiry) - which re-triggered role resolution and
// the dashboard's loading gate in a near-continuous loop. Reading the token
// from here instead means only AuthContext ever calls getSession() directly.
let cachedAccessToken: string | null = null;

export function setCachedAccessToken(token: string | null) {
  cachedAccessToken = token;
}

export function getCachedAccessToken(): string | null {
  return cachedAccessToken;
}

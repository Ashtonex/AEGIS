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

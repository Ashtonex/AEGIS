import { SupabaseClient, createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://placeholder.supabase.co';
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder_key';
let client: SupabaseClient | undefined;

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn("Supabase credentials are not set in environment variables.");
}

export function getSupabase(): SupabaseClient {
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

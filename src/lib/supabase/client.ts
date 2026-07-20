import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "./database.types";
import { publicEnv } from "@/lib/env";

export type TypedSupabaseClient = SupabaseClient<Database>;

let browserClient: TypedSupabaseClient | undefined;

/**
 * Singleton Supabase browser client.
 *
 * The app is fully client-rendered, so auth lives in the browser (session
 * persisted to localStorage, auto-refreshed). Security is enforced by RLS in
 * Postgres — the anon key is public by design and grants nothing that the
 * policies don't allow.
 *
 * Call only from the browser (effects / event handlers), never during SSR.
 */
export function getSupabaseClient(): TypedSupabaseClient {
  if (browserClient) return browserClient;
  const env = publicEnv();
  browserClient = createClient<Database>(
    env.NEXT_PUBLIC_SUPABASE_URL,
    env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    },
  );
  return browserClient;
}

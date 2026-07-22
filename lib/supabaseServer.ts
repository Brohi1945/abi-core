// Server-side Supabase client — SERVICE ROLE key, bypasses RLS.
// Same pattern jo abos-chat/api/_lib/supabaseServer.js mein already
// proven hai. Yeh file kabhi frontend code mein import nahi hogi.
import { createClient, SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function supabaseServer(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in Vercel environment variables"
    );
  }

  cached = createClient(url, serviceKey);
  return cached;
}

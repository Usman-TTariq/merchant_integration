import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { config } from "../config.js";

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (client) return client;
  const url = config.database.supabaseUrl;
  const key = config.database.supabaseServiceKey;
  if (!url || !key) {
    throw new Error("Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.");
  }
  client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  return client;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(config.database.supabaseUrl && config.database.supabaseServiceKey);
}

export async function verifySupabaseTables(): Promise<void> {
  const sb = getSupabase();
  const { error } = await sb.from("sync_cursors").select("key").limit(1);
  if (error) {
    throw new Error(
      `Supabase tables missing or inaccessible: ${error.message}. Run supabase/schema.sql in the SQL Editor, then npm run db:setup`
    );
  }
}

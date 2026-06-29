import ws from "ws";
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

  // Node 20 (Vercel default) has no native WebSocket — required by @supabase/realtime-js
  client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    realtime: {
      transport: ws as never,
    },
  });
  return client;
}

export function isSupabaseConfigured(): boolean {
  return Boolean(config.database.supabaseUrl && config.database.supabaseServiceKey);
}

export async function verifySupabaseTables(): Promise<void> {
  const sb = getSupabase();
  const tables = ["sync_cursors", "product_mappings", "shiphero_barcode_index", "korona_product_barcodes"] as const;
  for (const table of tables) {
    const { error } = await sb.from(table).select("*").limit(1);
    if (error) {
      throw new Error(
        `Supabase table "${table}" missing or inaccessible: ${error.message}. Run supabase/schema.sql and supabase/migrate-barcode-index.sql in SQL Editor, then npm run db:migrate`
      );
    }
  }
}

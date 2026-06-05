/**
 * Clear processed receipt markers so inventory sync can run again.
 * Use after fixing receipt line parsing (items vs sales).
 */
import "dotenv/config";
import { getSupabase } from "../db/supabase-client.js";
import { config, assertDatabaseConfigForRuntime } from "../config.js";
import { initDatabase, logSync } from "../db.js";

assertDatabaseConfigForRuntime();
await initDatabase();

if (config.database.provider === "supabase") {
  const sb = getSupabase();
  await sb.from("processed_receipts").delete().neq("receipt_id", "");
  await sb.from("sync_cursors").delete().eq("key", "receipts_revision");
  console.log("Cleared processed_receipts and receipts_revision cursor (Supabase)");
} else {
  const { default: Database } = await import("better-sqlite3");
  const db = new Database(config.database.sqlitePath);
  db.prepare("DELETE FROM processed_receipts").run();
  db.prepare("DELETE FROM sync_cursors WHERE key = ?").run("receipts_revision");
  db.close();
  console.log("Cleared processed_receipts and receipts_revision cursor (SQLite)");
}

await logSync("inventory", "info", "Receipt sync state reset for re-processing");
console.log("Done. Run: npm run sync:inventory");

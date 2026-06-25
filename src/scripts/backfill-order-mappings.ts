/**
 * Link Korona receipts to existing ShipHero orders (order_mappings backfill).
 * Use when ShipHero already has R-* orders but the local mapping table is empty.
 */
import "dotenv/config";
import { default as Database } from "better-sqlite3";
import { config, assertDatabaseConfigForRuntime } from "../config.js";
import { initDatabase, logSync } from "../db.js";
import { syncOrders } from "../sync/orders.js";

assertDatabaseConfigForRuntime();
await initDatabase();

if (config.database.provider === "supabase") {
  const { getSupabase } = await import("../db/supabase-client.js");
  const sb = getSupabase();
  await sb.from("sync_cursors").delete().eq("key", "receipt_orders_revision");
  await sb.from("sync_cursors").delete().eq("key", "customer_orders_revision");
  console.log("Reset order sync cursors (Supabase)");
} else {
  const db = new Database(config.database.sqlitePath);
  db.prepare("DELETE FROM sync_cursors WHERE key IN (?, ?)").run(
    "receipt_orders_revision",
    "customer_orders_revision"
  );
  db.close();
  console.log("Reset order sync cursors (SQLite)");
}

await logSync("orders", "info", "Order mapping backfill started");
const result = await syncOrders();
console.log("Backfill result:", result);
console.log("Done. Refresh dashboard Orders tab.");

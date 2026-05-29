import Database from "better-sqlite3";
import { config } from "../config.js";
import { KoronaClient } from "../clients/korona.js";

const db = new Database(config.sync.databasePath);
const korona = new KoronaClient();

const mappings = (db.prepare("SELECT COUNT(*) AS c FROM product_mappings").get() as { c: number }).c;
const orders = (db.prepare("SELECT COUNT(*) AS c FROM order_mappings").get() as { c: number }).c;
const receipts = (db.prepare("SELECT COUNT(*) AS c FROM processed_receipts").get() as { c: number }).c;
const productCursor = db.prepare("SELECT value FROM sync_cursors WHERE key = 'products_revision'").get() as
  | { value: string }
  | undefined;

let koronaTotal = 0;
try {
  const list = await korona.getProducts({ page: 1 });
  koronaTotal = list.resultsTotal ?? 0;
} catch (err) {
  console.log("Korona products fetch failed:", err instanceof Error ? err.message : err);
}

const pct = koronaTotal ? ((mappings / koronaTotal) * 100).toFixed(1) : "?";

const latestMapping = db
  .prepare(
    "SELECT updated_at, shiphero_sku, korona_revision FROM product_mappings ORDER BY updated_at DESC LIMIT 1"
  )
  .get() as { updated_at: string; shiphero_sku: string; korona_revision: number | null } | undefined;

const maxMappedRevision = (
  db.prepare("SELECT MAX(korona_revision) AS r FROM product_mappings").get() as { r: number | null }
).r;

const updatedRecently = (
  db
    .prepare("SELECT COUNT(*) AS c FROM product_mappings WHERE updated_at >= datetime('now', '-5 minutes')")
    .get() as { c: number }
).c;

const syncActive = updatedRecently > 0;

console.log("=== Sync Progress ===");
console.log(`Products: ${mappings} / ${koronaTotal} (${pct}%)`);
console.log(`Product revision cursor: ${productCursor?.value ?? maxMappedRevision ?? "not set yet"}`);
console.log(`Orders mapped: ${orders}`);
console.log(`Receipts processed: ${receipts}`);

console.log("\nLive activity:");
if (latestMapping) {
  console.log(`  Last updated SKU: ${latestMapping.shiphero_sku} @ ${latestMapping.updated_at}`);
  console.log(`  Updated in last 5 min: ${updatedRecently} products`);
  console.log(`  Sync status: ${syncActive ? "RUNNING (updates don't change count until new products)" : "IDLE or stalled"}`);
} else {
  console.log("  No product mappings yet");
}

console.log("\nRecent errors:");
for (const row of db
  .prepare(
    "SELECT datetime(created_at, 'localtime') AS at, job, message FROM sync_log WHERE level = 'error' ORDER BY id DESC LIMIT 5"
  )
  .all() as Array<{ at: string; job: string; message: string }>) {
  console.log(`  [${row.at}] ${row.job}: ${row.message.slice(0, 120)}`);
}

console.log("\nRecent product logs (creates/failures only):");
for (const row of db
  .prepare(
    "SELECT datetime(created_at, 'localtime') AS at, message FROM sync_log WHERE job = 'products' ORDER BY id DESC LIMIT 3"
  )
  .all() as Array<{ at: string; message: string }>) {
  console.log(`  [${row.at}] ${row.message.slice(0, 120)}`);
}
if (!syncActive) {
  console.log("  (no recent logs — normal during update-only pass)");
}

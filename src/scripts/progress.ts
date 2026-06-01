import {
  countOrderMappings,
  countProductsUpdatedSinceMinutes,
  countTable,
  getCursor,
  initDatabase,
  latestProductMapping,
  maxProductRevision,
  recentSyncLogs,
} from "../db.js";
import { config } from "../config.js";
import { KoronaClient } from "../clients/korona.js";

await initDatabase();

const korona = new KoronaClient();
const mappings = await countTable("product_mappings");
const orders = await countOrderMappings();
const receipts = await countTable("processed_receipts");
const productCursor = await getCursor("products_revision");
const maxMappedRevision = await maxProductRevision();
const latestMapping = await latestProductMapping();
const updatedRecently = await countProductsUpdatedSinceMinutes(5);

let koronaTotal = 0;
try {
  const list = await korona.getProducts({ page: 1 });
  koronaTotal = list.resultsTotal ?? 0;
} catch (err) {
  console.log("Korona products fetch failed:", err instanceof Error ? err.message : err);
}

const pct = koronaTotal ? ((mappings / koronaTotal) * 100).toFixed(1) : "?";
const syncActive = updatedRecently > 0;

console.log("=== Sync Progress ===");
console.log(`Database: ${config.database.provider}`);
console.log(`Products: ${mappings} / ${koronaTotal} (${pct}%)`);
console.log(`Product revision cursor: ${productCursor ?? maxMappedRevision ?? "not set yet"}`);
console.log(`Orders mapped: ${orders}`);
console.log(`Receipts processed: ${receipts}`);

console.log("\nLive activity:");
if (latestMapping) {
  console.log(`  Last updated SKU: ${latestMapping.shiphero_sku} @ ${latestMapping.updated_at}`);
  console.log(`  Updated in last 5 min: ${updatedRecently} products`);
  console.log(
    `  Sync status: ${syncActive ? "RUNNING (updates don't change count until new products)" : "IDLE or stalled"}`
  );
} else {
  console.log("  No product mappings yet");
}

console.log("\nRecent errors:");
for (const row of await recentSyncLogs({ level: "error", limit: 5 })) {
  console.log(`  [${row.at}] ${row.job}: ${row.message.slice(0, 120)}`);
}

console.log("\nRecent product logs (creates/failures only):");
for (const row of await recentSyncLogs({ job: "products", limit: 3 })) {
  console.log(`  [${row.at}] ${row.message.slice(0, 120)}`);
}

import "dotenv/config";
import { initDatabase, querySyncLogs, countTable } from "../db.js";
import { KoronaClient } from "../clients/korona.js";

await initDatabase();

console.log("=== Sync Health Check ===\n");

const stats = {
  productMappings: await countTable("product_mappings"),
  orderMappings: await countTable("order_mappings"),
  processedReceipts: await countTable("processed_receipts"),
};

console.log("Database:");
console.log(stats);

const { rows: logs } = await querySyncLogs({ page: 1, limit: 15 });
console.log("\nRecent logs (newest first):");
for (const row of logs) {
  console.log(`${row.created_at} [${row.job}/${row.level}] ${row.message}`);
}

const korona = new KoronaClient();
try {
  const receipts = await korona.getReceipts({ page: 1 });
  const orders = await korona.getCustomerOrders({ page: 1 });
  console.log("\nKorona live:");
  console.log(`  Receipts: ${receipts?.resultsTotal ?? 0}`);
  console.log(`  Customer orders: ${orders?.resultsTotal ?? orders?.results?.length ?? 0}`);
} catch (err) {
  console.log("\nKorona live: FAILED", err instanceof Error ? err.message : err);
}

console.log("\nEnv checks:");
console.log(`  SYNC_KORONA_STOCK: ${process.env.SYNC_KORONA_STOCK ?? "(default true)"}`);
console.log(`  CRON_SECRET set: ${Boolean(process.env.CRON_SECRET?.trim())}`);
console.log(`  KORONA_WAREHOUSE_ID: ${process.env.KORONA_WAREHOUSE_ID ?? "(not set, sums all)"}`);
console.log(`  VERCEL: ${process.env.VERCEL ?? "local"}`);

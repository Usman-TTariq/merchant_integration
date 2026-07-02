/**
 * Print effective sync config for post-import receipt → ShipHero flow.
 * Usage: npm run verify:receipt-flow
 */
import "dotenv/config";
import { config } from "../config.js";
import { initDatabase } from "../db.js";
import { isSyncPaused } from "../sync/pause.js";

await initDatabase();

const paused = await isSyncPaused();

console.log("=== Receipt → ShipHero stock flow ===\n");
console.log(`Sync paused:              ${paused}`);
console.log(`SYNC_KORONA_STOCK:        ${process.env.SYNC_KORONA_STOCK} → koronaStock=${config.sync.koronaStock}`);
console.log(`SYNC_CREATE_KORONA_PRODUCTS: ${process.env.SYNC_CREATE_KORONA_PRODUCTS} → createKoronaProducts=${config.sync.createKoronaProducts}`);
console.log(`Inventory cron:           ${config.cron.inventory}`);

console.log("\n--- Expected behavior when sync RESUMED ---");
if (paused) {
  console.log("  NOW: Nothing runs — all sync jobs skipped while paused.");
}
if (config.sync.koronaStock) {
  console.log("  Receipt deltas: OFF (bulk Korona on-hand → ShipHero via sync:stock)");
  console.log("  ⚠ Not ideal if ShipHero is master.");
} else {
  console.log("  Receipt deltas: ON — new Korona receipts → ShipHero inventory_remove");
  console.log("  Requires product_mappings for sold SKUs.");
}
if (!config.sync.createKoronaProducts) {
  console.log("  Korona→ShipHero product create: OFF (good after import).");
}

console.log("\n--- After import validate, run ---");
console.log("  npm run sync:resume");
console.log("  npm run sync:inventory   # test receipt sync manually");

if (config.sync.koronaStock) process.exit(1);

/**
 * One-time production bootstrap: product mappings + order link backfill.
 * Usage: npm run prod:bootstrap
 */
import "dotenv/config";
import { assertDatabaseConfigForRuntime } from "../config.js";
import { initDatabase, logSync } from "../db.js";
import { syncProducts } from "../sync/products.js";
import { syncOrders } from "../sync/orders.js";

assertDatabaseConfigForRuntime();
await initDatabase();

console.log("=== Production bootstrap ===\n");
await logSync("bootstrap", "info", "Production bootstrap started");

console.log("Step 1/2: Sync Products…");
const products = await syncProducts();
console.log("Products:", products);

console.log("\nStep 2/2: Sync Orders (links existing R-* ShipHero orders)…");
const orders = await syncOrders();
console.log("Orders:", orders);

await logSync("bootstrap", "info", `Production bootstrap done: ${JSON.stringify({ products, orders })}`);
console.log("\nDone. Stock will rotate via /api/cron/stock (150 SKUs per 15 min).");

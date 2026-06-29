/**
 * One-time production bootstrap: product mappings + order link backfill + barcode linking.
 * Usage: npm run prod:bootstrap
 */
import "dotenv/config";
import { assertDatabaseConfigForRuntime, config } from "../config.js";
import { initDatabase, logSync } from "../db.js";
import { runBarcodeLinkPipeline } from "../sync/barcode-link.js";
import { syncProducts } from "../sync/products.js";
import { syncOrders } from "../sync/orders.js";

assertDatabaseConfigForRuntime();
await initDatabase();

console.log("=== Production bootstrap ===\n");
console.log("Database provider:", config.database.provider);
await logSync("bootstrap", "info", "Production bootstrap started");

console.log("Step 1/4: Sync Products…");
const products = await syncProducts();
console.log("Products:", products);

console.log("\nStep 2/4: Sync Orders (links existing R-* ShipHero orders)…");
const orders = await syncOrders();
console.log("Orders:", orders);

console.log("\nStep 3/4: Barcode cache + ShipHero index (chunked)…");
const barcode = await runBarcodeLinkPipeline({ koronaPages: 10, shipheroPages: 100 });
console.log("Barcode pipeline:", barcode);

console.log("\nStep 4/4: Re-run product sync to apply linked SKUs…");
const productsAfter = await syncProducts();
console.log("Products (after link):", productsAfter);

await logSync(
  "bootstrap",
  "info",
  `Production bootstrap done: ${JSON.stringify({ products, orders, barcode, productsAfter })}`
);
console.log("\nDone.");
console.log("Repeat until complete:");
console.log("  npm run prod:link -- --cache-pages=20 --index-pages=100");
console.log("  npm run prod:remote-link   # or trigger /api/cron/barcode-* on Vercel");
console.log("Stock rotates via /api/cron/stock (150 SKUs per 15 min).");

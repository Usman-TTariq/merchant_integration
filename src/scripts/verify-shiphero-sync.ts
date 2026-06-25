/**
 * Sample Korona vs ShipHero on_hand for mapped products (production verification helper).
 * Usage: npm run verify:sync
 */
import "dotenv/config";
import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";
import { initDatabase, queryProductMappings } from "../db.js";
import { resolveKoronaStockQuantity } from "../utils/korona-product-stock.js";

await initDatabase();

const korona = new KoronaClient();
const shiphero = new ShipHeroClient();
const sampleSize = Number(process.argv[2] ?? "15");

const { rows, total } = await queryProductMappings({ page: 1, limit: sampleSize });
let inSync = 0;
let mismatch = 0;
let untracked = 0;
let missing = 0;

console.log(`=== ShipHero sync sample (${rows.length} of ${total} mappings) ===\n`);

for (const row of rows) {
  const koronaProductId = String(row.korona_product_id ?? "");
  const sku = String(row.shiphero_sku ?? "");
  const resolved = await resolveKoronaStockQuantity(korona, koronaProductId);
  if (resolved.status === "untracked") {
    untracked++;
    console.log(`${sku}: Korona not tracked`);
    continue;
  }
  if (resolved.status === "no_rows") {
    console.log(`${sku}: no Korona stock rows`);
    continue;
  }
  const product = await shiphero.getProductBySku(sku);
  if (!product) {
    missing++;
    console.log(`${sku}: missing in ShipHero`);
    continue;
  }
  const shQty = shiphero.getWarehouseOnHand(product);
  if (shQty === resolved.qty) {
    inSync++;
    console.log(`${sku}: in sync (${shQty})`);
  } else {
    mismatch++;
    console.log(`${sku}: MISMATCH Korona=${resolved.qty} ShipHero=${shQty}`);
  }
}

console.log("\nSummary:", { inSync, mismatch, untracked, missing, sampled: rows.length });
if (mismatch > 0) {
  console.log("\nRun Sync Stock or wait for /api/cron/stock to push mismatches.");
  process.exit(1);
}

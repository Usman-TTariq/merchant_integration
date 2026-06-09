import "dotenv/config";
import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";
import { initDatabase, queryProductMappings } from "../db.js";
import { syncProductStock } from "../sync/stock.js";

/**
 * One-shot: enable Korona trackInventory (when needed) and push on-hand to ShipHero
 * for every mapped SKU. Use after deploying the stock-tracking fix.
 */
await initDatabase();

const korona = new KoronaClient();
const shiphero = new ShipHeroClient();

const limit = 200;
let page = 1;
let updated = 0;
let untracked = 0;
let skipped = 0;
let total = 0;

while (true) {
  const batch = await queryProductMappings({ page, limit });
  if (page === 1) total = batch.total;
  if (!batch.rows.length) break;

  for (const row of batch.rows) {
    const koronaProductId = String(row.korona_product_id ?? "");
    const sku = String(row.shiphero_sku ?? "");
    if (!koronaProductId || !sku) {
      skipped++;
      continue;
    }

    const result = await syncProductStock(
      korona,
      shiphero,
      koronaProductId,
      sku,
      "Fix stock tracking",
      "stock"
    );
    if (result === "updated") updated++;
    else if (result === "untracked") untracked++;
    else skipped++;
  }

  if (page * limit >= batch.total) break;
  page++;
}

console.log(`Done: total=${total} updated=${updated} untracked=${untracked} skipped=${skipped}`);

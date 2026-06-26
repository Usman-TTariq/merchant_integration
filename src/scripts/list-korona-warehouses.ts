import "dotenv/config";
import { KoronaClient } from "../clients/korona.js";
import { initDatabase, queryProductMappings } from "../db.js";
import { config } from "../config.js";

await initDatabase();
const korona = new KoronaClient();

console.log("Configured KORONA_WAREHOUSE_ID:", config.korona.warehouseId);

const { rows } = await queryProductMappings({ page: 1, limit: 30 });
let found = 0;
for (const row of rows) {
  const productId = String(row.korona_product_id);
  const sku = String(row.shiphero_sku);
  const stocks = await korona.getProductStocksSafe(productId);
  if (stocks === null) continue;
  if (!stocks.length) continue;
  found++;
  console.log(`\nSKU ${sku}:`);
  for (const s of stocks) {
    console.log("  warehouse.id:", s.warehouse?.id, "warehouse.name:", s.warehouse?.name, "amount:", s.amount);
  }
  if (found >= 3) break;
}

if (!found) {
  console.log("\nNo mapped products with warehouse stock rows in first 30. Trying getProductStocks on A38573...");
  const { rows: r2 } = await queryProductMappings({ page: 1, limit: 1, search: "A38573" });
  const id = String(r2[0]?.korona_product_id ?? "");
  try {
    const full = await korona.getProductStocks(id);
    console.log(JSON.stringify(full, null, 2));
  } catch (e) {
    console.log("Error:", e instanceof Error ? e.message : e);
  }
}

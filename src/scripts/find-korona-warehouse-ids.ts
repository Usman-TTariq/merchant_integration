import "dotenv/config";
import { KoronaClient } from "../clients/korona.js";
import { initDatabase, queryProductMappings } from "../db.js";

await initDatabase();
const korona = new KoronaClient();

const warehouseIds = new Set<string>();
let page = 1;
let withStock = 0;
let scanned = 0;

while (page <= 20 && withStock < 5) {
  const { rows } = await queryProductMappings({ page, limit: 100 });
  if (!rows.length) break;
  for (const row of rows) {
    scanned++;
    const stocks = await korona.getProductStocksSafe(String(row.korona_product_id));
    if (stocks === null || !stocks.length) continue;
    withStock++;
    console.log(`SKU ${row.shiphero_sku}:`, stocks.map((s) => ({
      warehouseId: s.warehouse?.id,
      warehouseName: s.warehouse?.name,
      amount: s.amount,
    })));
    for (const s of stocks) {
      if (s.warehouse?.id) warehouseIds.add(s.warehouse.id);
    }
    if (withStock >= 5) break;
  }
  page++;
}

console.log("\nScanned:", scanned, "With stock rows:", withStock);
console.log("Distinct warehouse.id values:", [...warehouseIds]);

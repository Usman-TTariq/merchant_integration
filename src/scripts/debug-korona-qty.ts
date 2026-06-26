import "dotenv/config";
import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";
import { config } from "../config.js";
import { initDatabase, findKoronaProductIdBySku, queryProductMappings } from "../db.js";
import { resolveKoronaStockQuantity } from "../utils/korona-product-stock.js";

const sku = process.argv[2] ?? "A7679";
await initDatabase();

console.log("KORONA_WAREHOUSE_ID:", config.korona.warehouseId ?? "(not set)");
console.log("KORONA_INVENTORY_ID:", config.korona.inventoryId ?? "(not set)");
console.log("KORONA_INVENTORY_LIST_ID:", config.korona.inventoryListId ?? "(not set)");
console.log("");

let productId = await findKoronaProductIdBySku(sku);
if (!productId) {
  const { rows } = await queryProductMappings({ page: 1, limit: 1, search: sku });
  productId = rows[0]?.korona_product_id ? String(rows[0].korona_product_id) : null;
}
if (!productId) {
  console.log("No mapping for SKU", sku);
  process.exit(1);
}

const korona = new KoronaClient();
const shiphero = new ShipHeroClient();

const resolved = await resolveKoronaStockQuantity(korona, productId, { autoEnableTracking: false });
console.log("Reports mode (autoEnableTracking=false):", resolved);

const resolvedSync = await resolveKoronaStockQuantity(korona, productId, { autoEnableTracking: true });
console.log("Sync mode (autoEnableTracking=true):", resolvedSync);

const stocks = await korona.getProductStocksSafe(productId);
console.log("\nWarehouse stocks API:", stocks === null ? "NOT TRACKED" : stocks);

const sh = await shiphero.getProductBySku(sku);
console.log("ShipHero on_hand:", sh ? shiphero.getWarehouseOnHand(sh) : "NOT FOUND");

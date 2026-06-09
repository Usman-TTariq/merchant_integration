import "dotenv/config";
import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";
import { findShipheroSku, initDatabase } from "../db.js";
import { syncProductStock } from "../sync/stock.js";
import { sanitizeSku } from "../utils/sku.js";

const skuArg = process.argv[2];
if (!skuArg) {
  console.error("Usage: npx tsx src/scripts/sync-stock-sku.ts <SKU>");
  process.exit(1);
}

await initDatabase();

const korona = new KoronaClient();
const shiphero = new ShipHeroClient();

let productId: string | null = null;
for await (const batch of korona.paginate((page) => korona.getProducts({ page }))) {
  for (const product of batch) {
    const sku = sanitizeSku(product.number ?? product.id);
    if (sku === skuArg || product.number === skuArg) {
      productId = product.id;
      break;
    }
  }
  if (productId) break;
}

if (!productId) {
  const mapped = await findShipheroSku(undefined, skuArg);
  console.error("Product not found in Korona for SKU", skuArg, mapped ? "" : "(no mapping)");
  process.exit(1);
}

const result = await syncProductStock(korona, shiphero, productId, skuArg, "Manual stock sync", "stock");
console.log("Result:", result);

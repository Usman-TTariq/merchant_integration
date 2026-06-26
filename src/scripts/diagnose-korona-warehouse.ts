import "dotenv/config";
import { KoronaClient } from "../clients/korona.js";
import { initDatabase, queryProductMappings } from "../db.js";
import { config } from "../config.js";
import { resolveKoronaStockQuantity } from "../utils/korona-product-stock.js";

const base = process.env.KORONA_BASE_URL!.replace(/\/$/, "");
const accountId = process.env.KORONA_ACCOUNT_ID!;
const auth =
  "Basic " +
  Buffer.from(`${process.env.KORONA_USERNAME}:${process.env.KORONA_PASSWORD}`).toString("base64");

async function get(path: string) {
  const res = await fetch(`${base}/accounts/${accountId}${path}`, {
    headers: { Accept: "application/json", Authorization: auth },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : {};
}

try {
  const wh = await get("/warehouses?page=1&size=20");
  console.log("Korona /warehouses:", wh.results ?? wh);
} catch (e) {
  console.log("warehouses endpoint:", e instanceof Error ? e.message : e);
}

await initDatabase();
const korona = new KoronaClient();
console.log("\nConfigured KORONA_WAREHOUSE_ID:", config.korona.warehouseId);
console.log("Store 1 org unit (from discover): 64698fab-195e-4718-83f7-b121426267a4");
console.log("Match?", config.korona.warehouseId === "64698fab-195e-4718-83f7-b121426267a4");

// Test inventory list if set on server
const invId = config.korona.inventoryId;
const listId = config.korona.inventoryListId;
if (invId && listId) {
  const { rows } = await queryProductMappings({ page: 1, limit: 1, search: "A7679" });
  const pid = rows[0] ? String(rows[0].korona_product_id) : null;
  if (pid) {
    const item = await korona.getInventoryListItem(invId, listId, pid);
    console.log("\nInventory list item A7679:", item);
  }
}

// Count how many SKUs resolve to inventory_list vs warehouse vs untracked
const { rows } = await queryProductMappings({ page: 1, limit: 50 });
const tally = { warehouse: 0, inventory_list: 0, untracked: 0, no_rows: 0, ok0: 0, okNonZero: 0 };
for (const row of rows) {
  const resolved = await resolveKoronaStockQuantity(korona, String(row.korona_product_id), {
    autoEnableTracking: false,
  });
  if (resolved.status === "ok") {
    if (resolved.source === "warehouse") tally.warehouse++;
    else tally.inventory_list++;
    if (resolved.qty === 0) tally.ok0++;
    else tally.okNonZero++;
  } else if (resolved.status === "untracked") tally.untracked++;
  else tally.no_rows++;
}
console.log("\nSample 50 SKUs (reports mode):", tally);

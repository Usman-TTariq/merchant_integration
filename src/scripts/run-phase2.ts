import { syncInventory } from "../sync/inventory.js";
import { syncOrders } from "../sync/orders.js";
import { getDb } from "../db.js";

console.log("=== Phase 2+3: Inventory + Orders ===\n");

const before = {
  receipts: (getDb().prepare("SELECT COUNT(*) AS c FROM processed_receipts").get() as { c: number }).c,
  orders: (getDb().prepare("SELECT COUNT(*) AS c FROM order_mappings").get() as { c: number }).c,
};
console.log("Before:", before);

await syncInventory();
await syncOrders();

const after = {
  receipts: (getDb().prepare("SELECT COUNT(*) AS c FROM processed_receipts").get() as { c: number }).c,
  orders: (getDb().prepare("SELECT COUNT(*) AS c FROM order_mappings").get() as { c: number }).c,
};
console.log("\nAfter:", after);

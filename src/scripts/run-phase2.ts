import { syncInventory } from "../sync/inventory.js";
import { syncOrders } from "../sync/orders.js";
import { countOrderMappings, countTable, initDatabase } from "../db.js";

await initDatabase();

console.log("=== Phase 2+3: Inventory + Orders ===\n");

const before = {
  receipts: await countTable("processed_receipts"),
  orders: await countOrderMappings(),
};
console.log("Before:", before);

await syncInventory();
await syncOrders();

const after = {
  receipts: await countTable("processed_receipts"),
  orders: await countOrderMappings(),
};
console.log("\nAfter:", after);

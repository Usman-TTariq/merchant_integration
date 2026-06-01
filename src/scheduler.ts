import cron from "node-cron";
import { config } from "./config.js";
import { initDatabase, logSync } from "./db.js";
import { syncInventory } from "./sync/inventory.js";
import { syncOrders } from "./sync/orders.js";
import { syncProducts } from "./sync/products.js";

function wrap(job: string, fn: () => Promise<unknown>): () => void {
  return () => {
    fn().catch(async (err) => {
      await logSync(job, "error", err instanceof Error ? err.message : String(err));
    });
  };
}

await initDatabase();

console.log("Korona ↔ ShipHero scheduler started (UTC)");
console.log(`  database:  ${config.database.provider}`);
console.log(`  products:  ${config.cron.products}`);
console.log(`  inventory: ${config.cron.inventory}`);
console.log(`  orders:    ${config.cron.orders}`);

cron.schedule(config.cron.products, wrap("products", syncProducts));
cron.schedule(config.cron.inventory, wrap("inventory", syncInventory));
cron.schedule(config.cron.orders, wrap("orders", syncOrders));

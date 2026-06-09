import { initDatabase } from "../db.js";
import { syncInventory } from "./inventory.js";
import { syncOrders } from "./orders.js";
import { syncProducts } from "./products.js";
import { syncStock } from "./stock.js";

export type SyncJob = "products" | "inventory" | "orders" | "stock" | "all";

export async function runSyncJob(job: SyncJob): Promise<Record<string, unknown>> {
  await initDatabase();
  const results: Record<string, unknown> = {};

  if (job === "products" || job === "all") {
    results.products = await syncProducts();
  }
  if (job === "inventory" || job === "all") {
    results.inventory = await syncInventory();
  }
  if (job === "orders" || job === "all") {
    results.orders = await syncOrders();
  }
  if (job === "stock" || job === "all") {
    results.stock = await syncStock();
  }

  return results;
}

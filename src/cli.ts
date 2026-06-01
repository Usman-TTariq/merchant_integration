import { initDatabase } from "./db.js";
import { syncInventory } from "./sync/inventory.js";
import { syncOrders } from "./sync/orders.js";
import { syncProducts } from "./sync/products.js";

const job = process.argv[2] ?? "all";

async function main(): Promise<void> {
  await initDatabase();
  switch (job) {
    case "products":
      await syncProducts();
      break;
    case "inventory":
      await syncInventory();
      break;
    case "orders":
      await syncOrders();
      break;
    case "all":
      await syncProducts();
      await syncInventory();
      await syncOrders();
      break;
    default:
      console.error(`Unknown job: ${job}`);
      console.error("Usage: npm run sync:<products|inventory|orders|all>");
      process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

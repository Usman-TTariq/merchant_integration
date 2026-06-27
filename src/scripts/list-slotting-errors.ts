/**
 * List historical SKUs blocked by ShipHero dynamic slotting (inventory_replace era).
 * Current stock sync uses inventory_add/remove delta and does not log slotting errors.
 * Usage: npm run slotting:list
 */
import "dotenv/config";
import { initDatabase, querySyncLogs } from "../db.js";

await initDatabase();

const { rows } = await querySyncLogs({
  page: 1,
  limit: 500,
  level: "warn",
  search: "dynamic slotting",
});

const skus = new Set<string>();
for (const row of rows) {
  const message = String(row.message ?? "");
  const match = message.match(/SKU ([^:]+):/);
  if (match?.[1]) skus.add(match[1].trim());
}

console.log(`=== Historical dynamic slotting blocked SKUs (${skus.size}) ===\n`);
if (skus.size === 0) {
  console.log("No slotting warnings in recent stock logs.");
  console.log("\nStock sync now uses inventory_add / inventory_remove delta (not inventory_replace).");
  console.log("Re-run sync:stock or wait for stock cron to push Korona on-hand.");
  process.exit(0);
}

for (const sku of [...skus].sort()) {
  console.log(sku);
}

console.log("\nThese SKUs failed under the old inventory_replace path.");
console.log("Re-sync with: npm run sync:stock-sku -- <SKU>");

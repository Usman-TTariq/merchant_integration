/**
 * List SKUs blocked by ShipHero dynamic slotting from sync_log.
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

console.log(`=== Dynamic slotting blocked SKUs (${skus.size}) ===\n`);
if (skus.size === 0) {
  console.log("No slotting warnings in recent stock logs.");
  console.log("\nIf inventory_replace fails at runtime:");
  console.log("  1. Confirm your ShipHero account supports inventory_replace for this warehouse.");
  console.log("  2. Contact ShipHero support for non-slotting inventory API path.");
  console.log("  3. Re-test a mismatch SKU from Reports after account changes.");
  process.exit(0);
}

for (const sku of [...skus].sort()) {
  console.log(sku);
}

console.log("\nAction: contact ShipHero support with these SKUs.");
console.log("Until resolved, stock cron logs slotting=N and skips these SKUs.");

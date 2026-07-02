/**
 * Remove Korona duplicate SKUs from ShipHero (korona# = shiphero SKU).
 * Keeps linked Shopify/web mappings (korona# != shiphero SKU).
 *
 * Usage:
 *   npm run cleanup:korona-duplicates -- --stats
 *   npm run cleanup:korona-duplicates -- --dry-run --limit=20
 *   npm run cleanup:korona-duplicates -- --execute --limit=50
 *   npm run cleanup:korona-duplicates -- --execute --limit=100 --zero-stock
 *
 * Requires sync paused. Resumes via sync_cursors key korona_duplicate_cleanup_sku.
 */
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { ShipHeroClient } from "../clients/shiphero.js";
import {
  countKoronaDuplicateMappings,
  deleteProductMapping,
  getCursor,
  initDatabase,
  listProductMappingsForRelink,
  logSync,
  setCursor,
} from "../db.js";
import { isSyncPaused } from "../sync/pause.js";
import { sanitizeSku } from "../utils/sku.js";

const CURSOR_KEY = "korona_duplicate_cleanup_sku";
const FAILED_LOG = path.join(process.cwd(), "data", "korona-cleanup-failed.txt");

const statsOnly = process.argv.includes("--stats");
const dryRun = !process.argv.includes("--execute");
const zeroStock = process.argv.includes("--zero-stock");
const limitArg = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "50");
const delayMs = Number(process.argv.find((a) => a.startsWith("--delay="))?.split("=")[1] ?? "800");
const resetCursor = process.argv.includes("--reset-cursor");

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isKoronaDuplicateMapping(row: {
  koronaProductNumber: string | null;
  shipheroSku: string;
}): boolean {
  if (!row.koronaProductNumber) return false;
  return sanitizeSku(row.koronaProductNumber) === sanitizeSku(row.shipheroSku);
}

type DuplicateRow = {
  koronaProductId: string;
  koronaProductNumber: string | null;
  shipheroSku: string;
};

async function loadDuplicates(): Promise<DuplicateRow[]> {
  const all = await listProductMappingsForRelink();
  return all.filter(isKoronaDuplicateMapping).sort((a, b) => a.shipheroSku.localeCompare(b.shipheroSku));
}

function appendFailedSku(sku: string, reason: string): void {
  fs.mkdirSync(path.dirname(FAILED_LOG), { recursive: true });
  fs.appendFileSync(FAILED_LOG, `${sku}\t${reason.replace(/\s+/g, " ").slice(0, 200)}\n`, "utf8");
}

async function removeItemLocationsSafe(shiphero: ShipHeroClient, sku: string): Promise<number> {
  let removed = 0;
  try {
    const locations = await shiphero.listItemLocationIds(sku);
    for (const loc of locations) {
      try {
        await shiphero.deleteItemLocations([loc.id]);
        removed++;
      } catch (err) {
        console.warn(`  warn ${sku}: item_location ${loc.id} not removed — ${errMsg(err)}`);
      }
      await sleep(Math.min(delayMs, 500));
    }
  } catch (err) {
    console.warn(`  warn ${sku}: could not list item locations — ${errMsg(err)}`);
  }
  return removed;
}

async function removeFromShiphero(shiphero: ShipHeroClient, sku: string, onHand: number): Promise<boolean> {
  if (onHand > 0 && zeroStock) {
    try {
      await shiphero.inventoryRemove(sku, onHand, "Korona duplicate cleanup");
      await sleep(delayMs);
    } catch (err) {
      console.warn(`  warn ${sku}: inventory_remove failed — ${errMsg(err)}`);
    }
  }

  await removeItemLocationsSafe(shiphero, sku);

  const steps: Array<{ label: string; run: () => Promise<void> }> = [
    {
      label: "warehouse_product_delete",
      run: () => shiphero.deleteWarehouseProduct(sku),
    },
    {
      label: "product_delete",
      run: () => shiphero.deleteProduct(sku),
    },
  ];

  for (const step of steps) {
    try {
      await step.run();
      await sleep(delayMs);
    } catch (err) {
      const msg = errMsg(err);
      if (msg.toLowerCase().includes("not exist") || msg.toLowerCase().includes("not found")) {
        continue;
      }
      console.warn(`  warn ${sku}: ${step.label} — ${msg}`);
    }
  }

  const stillThere = await shiphero.getProductBySku(sku);
  return !stillThere;
}

async function cleanupSku(
  shiphero: ShipHeroClient,
  row: DuplicateRow
): Promise<"deleted" | "skipped" | "failed"> {
  const sku = row.shipheroSku;

  const product = await shiphero.getProductBySku(sku);
  if (!product) {
    if (!dryRun) await deleteProductMapping(row.koronaProductId);
    console.log(`  ok ${sku}: not in ShipHero (mapping only)`);
    return "deleted";
  }

  const onHand = shiphero.getWarehouseOnHand(product);
  if (onHand > 0 && !zeroStock) {
    console.log(`  skip ${sku}: on_hand=${onHand} (use --zero-stock to remove inventory first)`);
    return "skipped";
  }

  if (dryRun) {
    const locations = await shiphero.listItemLocationIds(sku);
    console.log(`  dry-run ${sku}: on_hand=${onHand}, item_locations=${locations.length}`);
    return "deleted";
  }

  const removed = await removeFromShiphero(shiphero, sku, onHand);
  if (!removed) {
    appendFailedSku(sku, "product still exists in ShipHero after delete attempts");
    console.error(`  fail ${sku}: still in ShipHero — logged to data/korona-cleanup-failed.txt`);
    return "failed";
  }

  await deleteProductMapping(row.koronaProductId);
  await logSync("cleanup", "info", `Removed Korona duplicate SKU ${sku} from ShipHero`);
  console.log(`  ok ${sku}: removed from ShipHero`);
  return "deleted";
}

await initDatabase();

const duplicates = await loadDuplicates();
const dbCount = await countKoronaDuplicateMappings();
const linkedCount = (await listProductMappingsForRelink()).length - duplicates.length;

console.log("=== Korona duplicate cleanup ===");
console.log(`  duplicate mappings (korona# = shiphero SKU): ${duplicates.length} (db count=${dbCount})`);
console.log(`  linked Shopify/web mappings (kept):          ${linkedCount}`);
console.log(`  mode: ${statsOnly ? "stats" : dryRun ? "dry-run" : "EXECUTE"}`);
console.log(`  zero-stock removal: ${zeroStock ? "yes" : "no (skip on_hand > 0)"}`);
console.log(`  delay: ${delayMs}ms between API calls`);

if (statsOnly) {
  console.log("\nFirst 10 duplicates:", duplicates.slice(0, 10).map((d) => d.shipheroSku));
  process.exit(0);
}

if (!(await isSyncPaused())) {
  console.error("\nERROR: Sync is not paused. Run: npm run sync:pause");
  process.exit(1);
}

let afterSku = resetCursor ? "" : ((await getCursor(CURSOR_KEY)) ?? "");
const batch = duplicates.filter((d) => !afterSku || d.shipheroSku > afterSku).slice(0, limitArg);

if (!batch.length) {
  console.log("\nNothing to process (cursor at end). Use --reset-cursor to start over.");
  process.exit(0);
}

console.log(`\nProcessing ${batch.length} SKU(s) after cursor "${afterSku || "(start)"}"…\n`);

const shiphero = new ShipHeroClient();
let deleted = 0;
let skipped = 0;
let failed = 0;
let lastSku = afterSku;

for (const row of batch) {
  console.log(`${row.shipheroSku} (${row.koronaProductNumber})`);
  try {
    const result = await cleanupSku(shiphero, row);
    if (result === "deleted") deleted++;
    else if (result === "skipped") skipped++;
    else failed++;
    lastSku = row.shipheroSku;
    if (!dryRun && (result === "deleted" || result === "skipped")) {
      await setCursor(CURSOR_KEY, lastSku);
    }
  } catch (err) {
    failed++;
    appendFailedSku(row.shipheroSku, errMsg(err));
    console.error(`  fail ${row.shipheroSku}: ${errMsg(err)}`);
    lastSku = row.shipheroSku;
  }
  await sleep(delayMs);
}

console.log(`\nDone: deleted=${deleted} skipped=${skipped} failed=${failed}`);
console.log(`  cursor: ${lastSku}`);
const remaining = duplicates.filter((d) => d.shipheroSku > lastSku).length;
console.log(`  remaining: ~${remaining}`);
if (failed > 0) {
  console.log(`  failed SKUs logged: ${FAILED_LOG}`);
}
if (dryRun) {
  console.log("\nDry-run only. Re-run with --execute to apply.");
} else {
  console.log(`\nRe-run: npm run cleanup:korona-duplicates -- --execute --limit=${limitArg}`);
}

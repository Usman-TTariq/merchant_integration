/**
 * Import ShipHero products into Korona (ShipHero = source of truth).
 * Korona product number = ShipHero SKU as-is. Stock = ShipHero on_hand.
 *
 * Usage:
 *   npm run import:shiphero-to-korona -- --stats
 *   npm run import:shiphero-to-korona -- --dry-run --limit=500
 *   npm run import:shiphero-to-korona -- --execute --limit=500 --delay=1000
 *
 * Requires sync paused. Resumes via sync_cursors key shiphero_to_korona_import_cursor.
 */
import fs from "node:fs";
import path from "node:path";
import "dotenv/config";
import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";
import { config, requireShipheroWarehouseId } from "../config.js";
import {
  findKoronaProductIdBySku,
  getCursor,
  initDatabase,
  logSync,
  setCursor,
  upsertProductMapping,
  upsertShipheroBarcodeIndex,
} from "../db.js";
import { isSyncPaused } from "../sync/pause.js";
import type { KoronaProductCreateInput, KoronaProductCreateResult } from "../types/korona.js";

const CURSOR_KEY = "shiphero_to_korona_import_cursor";
const DATA_DIR = path.join(process.cwd(), "data");
const LOG_CREATED = path.join(DATA_DIR, "shiphero-korona-import-created.txt");
const LOG_SKIPPED = path.join(DATA_DIR, "shiphero-korona-import-skipped.txt");
const LOG_FAILED = path.join(DATA_DIR, "shiphero-korona-import-failed.txt");

const statsOnly = process.argv.includes("--stats");
const dryRun = !process.argv.includes("--execute");
const resetCursor = process.argv.includes("--reset-cursor");
const limitArg = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "500");
const delayMs = Number(process.argv.find((a) => a.startsWith("--delay="))?.split("=")[1] ?? "800");
const pageSize = Number(process.argv.find((a) => a.startsWith("--page-size="))?.split("=")[1] ?? "50");
const batchSize = Number(process.argv.find((a) => a.startsWith("--batch="))?.split("=")[1] ?? "10");

type ShipHeroImportRow = {
  sku: string;
  name: string;
  barcode?: string;
  onHand: number;
  price?: string;
};

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function appendLog(file: string, line: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.appendFileSync(file, `${line}\n`, "utf8");
}

function buildKoronaProduct(
  row: ShipHeroImportRow,
  refs: { commodityGroupId: string; sectorId: string; assortmentId: string }
): KoronaProductCreateInput {
  const product: KoronaProductCreateInput = {
    number: row.sku,
    name: row.name || row.sku,
    trackInventory: true,
    commodityGroup: { id: refs.commodityGroupId },
    sector: { id: refs.sectorId },
    assortment: { id: refs.assortmentId },
  };
  const barcode = row.barcode?.trim();
  if (barcode) {
    product.codes = [{ productCode: barcode, primary: true }];
  }
  // Skip prices on create — Korona requires validFrom/priceGroup; set in Korona backend if needed.
  return product;
}

async function koronaProductIdByNumber(korona: KoronaClient, sku: string): Promise<string | null> {
  try {
    const list = await korona.getProducts({ number: sku, size: 5, page: 1 });
    const match = list?.results?.find((p) => p.number === sku && !p.deleted);
    return match?.id ?? null;
  } catch {
    return null;
  }
}

async function resolveKoronaIdAfterCreate(
  korona: KoronaClient,
  sku: string,
  created: KoronaProductCreateResult[] | undefined
): Promise<string | null> {
  const row = created?.[0];
  if (row?.status === "ERROR") {
    throw new Error(row.message ?? "Korona product create failed");
  }
  if (row?.status === "OK" && row.id) return row.id;
  return koronaProductIdByNumber(korona, sku);
}

async function setKoronaStock(
  korona: KoronaClient,
  inventoryId: string,
  inventoryListId: string,
  productId: string,
  onHand: number
): Promise<void> {
  await korona.updateInventoryListItems(inventoryId, inventoryListId, [
    {
      product: { id: productId },
      quantity: { value: Math.max(0, Math.round(onHand)) },
    },
  ]);
}

async function upsertMappingForImport(
  koronaProductId: string,
  sku: string,
  revision?: number | null
): Promise<void> {
  await upsertProductMapping({
    koronaProductId,
    koronaProductNumber: sku,
    shipheroSku: sku,
    koronaRevision: revision ?? null,
  });
}

async function processBatch(
  korona: KoronaClient,
  inventoryId: string,
  inventoryListId: string,
  importRefs: { commodityGroupId: string; sectorId: string; assortmentId: string },
  batch: ShipHeroImportRow[],
  execute: boolean
): Promise<{ created: number; skipped: number; failed: number }> {
  let created = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of batch) {
    const sku = row.sku.trim();
    if (!sku) {
      skipped++;
      appendLog(LOG_SKIPPED, `${sku || "(empty)"}\tempty_sku`);
      continue;
    }

    try {
      const mappedId = await findKoronaProductIdBySku(sku);
      if (mappedId) {
        skipped++;
        appendLog(LOG_SKIPPED, `${sku}\tmapping_exists`);
        console.log(`  skip ${sku}: already mapped (${mappedId})`);
        continue;
      }

      const existingId = await koronaProductIdByNumber(korona, sku);
      if (existingId) {
        if (execute) {
          await setKoronaStock(korona, inventoryId, inventoryListId, existingId, row.onHand);
          const full = await korona.getProduct(existingId);
          await upsertMappingForImport(existingId, sku, full.revision);
        }
        skipped++;
        appendLog(LOG_SKIPPED, `${sku}\tkorona_exists\t${existingId}`);
        console.log(`  skip ${sku}: Korona product exists (${existingId})${execute ? ", stock+mapping updated" : ""}`);
        continue;
      }

      if (!execute) {
        created++;
        console.log(`  dry-run ${sku}: name="${row.name}" on_hand=${row.onHand} barcode=${row.barcode ?? ""}`);
        appendLog(LOG_CREATED, `${sku}\tdry-run\ton_hand=${row.onHand}`);
        continue;
      }

      const payload = buildKoronaProduct(row, importRefs);
      const result = await korona.createProducts([payload], { upsert: true });
      const koronaId = await resolveKoronaIdAfterCreate(korona, sku, result);
      if (!koronaId) {
        failed++;
        appendLog(LOG_FAILED, `${sku}\tno_korona_id_after_create`);
        console.error(`  fail ${sku}: Korona create returned OK but no product id`);
        continue;
      }

      await sleep(Math.min(delayMs, 400));
      await setKoronaStock(korona, inventoryId, inventoryListId, koronaId, row.onHand);
      const full = await korona.getProduct(koronaId);
      await upsertMappingForImport(koronaId, sku, full.revision);
      if (row.barcode?.trim()) {
        await upsertShipheroBarcodeIndex([
          { barcode: row.barcode.trim(), shipheroSku: sku, onHand: row.onHand },
        ]);
      }
      await logSync("import", "info", `Imported ${sku} → Korona on_hand=${row.onHand}`);

      created++;
      appendLog(LOG_CREATED, `${sku}\t${koronaId}\ton_hand=${row.onHand}`);
      console.log(`  ok ${sku}: Korona ${koronaId} on_hand=${row.onHand}`);
    } catch (err) {
      failed++;
      const msg = errMsg(err);
      appendLog(LOG_FAILED, `${sku}\t${msg.replace(/\s+/g, " ").slice(0, 200)}`);
      console.error(`  fail ${sku}: ${msg}`);
      await logSync("import", "error", `Import ${sku}: ${msg}`);
    }

    await sleep(delayMs);
  }

  return { created, skipped, failed };
}

await initDatabase();

const inventoryId = config.korona.inventoryId;
const inventoryListId = config.korona.inventoryListId;

console.log("=== ShipHero → Korona import ===");
console.log(`  mode: ${statsOnly ? "stats" : dryRun ? "dry-run" : "EXECUTE"}`);
console.log(`  filter: on_hand > 0 only`);
console.log(`  limit: ${limitArg}`);
console.log(`  delay: ${delayMs}ms`);
console.log(`  batch size: ${batchSize}`);

if (config.sync.koronaStock) {
  console.warn("\n  WARN: SYNC_KORONA_STOCK=true — Korona→ShipHero stock sync may overwrite ShipHero after import.");
}

try {
  requireShipheroWarehouseId();
} catch (err) {
  console.error(`\nERROR: ${errMsg(err)}`);
  process.exit(1);
}

if (statsOnly) {
  const shiphero = new ShipHeroClient();
  let cursor = resetCursor ? null : (await getCursor(CURSOR_KEY)) || null;
  let eligible = 0;
  let scanned = 0;
  let pages = 0;

  while (true) {
    const page = await shiphero.listProductsPage(pageSize, cursor);
    pages++;
    for (const p of page.products) {
      scanned++;
      if (p.onHand > 0 && p.sku?.trim()) eligible++;
    }
    cursor = page.pageInfo.endCursor;
    if (!page.pageInfo.hasNextPage) break;
    if (pages % 20 === 0) {
      console.log(`  … scanned=${scanned} eligible(on_hand>0)=${eligible}`);
    }
    await sleep(300);
  }

  console.log(`\nShipHero products scanned: ${scanned}`);
  console.log(`Eligible for import (on_hand > 0): ${eligible}`);
  process.exit(0);
}

if (!(await isSyncPaused())) {
  console.error("\nERROR: Sync is not paused. Run: npm run sync:pause");
  process.exit(1);
}

if (!inventoryId || !inventoryListId) {
  console.error("\nERROR: Set KORONA_INVENTORY_ID and KORONA_INVENTORY_LIST_ID (npm run discover)");
  process.exit(1);
}

const shiphero = new ShipHeroClient();
const korona = new KoronaClient();
const importRefs = await korona.resolveImportRefs();
console.log(
  `  Korona create refs: commodityGroup=${importRefs.commodityGroupId} sector=${importRefs.sectorId} assortment=${importRefs.assortmentId}`
);

let cursor = resetCursor ? null : (await getCursor(CURSOR_KEY)) || null;
let processed = 0;
let totalCreated = 0;
let totalSkipped = 0;
let totalFailed = 0;
let pending: ShipHeroImportRow[] = [];
let pagesScanned = 0;

console.log(`\nStarting from cursor: ${cursor ?? "(start)"}\n`);

while (processed < limitArg) {
  const page = await shiphero.listProductsPage(pageSize, cursor);
  pagesScanned++;
  const eligible = page.products.filter((p) => p.onHand > 0 && p.sku?.trim());

  if (pagesScanned === 1 || pagesScanned % 25 === 0 || eligible.length > 0) {
    console.log(`  page ${pagesScanned}: eligible=${eligible.length} processed=${processed}/${limitArg}`);
  }

  for (const p of eligible) {
    if (processed + pending.length >= limitArg) break;
    pending.push({
      sku: p.sku.trim(),
      name: p.name,
      barcode: p.barcode,
      onHand: p.onHand,
      price: p.price,
    });

    if (pending.length >= batchSize || processed + pending.length >= limitArg) {
      const take = Math.min(batchSize, limitArg - processed, pending.length);
      if (take <= 0) break;
      const batch = pending.splice(0, take);
      const result = await processBatch(korona, inventoryId, inventoryListId, importRefs, batch, !dryRun);
      totalCreated += result.created;
      totalSkipped += result.skipped;
      totalFailed += result.failed;
      processed += batch.length;
    }
  }

  cursor = page.pageInfo.endCursor;
  if (cursor && !dryRun) await setCursor(CURSOR_KEY, cursor);

  if (processed >= limitArg) break;
  if (!page.pageInfo.hasNextPage) break;
  await sleep(Math.min(delayMs, 400));
}

if (pending.length && processed < limitArg) {
  const batch = pending.splice(0, limitArg - processed);
  const result = await processBatch(korona, inventoryId, inventoryListId, importRefs, batch, !dryRun);
  totalCreated += result.created;
  totalSkipped += result.skipped;
  totalFailed += result.failed;
  processed += batch.length;
}

if (cursor && !dryRun) await setCursor(CURSOR_KEY, cursor);

console.log("\n=== Summary ===");
console.log(`  processed: ${processed}`);
console.log(`  created:   ${totalCreated}`);
console.log(`  skipped:   ${totalSkipped}`);
console.log(`  failed:    ${totalFailed}`);
console.log(`  cursor:    ${cursor ?? "(end)"}`);
console.log(`  logs:      data/shiphero-korona-import-*.txt`);

if (totalFailed > 0) process.exit(1);

/**
 * Build ShipHero barcode → SKU index for linking Korona productCode to web SKUs.
 * Usage: npm run index:shiphero-barcodes [-- --pages 200]
 */
import "dotenv/config";
import { ShipHeroClient } from "../clients/shiphero.js";
import {
  countShipheroBarcodeIndex,
  getCursor,
  initDatabase,
  logSync,
  setCursor,
  upsertShipheroBarcodeIndex,
} from "../db.js";

const CURSOR_KEY = "shiphero_barcode_index_cursor";
const pagesArg = Number(process.argv.find((a) => a.startsWith("--pages="))?.split("=")[1] ?? "100");
const pageSize = 50;

await initDatabase();

const shiphero = new ShipHeroClient();
const after = (await getCursor(CURSOR_KEY)) || null;
let cursor = after;
let pages = 0;
let indexed = 0;
let hasNext = true;

while (hasNext && pages < pagesArg) {
  const page = await shiphero.listProductsPage(pageSize, cursor);
  const batch = page.products
    .filter((p) => p.barcode?.trim() && p.sku?.trim())
    .map((p) => ({
      barcode: p.barcode!.trim(),
      shipheroSku: p.sku.trim(),
      onHand: p.onHand ?? 0,
    }));

  if (batch.length) {
    indexed += await upsertShipheroBarcodeIndex(batch);
  }

  hasNext = page.pageInfo.hasNextPage;
  cursor = page.pageInfo.endCursor;
  pages++;
  if (pages % 10 === 0 || pages === 1 || !hasNext || pages >= pagesArg) {
    console.log(`[index] page ${pages}/${pagesArg} batch=${batch.length} total_index~${await countShipheroBarcodeIndex()}`);
  }
  if (cursor) await setCursor(CURSOR_KEY, cursor);
  if (!hasNext) await setCursor(CURSOR_KEY, "");
}

const total = await countShipheroBarcodeIndex();
await logSync(
  "products",
  "info",
  `Barcode index: pages=${pages} new_rows=${indexed} total_index=${total} cursor=${cursor ?? "done"}`
);
console.log({ pages, indexed, total, hasNext, cursor });

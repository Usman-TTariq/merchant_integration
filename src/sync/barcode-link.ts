import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";
import {
  countKoronaBarcodesCache,
  countShipheroBarcodeIndex,
  getCursor,
  loadKoronaBarcodesMap,
  loadShipheroBarcodeIndexByBarcode,
  listProductMappingsForRelink,
  logSync,
  setCursor,
  upsertKoronaBarcodes,
  upsertProductMapping,
  upsertShipheroBarcodeIndex,
} from "../db.js";
import { koronaProductCodes } from "../utils/korona-codes.js";
import { resolveShipheroSkuFromPreloadedIndex } from "../utils/resolve-shiphero-product.js";
import { sanitizeSku } from "../utils/sku.js";

const KORONA_CURSOR = "korona_barcode_cache_page";
const SHIPHERO_CURSOR = "shiphero_barcode_index_cursor";
const SHIPHERO_CATALOG_PAGE_COUNT = "shiphero_catalog_page_count";
const SHIPHERO_CATALOG_ESTIMATE = "shiphero_catalog_estimated_products";

export type BarcodeLinkOptions = {
  koronaPages?: number;
  koronaPageSize?: number;
  shipheroPages?: number;
  shipheroPageSize?: number;
  koronaConcurrency?: number;
};

async function mapPool<T, R>(items: T[], concurrency: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return out;
}

/** Cache Korona product barcodes for one or more list pages (resume-safe). */
export async function cacheKoronaBarcodesChunk(opts: BarcodeLinkOptions = {}): Promise<{
  processed: number;
  cached: number;
  total: number;
  page: number;
  done: boolean;
}> {
  const pageSize = opts.koronaPageSize ?? 100;
  const maxPages = opts.koronaPages ?? 5;
  const concurrency = opts.koronaConcurrency ?? 8;
  const korona = new KoronaClient();

  let page = Number((await getCursor(KORONA_CURSOR)) ?? "1");
  if (!Number.isFinite(page) || page < 1) page = 1;

  let processed = 0;
  let cached = 0;
  let pagesRun = 0;
  let done = false;

  while (pagesRun < maxPages) {
    const list = await korona.getProducts({ page, size: pageSize });
    const batch = (list.results ?? []).filter((p) => !p.deleted);
    if (!batch.length) {
      done = true;
      break;
    }

    const entries = await mapPool(batch, concurrency, async (product) => {
      processed++;
      try {
        const full = await korona.getProduct(product.id);
        const barcodes = koronaProductCodes(full);
        if (!barcodes.length) return null;
        return { koronaProductId: product.id, barcodes };
      } catch {
        return null;
      }
    });

    const rows = entries.filter((e): e is { koronaProductId: string; barcodes: string[] } => Boolean(e));
    if (rows.length) cached += await upsertKoronaBarcodes(rows);

    await setCursor(KORONA_CURSOR, String(page));
    pagesRun++;

    if (page >= (list.pagesTotal ?? page)) {
      done = true;
      break;
    }
    page++;
  }

  await logSync("products", "info", `Korona barcode cache page=${page} cached=${cached} processed=${processed} done=${done}`);
  return { processed, cached, total: await countKoronaBarcodesCache(), page, done };
}

/** Index ShipHero barcode → SKU rows (resume-safe). */
export async function indexShipheroBarcodesChunk(opts: BarcodeLinkOptions = {}): Promise<{
  pages: number;
  indexed: number;
  total: number;
  hasNext: boolean;
  cursor: string | null;
}> {
  const pagesArg = opts.shipheroPages ?? 50;
  const pageSize = opts.shipheroPageSize ?? 50;
  const shiphero = new ShipHeroClient();

  let cursor = (await getCursor(SHIPHERO_CURSOR)) || null;
  let apiPage = Number((await getCursor(SHIPHERO_CATALOG_PAGE_COUNT)) || "0");
  if (!cursor) apiPage = 0;
  let pages = 0;
  let indexed = 0;
  let hasNext = true;

  while (hasNext && pages < pagesArg) {
    const page = await shiphero.listProductsPage(pageSize, cursor);
    apiPage++;
    const batch = page.products
      .filter((p) => p.barcode?.trim() && p.sku?.trim())
      .map((p) => ({
        barcode: p.barcode!.trim(),
        shipheroSku: p.sku.trim(),
        onHand: p.onHand ?? 0,
      }));

    if (batch.length) indexed += await upsertShipheroBarcodeIndex(batch);

    hasNext = page.pageInfo.hasNextPage;
    cursor = page.pageInfo.endCursor;
    pages++;
    if (cursor) await setCursor(SHIPHERO_CURSOR, cursor);
    if (!hasNext) {
      await setCursor(SHIPHERO_CURSOR, "");
      const estimated = Math.max(0, (apiPage - 1) * pageSize + page.products.length);
      await setCursor(SHIPHERO_CATALOG_ESTIMATE, String(estimated));
      await setCursor(SHIPHERO_CATALOG_PAGE_COUNT, "0");
    } else {
      await setCursor(SHIPHERO_CATALOG_PAGE_COUNT, String(apiPage));
    }
  }

  const total = await countShipheroBarcodeIndex();
  await logSync(
    "products",
    "info",
    `Barcode index: pages=${pages} new_rows=${indexed} total_index=${total} hasNext=${hasNext}`
  );
  return { pages, indexed, total, hasNext, cursor };
}

/** Re-link product mappings via local barcode index; stocked SKUs first. */
export async function relinkProductMappingsChunk(): Promise<{
  scanned: number;
  relinked: number;
  unchanged: number;
}> {
  const mappings = await listProductMappingsForRelink();
  const koronaByProduct = await loadKoronaBarcodesMap();
  const indexByBarcode = await loadShipheroBarcodeIndexByBarcode();
  await logSync(
    "products",
    "info",
    `Relink start: mappings=${mappings.length} korona_cache=${koronaByProduct.size} barcode_index=${indexByBarcode.size}`
  );
  let scanned = 0;
  let relinked = 0;
  let unchanged = 0;

  type Pending = {
    koronaProductId: string;
    koronaProductNumber: string | null;
    prevSku: string;
    nextSku: string;
    matchedBy: string;
    onHand: number;
  };
  const pending: Pending[] = [];

  for (const mapping of mappings) {
    scanned++;
    const barcodes = koronaByProduct.get(mapping.koronaProductId) ?? [];
    if (!barcodes.length) {
      unchanged++;
      continue;
    }

    const createSku = sanitizeSku(mapping.koronaProductNumber ?? mapping.koronaProductId);
    const resolved = resolveShipheroSkuFromPreloadedIndex(barcodes, createSku, indexByBarcode);
    if (!resolved || mapping.shipheroSku === resolved.shipheroSku) {
      unchanged++;
      continue;
    }

    const fromDuplicate = mapping.shipheroSku === createSku;
    if (!fromDuplicate && resolved.onHand <= 0) {
      unchanged++;
      continue;
    }

    pending.push({
      koronaProductId: mapping.koronaProductId,
      koronaProductNumber: mapping.koronaProductNumber,
      prevSku: mapping.shipheroSku,
      nextSku: resolved.shipheroSku,
      matchedBy: resolved.matchedBy,
      onHand: resolved.onHand,
    });
  }

  pending.sort((a, b) => b.onHand - a.onHand || a.prevSku.localeCompare(b.prevSku));

  for (const item of pending) {
    await upsertProductMapping({
      koronaProductId: item.koronaProductId,
      koronaProductNumber: item.koronaProductNumber,
      shipheroSku: item.nextSku,
      koronaRevision: null,
    });
    relinked++;
    await logSync(
      "products",
      "info",
      `Relink ${sanitizeSku(item.koronaProductNumber ?? item.koronaProductId)}: ${item.prevSku} → ${item.nextSku} (${item.matchedBy} on_hand=${item.onHand})`
    );
  }

  await logSync("products", "info", `Relink done: scanned=${scanned} relinked=${relinked} unchanged=${unchanged}`);
  return { scanned, relinked, unchanged };
}

/** Run cache + index + link in one pass (chunked for cron). */
export async function runBarcodeLinkPipeline(opts: BarcodeLinkOptions = {}): Promise<Record<string, unknown>> {
  const cache = await cacheKoronaBarcodesChunk(opts);
  const index = await indexShipheroBarcodesChunk(opts);
  const link = await relinkProductMappingsChunk();
  return { cache, index, link };
}

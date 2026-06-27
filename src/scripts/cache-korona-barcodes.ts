/**
 * Cache Korona product barcodes (productCode) for fast ShipHero linking.
 * Usage: npm run cache:korona-barcodes [-- --limit=5000]
 */
import "dotenv/config";
import { KoronaClient } from "../clients/korona.js";
import {
  countKoronaBarcodesCache,
  getCursor,
  initDatabase,
  logSync,
  setCursor,
  upsertKoronaBarcodes,
} from "../db.js";
import { koronaProductCodes } from "../utils/korona-codes.js";

const CURSOR_KEY = "korona_barcode_cache_page";
const limitArg = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "0");
const concurrency = 8;

await initDatabase();

const korona = new KoronaClient();
let page = Number((await getCursor(CURSOR_KEY)) ?? "1");
if (!Number.isFinite(page) || page < 1) page = 1;

let processed = 0;
let cached = 0;

async function mapPool<T, R>(items: T[], fn: (item: T) => Promise<R>): Promise<R[]> {
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

while (true) {
  const list = await korona.getProducts({ page, size: 100 });
  const batch = (list.results ?? []).filter((p) => !p.deleted);
  if (!batch.length) break;

  const entries = await mapPool(batch, async (product) => {
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

  await setCursor(CURSOR_KEY, String(page));
  await logSync("products", "info", `Korona barcode cache page=${page} cached=${cached} processed=${processed}`);

  if (limitArg > 0 && processed >= limitArg) break;
  if (page >= (list.pagesTotal ?? page)) break;
  page++;
}

console.log({ processed, cached, total: await countKoronaBarcodesCache(), nextPage: page });

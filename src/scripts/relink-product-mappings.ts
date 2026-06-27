/**
 * Re-link Korona products to existing ShipHero SKUs via barcode index.
 * Stocked SKUs (on_hand > 0) are processed first.
 * Usage: npm run link:products [-- --limit=500] [-- --stocked-only] [-- --api]
 */
import "dotenv/config";
import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";
import {
  findShipheroSku,
  getKoronaBarcodes,
  getShipheroOnHandForSku,
  initDatabase,
  listProductMappingsForRelink,
  logSync,
  upsertProductMapping,
} from "../db.js";
import { loadKoronaBarcodes } from "../utils/load-korona-barcodes.js";
import {
  resolveShipheroProduct,
  resolveShipheroSkuFromBarcodeIndex,
} from "../utils/resolve-shiphero-product.js";
import { sanitizeSku } from "../utils/sku.js";

const limitArg = Number(process.argv.find((a) => a.startsWith("--limit="))?.split("=")[1] ?? "0");
const useApi = process.argv.includes("--api");
const stockedOnly = process.argv.includes("--stocked-only");

await initDatabase();

let scanned = 0;
let relinked = 0;
let unchanged = 0;

type PendingRelink = {
  koronaProductId: string;
  koronaProductNumber: string | null;
  prevSku: string;
  nextSku: string;
  matchedBy: string;
  onHand: number;
};

async function applyRelink(item: PendingRelink): Promise<void> {
  if (item.prevSku === item.nextSku) {
    unchanged++;
    return;
  }
  await upsertProductMapping({
    koronaProductId: item.koronaProductId,
    koronaProductNumber: item.koronaProductNumber,
    shipheroSku: item.nextSku,
    koronaRevision: null,
  });
  relinked++;
  const label = sanitizeSku(item.koronaProductNumber ?? item.koronaProductId);
  await logSync(
    "products",
    "info",
    `Relink ${label}: ${item.prevSku} → ${item.nextSku} (${item.matchedBy} on_hand=${item.onHand})`
  );
  if (relinked % 100 === 0) {
    console.log(`[link] relinked=${relinked} scanned=${scanned} last_on_hand=${item.onHand}`);
  }
}

if (!useApi) {
  console.log(
    "[link] Fast local relink — stocked SKUs first (use --stocked-only to skip zero-stock matches)"
  );
  const mappings = await listProductMappingsForRelink();
  const pending: PendingRelink[] = [];

  for (const mapping of mappings) {
    scanned++;
    if (limitArg > 0 && scanned > limitArg) break;

    const barcodes = await getKoronaBarcodes(mapping.koronaProductId);
    if (!barcodes.length) {
      unchanged++;
      continue;
    }

    const createSku = sanitizeSku(mapping.koronaProductNumber ?? mapping.koronaProductId);
    const resolved = await resolveShipheroSkuFromBarcodeIndex(barcodes, createSku);
    if (!resolved) {
      unchanged++;
      continue;
    }
    if (stockedOnly && resolved.onHand <= 0) {
      unchanged++;
      continue;
    }

    const prevOnHand = await getShipheroOnHandForSku(mapping.shipheroSku);
    if (mapping.shipheroSku === resolved.shipheroSku) {
      unchanged++;
      continue;
    }

    const fromDuplicate = mapping.shipheroSku === createSku;
    const upgradeStock = resolved.onHand > prevOnHand;
    if (!fromDuplicate && !upgradeStock && resolved.onHand <= 0) {
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
  console.log(`[link] ${pending.length} candidate relinks (${pending.filter((p) => p.onHand > 0).length} with on_hand > 0)`);

  for (const item of pending) {
    await applyRelink(item);
  }
} else {
  console.log("[link] Slow API relink (Korona list + ShipHero getProductBySku per candidate)");
  const korona = new KoronaClient();
  const shiphero = new ShipHeroClient();

  for await (const batch of korona.paginate((page) => korona.getProducts({ page }))) {
    for (const product of batch) {
      if (product.deleted) continue;
      scanned++;
      if (limitArg > 0 && scanned > limitArg) break;

      const barcodes = await loadKoronaBarcodes(korona, product);
      const resolved = await resolveShipheroProduct(shiphero, product, barcodes);
      if (!resolved.existing) {
        unchanged++;
        continue;
      }
      if (stockedOnly && shiphero.getWarehouseOnHand(resolved.existing) <= 0) {
        unchanged++;
        continue;
      }

      const prev =
        (await findShipheroSku(product.id, product.number ?? undefined)) ??
        sanitizeSku(product.number ?? product.id);
      await applyRelink({
        koronaProductId: product.id,
        koronaProductNumber: product.number ?? null,
        prevSku: prev,
        nextSku: resolved.shipheroSku,
        matchedBy: resolved.matchedBy ?? "api",
        onHand: shiphero.getWarehouseOnHand(resolved.existing),
      });
    }
    if (limitArg > 0 && scanned > limitArg) break;
  }
}

console.log({ scanned, relinked, unchanged });
await logSync("products", "info", `Relink done: scanned=${scanned} relinked=${relinked} unchanged=${unchanged}`);

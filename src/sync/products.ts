import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";
import { config } from "../config.js";
import { getCursor, logSync, setCursor, upsertProductMapping } from "../db.js";
import { loadKoronaBarcodes } from "../utils/load-korona-barcodes.js";
import { koronaProductCodes, primaryKoronaCode } from "../utils/korona-codes.js";
import { resolveShipheroProduct } from "../utils/resolve-shiphero-product.js";
import { sanitizeSku } from "../utils/sku.js";
import { resolveKoronaStockQuantity } from "../utils/korona-product-stock.js";
import type { KoronaProduct } from "../types/korona.js";
import { syncProductStock } from "./stock.js";

const CURSOR_KEY = "products_revision";

function productPrice(product: KoronaProduct): string {
  const price = product.prices?.[0]?.value;
  return price != null ? String(price) : "0.00";
}

async function koronaOnHand(korona: KoronaClient, productId: string): Promise<number> {
  const resolved = await resolveKoronaStockQuantity(korona, productId);
  return resolved.status === "ok" ? resolved.qty : 0;
}

async function loadKoronaProductDetails(
  korona: KoronaClient,
  product: KoronaProduct
): Promise<{ product: KoronaProduct; barcodes: string[] }> {
  const barcodes = await loadKoronaBarcodes(korona, product);
  if (barcodes.length > 0 || !config.sync.linkShipheroByBarcode) {
    return { product, barcodes };
  }
  const full = await korona.getProduct(product.id);
  return { product: full, barcodes: koronaProductCodes(full) };
}

export async function syncProducts(): Promise<{ created: number; updated: number; skipped: number; linked: number }> {
  const korona = new KoronaClient();
  const shiphero = new ShipHeroClient();

  const revisionCursor = await getCursor(CURSOR_KEY);
  const revision = revisionCursor ? Number(revisionCursor) : undefined;

  let created = 0;
  let updated = 0;
  let skipped = 0;
  let linked = 0;
  let maxRevision = revision ?? 0;

  for await (const batch of korona.paginate((page) => korona.getProducts({ revision, page }))) {
    for (const product of batch) {
      if (product.deleted) {
        skipped++;
        continue;
      }

      if (product.revision != null && product.revision > maxRevision) {
        maxRevision = product.revision;
      }

      const koronaNumber = product.number ? sanitizeSku(product.number) : null;

      try {
        const { product: full, barcodes } = await loadKoronaProductDetails(korona, product);
        const barcode = primaryKoronaCode(full) ?? barcodes[0];
        const resolved = await resolveShipheroProduct(shiphero, full, barcodes);
        const shipheroSku = resolved.shipheroSku;
        const name = full.name ?? shipheroSku;
        const onHand = config.sync.koronaStock ? await koronaOnHand(korona, product.id) : 0;

        if (!resolved.existing) {
          await shiphero.createProduct({
            name,
            sku: resolved.createSku,
            price: productPrice(full),
            barcode,
            onHand,
          });
          created++;
          await logSync("products", "info", `Created ShipHero product ${resolved.createSku} on_hand=${onHand}`);
        } else {
          await shiphero.updateProduct({ sku: shipheroSku, name, barcode });
          if (resolved.matchedBy && shipheroSku !== resolved.createSku) {
            linked++;
            await logSync(
              "products",
              "info",
              `Linked Korona ${koronaNumber ?? full.id} → ShipHero ${shipheroSku} (${resolved.matchedBy})`
            );
          }
          if (config.sync.koronaStock) {
            await syncProductStock(korona, shiphero, product.id, shipheroSku, "Korona product sync", "products");
          }
          updated++;
        }

        await upsertProductMapping({
          koronaProductId: product.id,
          koronaProductNumber: product.number ?? null,
          shipheroSku,
          koronaRevision: product.revision ?? null,
        });
      } catch (err) {
        skipped++;
        await logSync(
          "products",
          "error",
          `Failed ${koronaNumber ?? product.id}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  if (maxRevision > (revision ?? 0)) {
    await setCursor(CURSOR_KEY, String(maxRevision));
  }

  await logSync("products", "info", `Done: created=${created} updated=${updated} linked=${linked} skipped=${skipped}`);
  return { created, updated, skipped, linked };
}

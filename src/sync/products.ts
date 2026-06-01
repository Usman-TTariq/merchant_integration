import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";
import { getCursor, logSync, setCursor, upsertProductMapping } from "../db.js";
import { koronaSku, sanitizeSku } from "../utils/sku.js";
import type { KoronaProduct } from "../types/korona.js";

const CURSOR_KEY = "products_revision";

function productPrice(product: KoronaProduct): string {
  const price = product.prices?.[0]?.value;
  return price != null ? String(price) : "0.00";
}

function primaryBarcode(product: KoronaProduct): string | undefined {
  return product.codes?.find((c) => c.primary)?.code ?? product.codes?.[0]?.code;
}

export async function syncProducts(): Promise<{ created: number; updated: number; skipped: number }> {
  const korona = new KoronaClient();
  const shiphero = new ShipHeroClient();

  const revisionCursor = await getCursor(CURSOR_KEY);
  const revision = revisionCursor ? Number(revisionCursor) : undefined;

  let created = 0;
  let updated = 0;
  let skipped = 0;
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

      const sku = sanitizeSku(koronaSku(product));
      const name = product.name ?? sku;
      const barcode = primaryBarcode(product);

      try {
        const existing = await shiphero.getProductBySku(sku);
        if (!existing) {
          await shiphero.createProduct({
            name,
            sku,
            price: productPrice(product),
            barcode,
            onHand: 0,
          });
          created++;
          await logSync("products", "info", `Created ShipHero product ${sku}`);
        } else {
          await shiphero.updateProduct({ sku, name, barcode });
          updated++;
        }

        await upsertProductMapping({
          koronaProductId: product.id,
          koronaProductNumber: product.number ?? null,
          shipheroSku: sku,
          koronaRevision: product.revision ?? null,
        });
      } catch (err) {
        skipped++;
        await logSync("products", "error", `Failed ${sku}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (maxRevision > (revision ?? 0)) {
    await setCursor(CURSOR_KEY, String(maxRevision));
  }

  await logSync("products", "info", `Done: created=${created} updated=${updated} skipped=${skipped}`);
  return { created, updated, skipped };
}

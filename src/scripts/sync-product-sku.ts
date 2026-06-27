import "dotenv/config";
import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";
import { initDatabase, upsertProductMapping } from "../db.js";
import { koronaSku, sanitizeSku } from "../utils/sku.js";
import { koronaProductCodes, primaryKoronaCode } from "../utils/korona-codes.js";
import { resolveShipheroProduct } from "../utils/resolve-shiphero-product.js";

const target = process.argv[2];
if (!target) {
  console.error("Usage: npx tsx src/scripts/sync-product-sku.ts <SKU-or-Korona-product-id>");
  process.exit(1);
}

await initDatabase();

const korona = new KoronaClient();
const shiphero = new ShipHeroClient();

const isUuid = /^[0-9a-f-]{36}$/i.test(target);

async function syncProduct(product: Awaited<ReturnType<KoronaClient["getProduct"]>>) {
  const full = koronaProductCodes(product).length ? product : await korona.getProduct(product.id);
  const barcodes = koronaProductCodes(full);
  const resolved = await resolveShipheroProduct(shiphero, full, barcodes);
  const shipheroSku = resolved.shipheroSku;
  const price = full.prices?.[0]?.value;
  const barcode = primaryKoronaCode(full);

  if (!resolved.existing) {
    await shiphero.createProduct({
      name: full.name ?? resolved.createSku,
      sku: resolved.createSku,
      price: price != null ? String(price) : "0.00",
      barcode,
      onHand: 0,
    });
    console.log("Created ShipHero product", resolved.createSku);
  } else {
    await shiphero.updateProduct({ sku: shipheroSku, name: full.name ?? shipheroSku, barcode });
    console.log("Linked/updated ShipHero product", shipheroSku, resolved.matchedBy ?? "");
  }

  await upsertProductMapping({
    koronaProductId: full.id,
    koronaProductNumber: full.number ?? null,
    shipheroSku,
    koronaRevision: full.revision ?? null,
  });
  console.log("Mapped", full.number, "->", shipheroSku);
}

if (isUuid) {
  await syncProduct(await korona.getProduct(target));
} else {
  let found = false;
  for await (const batch of korona.paginate((page) => korona.getProducts({ page }))) {
    for (const product of batch) {
      const sku = sanitizeSku(koronaSku(product));
      if (sku !== target && product.number !== target) continue;
      found = true;
      await syncProduct(product);
      break;
    }
    if (found) break;
  }

  if (!found) {
    console.error("Product not found in Korona:", target);
    process.exit(1);
  }
}

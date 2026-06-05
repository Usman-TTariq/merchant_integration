import "dotenv/config";
import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";
import { initDatabase, upsertProductMapping } from "../db.js";
import { koronaSku, sanitizeSku } from "../utils/sku.js";

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
  const sku = sanitizeSku(koronaSku(product));
  const price = product.prices?.[0]?.value;
  const barcode = product.codes?.find((c) => c.primary)?.code ?? product.codes?.[0]?.code;
  const existing = await shiphero.getProductBySku(sku);

  if (!existing) {
    await shiphero.createProduct({
      name: product.name ?? sku,
      sku,
      price: price != null ? String(price) : "0.00",
      barcode,
      onHand: 0,
    });
    console.log("Created ShipHero product", sku);
  } else {
    await shiphero.updateProduct({ sku, name: product.name ?? sku, barcode });
    console.log("Updated ShipHero product", sku);
  }

  await upsertProductMapping({
    koronaProductId: product.id,
    koronaProductNumber: product.number ?? null,
    shipheroSku: sku,
    koronaRevision: product.revision ?? null,
  });
  console.log("Mapped", product.number, "->", sku);
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

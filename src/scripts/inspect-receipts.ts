import "dotenv/config";
import { KoronaClient } from "../clients/korona.js";
import { getDb } from "../db.js";

const korona = new KoronaClient();
const db = getDb();

const skuByProductId = db.prepare(
  "SELECT shiphero_sku FROM product_mappings WHERE korona_product_id = ?"
);
const skuByProductNumber = db.prepare(
  "SELECT shiphero_sku FROM product_mappings WHERE korona_product_number = ?"
);

console.log("=== Korona Receipts Inspection ===\n");

for await (const batch of korona.paginate((page) => korona.getReceipts({ page }))) {
  for (const receipt of batch) {
    let full = receipt;
    if (!receipt.sales?.length) {
      try {
        full = await korona.getReceipt(receipt.id);
      } catch (err) {
        console.log(`Receipt ${receipt.id}: fetch failed`, err instanceof Error ? err.message : err);
        continue;
      }
    }

    const sales = full.sales ?? [];
    console.log(`Receipt ${full.number ?? full.id} (revision ${full.revision ?? "?"})`);
    console.log(`  Sales lines: ${sales.length}`);

    if (!sales.length) {
      console.log("  -> No sale lines (nothing to sync)\n");
      continue;
    }

    for (const line of sales) {
      const qty = Math.abs(line.quantity ?? 0);
      const productId = line.product?.id;
      const productNumber = line.product?.number ?? line.recognitionCode;
      const mapped =
        (productId ? (skuByProductId.get(productId) as { shiphero_sku: string } | undefined) : undefined) ??
        (productNumber
          ? (skuByProductNumber.get(productNumber) as { shiphero_sku: string } | undefined)
          : undefined);

      console.log(
        `  - qty=${qty} product=${productNumber ?? productId ?? "?"} mapped_sku=${mapped?.shiphero_sku ?? "NO"}`
      );
    }
    console.log("");
  }
}

import { KoronaClient } from "../clients/korona.js";
import { findShipheroSku, initDatabase } from "../db.js";

await initDatabase();

const korona = new KoronaClient();

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
      const mappedSku = await findShipheroSku(productId, productNumber);

      console.log(
        `  - qty=${qty} product=${productNumber ?? productId ?? "?"} mapped_sku=${mappedSku ?? "NO"}`
      );
    }
    console.log("");
  }
}

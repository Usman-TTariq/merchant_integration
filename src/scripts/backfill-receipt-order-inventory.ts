import "dotenv/config";
import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";
import { findShipheroSku, initDatabase, logSync, queryOrderMappings } from "../db.js";
import { removeInventoryForReceiptLines } from "../sync/receipt-inventory.js";
import { receiptHasSaleLines, receiptSaleLines } from "../utils/korona-receipt.js";
import { sanitizeSku } from "../utils/sku.js";

const force = process.argv.includes("--force");

await initDatabase();

const korona = new KoronaClient();
const shiphero = new ShipHeroClient();
const { rows } = await queryOrderMappings({ page: 1, limit: 500 });
const receiptOrders = rows.filter((r) => r.korona_order_type === "receipt");

console.log(`Receipt order mappings: ${receiptOrders.length} (force=${force})`);

let adjusted = 0;

for (const mapping of receiptOrders) {
  const receiptId = mapping.korona_order_id as string;
  let receipt;
  try {
    receipt = await korona.getReceipt(receiptId);
  } catch (err) {
    console.error(`Skip ${receiptId}:`, err instanceof Error ? err.message : err);
    continue;
  }

  if (!receiptHasSaleLines(receipt)) {
    console.log(`Skip receipt ${receipt.number ?? receiptId}: no sale lines`);
    continue;
  }

  const receiptNumber = receipt.number ?? receiptId;
  const lines: Array<{ sku: string; quantity: number }> = [];

  for (const line of receiptSaleLines(receipt)) {
    const qty = Math.abs(line.quantity ?? 0);
    if (qty <= 0) continue;

    const productId = line.product?.id;
    const productNumber = line.product?.number ?? line.recognitionCode;
    const mappedSku = await findShipheroSku(productId, productNumber);
    const sku = mappedSku ?? (productNumber ? sanitizeSku(productNumber) : null);
    if (!sku) continue;

    const product = await shiphero.getProductBySku(sku);
    if (!product) {
      console.log(`Skip ${sku} on receipt ${receiptNumber}: not in ShipHero`);
      continue;
    }

    lines.push({ sku, quantity: Math.round(qty) });
  }

  if (!lines.length) {
    console.log(`Skip receipt ${receiptNumber}: no valid ShipHero lines`);
    continue;
  }

  const bySku = new Map<string, { sku: string; quantity: number }>();
  for (const line of lines) {
    const existing = bySku.get(line.sku);
    if (existing) existing.quantity += line.quantity;
    else bySku.set(line.sku, { ...line });
  }

  const count = await removeInventoryForReceiptLines(
    shiphero,
    [...bySku.values()],
    String(receiptNumber)
  );
  adjusted += count;
  console.log(`Receipt ${receiptNumber}: ${count} inventory adjustment(s)`);
}

await logSync("orders", "info", `Backfill receipt order inventory: adjustments=${adjusted} force=${force}`);
console.log(`Done. Total inventory adjustments: ${adjusted}`);

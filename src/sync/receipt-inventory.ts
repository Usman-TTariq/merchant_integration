import { ShipHeroClient } from "../clients/shiphero.js";
import { logSync } from "../db.js";

export type ReceiptInventoryLine = { sku: string; quantity: number };

export async function removeInventoryForReceiptLines(
  shiphero: ShipHeroClient,
  lineItems: ReceiptInventoryLine[],
  receiptNumber: string,
  job: "orders" | "inventory" = "orders"
): Promise<number> {
  let adjustments = 0;

  for (const line of lineItems) {
    const product = await shiphero.getProductBySku(line.sku);
    if (!product) {
      await logSync(job, "warn", `SKU ${line.sku} not in ShipHero, skipping inventory_remove for receipt ${receiptNumber}`);
      continue;
    }

    try {
      await shiphero.inventoryRemove(
        line.sku,
        line.quantity,
        `Korona receipt ${receiptNumber}`
      );
      adjustments++;
      await logSync(
        job,
        "info",
        `inventory_remove ${line.sku} x${line.quantity} for receipt ${receiptNumber}`
      );
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const level = msg.includes("not found") || msg.includes("Not Found") ? "warn" : "error";
      await logSync(job, level, `inventory_remove ${line.sku}: ${msg}`);
    }
  }

  return adjustments;
}

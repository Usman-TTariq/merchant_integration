import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";
import { config } from "../config.js";
import {
  countOrderMappings,
  findKoronaOrderIdByShiphero,
  findKoronaProductIdBySku,
  findShipheroSku,
  getCursor,
  isReceiptProcessed,
  logSync,
  markReceiptProcessed,
  setCursor,
} from "../db.js";
import { receiptHasSaleLines, receiptSaleLines } from "../utils/korona-receipt.js";
import { sanitizeSku } from "../utils/sku.js";
import type { KoronaReceipt, KoronaSaleLine } from "../types/korona.js";

const RECEIPT_CURSOR = "receipts_revision";
const SHIPHERO_ORDERS_CURSOR = "shiphero_orders_updated_at";

function saleQuantity(line: KoronaSaleLine): number {
  const q = line.quantity ?? 0;
  return Math.abs(q);
}

function resolveProductId(line: KoronaSaleLine): string | null {
  return line.product?.id ?? null;
}

export async function syncInventoryFromKorona(): Promise<{ receipts: number; adjustments: number }> {
  const korona = new KoronaClient();
  const shiphero = new ShipHeroClient();

  const revision = await getCursor(RECEIPT_CURSOR);
  const revisionNum = revision ? Number(revision) : undefined;

  let receipts = 0;
  let adjustments = 0;
  let maxRevision = revisionNum ?? 0;

  for await (const batch of korona.paginate((page) => korona.getReceipts({ revision: revisionNum, page }))) {
    for (const receipt of batch) {
      if (receipt.revision != null && receipt.revision > maxRevision) {
        maxRevision = receipt.revision;
      }

      if (await isReceiptProcessed(receipt.id)) continue;

      let full: KoronaReceipt = receipt;
      if (!receiptHasSaleLines(receipt)) {
        try {
          full = await korona.getReceipt(receipt.id);
        } catch {
          continue;
        }
      }

      for (const line of receiptSaleLines(full)) {
        const qty = saleQuantity(line);
        if (qty <= 0) continue;

        const productId = resolveProductId(line);
        const productNumber = line.product?.number ?? line.recognitionCode;
        let sku = await findShipheroSku(productId ?? undefined, productNumber);
        if (!sku && productNumber) sku = sanitizeSku(productNumber);
        if (!sku) {
          await logSync("inventory", "warn", `No SKU mapping for receipt ${receipt.number ?? receipt.id}`);
          continue;
        }

        try {
          await shiphero.inventoryRemove(
            sku,
            qty,
            `Korona receipt ${receipt.number ?? receipt.id}`
          );
          adjustments++;
        } catch (err) {
          await logSync(
            "inventory",
            "error",
            `inventory_remove ${sku}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      await markReceiptProcessed(receipt.id);
      receipts++;
    }
  }

  if (maxRevision > (revisionNum ?? 0)) {
    await setCursor(RECEIPT_CURSOR, String(maxRevision));
  }

  await logSync("inventory", "info", `Korona→ShipHero: receipts=${receipts} adjustments=${adjustments}`);
  return { receipts, adjustments };
}

export async function syncInventoryToKorona(): Promise<{ orders: number; adjustments: number }> {
  const korona = new KoronaClient();
  const shiphero = new ShipHeroClient();

  if (!config.korona.inventoryId || !config.korona.inventoryListId) {
    await logSync(
      "inventory",
      "warn",
      "Skipping ShipHero→Korona: set KORONA_INVENTORY_ID and KORONA_INVENTORY_LIST_ID"
    );
    return { orders: 0, adjustments: 0 };
  }

  const mappedOrders = await countOrderMappings();
  if (mappedOrders === 0) {
    await logSync("inventory", "info", "ShipHero→Korona: skipped (no order mappings yet)");
    return { orders: 0, adjustments: 0 };
  }

  const updatedFrom = (await getCursor(SHIPHERO_ORDERS_CURSOR)) ?? config.sync.shipheroOrdersUpdatedFrom;
  const orders = await shiphero.getFulfilledOrders(updatedFrom);

  let adjustments = 0;
  let latestUpdated = updatedFrom ?? "";

  for (const order of orders) {
    if (order.updated_at && order.updated_at > latestUpdated) {
      latestUpdated = order.updated_at;
    }

    const koronaOrderId = await findKoronaOrderIdByShiphero(order.id);
    if (!koronaOrderId) continue;

    const items: Array<{ product: { id: string }; quantity: { value: number } }> = [];

    for (const edge of order.line_items?.edges ?? []) {
      const line = edge.node;
      if (!line?.sku) continue;
      const shipped = line.quantity_shipped ?? line.quantity ?? 0;
      if (shipped <= 0) continue;

      const koronaProductId = await findKoronaProductIdBySku(line.sku);
      if (!koronaProductId) {
        await logSync("inventory", "warn", `No Korona product for SKU ${line.sku}`);
        continue;
      }

      items.push({
        product: { id: koronaProductId },
        quantity: { value: shipped },
      });
      adjustments++;
    }

    if (items.length) {
      try {
        await korona.updateInventoryListItems(
          config.korona.inventoryId,
          config.korona.inventoryListId,
          items
        );
        await logSync("inventory", "info", `Updated Korona inventory for ShipHero order ${order.order_number}`);
      } catch (err) {
        await logSync(
          "inventory",
          "error",
          `Korona inventory update: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  if (latestUpdated) {
    await setCursor(SHIPHERO_ORDERS_CURSOR, latestUpdated);
  }

  await logSync("inventory", "info", `ShipHero→Korona: orders=${orders.length} line adjustments=${adjustments}`);
  return { orders: orders.length, adjustments };
}

export async function syncInventory(): Promise<void> {
  await syncInventoryFromKorona();
  await syncInventoryToKorona();
}

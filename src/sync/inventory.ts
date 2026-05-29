import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";
import { config } from "../config.js";
import { getDb, getCursor, logSync, setCursor } from "../db.js";
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
  const db = getDb();

  const revision = getCursor(RECEIPT_CURSOR);
  const revisionNum = revision ? Number(revision) : undefined;

  const isProcessed = db.prepare("SELECT 1 FROM processed_receipts WHERE receipt_id = ?");
  const markProcessed = db.prepare("INSERT OR IGNORE INTO processed_receipts (receipt_id) VALUES (?)");
  const skuByProductId = db.prepare(
    "SELECT shiphero_sku FROM product_mappings WHERE korona_product_id = ?"
  );
  const skuByProductNumber = db.prepare(
    "SELECT shiphero_sku FROM product_mappings WHERE korona_product_number = ?"
  );

  let receipts = 0;
  let adjustments = 0;
  let maxRevision = revisionNum ?? 0;

  for await (const batch of korona.paginate((page) => korona.getReceipts({ revision: revisionNum, page }))) {
    for (const receipt of batch) {
      if (receipt.revision != null && receipt.revision > maxRevision) {
        maxRevision = receipt.revision;
      }

      if (isProcessed.get(receipt.id)) continue;

      let full: KoronaReceipt = receipt;
      if (!receipt.sales?.length) {
        try {
          full = await korona.getReceipt(receipt.id);
        } catch {
          continue;
        }
      }

      for (const line of full.sales ?? []) {
        const qty = saleQuantity(line);
        if (qty <= 0) continue;

        const productId = resolveProductId(line);
        const productNumber = line.product?.number ?? line.recognitionCode;
        const row = productId
          ? (skuByProductId.get(productId) as { shiphero_sku: string } | undefined) ??
            (productNumber
              ? (skuByProductNumber.get(productNumber) as { shiphero_sku: string } | undefined)
              : undefined)
          : productNumber
            ? (skuByProductNumber.get(productNumber) as { shiphero_sku: string } | undefined)
            : undefined;

        let sku = row?.shiphero_sku;
        if (!sku && productNumber) sku = sanitizeSku(productNumber);
        if (!sku) {
          logSync("inventory", "warn", `No SKU mapping for receipt ${receipt.number ?? receipt.id}`);
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
          logSync(
            "inventory",
            "error",
            `inventory_remove ${sku}: ${err instanceof Error ? err.message : String(err)}`
          );
        }
      }

      markProcessed.run(receipt.id);
      receipts++;
    }
  }

  if (maxRevision > (revisionNum ?? 0)) {
    setCursor(RECEIPT_CURSOR, String(maxRevision));
  }

  logSync("inventory", "info", `Korona→ShipHero: receipts=${receipts} adjustments=${adjustments}`);
  return { receipts, adjustments };
}

export async function syncInventoryToKorona(): Promise<{ orders: number; adjustments: number }> {
  const korona = new KoronaClient();
  const shiphero = new ShipHeroClient();
  const db = getDb();

  if (!config.korona.inventoryId || !config.korona.inventoryListId) {
    logSync(
      "inventory",
      "warn",
      "Skipping ShipHero→Korona: set KORONA_INVENTORY_ID and KORONA_INVENTORY_LIST_ID"
    );
    return { orders: 0, adjustments: 0 };
  }

  const mappedOrders = (db.prepare("SELECT COUNT(*) AS c FROM order_mappings").get() as { c: number }).c;
  if (mappedOrders === 0) {
    logSync("inventory", "info", "ShipHero→Korona: skipped (no order mappings yet)");
    return { orders: 0, adjustments: 0 };
  }

  const updatedFrom = getCursor(SHIPHERO_ORDERS_CURSOR) ?? config.sync.shipheroOrdersUpdatedFrom;
  const orders = await shiphero.getFulfilledOrders(updatedFrom);

  const mappingByShiphero = db.prepare(
    `SELECT korona_order_id FROM order_mappings WHERE shiphero_order_id = ?`
  );
  const productBySku = db.prepare(
    "SELECT korona_product_id FROM product_mappings WHERE shiphero_sku = ?"
  );

  let adjustments = 0;
  let latestUpdated = updatedFrom ?? "";

  for (const order of orders) {
    if (order.updated_at && order.updated_at > latestUpdated) {
      latestUpdated = order.updated_at;
    }

    const mapped = mappingByShiphero.get(order.id) as { korona_order_id: string } | undefined;
    if (!mapped) continue;

    const items: Array<{ product: { id: string }; quantity: { value: number } }> = [];

    for (const edge of order.line_items?.edges ?? []) {
      const line = edge.node;
      if (!line?.sku) continue;
      const shipped = line.quantity_shipped ?? line.quantity ?? 0;
      if (shipped <= 0) continue;

      const row = productBySku.get(line.sku) as { korona_product_id: string } | undefined;
      if (!row) {
        logSync("inventory", "warn", `No Korona product for SKU ${line.sku}`);
        continue;
      }

      items.push({
        product: { id: row.korona_product_id },
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
        logSync("inventory", "info", `Updated Korona inventory for ShipHero order ${order.order_number}`);
      } catch (err) {
        logSync(
          "inventory",
          "error",
          `Korona inventory update: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  if (latestUpdated) {
    setCursor(SHIPHERO_ORDERS_CURSOR, latestUpdated);
  }

  logSync("inventory", "info", `ShipHero→Korona: orders=${orders.length} line adjustments=${adjustments}`);
  return { orders: orders.length, adjustments };
}

export async function syncInventory(): Promise<void> {
  await syncInventoryFromKorona();
  await syncInventoryToKorona();
}

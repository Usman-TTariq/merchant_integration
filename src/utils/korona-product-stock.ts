import type { KoronaClient } from "../clients/korona.js";
import { config } from "../config.js";
import type { KoronaInventoryListItem } from "../types/korona.js";
import { koronaStockQuantity } from "./korona-stock.js";

export type KoronaStockSource = "warehouse" | "inventory_list";

export type KoronaStockResolveResult =
  | { status: "ok"; qty: number; source: KoronaStockSource; enabledTracking?: boolean }
  | { status: "untracked" }
  | { status: "no_rows" };

function inventoryListQuantity(item: KoronaInventoryListItem): number | null {
  const stock = item.stock;
  if (stock?.actual != null) return Math.round(stock.actual);
  if (stock?.nominal != null) return Math.round(stock.nominal);

  const qty = item.quantity;
  if (qty == null) return null;
  if (typeof qty === "number") return Math.round(qty);
  if (qty.actual != null) return Math.round(qty.actual);
  if (qty.value != null) return Math.round(qty.value);
  return null;
}

async function readInventoryListQuantity(
  korona: KoronaClient,
  productId: string
): Promise<number | null> {
  const inventoryId = config.korona.inventoryId;
  const inventoryListId = config.korona.inventoryListId;
  if (!inventoryId || !inventoryListId) return null;

  const item = await korona.getInventoryListItem(inventoryId, inventoryListId, productId);
  if (!item) return null;
  return inventoryListQuantity(item);
}

function warehouseQuantity(stocks: NonNullable<Awaited<ReturnType<KoronaClient["getProductStocksSafe"]>>>) {
  if (!stocks.length) return 0;
  const qty = koronaStockQuantity(stocks, config.korona.warehouseId);
  if (qty != null) return Math.max(0, qty);

  // Warehouse filter matched nothing — fall back to all warehouses.
  const all = koronaStockQuantity(stocks);
  return all != null ? Math.max(0, all) : null;
}

async function tryWarehouseQuantity(
  korona: KoronaClient,
  productId: string
): Promise<{ qty: number } | { untracked: true } | null> {
  const stocks = await korona.getProductStocksSafe(productId);
  if (stocks === null) return { untracked: true };
  const qty = warehouseQuantity(stocks);
  if (qty === null) return null;
  return { qty };
}

export type ResolveKoronaStockOptions = {
  /** When false, never PATCH trackInventory (e.g. dashboard reports). Default: config flag. */
  autoEnableTracking?: boolean;
};

async function enableStockTracking(
  korona: KoronaClient,
  productId: string,
  autoEnableTracking: boolean
): Promise<boolean> {
  if (!autoEnableTracking) return false;

  const product = await korona.getProduct(productId);
  if (product.trackInventory === true) return false;

  await korona.updateProduct(productId, { trackInventory: true });
  return true;
}

/** Resolve Korona on-hand for a product (warehouse stocks, inventory list, or auto-enable tracking). */
export async function resolveKoronaStockQuantity(
  korona: KoronaClient,
  productId: string,
  options?: ResolveKoronaStockOptions
): Promise<KoronaStockResolveResult> {
  const autoEnableTracking = options?.autoEnableTracking ?? config.korona.autoEnableStockTracking;
  let warehouse = await tryWarehouseQuantity(korona, productId);

  if (warehouse && "untracked" in warehouse) {
    const listQty = await readInventoryListQuantity(korona, productId);
    if (listQty != null) {
      return { status: "ok", qty: Math.max(0, listQty), source: "inventory_list" };
    }

    const enabledTracking = await enableStockTracking(korona, productId, autoEnableTracking);
    if (enabledTracking) {
      warehouse = await tryWarehouseQuantity(korona, productId);
      if (warehouse && "qty" in warehouse) {
        return { status: "ok", qty: warehouse.qty, source: "warehouse", enabledTracking: true };
      }
    }
  }

  if (!warehouse) return { status: "no_rows" };
  if ("untracked" in warehouse) return { status: "untracked" };
  return { status: "ok", qty: warehouse.qty, source: "warehouse" };
}

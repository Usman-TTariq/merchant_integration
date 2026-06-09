import type { KoronaProductStock } from "../types/korona.js";

function stockAmount(entry: KoronaProductStock): number {
  const amount = entry.amount;
  if (!amount) return 0;
  if (typeof amount === "number") return amount;
  if (amount.actual != null) return amount.actual;
  if (amount.value != null) return amount.value;
  return 0;
}

/** Sum Korona on-hand for optional warehouse filter. Returns null when no stock rows. */
export function koronaStockQuantity(
  stocks: KoronaProductStock[],
  warehouseId?: string
): number | null {
  if (!stocks.length) return null;

  const entries = warehouseId
    ? stocks.filter((s) => s.warehouse?.id === warehouseId)
    : stocks;
  if (!entries.length) return null;

  const total = entries.reduce((sum, entry) => sum + stockAmount(entry), 0);
  return Math.round(total);
}

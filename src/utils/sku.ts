import { config } from "../config.js";
import type { KoronaProduct } from "../types/korona.js";
import { koronaProductCodes, primaryKoronaCode } from "./korona-codes.js";

export function koronaSku(product: KoronaProduct): string {
  const field = config.sync.skuField;
  if (field === "id") return product.id;
  if (field === "code") {
    const primary = primaryKoronaCode(product);
    if (primary) return primary;
  }
  if (product.number) return product.number;
  return product.id;
}

export { koronaProductCodes, primaryKoronaCode };

export function sanitizeSku(sku: string): string {
  return sku.trim().slice(0, 128);
}

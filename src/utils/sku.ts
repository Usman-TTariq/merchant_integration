import { config } from "../config.js";
import type { KoronaProduct } from "../types/korona.js";

export function koronaSku(product: KoronaProduct): string {
  const field = config.sync.skuField;
  if (field === "id") return product.id;
  if (field === "code") {
    const primary = product.codes?.find((c) => c.primary)?.code ?? product.codes?.[0]?.code;
    if (primary) return primary;
  }
  if (product.number) return product.number;
  return product.id;
}

export function sanitizeSku(sku: string): string {
  return sku.trim().slice(0, 128);
}

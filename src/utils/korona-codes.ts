import type { KoronaProduct } from "../types/korona.js";

type KoronaCodeRow = { code?: string; productCode?: string; primary?: boolean };

/** Korona API v3 uses `productCode` on detail; some payloads use `code`. */
export function koronaProductCodes(product: KoronaProduct): string[] {
  const rows = (product.codes ?? []) as KoronaCodeRow[];
  const out: string[] = [];
  for (const row of rows) {
    const value = (row.productCode ?? row.code ?? "").trim();
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

export function primaryKoronaCode(product: KoronaProduct): string | undefined {
  const rows = (product.codes ?? []) as KoronaCodeRow[];
  const primary = rows.find((c) => c.primary);
  const value = (primary?.productCode ?? primary?.code ?? rows[0]?.productCode ?? rows[0]?.code ?? "").trim();
  return value || undefined;
}

import type { KoronaProduct } from "../types/korona.js";
import { KoronaClient } from "../clients/korona.js";
import { getKoronaBarcodes } from "../db.js";
import { koronaProductCodes } from "./korona-codes.js";

/** Barcodes from list payload, local cache, or Korona product detail. */
export async function loadKoronaBarcodes(
  korona: KoronaClient,
  product: KoronaProduct
): Promise<string[]> {
  const fromList = koronaProductCodes(product);
  if (fromList.length) return fromList;

  const cached = await getKoronaBarcodes(product.id);
  if (cached.length) return cached;

  const full = await korona.getProduct(product.id);
  return koronaProductCodes(full);
}

import type { ShipHeroClient } from "../clients/shiphero.js";
import { findShipheroSkuByBarcode, lookupShipheroBarcodeCandidates } from "../db.js";
import type { KoronaProduct } from "../types/korona.js";
import type { ShipHeroProduct } from "../types/shiphero.js";
import { koronaProductCodes } from "./korona-codes.js";
import { koronaSku, sanitizeSku } from "./sku.js";

export type ResolvedShipheroProduct = {
  shipheroSku: string;
  createSku: string;
  existing: ShipHeroProduct | null;
  matchedBy: string | null;
};

type ProductMatch = {
  product: ShipHeroProduct;
  matchedBy: string;
  onHand: number;
};

function uniqueCandidates(product: KoronaProduct, barcodes: string[]): string[] {
  const out: string[] = [];
  const add = (raw?: string | null) => {
    if (!raw) return;
    const sku = sanitizeSku(raw);
    if (sku && !out.includes(sku)) out.push(sku);
  };
  add(product.number);
  add(koronaSku(product));
  for (const bc of barcodes) add(bc);
  return out;
}

function pickBestMatch(matches: ProductMatch[], createSku: string): ProductMatch | null {
  if (!matches.length) return null;

  const stocked = matches.filter((m) => m.onHand > 0);
  const pool = stocked.length ? stocked : matches;

  pool.sort((a, b) => {
    if (b.onHand !== a.onHand) return b.onHand - a.onHand;
    const aDup = a.product.sku === createSku ? 1 : 0;
    const bDup = b.product.sku === createSku ? 1 : 0;
    return aDup - bDup;
  });

  return pool[0] ?? null;
}

async function collectMatches(
  shiphero: ShipHeroClient,
  candidates: string[],
  barcodes: string[]
): Promise<ProductMatch[]> {
  const matches: ProductMatch[] = [];
  const seen = new Set<string>();

  const addProduct = async (sku: string, matchedBy: string) => {
    if (seen.has(sku)) return;
    const product = await shiphero.getProductBySku(sku);
    if (!product) return;
    seen.add(product.sku);
    matches.push({
      product,
      matchedBy,
      onHand: shiphero.getWarehouseOnHand(product),
    });
  };

  for (const bc of barcodes) {
    const normalized = sanitizeSku(bc);
    if (!normalized) continue;
    const indexedSku = await findShipheroSkuByBarcode(normalized);
    if (indexedSku) await addProduct(indexedSku, `barcode:${normalized}`);
  }

  for (const sku of candidates) {
    await addProduct(sku, `sku:${sku}`);
  }

  return matches;
}

/** Prefer existing ShipHero SKU with on_hand > 0 (web/Shopify) over empty A-prefix duplicates. */
export async function resolveShipheroProduct(
  shiphero: ShipHeroClient,
  product: KoronaProduct,
  barcodes = koronaProductCodes(product)
): Promise<ResolvedShipheroProduct> {
  const createSku = sanitizeSku(koronaSku(product));
  const candidates = uniqueCandidates(product, barcodes);
  const matches = await collectMatches(shiphero, candidates, barcodes);
  const best = pickBestMatch(matches, createSku);

  if (best) {
    return {
      shipheroSku: best.product.sku,
      createSku,
      existing: best.product,
      matchedBy: `${best.matchedBy} on_hand=${best.onHand}`,
    };
  }

  return { shipheroSku: createSku, createSku, existing: null, matchedBy: null };
}

/** Fast local link via barcode index only (no ShipHero API). Prefers highest on_hand SKU. */
export async function resolveShipheroSkuFromBarcodeIndex(
  barcodes: string[],
  createSku: string
): Promise<{ shipheroSku: string; matchedBy: string; onHand: number } | null> {
  const normalizedBarcodes = barcodes.map((bc) => sanitizeSku(bc)).filter(Boolean);
  const candidates = await lookupShipheroBarcodeCandidates(normalizedBarcodes);
  const matches: ProductMatch[] = [];
  const seen = new Set<string>();

  for (const hit of candidates) {
    if (seen.has(hit.shipheroSku)) continue;
    seen.add(hit.shipheroSku);
    matches.push({
      product: { sku: hit.shipheroSku } as ShipHeroProduct,
      matchedBy: `barcode:${hit.barcode}`,
      onHand: hit.onHand,
    });
  }

  const best = pickBestMatch(matches, createSku);
  if (!best) return null;
  return { shipheroSku: best.product.sku, matchedBy: best.matchedBy, onHand: best.onHand };
}

/** In-memory barcode index lookup (no per-row DB queries). */
export function resolveShipheroSkuFromPreloadedIndex(
  barcodes: string[],
  createSku: string,
  indexByBarcode: Map<string, Array<{ barcode: string; shipheroSku: string; onHand: number }>>
): { shipheroSku: string; matchedBy: string; onHand: number } | null {
  const matches: ProductMatch[] = [];
  const seen = new Set<string>();

  for (const bc of barcodes) {
    const normalized = sanitizeSku(bc);
    if (!normalized) continue;
    for (const hit of indexByBarcode.get(normalized) ?? []) {
      if (seen.has(hit.shipheroSku)) continue;
      seen.add(hit.shipheroSku);
      matches.push({
        product: { sku: hit.shipheroSku } as ShipHeroProduct,
        matchedBy: `barcode:${hit.barcode}`,
        onHand: hit.onHand,
      });
    }
  }

  const best = pickBestMatch(matches, createSku);
  if (!best) return null;
  return { shipheroSku: best.product.sku, matchedBy: best.matchedBy, onHand: best.onHand };
}

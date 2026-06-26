import { KoronaClient } from "../clients/korona.js";
import { config } from "../config.js";
import { findShipheroSku } from "../db.js";
import { sanitizeSku } from "./sku.js";
import { receiptHasSaleLines, receiptSaleLines } from "./korona-receipt.js";
import type { KoronaCustomerOrder, KoronaReceipt } from "../types/korona.js";

export interface SalesAggregate {
  sku: string;
  productName: string;
  soldQty: number;
  sources: Set<string>;
}

const SALES_CACHE_TTL_MS = 3 * 60_000;
const salesCache = new Map<
  number,
  {
    expiresAt: number;
    data: Map<string, SalesAggregate>;
    inflight?: Promise<Map<string, SalesAggregate>>;
  }
>();

function dateKeyPt(iso: string | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: config.dashboard.displayTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function todayKeyPt(): string {
  return dateKeyPt(new Date().toISOString()) ?? "";
}

function ptDateParts(offsetDays = 0): { y: number; m: number; d: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: config.dashboard.displayTimezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(Date.now() + offsetDays * 86_400_000));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  return { y: get("year"), m: get("month"), d: get("day") };
}

/** Korona receipt query window for sales aggregation (display timezone). */
export function salesReceiptWindow(days: number): { minCreateTime: string; maxCreateTime: string } {
  const end = ptDateParts(0);
  const start = ptDateParts(-(Math.max(1, days) - 1));
  const pad = (n: number) => String(n).padStart(2, "0");
  const minCreateTime = `${start.y}-${pad(start.m)}-${pad(start.d)}T00:00:00`;
  const maxCreateTime = `${end.y}-${pad(end.m)}-${pad(end.d)}T23:59:59`;
  return { minCreateTime, maxCreateTime };
}

function isWithinDays(iso: string | undefined, days: number): boolean {
  const key = dateKeyPt(iso);
  if (!key) return false;
  const today = todayKeyPt();
  if (days <= 1) return key === today;

  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  const startKey = dateKeyPt(start.toISOString());
  if (!startKey) return false;
  return key >= startKey && key <= today;
}

async function resolveLineSku(
  productId: string | undefined,
  productNumber: string | undefined,
  recognitionCode: string | undefined
): Promise<string | null> {
  const mapped = await findShipheroSku(productId, productNumber ?? recognitionCode);
  if (mapped) return mapped;
  const raw = productNumber ?? recognitionCode;
  return raw ? sanitizeSku(raw) : null;
}

function addSale(
  map: Map<string, SalesAggregate>,
  sku: string,
  name: string,
  qty: number,
  source: string
): void {
  if (qty <= 0) return;
  const existing = map.get(sku);
  if (existing) {
    existing.soldQty += qty;
    existing.sources.add(source);
    if (!existing.productName && name) existing.productName = name;
  } else {
    map.set(sku, { sku, productName: name, soldQty: qty, sources: new Set([source]) });
  }
}

async function ingestReceipt(
  korona: KoronaClient,
  map: Map<string, SalesAggregate>,
  receipt: KoronaReceipt,
  days: number
): Promise<void> {
  if (receipt.cancelled || receipt.voided) return;
  if (!isWithinDays(receipt.creationTime, days)) return;

  let full = receipt;
  if (!receiptHasSaleLines(receipt)) {
    try {
      full = await korona.getReceipt(receipt.id);
    } catch {
      return;
    }
  }

  for (const line of receiptSaleLines(full)) {
    const qty = Math.abs(line.quantity ?? 0);
    if (qty <= 0) continue;
    const sku = await resolveLineSku(
      line.product?.id,
      line.product?.number,
      line.recognitionCode
    );
    if (!sku) continue;
    const name = line.description ?? line.product?.name ?? sku;
    addSale(map, sku, name, qty, "korona_pos");
  }
}

async function ingestCustomerOrder(
  map: Map<string, SalesAggregate>,
  order: KoronaCustomerOrder,
  days: number
): Promise<void> {
  if (order.deleted) return;
  if (!isWithinDays(order.creationTime, days)) return;

  const lines = order.items ?? order.orderLines ?? [];
  for (const line of lines) {
    const qty = Math.abs(line.quantity ?? 0);
    if (qty <= 0) continue;
    const sku = await resolveLineSku(line.product?.id, line.product?.number, undefined);
    if (!sku) continue;
    const name = line.description ?? line.product?.name ?? sku;
    addSale(map, sku, name, qty, "korona_studio");
  }
}

const MAX_RECEIPT_PAGES = 20;
const MAX_ORDER_PAGES = 10;

async function aggregateKoronaSalesUncached(
  korona: KoronaClient,
  days = 1
): Promise<Map<string, SalesAggregate>> {
  const map = new Map<string, SalesAggregate>();
  const window = salesReceiptWindow(days);

  let receiptPage = 1;
  while (receiptPage <= MAX_RECEIPT_PAGES) {
    let list: Awaited<ReturnType<KoronaClient["getReceipts"]>> | undefined;
    try {
      list = await korona.getReceipts({
        page: receiptPage,
        minCreateTime: window.minCreateTime,
        maxCreateTime: window.maxCreateTime,
      });
    } catch {
      break;
    }
    if (!list) break;
    const batch = list.results ?? [];
    if (!batch.length) break;
    for (const receipt of batch) {
      await ingestReceipt(korona, map, receipt, days);
    }
    if (receiptPage >= (list.pagesTotal ?? 1)) break;
    receiptPage++;
  }

  let orderPage = 1;
  while (orderPage <= MAX_ORDER_PAGES) {
    let list: Awaited<ReturnType<KoronaClient["getCustomerOrders"]>> | undefined;
    try {
      list = await korona.getCustomerOrders({ page: orderPage });
    } catch {
      break;
    }
    if (!list) break;
    const batch = list.results ?? [];
    if (!batch.length) break;
    for (const order of batch) {
      await ingestCustomerOrder(map, order, days);
    }
    const pages = list.pagesTotal ?? 1;
    if (orderPage >= pages) break;
    orderPage++;
  }

  return map;
}

/** Cached sold-qty map (shared across report endpoints for the same day range). */
export async function getCachedKoronaSales(
  korona: KoronaClient,
  days = 1
): Promise<Map<string, SalesAggregate>> {
  const key = Math.min(30, Math.max(1, days));
  const now = Date.now();
  const hit = salesCache.get(key);
  if (hit && now < hit.expiresAt) return hit.data;
  if (hit?.inflight) return hit.inflight;

  const inflight = aggregateKoronaSalesUncached(korona, key).then((data) => {
    salesCache.set(key, { data, expiresAt: Date.now() + SALES_CACHE_TTL_MS });
    return data;
  });

  salesCache.set(key, {
    data: hit?.data ?? new Map(),
    expiresAt: 0,
    inflight,
  });

  try {
    return await inflight;
  } finally {
    const entry = salesCache.get(key);
    if (entry) delete entry.inflight;
  }
}

/** @deprecated Use getCachedKoronaSales */
export async function aggregateKoronaSales(
  korona: KoronaClient,
  days = 1
): Promise<Map<string, SalesAggregate>> {
  return getCachedKoronaSales(korona, days);
}

export function clearKoronaSalesCache(): void {
  salesCache.clear();
}

import type { KoronaClient } from "../clients/korona.js";
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

/** Aggregate sold qty per SKU from recent Korona receipts and studio orders. */
export async function aggregateKoronaSales(
  korona: KoronaClient,
  days = 1
): Promise<Map<string, SalesAggregate>> {
  const map = new Map<string, SalesAggregate>();

  let receiptPage = 1;
  while (receiptPage <= MAX_RECEIPT_PAGES) {
    const list = await korona.getReceipts({ page: receiptPage });
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
    const list = await korona.getCustomerOrders({ page: orderPage });
    const batch = list?.results ?? [];
    if (!batch.length) break;
    for (const order of batch) {
      await ingestCustomerOrder(map, order, days);
    }
    const pages = list?.pagesTotal ?? 1;
    if (orderPage >= pages) break;
    orderPage++;
  }

  return map;
}

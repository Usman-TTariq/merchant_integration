import { KoronaClient } from "../clients/korona.js";
import { querySyncLogs } from "../db.js";
import { csvRow } from "../utils/csv.js";
import { formatDisplayTime } from "./format-time.js";
import { receiptHasSaleLines, receiptSaleLines } from "../utils/korona-receipt.js";
import type { KoronaReceipt, KoronaReceiptItem } from "../types/korona.js";

const MAX_RECEIPT_PAGES = 150;

function lineTotal(item: KoronaReceiptItem): number | null {
  if (item.total?.net != null) return item.total.net;
  if (item.total?.gross != null) return item.total.gross;
  return null;
}

function unitPriceFromItem(item: KoronaReceiptItem): number | null {
  const qty = Math.abs(item.quantity ?? 0);
  const total = lineTotal(item);
  if (!qty || total == null) return null;
  return total / qty;
}

function quickLines(receipt: KoronaReceipt): Array<{
  sku: string;
  name: string;
  qty: number;
  unitPrice: number | null;
  lineTotal: number | null;
}> {
  if (receipt.items?.length) {
    const lines: Array<{
      sku: string;
      name: string;
      qty: number;
      unitPrice: number | null;
      lineTotal: number | null;
    }> = [];
    for (const item of receipt.items) {
      if (item.type && item.type !== "PRODUCT") continue;
      if (!item.product?.id && !item.recognitionNumber && !item.recognitionCode) continue;
      const sku = item.product?.number ?? item.recognitionNumber ?? item.recognitionCode ?? "";
      const name =
        item.description?.trim() ||
        item.product?.name?.trim() ||
        item.product?.number?.trim() ||
        sku;
      lines.push({
        sku,
        name,
        qty: Math.abs(item.quantity ?? 0),
        unitPrice: unitPriceFromItem(item),
        lineTotal: lineTotal(item),
      });
    }
    if (lines.length) return lines;
  }

  return receiptSaleLines(receipt).map((line) => {
    const sku = line.product?.number ?? line.recognitionCode ?? "";
    const name =
      line.description?.trim() ||
      line.product?.name?.trim() ||
      line.product?.number?.trim() ||
      sku;
    const qty = Math.abs(line.quantity ?? 0);
    const unitPrice = line.price ?? null;
    return {
      sku,
      name,
      qty,
      unitPrice,
      lineTotal: unitPrice != null && qty ? unitPrice * qty : null,
    };
  });
}

function receiptStatus(receipt: KoronaReceipt): string {
  if (receipt.cancelled) return "cancelled";
  if (receipt.voided) return "voided";
  return "completed";
}

export async function exportAllReceiptsCsv(): Promise<{ csv: string; receiptCount: number; lineCount: number }> {
  const korona = new KoronaClient();
  const rows: string[] = [
    csvRow([
      "receipt_number",
      "receipt_id",
      "created",
      "status",
      "point_of_sale",
      "org_unit",
      "sku",
      "product_name",
      "quantity",
      "unit_price",
      "line_total",
    ]),
  ];

  let receiptCount = 0;
  let lineCount = 0;
  let page = 1;

  while (page <= MAX_RECEIPT_PAGES) {
    const list = await korona.getReceipts({ page });
    const batch = list.results ?? [];
    if (!batch.length) break;

    for (const receipt of batch) {
      let full: KoronaReceipt = receipt;
      if (!receiptHasSaleLines(receipt)) {
        try {
          full = await korona.getReceipt(receipt.id);
        } catch {
          continue;
        }
      }

      const lines = quickLines(full);
      if (!lines.length) continue;

      receiptCount++;
      const created = formatDisplayTime(full.creationTime);
      const pos = full.pointOfSale?.name ?? full.pointOfSale?.number ?? "";
      const org = full.organizationalUnit?.name ?? full.organizationalUnit?.number ?? "";
      const number = full.number ?? full.id;
      const status = receiptStatus(full);

      for (const line of lines) {
        lineCount++;
        rows.push(
          csvRow([
            number,
            full.id,
            created,
            status,
            pos,
            org,
            line.sku,
            line.name,
            line.qty,
            line.unitPrice != null ? line.unitPrice.toFixed(2) : "",
            line.lineTotal != null ? line.lineTotal.toFixed(2) : "",
          ])
        );
      }
    }

    if (page >= (list.pagesTotal ?? page)) break;
    page++;
  }

  return { csv: rows.join("\n"), receiptCount, lineCount };
}

function formatShDate(dateStr: string): string {
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}

export async function exportShipheroInventoryCsv(opts: {
  from: string;
  to: string;
  storeName?: string;
}): Promise<{ csv: string; skuCount: number }> {
  const korona = new KoronaClient();

  // Korona API expects ISO 8601 datetime strings
  const minCreateTime = `${opts.from}T00:00:00`;
  const maxCreateTime = `${opts.to}T23:59:59`;

  const skuTotals = new Map<string, number>();
  let detectedStore = opts.storeName ?? "";
  let page = 1;

  while (page <= MAX_RECEIPT_PAGES) {
    const list = await korona.getReceipts({ page, minCreateTime, maxCreateTime });
    const batch = list.results ?? [];
    if (!batch.length) break;

    for (const receipt of batch) {
      if (receipt.cancelled || receipt.voided) continue;

      if (!detectedStore && receipt.organizationalUnit?.name) {
        detectedStore = receipt.organizationalUnit.name;
      }

      let full: KoronaReceipt = receipt;
      if (!receiptHasSaleLines(receipt)) {
        try {
          full = await korona.getReceipt(receipt.id);
        } catch {
          continue;
        }
      }

      const lines = quickLines(full);
      for (const line of lines) {
        if (!line.sku) continue;
        skuTotals.set(line.sku, (skuTotals.get(line.sku) ?? 0) + line.qty);
      }
    }

    if (page >= (list.pagesTotal ?? page)) break;
    page++;
  }

  const storePart = detectedStore || "Store";
  const reason = `${storePart} ${formatShDate(opts.from)} - ${formatShDate(opts.to)}`;

  const rows = ["Sku,Action,Quantity,Location,Reason"];
  for (const [sku, qty] of skuTotals) {
    if (qty <= 0) continue;
    rows.push(csvRow([sku, "change", String(-Math.round(qty)), "Unassigned", reason]));
  }

  return { csv: rows.join("\n"), skuCount: skuTotals.size };
}

export async function exportAllLogsCsv(level = ""): Promise<{ csv: string; rowCount: number }> {
  const rows: string[] = [csvRow(["id", "created_at", "job", "level", "message"])];
  const all: Record<string, unknown>[] = [];
  let page = 1;
  const limit = 2000;

  while (true) {
    const batch = await querySyncLogs({ page, limit, level: level || undefined });
    all.push(...batch.rows);
    if (page * limit >= batch.total) break;
    page++;
  }

  for (const row of all) {
    rows.push(
      csvRow([
        row.id as string | number,
        String(row.created_at ?? ""),
        String(row.job ?? ""),
        String(row.level ?? ""),
        String(row.message ?? ""),
      ])
    );
  }

  return { csv: rows.join("\n"), rowCount: all.length };
}

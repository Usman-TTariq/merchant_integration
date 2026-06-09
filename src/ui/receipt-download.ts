import { KoronaClient } from "../clients/korona.js";
import { config } from "../config.js";
import { formatDisplayTime } from "./format-time.js";
import { receiptSaleLines } from "../utils/korona-receipt.js";
import type { KoronaReceipt, KoronaReceiptItem } from "../types/korona.js";

export interface ReceiptLineView {
  sku: string;
  name: string;
  qty: number;
  unitPrice: number | null;
  lineTotal: number | null;
}

function lineTotal(item: KoronaReceiptItem): number | null {
  const net = item.total?.net;
  if (net != null) return net;
  const gross = item.total?.gross;
  return gross != null ? gross : null;
}

function unitPriceFromItem(item: KoronaReceiptItem): number | null {
  const qty = Math.abs(item.quantity ?? 0);
  const total = lineTotal(item);
  if (!qty || total == null) return null;
  return total / qty;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return "—";
  return n.toFixed(2);
}

async function resolveProductName(
  korona: KoronaClient,
  cache: Map<string, string>,
  productId: string | undefined,
  fallback: string
): Promise<string> {
  if (!productId) return fallback;
  const cached = cache.get(productId);
  if (cached) return cached;

  try {
    const product = await korona.getProduct(productId);
    const name = product.name?.trim() || product.number?.trim() || fallback;
    cache.set(productId, name);
    return name;
  } catch {
    return fallback;
  }
}

export async function buildReceiptLineViews(
  korona: KoronaClient,
  receipt: KoronaReceipt
): Promise<ReceiptLineView[]> {
  const cache = new Map<string, string>();
  const views: ReceiptLineView[] = [];

  if (receipt.items?.length) {
    for (const item of receipt.items) {
      if (item.type && item.type !== "PRODUCT") continue;
      if (!item.product?.id && !item.recognitionNumber && !item.recognitionCode) continue;

      const sku =
        item.product?.number ?? item.recognitionNumber ?? item.recognitionCode ?? "—";
      const fallbackName = item.description?.trim() || item.product?.name?.trim() || sku;
      const name = await resolveProductName(korona, cache, item.product?.id, fallbackName);

      views.push({
        sku,
        name,
        qty: Math.abs(item.quantity ?? 0),
        unitPrice: unitPriceFromItem(item),
        lineTotal: lineTotal(item),
      });
    }
    return views;
  }

  for (const line of receiptSaleLines(receipt)) {
    const sku = line.product?.number ?? line.recognitionCode ?? "—";
    const fallbackName = line.description?.trim() || line.product?.name?.trim() || sku;
    const name = await resolveProductName(korona, cache, line.product?.id, fallbackName);
    const qty = Math.abs(line.quantity ?? 0);
    const unitPrice = line.price ?? null;
    views.push({
      sku,
      name,
      qty,
      unitPrice,
      lineTotal: unitPrice != null && qty ? unitPrice * qty : null,
    });
  }

  return views;
}

export async function buildReceiptDownload(receiptId: string): Promise<{
  html: string;
  filename: string;
}> {
  const korona = new KoronaClient();
  const receipt = await korona.getReceipt(receiptId);
  const lines = await buildReceiptLineViews(korona, receipt);

  const receiptNumber = receipt.number ?? receipt.id;
  const created = formatDisplayTime(receipt.creationTime) || "—";
  const pos = receipt.pointOfSale?.name ?? receipt.pointOfSale?.number ?? "—";
  const org = receipt.organizationalUnit?.name ?? receipt.organizationalUnit?.number ?? "—";
  const status = receipt.cancelled ? "Cancelled" : receipt.voided ? "Voided" : "Completed";

  const subtotal = lines.reduce((sum, line) => sum + (line.lineTotal ?? 0), 0);

  const rowsHtml = lines.length
    ? lines
        .map(
          (line) => `
      <tr>
        <td>${escapeHtml(line.sku)}</td>
        <td>${escapeHtml(line.name)}</td>
        <td class="num">${line.qty}</td>
        <td class="num">${money(line.unitPrice)}</td>
        <td class="num">${money(line.lineTotal)}</td>
      </tr>`
        )
        .join("")
    : `<tr><td colspan="5" class="empty">No product lines on this receipt.</td></tr>`;

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Receipt ${escapeHtml(receiptNumber)}</title>
  <style>
    body { font-family: "Segoe UI", system-ui, sans-serif; margin: 32px; color: #1e293b; }
    h1 { margin: 0 0 4px; font-size: 1.5rem; }
    .meta { color: #64748b; font-size: 0.9rem; margin-bottom: 24px; }
    .meta div { margin: 4px 0; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th, td { border-bottom: 1px solid #dde3eb; padding: 10px 8px; text-align: left; }
    th { font-size: 0.75rem; text-transform: uppercase; color: #64748b; }
    .num { text-align: right; white-space: nowrap; }
    .total { margin-top: 16px; text-align: right; font-size: 1.1rem; font-weight: 700; }
    .badge { display: inline-block; padding: 2px 8px; border-radius: 999px; background: #fff4ed; color: #c44d03; font-size: 0.8rem; }
    .empty { text-align: center; color: #64748b; }
    @media print { body { margin: 12px; } }
  </style>
</head>
<body>
  <h1>Receipt #${escapeHtml(receiptNumber)}</h1>
  <div class="meta">
    <div><strong>Date:</strong> ${escapeHtml(created)} (${escapeHtml(config.dashboard.displayTimezone)})</div>
    <div><strong>Status:</strong> <span class="badge">${escapeHtml(status)}</span></div>
    <div><strong>Point of sale:</strong> ${escapeHtml(pos)}</div>
    <div><strong>Organizational unit:</strong> ${escapeHtml(org)}</div>
    <div><strong>Receipt ID:</strong> ${escapeHtml(receipt.id)}</div>
    <div><strong>Source:</strong> Korona POS</div>
  </div>
  <table>
    <thead>
      <tr>
        <th>SKU</th>
        <th>Product</th>
        <th class="num">Qty</th>
        <th class="num">Unit price</th>
        <th class="num">Line total</th>
      </tr>
    </thead>
    <tbody>${rowsHtml}</tbody>
  </table>
  <div class="total">Total: ${money(subtotal)}</div>
  <p class="meta">Generated by Korona ↔ ShipHero Dashboard</p>
</body>
</html>`;

  const safeName = String(receiptNumber).replace(/[^\w.-]+/g, "_");
  return { html, filename: `receipt-${safeName}.html` };
}

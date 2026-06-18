import type { KoronaReceipt, KoronaReceiptItem, KoronaSaleLine } from "../types/korona.js";

/** Korona API v3 uses `items` on receipts; older docs/samples use `sales`. */
export function receiptSaleLines(receipt: KoronaReceipt): KoronaSaleLine[] {
  if (receipt.sales?.length) return receipt.sales;
  return (receipt.items ?? [])
    .filter((item) => isProductLine(item))
    .map((item) => ({
      quantity: item.quantity,
      product: item.product,
      description: item.description,
      recognitionCode: item.recognitionNumber ?? item.recognitionCode,
      price: unitPrice(item),
    }));
}

function unitPrice(item: KoronaReceiptItem): number | undefined {
  const qty = item.quantity ?? 0;
  if (!qty || item.total?.net == null) return undefined;
  return item.total.net / Math.abs(qty);
}

function isProductLine(item: KoronaReceiptItem): boolean {
  if (item.type && item.type !== "PRODUCT") return false;
  return Boolean(item.product?.id || item.recognitionNumber || item.recognitionCode);
}

export function receiptHasSaleLines(receipt: KoronaReceipt): boolean {
  return receiptSaleLines(receipt).length > 0;
}

export function saleLineMatchesProduct(
  line: KoronaSaleLine,
  productId: string,
  productNumber?: string
): boolean {
  if (line.product?.id === productId) return true;
  if (!productNumber) return false;
  return line.product?.number === productNumber || line.recognitionCode === productNumber;
}

export function receiptLinesMatchProduct(
  lines: KoronaSaleLine[],
  productId: string,
  productNumber?: string
): boolean {
  return lines.some((line) => saleLineMatchesProduct(line, productId, productNumber));
}

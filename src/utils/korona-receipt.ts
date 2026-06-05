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
    }));
}

function isProductLine(item: KoronaReceiptItem): boolean {
  if (item.type && item.type !== "PRODUCT") return false;
  return Boolean(item.product?.id || item.recognitionNumber || item.recognitionCode);
}

export function receiptHasSaleLines(receipt: KoronaReceipt): boolean {
  return receiptSaleLines(receipt).length > 0;
}

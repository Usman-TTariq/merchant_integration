import {
  countLogsByLevel,
  countTable,
  summarizeSyncLogs,
  getAllCursors,
  queryOrderMappings,
  queryProcessedReceipts,
  queryProductMappings,
  querySyncLogs,
} from "../db.js";
import { KoronaClient } from "../clients/korona.js";
import { formatRowTimes } from "./format-time.js";
import { getKoronaReceiptsLive } from "./status.js";

let _koronaReceiptCountCache: { total: number; expiresAt: number } | null = null;
const KORONA_RECEIPT_COUNT_TTL_MS = 60_000;

async function getKoronaReceiptCountCached(): Promise<number> {
  const now = Date.now();
  if (_koronaReceiptCountCache && now < _koronaReceiptCountCache.expiresAt) {
    return _koronaReceiptCountCache.total;
  }
  try {
    const live = await getKoronaReceiptsLive(1);
    _koronaReceiptCountCache = { total: live.total, expiresAt: now + KORONA_RECEIPT_COUNT_TTL_MS };
    return live.total;
  } catch {
    return -1;
  }
}

export interface DashboardStats {
  productMappings: number;
  orderMappings: number;
  processedReceipts: number;
  logErrors: number;
  logWarnings: number;
}

export async function getStats(): Promise<DashboardStats> {
  return {
    productMappings: await countTable("product_mappings"),
    orderMappings: await countTable("order_mappings"),
    processedReceipts: await countTable("processed_receipts"),
    logErrors: await countLogsByLevel("error"),
    logWarnings: await countLogsByLevel("warn"),
  };
}

export async function getCursors(): Promise<Array<{ key: string; value: string; updated_at: string }>> {
  const rows = await getAllCursors();
  return formatRowTimes(rows, ["updated_at"]);
}

export async function getProducts(page = 1, limit = 50, search = "", linkedOnly = false) {
  const { rows, total } = await queryProductMappings({ page, limit, search, linkedOnly });
  return {
    rows: formatRowTimes(rows as Record<string, unknown>[], ["updated_at"]),
    total,
    page,
    limit,
  };
}

export function getOrders(page = 1, limit = 50, search = "") {
  return queryOrderMappings({ page, limit, search }).then(({ rows, total }: { rows: Record<string, unknown>[]; total: number }) => ({
    rows: formatRowTimes(rows, ["created_at"]),
    total,
    page,
    limit,
  }));
}

export async function getOrdersWithMeta(page = 1, limit = 50, search = "") {
  const result = await getOrders(page, limit, search);
  const korona = new KoronaClient();
  let koronaTotal = 0;
  let receiptTotal = 0;
  try {
    const list = await korona.getCustomerOrders({ page: 1 });
    koronaTotal = list?.resultsTotal ?? (list?.results?.length ?? 0);
  } catch {
    koronaTotal = -1;
  }
  try {
    const receipts = await korona.getReceipts({ page: 1 });
    receiptTotal = receipts?.resultsTotal ?? (receipts?.results?.length ?? 0);
  } catch {
    receiptTotal = -1;
  }

  let hint: string | undefined;
  if (result.total === 0) {
    if (koronaTotal === 0 && receiptTotal > 0) {
      hint = `${receiptTotal} POS receipt(s) in Korona. Run Sync Orders to create ShipHero orders from register sales (type: receipt). Sync Inventory is only needed for receipts not yet converted to orders.`;
    } else if (koronaTotal === 0 && receiptTotal === 0) {
      hint =
        "No customer orders or POS receipts in Korona yet. Studio customer orders and register sales both sync via Sync Orders.";
    } else if (koronaTotal > 0) {
      hint = `${koronaTotal} customer order(s) in Korona but none synced to ShipHero yet. Run Sync Orders.`;
    } else if (koronaTotal === 0 && receiptTotal < 0) {
      hint = "Could not reach Korona to check orders/receipts.";
    } else if (koronaTotal < 0) {
      hint = "Could not reach Korona to check customer orders.";
    }
  }

  return {
    ...result,
    source: "order_mappings",
    koronaCustomerOrdersTotal: Math.max(koronaTotal, 0),
    hint,
  };
}

export async function getReceipts(page = 1, limit = 50, search = "") {
  const { rows, total } = await queryProcessedReceipts({ page, limit, search });
  return {
    rows: formatRowTimes(rows as Record<string, unknown>[], ["processed_at"]),
    total,
    page,
    limit,
  };
}

export async function getReceiptsWithMeta(page = 1, limit = 50, search = "") {
  const result = await getReceipts(page, limit, search);
  const koronaTotal = search ? -1 : await getKoronaReceiptCountCached();

  let hint: string | undefined;
  if (result.total === 0 && koronaTotal >= 0) {
    if (koronaTotal === 0) {
      hint = "No receipts in Korona yet. Sales receipts appear after POS transactions.";
    } else if (koronaTotal > 0) {
      hint = `${koronaTotal} receipt(s) in Korona but none processed yet. Run Sync Inventory to push sales to ShipHero.`;
    }
  } else if (result.total === 0 && koronaTotal < 0) {
    hint = "Could not reach Korona to check receipts.";
  }

  return {
    ...result,
    source: "processed_receipts",
    koronaReceiptsTotal: Math.max(koronaTotal, 0),
    hint,
  };
}

export async function getLogs(page = 1, limit = 100, level = "", search = "") {
  const { rows, total } = await querySyncLogs({ page, limit, level: level || undefined, search: search || undefined });
  return {
    rows: formatRowTimes(rows as Record<string, unknown>[], ["created_at"]),
    total,
    page,
    limit,
  };
}

export function getLogsSummary() {
  return summarizeSyncLogs();
}

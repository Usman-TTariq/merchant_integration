import {
  countLogsByLevel,
  countTable,
  getAllCursors,
  queryOrderMappings,
  queryProcessedReceipts,
  queryProductMappings,
  querySyncLogs,
} from "../db.js";
import { KoronaClient } from "../clients/korona.js";
import { formatRowTimes } from "./format-time.js";
import { getKoronaReceiptsLive } from "./status.js";

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

export async function getProducts(page = 1, limit = 50, search = "") {
  const { rows, total } = await queryProductMappings({ page, limit, search });
  return {
    rows: formatRowTimes(rows as Record<string, unknown>[], ["updated_at"]),
    total,
    page,
    limit,
  };
}

export function getOrders(page = 1, limit = 50) {
  return queryOrderMappings({ page, limit }).then(({ rows, total }: { rows: Record<string, unknown>[]; total: number }) => ({
    rows: formatRowTimes(rows, ["created_at"]),
    total,
    page,
    limit,
  }));
}

export async function getOrdersWithMeta(page = 1, limit = 50) {
  const result = await getOrders(page, limit);
  let koronaTotal = 0;
  try {
    const list = await new KoronaClient().getCustomerOrders({ page: 1 });
    koronaTotal = list?.resultsTotal ?? 0;
  } catch {
    koronaTotal = -1;
  }

  let hint: string | undefined;
  if (result.total === 0) {
    if (koronaTotal === 0) {
      hint =
        "No customer orders in Korona yet. Create a customer order in Korona POS, then run Sync Orders.";
    } else if (koronaTotal > 0) {
      hint = `${koronaTotal} customer order(s) in Korona but none synced to ShipHero yet. Run Sync Orders.`;
    } else {
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

export async function getReceipts(page = 1, limit = 50) {
  const { rows, total } = await queryProcessedReceipts({ page, limit });
  return {
    rows: formatRowTimes(rows as Record<string, unknown>[], ["processed_at"]),
    total,
    page,
    limit,
  };
}

export async function getReceiptsWithMeta(page = 1, limit = 50) {
  const result = await getReceipts(page, limit);
  let koronaTotal = 0;
  try {
    const live = await getKoronaReceiptsLive(1);
    koronaTotal = live.total;
  } catch {
    koronaTotal = -1;
  }

  let hint: string | undefined;
  if (result.total === 0) {
    if (koronaTotal === 0) {
      hint = "No receipts in Korona yet. Sales receipts appear after POS transactions.";
    } else if (koronaTotal > 0) {
      hint = `${koronaTotal} receipt(s) in Korona but none processed yet. Run Sync Inventory to push sales to ShipHero.`;
    } else {
      hint = "Could not reach Korona to check receipts.";
    }
  }

  return {
    ...result,
    source: "processed_receipts",
    koronaReceiptsTotal: Math.max(koronaTotal, 0),
    hint,
  };
}

export async function getLogs(page = 1, limit = 100, level = "") {
  const { rows, total } = await querySyncLogs({ page, limit, level: level || undefined });
  return {
    rows: formatRowTimes(rows as Record<string, unknown>[], ["created_at"]),
    total,
    page,
    limit,
  };
}

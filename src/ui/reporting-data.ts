import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";
import { config } from "../config.js";
import {
  countLogsByLevel,
  countOrderMappings,
  countTable,
  getAllCursors,
  getCursor,
  queryOrderMappings,
  queryProductMappings,
  querySyncLogs,
} from "../db.js";
import { resolveKoronaStockQuantity } from "../utils/korona-product-stock.js";
import { getDashboardStatus } from "./status.js";

export type StockReportStatus =
  | "synced"
  | "mismatch"
  | "untracked"
  | "no_rows"
  | "missing_sh";

export interface StockReportRow {
  sku: string;
  koronaNumber: string | null;
  koronaProductId: string;
  koronaQty: number | null;
  koronaSource: string | null;
  shipheroQty: number | null;
  diff: number | null;
  status: StockReportStatus;
  statusLabel: string;
}

export interface ReportSummary {
  generatedAt: string;
  connections: { korona: boolean; shiphero: boolean };
  sync: {
    productMappings: number;
    orderMappings: number;
    orderReceipts: number;
    orderStudio: number;
    processedReceipts: number;
    syncKoronaStock: boolean;
    stockBatchCursor: string | null;
    cursors: Array<{ key: string; value: string; updated_at: string }>;
  };
  logs: {
    errors: number;
    warnings: number;
    stockUntrackedHints: number;
  };
  stockScan: {
    sampled: number;
    synced: number;
    mismatch: number;
    untracked: number;
    noRows: number;
    missingShiphero: number;
  };
}

function classifyStockRow(
  koronaQty: number | null,
  koronaStatus: string,
  shipheroQty: number | null
): { status: StockReportStatus; statusLabel: string } {
  if (koronaStatus === "untracked") {
    return { status: "untracked", statusLabel: "Korona not tracked" };
  }
  if (koronaStatus === "no_rows") {
    return { status: "no_rows", statusLabel: "No Korona stock rows" };
  }
  if (shipheroQty === null) {
    return { status: "missing_sh", statusLabel: "Missing in ShipHero" };
  }
  if (koronaQty === null) {
    return { status: "no_rows", statusLabel: "Korona qty unknown" };
  }
  if (koronaQty === shipheroQty) {
    return { status: "synced", statusLabel: "In sync" };
  }
  return { status: "mismatch", statusLabel: "Qty mismatch" };
}

async function countOrderTypes(): Promise<{ receipt: number; customerOrder: number }> {
  let receipt = 0;
  let customerOrder = 0;
  let page = 1;
  const batchSize = 500;
  while (true) {
    const batch = await queryOrderMappings({ page, limit: batchSize });
    for (const row of batch.rows) {
      const t = String(row.korona_order_type ?? "");
      if (t === "receipt") receipt++;
      else if (t === "customerOrder") customerOrder++;
    }
    if (page * batchSize >= batch.total) break;
    page++;
  }
  return { receipt, customerOrder };
}

async function countStockUntrackedLogs(): Promise<number> {
  const { rows } = await querySyncLogs({ page: 1, limit: 500, level: "warn" });
  return rows.filter((r) => String(r.message ?? "").includes("not tracked")).length;
}

async function buildStockRow(
  korona: KoronaClient,
  shiphero: ShipHeroClient,
  mapping: Record<string, unknown>
): Promise<StockReportRow> {
  const koronaProductId = String(mapping.korona_product_id ?? "");
  const sku = String(mapping.shiphero_sku ?? "");
  const koronaNumber = mapping.korona_product_number != null ? String(mapping.korona_product_number) : null;

  let koronaQty: number | null = null;
  let koronaSource: string | null = null;
  let koronaStatus = "ok";

  try {
    const resolved = await resolveKoronaStockQuantity(korona, koronaProductId, {
      autoEnableTracking: false,
    });
    if (resolved.status === "ok") {
      koronaQty = resolved.qty;
      koronaSource = resolved.source;
    } else {
      koronaStatus = resolved.status;
    }
  } catch {
    koronaStatus = "no_rows";
  }

  let shipheroQty: number | null = null;
  try {
    const product = await shiphero.getProductBySku(sku);
    shipheroQty = product ? shiphero.getWarehouseOnHand(product) : null;
  } catch {
    shipheroQty = null;
  }

  const diff = koronaQty != null && shipheroQty != null ? shipheroQty - koronaQty : null;
  const { status, statusLabel } = classifyStockRow(koronaQty, koronaStatus, shipheroQty);

  return {
    sku,
    koronaNumber,
    koronaProductId,
    koronaQty,
    koronaSource,
    shipheroQty,
    diff,
    status,
    statusLabel,
  };
}

function tallyStockRows(rows: StockReportRow[]) {
  return {
    sampled: rows.length,
    synced: rows.filter((r) => r.status === "synced").length,
    mismatch: rows.filter((r) => r.status === "mismatch").length,
    untracked: rows.filter((r) => r.status === "untracked").length,
    noRows: rows.filter((r) => r.status === "no_rows").length,
    missingShiphero: rows.filter((r) => r.status === "missing_sh").length,
  };
}

const SUMMARY_SAMPLE_SIZE = 40;

export async function getReportSummary(): Promise<ReportSummary> {
  const status = await getDashboardStatus();
  const [productMappings, orderMappings, processedReceipts, orderTypes, cursors, stockCursor] =
    await Promise.all([
      countTable("product_mappings"),
      countOrderMappings(),
      countTable("processed_receipts"),
      countOrderTypes(),
      getAllCursors(),
      getCursor("stock_sync_page"),
    ]);

  const korona = new KoronaClient();
  const shiphero = new ShipHeroClient();
  const sampleBatch = await queryProductMappings({ page: 1, limit: SUMMARY_SAMPLE_SIZE });
  const sampleRows: StockReportRow[] = [];
  for (const row of sampleBatch.rows) {
    sampleRows.push(await buildStockRow(korona, shiphero, row));
  }

  return {
    generatedAt: new Date().toISOString(),
    connections: { korona: status.korona.ok, shiphero: status.shiphero.ok },
    sync: {
      productMappings,
      orderMappings,
      orderReceipts: orderTypes.receipt,
      orderStudio: orderTypes.customerOrder,
      processedReceipts,
      syncKoronaStock: config.sync.koronaStock,
      stockBatchCursor: stockCursor,
      cursors,
    },
    logs: {
      errors: await countLogsByLevel("error"),
      warnings: await countLogsByLevel("warn"),
      stockUntrackedHints: await countStockUntrackedLogs(),
    },
    stockScan: tallyStockRows(sampleRows),
  };
}

export async function getStockReport(opts: {
  page?: number;
  limit?: number;
  search?: string;
  filter?: string;
}): Promise<{
  rows: StockReportRow[];
  page: number;
  limit: number;
  total: number;
  scanned: number;
}> {
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(50, Math.max(10, opts.limit ?? 25));
  const search = opts.search?.trim() ?? "";
  const filter = opts.filter?.trim() || "all";

  const korona = new KoronaClient();
  const shiphero = new ShipHeroClient();

  if (filter === "all" && !search) {
    const { rows: mappings, total } = await queryProductMappings({ page, limit, search });
    const rows: StockReportRow[] = [];
    for (const mapping of mappings) {
      rows.push(await buildStockRow(korona, shiphero, mapping));
    }
    return { rows, page, limit, total, scanned: mappings.length };
  }

  const results: StockReportRow[] = [];
  let scanPage = 1;
  let scanned = 0;
  let totalMappings = 0;
  const targetStart = (page - 1) * limit;
  const targetEnd = targetStart + limit;
  const matched: StockReportRow[] = [];

  while (matched.length < targetEnd) {
    const batch = await queryProductMappings({ page: scanPage, limit: 100, search });
    if (scanPage === 1) totalMappings = batch.total;
    if (!batch.rows.length) break;

    for (const mapping of batch.rows) {
      scanned++;
      const row = await buildStockRow(korona, shiphero, mapping);
      if (filter === "all" || row.status === filter) {
        matched.push(row);
      }
      if (matched.length >= targetEnd) break;
    }

    if (scanPage * 100 >= batch.total) break;
    scanPage++;
    if (scanned > 500) break;
  }

  results.push(...matched.slice(targetStart, targetEnd));

  return {
    rows: results,
    page,
    limit,
    total: filter === "all" ? totalMappings : matched.length,
    scanned,
  };
}

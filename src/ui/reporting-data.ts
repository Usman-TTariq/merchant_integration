import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";
import { config } from "../config.js";
import {
  countLogsByLevel,
  countOrderMappings,
  countTable,
  findKoronaProductIdBySku,
  getAllCursors,
  getCursor,
  queryOrderMappings,
  queryProductMappings,
  querySyncLogs,
} from "../db.js";
import { getCachedKoronaSales } from "../utils/report-sales.js";
import { resolveKoronaStockQuantity } from "../utils/korona-product-stock.js";
import { getDashboardStatus, searchKoronaProducts } from "./status.js";
import type { KoronaProduct } from "../types/korona.js";
import type { ShipHeroProduct } from "../types/shiphero.js";

export type StockReportStatus =
  | "synced"
  | "mismatch"
  | "untracked"
  | "no_rows"
  | "missing_sh"
  | "unmapped";

export interface StockReportRow {
  sku: string;
  productName: string | null;
  koronaNumber: string | null;
  koronaProductId: string;
  koronaQty: number | null;
  koronaSource: string | null;
  shipheroQty: number | null;
  soldQty: number;
  diff: number | null;
  status: StockReportStatus;
  statusLabel: string;
}

export interface SalesReportRow {
  sku: string;
  productName: string;
  soldQty: number;
  sources: string[];
  koronaQty: number | null;
  shipheroQty: number | null;
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
    unmapped: number;
  };
}

const SUMMARY_SAMPLE_SIZE = 25;
const REPORT_CONCURRENCY = 12;

type SalesMap = Map<string, { soldQty: number; productName: string }>;

type ReportClients = {
  korona: KoronaClient;
  shiphero: ShipHeroClient;
  shipheroBySku: Map<string, ShipHeroProduct | null>;
};

function createReportClients(): ReportClients {
  return {
    korona: new KoronaClient(),
    shiphero: new ShipHeroClient(),
    shipheroBySku: new Map(),
  };
}

async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  if (!items.length) return [];
  const results: R[] = new Array(items.length);
  let index = 0;

  async function worker(): Promise<void> {
    while (index < items.length) {
      const i = index++;
      results[i] = await fn(items[i]!);
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(concurrency, items.length) }, () => worker())
  );
  return results;
}

async function getShipheroProduct(
  ctx: ReportClients,
  sku: string
): Promise<ShipHeroProduct | null> {
  if (ctx.shipheroBySku.has(sku)) return ctx.shipheroBySku.get(sku) ?? null;
  try {
    const product = await ctx.shiphero.getProductBySku(sku);
    ctx.shipheroBySku.set(sku, product);
    return product;
  } catch {
    ctx.shipheroBySku.set(sku, null);
    return null;
  }
}

function salesMapFromRaw(raw: Awaited<ReturnType<typeof getCachedKoronaSales>>): SalesMap {
  return new Map(
    [...raw.entries()].map(([k, v]) => [k, { soldQty: v.soldQty, productName: v.productName }])
  );
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
  ctx: ReportClients,
  mapping: Record<string, unknown>,
  salesMap?: SalesMap
): Promise<StockReportRow> {
  const koronaProductId = String(mapping.korona_product_id ?? "");
  const sku = String(mapping.shiphero_sku ?? "");
  const koronaNumber = mapping.korona_product_number != null ? String(mapping.korona_product_number) : null;

  let koronaQty: number | null = null;
  let koronaSource: string | null = null;
  let koronaStatus = "ok";

  try {
    const resolved = await resolveKoronaStockQuantity(ctx.korona, koronaProductId, {
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

  const product = await getShipheroProduct(ctx, sku);
  const shipheroQty = product ? ctx.shiphero.getWarehouseOnHand(product) : null;
  const productName = product?.name ?? salesMap?.get(sku)?.productName ?? koronaNumber ?? sku;

  const soldQty = salesMap?.get(sku)?.soldQty ?? 0;
  const diff = koronaQty != null && shipheroQty != null ? shipheroQty - koronaQty : null;
  const { status, statusLabel } = classifyStockRow(koronaQty, koronaStatus, shipheroQty);

  return {
    sku,
    productName,
    koronaNumber,
    koronaProductId,
    koronaQty,
    koronaSource,
    shipheroQty,
    soldQty,
    diff,
    status,
    statusLabel,
  };
}

async function buildStockRows(
  ctx: ReportClients,
  mappings: Record<string, unknown>[],
  salesMap?: SalesMap
): Promise<StockReportRow[]> {
  return mapWithConcurrency(mappings, (mapping) => buildStockRow(ctx, mapping, salesMap), REPORT_CONCURRENCY);
}

async function buildStockRowFromKoronaProduct(
  ctx: ReportClients,
  product: KoronaProduct,
  salesMap?: SalesMap
): Promise<StockReportRow> {
  const koronaProductId = product.id;
  const sku = product.number ?? product.id;
  const koronaNumber = product.number ?? null;

  let koronaQty: number | null = null;
  let koronaSource: string | null = null;
  let koronaStatus = "ok";

  try {
    const resolved = await resolveKoronaStockQuantity(ctx.korona, koronaProductId, {
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

  const shProduct = await getShipheroProduct(ctx, sku);
  const shipheroQty = shProduct ? ctx.shiphero.getWarehouseOnHand(shProduct) : null;
  const productName = product.name ?? salesMap?.get(sku)?.productName ?? null;
  const soldQty = salesMap?.get(sku)?.soldQty ?? 0;
  const diff = koronaQty != null && shipheroQty != null ? shipheroQty - koronaQty : null;
  const mapped = await findKoronaProductIdBySku(sku);
  const classified = classifyStockRow(koronaQty, koronaStatus, shipheroQty);

  if (!mapped) {
    return {
      sku,
      productName,
      koronaNumber,
      koronaProductId,
      koronaQty,
      koronaSource,
      shipheroQty,
      soldQty,
      diff,
      status: "unmapped",
      statusLabel: "Not mapped — run Sync Products",
    };
  }

  return {
    sku,
    productName,
    koronaNumber,
    koronaProductId,
    koronaQty,
    koronaSource,
    shipheroQty,
    soldQty,
    diff,
    status: classified.status,
    statusLabel: classified.statusLabel,
  };
}

async function stockRowsFromKoronaLiveSearch(
  ctx: ReportClients,
  term: string,
  salesMap: SalesMap,
  filter: string
): Promise<StockReportRow[]> {
  const list = await searchKoronaProducts(ctx.korona, term, 1, 5);
  const rows: StockReportRow[] = [];
  for (const product of list.results ?? []) {
    const row = await buildStockRowFromKoronaProduct(ctx, product, salesMap);
    if (filter === "all" || row.status === filter) {
      rows.push(row);
    }
  }
  return rows;
}

function tallyStockRows(rows: StockReportRow[]) {
  return {
    sampled: rows.length,
    synced: rows.filter((r) => r.status === "synced").length,
    mismatch: rows.filter((r) => r.status === "mismatch").length,
    untracked: rows.filter((r) => r.status === "untracked").length,
    noRows: rows.filter((r) => r.status === "no_rows").length,
    missingShiphero: rows.filter((r) => r.status === "missing_sh").length,
    unmapped: rows.filter((r) => r.status === "unmapped").length,
  };
}

export async function getReportSummary(): Promise<ReportSummary> {
  const status = await getDashboardStatus();
  const [productMappings, orderMappings, processedReceipts, orderTypes, cursors, stockCursor, errors, warnings, stockUntrackedHints] =
    await Promise.all([
      countTable("product_mappings"),
      countOrderMappings(),
      countTable("processed_receipts"),
      countOrderTypes(),
      getAllCursors(),
      getCursor("stock_sync_page"),
      countLogsByLevel("error"),
      countLogsByLevel("warn"),
      countStockUntrackedLogs(),
    ]);

  const ctx = createReportClients();
  const sampleBatch = await queryProductMappings({ page: 1, limit: SUMMARY_SAMPLE_SIZE });
  const sampleRows = await buildStockRows(ctx, sampleBatch.rows);

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
    logs: { errors, warnings, stockUntrackedHints },
    stockScan: tallyStockRows(sampleRows),
  };
}

async function buildSalesReportRow(
  ctx: ReportClients,
  entry: { sku: string; productName: string; soldQty: number; sources: Set<string> },
  mapping: string | null
): Promise<SalesReportRow> {
  let koronaQty: number | null = null;
  let shipheroQty: number | null = null;
  let koronaStatus = "ok";

  if (mapping) {
    const resolved = await resolveKoronaStockQuantity(ctx.korona, mapping, { autoEnableTracking: false });
    if (resolved.status === "ok") koronaQty = resolved.qty;
    else koronaStatus = resolved.status;
  }

  const product = await getShipheroProduct(ctx, entry.sku);
  shipheroQty = product ? ctx.shiphero.getWarehouseOnHand(product) : null;

  const { status, statusLabel } = classifyStockRow(koronaQty, koronaStatus, shipheroQty);
  return {
    sku: entry.sku,
    productName: entry.productName,
    soldQty: entry.soldQty,
    sources: [...entry.sources],
    koronaQty,
    shipheroQty,
    status,
    statusLabel,
  };
}

export async function getSalesReport(opts: {
  days?: number;
  page?: number;
  limit?: number;
  search?: string;
}): Promise<{
  rows: SalesReportRow[];
  page: number;
  limit: number;
  total: number;
  days: number;
  periodLabel: string;
}> {
  const days = Math.min(30, Math.max(1, opts.days ?? 1));
  const page = Math.max(1, opts.page ?? 1);
  const limit = Math.min(100, Math.max(10, opts.limit ?? 50));
  const search = opts.search?.trim().toLowerCase() ?? "";

  const ctx = createReportClients();
  const salesRaw = await getCachedKoronaSales(ctx.korona, days);

  let entries = [...salesRaw.values()].sort((a, b) => b.soldQty - a.soldQty);
  if (search) {
    entries = entries.filter(
      (e) => e.sku.toLowerCase().includes(search) || e.productName.toLowerCase().includes(search)
    );
  }

  const total = entries.length;
  const slice = entries.slice((page - 1) * limit, page * limit);
  const mappingPairs = await Promise.all(
    slice.map(async (entry) => [entry.sku, await findKoronaProductIdBySku(entry.sku)] as const)
  );
  const mappingBySku = new Map(mappingPairs);

  const rows = await mapWithConcurrency(
    slice,
    (entry) => buildSalesReportRow(ctx, entry, mappingBySku.get(entry.sku) ?? null),
    REPORT_CONCURRENCY
  );

  const periodLabel = days === 1 ? "Today (PT)" : `Last ${days} days (PT)`;
  return { rows, page, limit, total, days, periodLabel };
}

export async function getStockReport(opts: {
  page?: number;
  limit?: number;
  search?: string;
  filter?: string;
  days?: number;
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

  const ctx = createReportClients();
  const salesDays = Math.min(30, Math.max(1, opts.days ?? 1));
  const salesMap = salesMapFromRaw(await getCachedKoronaSales(ctx.korona, salesDays));

  if (filter === "all" && !search) {
    const { rows: mappings, total } = await queryProductMappings({ page, limit, search });
    const rows = await buildStockRows(ctx, mappings, salesMap);
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

    const built = await buildStockRows(ctx, batch.rows, salesMap);
    for (const row of built) {
      scanned++;
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

  if (search && results.length === 0) {
    const liveRows = await stockRowsFromKoronaLiveSearch(ctx, search, salesMap, filter);
    return {
      rows: liveRows.slice(0, limit),
      page,
      limit,
      total: liveRows.length,
      scanned: liveRows.length,
    };
  }

  return {
    rows: results,
    page,
    limit,
    total: filter === "all" ? totalMappings : matched.length,
    scanned,
  };
}

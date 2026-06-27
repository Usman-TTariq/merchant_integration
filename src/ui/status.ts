import { config } from "../config.js";
import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";
import {
  receiptLinesMatchProduct,
  receiptSaleLines,
} from "../utils/korona-receipt.js";
import { formatDisplayTime } from "./format-time.js";
import { queryProductMappings } from "../db.js";
import type { KoronaCustomerOrder, KoronaProduct, KoronaReceipt, KoronaResultList } from "../types/korona.js";

export interface ServiceStatus {
  ok: boolean;
  message: string;
  detail?: string;
}

export interface DashboardStatus {
  korona: ServiceStatus;
  shiphero: ServiceStatus;
  config: {
    accountId: string;
    skuField: string;
    warehouseId: string | null;
    shipheroAuthMode: string;
    databaseProvider: string;
    databaseDetail: string;
    displayTimezone: string;
  };
}

export async function checkKorona(): Promise<ServiceStatus & { productTotal?: number }> {
  try {
    const korona = new KoronaClient();
    const list = await korona.getProducts({ page: 1 });
    return {
      ok: true,
      message: "Connected",
      detail: `${list.resultsTotal ?? 0} products in Korona`,
      productTotal: list.resultsTotal ?? 0,
    };
  } catch (err) {
    return {
      ok: false,
      message: "Connection failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function checkShipHero(): Promise<ServiceStatus> {
  if (config.shiphero.authMode === "none") {
    return { ok: false, message: "Not configured", detail: "Add ShipHero credentials in .env" };
  }

  try {
    const shiphero = new ShipHeroClient();
    await shiphero.graphql<{ account: { data: { id: string } | null } }>(
      `query { account { data { id email } } }`
    );
    return { ok: true, message: "Connected", detail: "GraphQL API responding" };
  } catch (err) {
    return {
      ok: false,
      message: "Connection failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

// Cache status for 60 s to avoid hammering external APIs on every dashboard refresh
let _statusCache: { data: DashboardStatus; expiresAt: number } | null = null;
let _statusInflight: Promise<DashboardStatus> | null = null;
const STATUS_TTL_MS = 60_000;

export async function getDashboardStatus(): Promise<DashboardStatus> {
  const now = Date.now();

  // Return cached value if still fresh
  if (_statusCache && now < _statusCache.expiresAt) {
    return _statusCache.data;
  }

  // Deduplicate concurrent callers — only one external fetch at a time
  if (_statusInflight) return _statusInflight;

  _statusInflight = (async () => {
    try {
      const [korona, shiphero] = await Promise.all([checkKorona(), checkShipHero()]);
      const result: DashboardStatus = {
        korona,
        shiphero,
        config: {
          accountId: config.korona.accountId,
          skuField: config.sync.skuField,
          warehouseId: config.shiphero.warehouseId ?? null,
          shipheroAuthMode: config.shiphero.authMode,
          databaseProvider: config.database.provider,
          databaseDetail:
            config.database.provider === "supabase"
              ? (config.database.supabaseUrl ?? "supabase")
              : config.database.sqlitePath,
          displayTimezone: config.dashboard.displayTimezone,
        },
      };
      _statusCache = { data: result, expiresAt: Date.now() + STATUS_TTL_MS };
      return result;
    } finally {
      _statusInflight = null;
    }
  })();

  return _statusInflight;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const PARTIAL_UUID_RE = /^[0-9a-f-]{8,}$/i;

function isFullUuid(term: string): boolean {
  return UUID_RE.test(term);
}

function isPartialUuid(term: string): boolean {
  return PARTIAL_UUID_RE.test(term) && term.includes("-");
}

/** Strip a leading dash when the user pasted the tail of a Korona UUID. */
function normalizeSearchTerm(term: string): string {
  const t = term.trim();
  if (t.startsWith("-") && /^-[0-9a-f-]{8,}$/i.test(t)) {
    return t.slice(1);
  }
  return t;
}

function productsFromList(products: KoronaProduct[]): KoronaResultList<KoronaProduct> {
  return {
    currentPage: 1,
    pagesTotal: 1,
    resultsTotal: products.length,
    resultsOfPage: products.length,
    results: products,
  };
}

async function safeGetProducts(
  korona: KoronaClient,
  opts: Parameters<KoronaClient["getProducts"]>[0]
): Promise<KoronaResultList<KoronaProduct> | undefined> {
  try {
    return await korona.getProducts(opts);
  } catch {
    return undefined;
  }
}

async function safeGetReceipts(
  korona: KoronaClient,
  opts: Parameters<KoronaClient["getReceipts"]>[0]
): Promise<KoronaResultList<KoronaReceipt> | undefined> {
  try {
    return await korona.getReceipts(opts);
  } catch {
    return undefined;
  }
}

function singleResultList<T>(item: T): KoronaResultList<T> {
  return {
    currentPage: 1,
    pagesTotal: 1,
    resultsTotal: 1,
    resultsOfPage: 1,
    results: [item],
  };
}

function emptyResultList<T>(): KoronaResultList<T> {
  return {
    currentPage: 1,
    pagesTotal: 1,
    resultsTotal: 0,
    resultsOfPage: 0,
    results: [],
  };
}

function hasResults<T>(list: KoronaResultList<T> | undefined): list is KoronaResultList<T> {
  return Boolean(list?.results?.length);
}

async function searchKoronaProductsFromMappings(
  korona: KoronaClient,
  term: string,
  limit: number
): Promise<KoronaProduct[]> {
  const { rows } = await queryProductMappings({ page: 1, limit, search: term });
  const products: KoronaProduct[] = [];
  for (const row of rows) {
    const id = String(row.korona_product_id ?? "");
    if (!id) continue;
    try {
      products.push(await korona.getProduct(id));
    } catch {
      /* skip missing product */
    }
  }
  return products;
}

export async function searchKoronaProducts(
  korona: KoronaClient,
  term: string,
  page: number,
  size: number
): Promise<KoronaResultList<KoronaProduct>> {
  const normalized = normalizeSearchTerm(term);
  const base = { page, size };

  if (isFullUuid(normalized)) {
    try {
      const product = await korona.getProduct(normalized);
      return singleResultList(product);
    } catch {
      /* fall through */
    }
  }

  if (isPartialUuid(normalized)) {
    const mapped = await searchKoronaProductsFromMappings(korona, normalized, size);
    if (mapped.length) return productsFromList(mapped);
  }

  let list = await safeGetProducts(korona, { ...base, number: normalized });
  if (hasResults(list)) return list;

  list = await safeGetProducts(korona, { ...base, productCodes: normalized });
  if (hasResults(list)) return list;

  list = await safeGetProducts(korona, { ...base, name: normalized });
  if (hasResults(list)) return list;

  const mapped = await searchKoronaProductsFromMappings(korona, normalized, size);
  if (mapped.length) return productsFromList(mapped);

  return emptyResultList();
}

/** Resolve a search term to Korona product UUID(s), if any. */
export async function resolveKoronaProductIds(
  korona: KoronaClient,
  term: string,
  limit = 5
): Promise<string[]> {
  const list = await searchKoronaProducts(korona, term.trim(), 1, limit);
  return (list.results ?? []).map((p) => p.id).filter(Boolean);
}

async function receiptMatchesProduct(
  korona: KoronaClient,
  receipt: KoronaReceipt,
  productId: string,
  productNumber?: string
): Promise<boolean> {
  const listLines = receiptSaleLines(receipt);
  if (listLines.length) {
    return receiptLinesMatchProduct(listLines, productId, productNumber);
  }

  try {
    const full = await korona.getReceipt(receipt.id);
    return receiptLinesMatchProduct(receiptSaleLines(full), productId, productNumber);
  } catch {
    return false;
  }
}

/** Korona's `product` query param is ignored by the API — scan receipts and match sale lines locally. */
const RECEIPT_SCAN_CONCURRENCY = 8;
const PRODUCT_RECEIPT_SEARCH_TTL_MS = 5 * 60_000;
const productReceiptSearchCache = new Map<
  string,
  { result: KoronaResultList<KoronaReceipt>; expiresAt: number }
>();

async function mapWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  concurrency: number
): Promise<R[]> {
  const results: R[] = [];
  for (let i = 0; i < items.length; i += concurrency) {
    const chunk = items.slice(i, i + concurrency);
    results.push(...(await Promise.all(chunk.map(fn))));
  }
  return results;
}

async function searchReceiptsByProductId(
  korona: KoronaClient,
  productId: string,
  page: number,
  size: number,
  productNumber?: string
): Promise<KoronaResultList<KoronaReceipt>> {
  const cacheKey = `${productId}:${page}:${size}`;
  const cached = productReceiptSearchCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.result;
  }

  const matched: KoronaReceipt[] = [];
  let pagesTotal = 1;

  for (let p = 1; p <= pagesTotal; p++) {
    const batch = await safeGetReceipts(korona, { page: p, size: 100 });
    if (!hasResults(batch)) break;
    pagesTotal = batch.pagesTotal ?? p;

    const receipts = batch.results ?? [];
    const hits = await mapWithConcurrency(
      receipts,
      (receipt) => receiptMatchesProduct(korona, receipt, productId, productNumber),
      RECEIPT_SCAN_CONCURRENCY
    );
    for (let i = 0; i < receipts.length; i++) {
      if (hits[i]) matched.push(receipts[i]!);
    }
  }

  const result = !matched.length
    ? emptyResultList<KoronaReceipt>()
    : (() => {
        const start = (page - 1) * size;
        const pageResults = matched.slice(start, start + size);
        return {
          currentPage: page,
          pagesTotal: Math.max(1, Math.ceil(matched.length / size)),
          resultsTotal: matched.length,
          resultsOfPage: pageResults.length,
          results: pageResults,
        };
      })();

  productReceiptSearchCache.set(cacheKey, {
    result,
    expiresAt: Date.now() + PRODUCT_RECEIPT_SEARCH_TTL_MS,
  });
  return result;
}

async function searchKoronaReceipts(
  korona: KoronaClient,
  term: string,
  page: number,
  size: number
): Promise<KoronaResultList<KoronaReceipt>> {
  const normalized = normalizeSearchTerm(term);
  let list = await safeGetReceipts(korona, { page, size, number: normalized });
  if (hasResults(list)) return list;

  if (isFullUuid(normalized)) {
    try {
      const receipt = await korona.getReceipt(normalized);
      return singleResultList(receipt);
    } catch {
      /* not a receipt id — try as product id below */
    }
  }

  const productList = await searchKoronaProducts(korona, normalized, 1, 1);
  const product = productList.results?.[0];
  if (product?.id) {
    return searchReceiptsByProductId(
      korona,
      product.id,
      page,
      size,
      product.number ?? undefined
    );
  }

  return emptyResultList();
}

async function searchKoronaCustomerOrders(
  korona: KoronaClient,
  term: string,
  page: number,
  size: number
): Promise<KoronaResultList<KoronaCustomerOrder> | undefined> {
  let list = await korona.getCustomerOrders({ page, size, number: term });
  if (list?.results?.length) return list;

  if (UUID_RE.test(term)) {
    try {
      const order = await korona.getCustomerOrder(term);
      return singleResultList(order);
    } catch {
      /* not found */
    }
  }

  return emptyResultList();
}

export async function getKoronaProductsLive(page = 1, search = "", size = 25) {
  const korona = new KoronaClient();
  const term = search.trim();
  const list = term
    ? await searchKoronaProducts(korona, term, page, size)
    : (await korona.getProducts({ page, size })) ?? emptyResultList<KoronaProduct>();
  return {
    total: list.resultsTotal ?? 0,
    pages: list.pagesTotal ?? 1,
    page: list.currentPage ?? page,
    search: term || undefined,
    products: (list.results ?? []).map((p) => ({
      id: p.id,
      number: p.number ?? "",
      name: p.name ?? "",
      deleted: Boolean(p.deleted),
      revision: p.revision ?? null,
      barcode: (() => {
        const rows = p.codes ?? [];
        const primary = rows.find((c) => c.primary) ?? rows[0];
        return (primary?.productCode ?? primary?.code ?? "").trim();
      })(),
      price: p.prices?.[0]?.value ?? null,
    })),
  };
}

export async function getKoronaOrdersLive(page = 1, search = "", size = 100) {
  const korona = new KoronaClient();
  const term = search.trim();
  const list = term
    ? await searchKoronaCustomerOrders(korona, term, page, size)
    : await korona.getCustomerOrders({ page, size });
  if (!list) {
    return {
      total: 0,
      pages: 1,
      page: 1,
      search: term || undefined,
      orders: [] as Array<{
        id: string;
        number: string;
        deleted: boolean;
        revision: number | null;
        lineCount: number;
        creationTime: string;
      }>,
    };
  }

  return {
    total: list.resultsTotal ?? 0,
    pages: list.pagesTotal ?? 1,
    page: list.currentPage ?? page,
    search: term || undefined,
    orders: (list.results ?? []).map((o) => ({
      id: o.id,
      number: o.number ?? "",
      deleted: Boolean(o.deleted),
      revision: o.revision ?? null,
      lineCount: (o.items ?? o.orderLines ?? []).length,
      creationTime: formatDisplayTime(o.creationTime),
    })),
  };
}

export async function getKoronaReceiptsLive(page = 1, search = "", size = 100) {
  const korona = new KoronaClient();
  const term = normalizeSearchTerm(search);
  const list =
    (term
      ? await searchKoronaReceipts(korona, term, page, size)
      : await korona.getReceipts({ page, size })) ?? emptyResultList<KoronaReceipt>();

  let productMatch: { id: string; number: string; name: string } | undefined;
  if (term && (list.resultsTotal ?? 0) === 0) {
    const products = await searchKoronaProducts(korona, term, 1, 1);
    const hit = products.results?.[0];
    if (hit) {
      productMatch = {
        id: hit.id,
        number: hit.number ?? "",
        name: hit.name ?? "",
      };
    }
  }

  return {
    total: list.resultsTotal ?? 0,
    pages: list.pagesTotal ?? 1,
    page: list.currentPage ?? page,
    search: term || undefined,
    productMatch,
    receipts: (list.results ?? []).map((r) => ({
      id: r.id,
      number: r.number ?? "",
      revision: r.revision ?? null,
      lineCount: receiptSaleLines(r).length,
      creationTime: formatDisplayTime(r.creationTime),
      modificationTime: formatDisplayTime(r.modificationTime),
    })),
  };
}

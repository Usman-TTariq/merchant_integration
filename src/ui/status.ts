import { config } from "../config.js";
import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";
import { receiptSaleLines } from "../utils/korona-receipt.js";
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

async function searchKoronaProducts(
  korona: KoronaClient,
  term: string,
  page: number,
  size: number
): Promise<KoronaResultList<KoronaProduct>> {
  const base = { page, size };

  let list = await korona.getProducts({ ...base, number: term });
  if (hasResults(list)) return list;

  list = await korona.getProducts({ ...base, productCodes: term });
  if (hasResults(list)) return list;

  list = await korona.getProducts({ ...base, name: term });
  if (hasResults(list)) return list;

  if (UUID_RE.test(term)) {
    try {
      const product = await korona.getProduct(term);
      return singleResultList(product);
    } catch {
      /* not found */
    }
  }

  const mapped = await searchKoronaProductsFromMappings(korona, term, size);
  if (mapped.length) {
    return {
      currentPage: 1,
      pagesTotal: 1,
      resultsTotal: mapped.length,
      resultsOfPage: mapped.length,
      results: mapped,
    };
  }

  return emptyResultList();
}

async function searchKoronaReceipts(
  korona: KoronaClient,
  term: string,
  page: number,
  size: number
): Promise<KoronaResultList<KoronaReceipt>> {
  let list = await korona.getReceipts({ page, size, number: term });
  if (hasResults(list)) return list;

  if (UUID_RE.test(term)) {
    try {
      const receipt = await korona.getReceipt(term);
      return singleResultList(receipt);
    } catch {
      /* not found */
    }
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
      barcode: p.codes?.find((c) => c.primary)?.code ?? p.codes?.[0]?.code ?? "",
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
  const term = search.trim();
  const list = term
    ? await searchKoronaReceipts(korona, term, page, size)
    : await korona.getReceipts({ page, size });
  return {
    total: list.resultsTotal ?? 0,
    pages: list.pagesTotal ?? 1,
    page: list.currentPage ?? page,
    search: term || undefined,
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

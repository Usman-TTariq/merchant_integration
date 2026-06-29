import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { deleteErrorLogs, deleteWarningLogs, initDatabase, logSync } from "../db.js";
import { runSyncJob, type SyncJob } from "../sync/run-job.js";
import { runBarcodeJob, type BarcodeJob } from "../sync/run-barcode-job.js";
import { isCronAuthorized } from "./cron-auth.js";
import {
  getCursors,
  getLogs,
  getLogsSummary,
  getOrdersWithMeta,
  getProducts,
  getReceiptsWithMeta,
  getStats,
} from "./dashboard-data.js";
import {
  clearSessionCookieHeader,
  createSessionToken,
  isAuthenticated,
  isDashboardAuthEnabled,
  isPublicPath,
  sessionCookieHeader,
  verifyPassword,
} from "./auth.js";
import { exportAllLogsCsv, exportAllReceiptsCsv, exportShipheroInventoryCsv } from "./export-data.js";
import { buildReceiptDownload } from "./receipt-download.js";
import { getReportSummary, getSalesReport, getStockReport } from "./reporting-data.js";
import {
  getDashboardStatus,
  getKoronaOrdersLive,
  getKoronaProductsLive,
  getKoronaReceiptsLive,
} from "./status.js";
import { buildGenericLabelInput } from "../utils/shiphero-label-print.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = fs.existsSync(path.join(process.cwd(), "public"))
  ? path.join(process.cwd(), "public")
  : path.resolve(__dirname, "../../public");
const PORT = Number(process.env.DASHBOARD_PORT ?? "3847");

let syncRunning = false;

// ─── Simple in-memory cache ───────────────────────────────────────────────────
interface CacheEntry<T> {
  data: T;
  expiresAt: number;
  inflight?: Promise<T>;
}
const _cache = new Map<string, CacheEntry<unknown>>();

function cached<T>(key: string, ttlMs: number, fn: () => Promise<T>): Promise<T> {
  const now = Date.now();
  const entry = _cache.get(key) as CacheEntry<T> | undefined;
  if (entry && now < entry.expiresAt) return Promise.resolve(entry.data);
  if (entry?.inflight) return entry.inflight;
  const inflight: Promise<T> = fn().then((data) => {
    _cache.set(key, { data, expiresAt: Date.now() + ttlMs });
    return data;
  }).finally(() => {
    const e = _cache.get(key) as CacheEntry<T> | undefined;
    if (e) delete e.inflight;
  });
  _cache.set(key, { data: (entry?.data ?? null) as T, expiresAt: 0, inflight });
  return inflight;
}
// ─────────────────────────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".png": "image/png",
};

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendHtmlFile(res: http.ServerResponse, status: number, html: string, filename: string): void {
  res.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
  res.end(html);
}

function sendCsvFile(res: http.ServerResponse, status: number, csv: string, filename: string): void {
  res.writeHead(status, {
    "Content-Type": "text/csv; charset=utf-8",
    "Content-Disposition": `attachment; filename="${filename}"`,
  });
  res.end("\uFEFF" + csv);
}

function isSecureRequest(req: http.IncomingMessage): boolean {
  if (process.env.VERCEL) return true;
  const proto = req.headers["x-forwarded-proto"];
  return proto === "https";
}

function redirect(res: http.ServerResponse, location: string): void {
  res.writeHead(302, { Location: location });
  res.end();
}

async function readJsonBody(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  return JSON.parse(raw) as unknown;
}

function enforceAuth(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  pathname: string
): boolean {
  if (!isDashboardAuthEnabled() || isPublicPath(pathname)) return true;
  if (isAuthenticated(req)) return true;

  if (pathname.startsWith("/api/")) {
    sendJson(res, 401, { error: "Unauthorized", authenticated: false });
    return false;
  }

  redirect(res, "/login.html");
  return false;
}

function parseQuery(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

function serveFavicon(res: http.ServerResponse): boolean {
  const full = path.join(PUBLIC_DIR, "favicon.ico");
  if (!fs.existsSync(full)) return false;
  res.writeHead(200, {
    "Content-Type": "image/x-icon",
    "Cache-Control": "public, max-age=86400",
  });
  fs.createReadStream(full).pipe(res);
  return true;
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const relative =
    url.pathname === "/" ? "index.html" : url.pathname.replace(/^\//, "").replace(/^(\.\.[/\\])+/, "");
  const full = path.join(PUBLIC_DIR, relative);

  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    return false;
  }

  const ext = path.extname(full);
  const headers: Record<string, string> = {
    "Content-Type": MIME[ext] ?? "application/octet-stream",
  };
  if (ext === ".html" || ext === ".js" || ext === ".css") {
    headers["Cache-Control"] = "no-cache, must-revalidate";
  }
  res.writeHead(200, headers);
  fs.createReadStream(full).pipe(res);
  return true;
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const q = parseQuery(url);

  try {
    if (req.method === "POST" && url.pathname === "/api/auth/login") {
      if (!isDashboardAuthEnabled()) {
        return sendJson(res, 200, { ok: true, authenticated: true, authDisabled: true });
      }
      const body = (await readJsonBody(req)) as { password?: string };
      if (!verifyPassword(body.password ?? "")) {
        return sendJson(res, 401, { error: "Invalid password" });
      }
      const token = createSessionToken();
      res.setHeader("Set-Cookie", sessionCookieHeader(token, isSecureRequest(req)));
      return sendJson(res, 200, { ok: true, authenticated: true });
    }

    if (req.method === "POST" && url.pathname === "/api/auth/logout") {
      res.setHeader("Set-Cookie", clearSessionCookieHeader(isSecureRequest(req)));
      return sendJson(res, 200, { ok: true, authenticated: false });
    }

    if (url.pathname.startsWith("/api/cron/")) {
      if (req.method !== "GET" && req.method !== "POST") {
        return sendJson(res, 405, { error: "Method not allowed" });
      }
      if (!isCronAuthorized(req)) {
        return sendJson(res, 401, { error: "Unauthorized cron request" });
      }

      const job = url.pathname.replace("/api/cron/", "");
      const barcodeJobs = ["barcode-cache", "barcode-index", "link", "barcode-link"] as const;
      const syncJobs = ["products", "inventory", "orders", "stock"] as const;

      if (barcodeJobs.includes(job as (typeof barcodeJobs)[number])) {
        if (syncRunning) {
          return sendJson(res, 409, { error: "Sync already running" });
        }
        syncRunning = true;
        try {
          await logSync("cron", "info", `Cron barcode job started: ${job}`);
          const results = await runBarcodeJob(job as BarcodeJob);
          await logSync("cron", "info", `Cron barcode job finished: ${job} ${JSON.stringify(results)}`);
          return sendJson(res, 200, { ok: true, job, results });
        } catch (err) {
          await logSync("cron", "error", `Cron barcode job failed (${job}): ${err instanceof Error ? err.message : String(err)}`);
          return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
        } finally {
          syncRunning = false;
        }
      }

      if (!syncJobs.includes(job as (typeof syncJobs)[number])) {
        return sendJson(res, 404, { error: "Unknown cron job" });
      }
      if (syncRunning) {
        return sendJson(res, 409, { error: "Sync already running" });
      }

      syncRunning = true;
      try {
        await logSync("cron", "info", `Cron sync started: ${job}`);
        const results = await runSyncJob(job as SyncJob);
        await logSync("cron", "info", `Cron sync finished: ${job} ${JSON.stringify(results)}`);
        return sendJson(res, 200, { ok: true, job, results });
      } catch (err) {
        await logSync("cron", "error", `Cron sync failed (${job}): ${err instanceof Error ? err.message : String(err)}`);
        return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      } finally {
        syncRunning = false;
      }
    }

    if (req.method === "GET" && url.pathname === "/api/auth/session") {
      return sendJson(res, 200, {
        authenticated: isAuthenticated(req),
        authEnabled: isDashboardAuthEnabled(),
      });
    }

    if (!enforceAuth(req, res, url.pathname)) return;

    if (req.url?.startsWith("/api/") && url.pathname !== "/api/health") {
      await initDatabase();
    }

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        provider: config.database.provider,
        vercel: Boolean(process.env.VERCEL),
        supabaseConfigured: Boolean(config.database.supabaseUrl && config.database.supabaseServiceKey),
      });
    }

    if (req.method === "GET" && url.pathname === "/api/status") {
      return sendJson(res, 200, await getDashboardStatus());
    }

    if (req.method === "GET" && url.pathname === "/api/stats") {
      return sendJson(res, 200, await getStats());
    }

    if (req.method === "GET" && url.pathname === "/api/cursors") {
      return sendJson(res, 200, await getCursors());
    }

    if (req.method === "GET" && url.pathname === "/api/products") {
      return sendJson(
        res,
        200,
        await getProducts(
          Number(q.page ?? 1),
          Number(q.limit ?? 50),
          q.search ?? "",
          q.linked === "1" || q.linked === "true"
        )
      );
    }

    if (req.method === "GET" && url.pathname === "/api/orders") {
      return sendJson(
        res,
        200,
        await getOrdersWithMeta(Number(q.page ?? 1), Number(q.limit ?? 50), q.search ?? "")
      );
    }

    if (req.method === "GET" && url.pathname === "/api/korona/orders") {
      return sendJson(
        res,
        200,
        await getKoronaOrdersLive(Number(q.page ?? 1), q.search ?? "", Number(q.limit ?? 100))
      );
    }

    if (req.method === "GET" && url.pathname === "/api/receipts") {
      return sendJson(
        res,
        200,
        await getReceiptsWithMeta(Number(q.page ?? 1), Number(q.limit ?? 50), q.search ?? "")
      );
    }

    if (req.method === "GET" && url.pathname === "/api/korona/receipts") {
      return sendJson(
        res,
        200,
        await getKoronaReceiptsLive(Number(q.page ?? 1), q.search ?? "", Number(q.limit ?? 100))
      );
    }

    const receiptDownload = url.pathname.match(/^\/api\/korona\/receipts\/([^/]+)\/download$/);
    if (req.method === "GET" && receiptDownload) {
      const receiptId = decodeURIComponent(receiptDownload[1]!);
      const doc = await buildReceiptDownload(receiptId);
      return sendHtmlFile(res, 200, doc.html, doc.filename);
    }

    if (req.method === "GET" && url.pathname === "/api/export/receipts.csv") {
      const result = await exportAllReceiptsCsv();
      return sendCsvFile(res, 200, result.csv, "winchateau-receipts.csv");
    }

    if (req.method === "GET" && url.pathname === "/api/export/logs.csv") {
      const result = await exportAllLogsCsv(q.level ?? "");
      const suffix = q.level ? `-${q.level}` : "";
      return sendCsvFile(res, 200, result.csv, `sync-logs${suffix}.csv`);
    }

    if (req.method === "GET" && url.pathname === "/api/export/shiphero-inventory.csv") {
      const from = q.from?.trim() ?? "";
      const to = q.to?.trim() ?? "";
      if (!from || !to) return sendJson(res, 400, { error: "from and to query params required (YYYY-MM-DD)" });
      const result = await exportShipheroInventoryCsv({ from, to, storeName: q.store?.trim() });
      return sendCsvFile(res, 200, result.csv, `shiphero-inventory-${from}-to-${to}.csv`);
    }

    if (req.method === "GET" && url.pathname === "/api/logs") {
      return sendJson(
        res,
        200,
        await getLogs(Number(q.page ?? 1), Number(q.limit ?? 100), q.level ?? "", q.search ?? "")
      );
    }

    if (req.method === "GET" && url.pathname === "/api/logs/summary") {
      return sendJson(res, 200, await getLogsSummary());
    }

    if (req.method === "GET" && url.pathname === "/api/reports/summary") {
      return sendJson(
        res,
        200,
        await cached("reports:summary", 2 * 60_000, () => getReportSummary())
      );
    }

    if (req.method === "GET" && url.pathname === "/api/reports/stock") {
      const stockKey = `reports:stock:${q.page ?? 1}:${q.limit ?? 25}:${q.filter ?? "all"}:${q.days ?? 1}:${q.search ?? ""}`;
      return sendJson(
        res,
        200,
        await cached(stockKey, 2 * 60_000, () =>
          getStockReport({
            page: Number(q.page ?? 1),
            limit: Number(q.limit ?? 25),
            search: q.search ?? "",
            filter: q.filter ?? "all",
            days: Number(q.days ?? 1),
          })
        )
      );
    }

    if (req.method === "GET" && url.pathname === "/api/shiphero/sku") {
      const sku = q.sku?.trim();
      if (!sku) return sendJson(res, 400, { error: "sku required" });
      try {
        const { ShipHeroClient } = await import("../clients/shiphero.js");
        const sh = new ShipHeroClient();
        const product = await sh.getProductBySku(sku);
        if (!product) return sendJson(res, 404, { found: false, sku });
        const { requireShipheroWarehouseId } = await import("../config.js");
        const warehouseId = requireShipheroWarehouseId();
        const row = product.warehouse_products?.find((w) => w.warehouse_id === warehouseId);
        return sendJson(res, 200, {
          found: true,
          sku: product.sku,
          name: product.name,
          onHand: row?.on_hand ?? 0,
        });
      } catch (err) {
        return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/shiphero/orders") {
      try {
        const { ShipHeroClient } = await import("../clients/shiphero.js");
        const sh = new ShipHeroClient();
        const search = (q.search ?? "").trim().toLowerCase();
        const statusFilter = (q.status ?? "").trim().toLowerCase();
        const after = q.after?.trim() || null;
        const first = Math.min(Number(q.limit ?? 25), 50);

        type OrderNode = {
          id: string;
          order_number: string;
          partner_order_id: string;
          fulfillment_status: string;
          updated_at: string;
          shipping_address: { first_name?: string; last_name?: string; city?: string; state?: string; country?: string } | null;
          line_items: { edges: Array<{ node: { sku: string; quantity: number; quantity_shipped: number; fulfillment_status: string } }> };
        };
        type OrdersResp = {
          orders: {
            data: {
              pageInfo: { hasNextPage: boolean; endCursor: string | null };
              edges: Array<{ node: OrderNode }>;
            };
          };
        };

        // Cache per page/cursor — orders change rarely; 2 min TTL
        const cacheKey = `sh:orders:${first}:${after ?? "start"}`;
        const raw = await cached(cacheKey, 2 * 60_000, () =>
          sh.graphql<OrdersResp>(
            `query ShOrders($first: Int, $after: String) {
              orders {
                data(first: $first, after: $after) {
                  pageInfo { hasNextPage endCursor }
                  edges {
                    node {
                      id
                      order_number
                      partner_order_id
                      fulfillment_status
                      updated_at
                      shipping_address { first_name last_name city state country }
                      line_items(first: 30) {
                        edges {
                          node { sku quantity quantity_shipped fulfillment_status }
                        }
                      }
                    }
                  }
                }
              }
            }`,
            { first, after }
          )
        );

        const conn = raw.orders.data;
        let orders = conn.edges.map((e) => {
          const n = e.node;
          const addr = n.shipping_address;
          return {
            ...n,
            shipping_address: addr
              ? { ...addr, full_name: `${addr.first_name ?? ""} ${addr.last_name ?? ""}`.trim() }
              : null,
          };
        });

        // client-side filter (search + status)
        if (search) {
          orders = orders.filter(
            (o) =>
              o.order_number?.toLowerCase().includes(search) ||
              o.partner_order_id?.toLowerCase().includes(search) ||
              o.line_items?.edges?.some((e) => e.node.sku?.toLowerCase().includes(search))
          );
        }
        if (statusFilter) orders = orders.filter((o) => (o.fulfillment_status ?? "").toLowerCase() === statusFilter);

        return sendJson(res, 200, { orders, pageInfo: conn.pageInfo });
      } catch (err) {
        return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    const printLabelMatch = url.pathname.match(/^\/api\/shiphero\/orders\/([^/]+)\/print-label$/);
    if (req.method === "POST" && printLabelMatch) {
      const orderId = decodeURIComponent(printLabelMatch[1] ?? "");
      if (!orderId) return sendJson(res, 400, { error: "order id required" });
      try {
        const { ShipHeroClient } = await import("../clients/shiphero.js");
        const sh = new ShipHeroClient();
        const order = await sh.getOrderById(orderId);
        if (!order) return sendJson(res, 404, { error: "Order not found" });

        let input;
        try {
          input = buildGenericLabelInput(order);
        } catch (err) {
          return sendJson(res, 400, {
            error: err instanceof Error ? err.message : String(err),
          });
        }

        const result = await sh.labelPrint(input);
        const labels = (result.labels ?? []).map((label) => ({
          id: label.id,
          tracking_number: label.tracking_number,
          tracking_url: label.tracking_url,
          order_number: label.order_number,
          carrier: label.carrier,
          shipping_method: label.shipping_method,
          status: label.status,
          pdf_location: label.label?.pdf_location,
          paper_pdf_location: label.label?.paper_pdf_location,
          thermal_pdf_location: label.label?.thermal_pdf_location,
          image_location: label.label?.image_location,
        }));

        const tracking = labels.map((l) => l.tracking_number).filter(Boolean).join(", ");
        await logSync(
          "labels",
          "info",
          `Label print order ${order.order_number ?? orderId}: request_id=${result.request_id ?? "?"} tracking=${tracking || "n/a"}`
        );

        return sendJson(res, 200, {
          request_id: result.request_id,
          complexity: result.complexity,
          labels,
        });
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        await logSync("labels", "error", `Label print failed (${orderId}): ${message}`);
        return sendJson(res, 500, { error: message });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/shiphero/products") {
      try {
        const { ShipHeroClient } = await import("../clients/shiphero.js");
        const sh = new ShipHeroClient();
        const search = (q.search ?? "").trim().toLowerCase();
        const after = q.after?.trim() || null;
        const first = Math.min(Number(q.limit ?? 25), 50);

        type ProductsResp = {
          products: {
            data: {
              pageInfo: { hasNextPage: boolean; endCursor: string | null };
              edges: Array<{ node: Record<string, unknown> }>;
            };
          };
        };

        // Cache per page/cursor only when NOT searching (search needs fresh filtered results)
        const cacheKey = `sh:products:${first}:${after ?? "start"}`;
        const rawData = await cached(cacheKey, 5 * 60_000, () =>
          sh.graphql<ProductsResp>(
            `query ShProducts($first: Int, $after: String) {
              products {
                data(first: $first, after: $after) {
                  pageInfo { hasNextPage endCursor }
                  edges {
                    node {
                      id
                      sku
                      name
                      barcode
                      price
                      value
                      warehouse_products {
                        warehouse_id
                        on_hand
                        available
                        allocated
                        backorder
                      }
                    }
                  }
                }
              }
            }`,
            { first, after }
          )
        );

        const conn = rawData.products.data;
        const { requireShipheroWarehouseId } = await import("../config.js");
        let warehouseId = "";
        try { warehouseId = requireShipheroWarehouseId(); } catch { /* ignore */ }

        let products = conn.edges.map((e) => {
          const p = e.node as {
            id: string; sku: string; name: string; barcode?: string; price?: string; value?: string;
            warehouse_products?: Array<{ warehouse_id: string; on_hand: number; available?: number; allocated?: number; backorder?: number }>;
          };
          const row = p.warehouse_products?.find((w) => w.warehouse_id === warehouseId);
          return {
            id: p.id,
            sku: p.sku ?? "",
            name: p.name ?? "",
            barcode: p.barcode ?? "",
            price: p.price ?? "",
            value: p.value ?? "",
            onHand: row?.on_hand ?? 0,
            available: row?.available ?? 0,
            allocated: row?.allocated ?? 0,
            backorder: row?.backorder ?? 0,
          };
        });

        // If searching: try direct SKU lookup first (exact), then filter current page
        if (search) {
          // Direct exact-match lookup via product(sku:) query
          try {
            const exactResult = await sh.graphql<{ product: { data: { id: string; sku: string; name: string; barcode?: string; price?: string; value?: string; warehouse_products?: Array<{ warehouse_id: string; on_hand: number; available?: number; allocated?: number; backorder?: number }> } | null } }>(
              `query SearchBySku($sku: String!) {
                product(sku: $sku) {
                  data {
                    id sku name barcode price value
                    warehouse_products { warehouse_id on_hand available allocated backorder }
                  }
                }
              }`,
              { sku: q.search?.trim() }
            );
            if (exactResult.product.data) {
              const p = exactResult.product.data;
              const row = p.warehouse_products?.find((w) => w.warehouse_id === warehouseId);
              return sendJson(res, 200, {
                products: [{
                  id: p.id, sku: p.sku ?? "", name: p.name ?? "", barcode: p.barcode ?? "",
                  price: p.price ?? "", value: p.value ?? "",
                  onHand: row?.on_hand ?? 0, available: row?.available ?? 0,
                  allocated: row?.allocated ?? 0, backorder: row?.backorder ?? 0,
                }],
                pageInfo: { hasNextPage: false, endCursor: null },
                searchMatch: "exact",
              });
            }
          } catch { /* fall through to page filter */ }

          // Fallback: filter current page results
          products = products.filter((p) => p.sku?.toLowerCase().includes(search) || p.name?.toLowerCase().includes(search));
        }

        products.sort(
          (a, b) =>
            (b.onHand ?? 0) - (a.onHand ?? 0) ||
            (a.sku ?? "").localeCompare(b.sku ?? "", undefined, { sensitivity: "base" })
        );

        return sendJson(res, 200, { products, pageInfo: search ? { hasNextPage: false, endCursor: null } : conn.pageInfo });
      } catch (err) {
        return sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
      }
    }

    if (req.method === "GET" && url.pathname === "/api/reports/sales") {
      const salesKey = `reports:sales:${q.page ?? 1}:${q.limit ?? 50}:${q.days ?? 1}:${q.search ?? ""}`;
      return sendJson(
        res,
        200,
        await cached(salesKey, 2 * 60_000, () =>
          getSalesReport({
            page: Number(q.page ?? 1),
            limit: Number(q.limit ?? 50),
            search: q.search ?? "",
            days: Number(q.days ?? 1),
          })
        )
      );
    }

    if (req.method === "POST" && url.pathname === "/api/logs/clear-errors") {
      const deleted = await deleteErrorLogs();
      await logSync("dashboard", "info", `Cleared ${deleted} error log(s)`);
      return sendJson(res, 200, { ok: true, deleted });
    }

    if (req.method === "POST" && url.pathname === "/api/logs/clear-warnings") {
      const deleted = await deleteWarningLogs();
      await logSync("dashboard", "info", `Cleared ${deleted} warning log(s)`);
      return sendJson(res, 200, { ok: true, deleted });
    }

    if (req.method === "GET" && url.pathname === "/api/korona/products") {
      return sendJson(
        res,
        200,
        await getKoronaProductsLive(Number(q.page ?? 1), q.search ?? "", Number(q.size ?? 25))
      );
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/sync/")) {
      const job = url.pathname.replace("/api/sync/", "");
      const barcodeJobs = ["barcode-cache", "barcode-index", "link", "barcode-link"] as const;
      const syncJobs = ["products", "inventory", "orders", "stock", "all"] as const;

      if (barcodeJobs.includes(job as (typeof barcodeJobs)[number])) {
        if (syncRunning) {
          return sendJson(res, 409, { error: "Sync already running" });
        }
        syncRunning = true;
        sendJson(res, 202, { ok: true, job, message: "Barcode job started" });
        void (async () => {
          try {
            await logSync("dashboard", "info", `Manual barcode job started: ${job}`);
            const results = await runBarcodeJob(job as BarcodeJob);
            await logSync("dashboard", "info", `Manual barcode job finished: ${job} ${JSON.stringify(results)}`);
          } catch (err) {
            await logSync(
              "dashboard",
              "error",
              `Manual barcode job failed (${job}): ${err instanceof Error ? err.message : String(err)}`
            );
          } finally {
            syncRunning = false;
          }
        })();
        return;
      }

      if (!syncJobs.includes(job as (typeof syncJobs)[number])) {
        return sendJson(res, 400, { error: "Unknown sync job" });
      }
      if (syncRunning) {
        return sendJson(res, 409, { error: "Sync already running" });
      }

      syncRunning = true;
      sendJson(res, 202, { ok: true, job, message: "Sync started" });

      void (async () => {
        try {
          await logSync("dashboard", "info", `Manual sync started: ${job}`);
          const results = await runSyncJob(job as SyncJob);
          await logSync("dashboard", "info", `Manual sync finished: ${job} ${JSON.stringify(results)}`);
        } catch (err) {
          await logSync(
            "dashboard",
            "error",
            `Manual sync failed (${job}): ${err instanceof Error ? err.message : String(err)}`
          );
        } finally {
          syncRunning = false;
        }
      })();
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  } catch (err) {
    sendJson(res, 500, { error: err instanceof Error ? err.message : String(err) });
  }
}

const server = http.createServer((req, res) => {
  void handleRequest(req, res);
});

export async function handleRequest(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);

  if (url.pathname === "/favicon.ico") {
    if (serveFavicon(res)) return;
  }

  if (req.url?.startsWith("/api/")) {
    await handleApi(req, res);
    return;
  }

  if (isDashboardAuthEnabled() && isAuthenticated(req) && (url.pathname === "/login" || url.pathname === "/login.html")) {
    redirect(res, "/");
    return;
  }

  if (!enforceAuth(req, res, url.pathname)) return;

  if (serveStatic(req, res)) return;
  sendJson(res, 404, { error: "Not found" });
}

const runningDirectly =
  Boolean(process.argv[1]) &&
  path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));

if (runningDirectly && !process.env.VERCEL) {
  void initDatabase()
    .then(() => {
      server.listen(PORT, () => {
        console.log(`Dashboard: http://localhost:${PORT}`);
        console.log(`Database: ${config.database.provider}`);
        const nets = os.networkInterfaces();
        for (const iface of Object.values(nets)) {
          for (const net of iface ?? []) {
            if (net.family === "IPv4" && !net.internal) {
              console.log(`Network:   http://${net.address}:${PORT}`);
            }
          }
        }
      });
    })
    .catch((err: unknown) => {
      console.error("Database init failed:", err);
      process.exit(1);
    });
}

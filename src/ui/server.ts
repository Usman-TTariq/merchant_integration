import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { logSync } from "../db.js";
import { syncInventory } from "../sync/inventory.js";
import { syncOrders } from "../sync/orders.js";
import { syncProducts } from "../sync/products.js";
import {
  getCursors,
  getLogs,
  getOrders,
  getProducts,
  getReceipts,
  getStats,
} from "./dashboard-data.js";
import { getDashboardStatus, getKoronaProductsLive } from "./status.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "../../public");
const PORT = Number(process.env.DASHBOARD_PORT ?? "3847");

let syncRunning = false;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".svg": "image/svg+xml",
};

function sendJson(res: http.ServerResponse, status: number, data: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function parseQuery(url: URL): Record<string, string> {
  const out: Record<string, string> = {};
  url.searchParams.forEach((v, k) => {
    out[k] = v;
  });
  return out;
}

function serveStatic(req: http.IncomingMessage, res: http.ServerResponse): boolean {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  let filePath = url.pathname === "/" ? "/index.html" : url.pathname;
  filePath = path.normalize(filePath).replace(/^(\.\.[/\\])+/, "");
  const full = path.join(PUBLIC_DIR, filePath);

  if (!full.startsWith(PUBLIC_DIR) || !fs.existsSync(full) || fs.statSync(full).isDirectory()) {
    return false;
  }

  const ext = path.extname(full);
  res.writeHead(200, { "Content-Type": MIME[ext] ?? "application/octet-stream" });
  fs.createReadStream(full).pipe(res);
  return true;
}

async function handleApi(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const q = parseQuery(url);

  try {
    if (req.method === "GET" && url.pathname === "/api/status") {
      return sendJson(res, 200, await getDashboardStatus());
    }

    if (req.method === "GET" && url.pathname === "/api/stats") {
      return sendJson(res, 200, getStats());
    }

    if (req.method === "GET" && url.pathname === "/api/cursors") {
      return sendJson(res, 200, getCursors());
    }

    if (req.method === "GET" && url.pathname === "/api/products") {
      return sendJson(
        res,
        200,
        getProducts(Number(q.page ?? 1), Number(q.limit ?? 50), q.search ?? "")
      );
    }

    if (req.method === "GET" && url.pathname === "/api/orders") {
      return sendJson(res, 200, getOrders(Number(q.page ?? 1), Number(q.limit ?? 50)));
    }

    if (req.method === "GET" && url.pathname === "/api/receipts") {
      return sendJson(res, 200, getReceipts(Number(q.page ?? 1), Number(q.limit ?? 50)));
    }

    if (req.method === "GET" && url.pathname === "/api/logs") {
      return sendJson(
        res,
        200,
        getLogs(Number(q.page ?? 1), Number(q.limit ?? 100), q.level ?? "")
      );
    }

    if (req.method === "GET" && url.pathname === "/api/korona/products") {
      return sendJson(
        res,
        200,
        await getKoronaProductsLive(Number(q.page ?? 1))
      );
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/sync/")) {
      const job = url.pathname.replace("/api/sync/", "");
      if (!["products", "inventory", "orders", "all"].includes(job)) {
        return sendJson(res, 400, { error: "Unknown sync job" });
      }
      if (syncRunning) {
        return sendJson(res, 409, { error: "Sync already running" });
      }

      syncRunning = true;
      sendJson(res, 202, { ok: true, job, message: "Sync started" });

      void (async () => {
        try {
          logSync("dashboard", "info", `Manual sync started: ${job}`);
          if (job === "products" || job === "all") await syncProducts();
          if (job === "inventory" || job === "all") await syncInventory();
          if (job === "orders" || job === "all") await syncOrders();
          logSync("dashboard", "info", `Manual sync finished: ${job}`);
        } catch (err) {
          logSync(
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
  void (async () => {
    if (req.url?.startsWith("/api/")) {
      await handleApi(req, res);
      return;
    }
    if (serveStatic(req, res)) return;
    sendJson(res, 404, { error: "Not found" });
  })();
});

server.listen(PORT, () => {
  console.log(`Dashboard: http://localhost:${PORT}`);
  const nets = os.networkInterfaces();
  for (const iface of Object.values(nets)) {
    for (const net of iface ?? []) {
      if (net.family === "IPv4" && !net.internal) {
        console.log(`Network:   http://${net.address}:${PORT}`);
      }
    }
  }
});

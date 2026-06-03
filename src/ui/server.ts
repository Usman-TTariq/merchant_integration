import http from "node:http";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { initDatabase, logSync } from "../db.js";
import { syncInventory } from "../sync/inventory.js";
import { syncOrders } from "../sync/orders.js";
import { syncProducts } from "../sync/products.js";
import {
  getCursors,
  getLogs,
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
import {
  getDashboardStatus,
  getKoronaOrdersLive,
  getKoronaProductsLive,
  getKoronaReceiptsLive,
} from "./status.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = fs.existsSync(path.join(process.cwd(), "public"))
  ? path.join(process.cwd(), "public")
  : path.resolve(__dirname, "../../public");
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
        await getProducts(Number(q.page ?? 1), Number(q.limit ?? 50), q.search ?? "")
      );
    }

    if (req.method === "GET" && url.pathname === "/api/orders") {
      return sendJson(res, 200, await getOrdersWithMeta(Number(q.page ?? 1), Number(q.limit ?? 50)));
    }

    if (req.method === "GET" && url.pathname === "/api/korona/orders") {
      return sendJson(res, 200, await getKoronaOrdersLive(Number(q.page ?? 1)));
    }

    if (req.method === "GET" && url.pathname === "/api/receipts") {
      return sendJson(
        res,
        200,
        await getReceiptsWithMeta(Number(q.page ?? 1), Number(q.limit ?? 50))
      );
    }

    if (req.method === "GET" && url.pathname === "/api/korona/receipts") {
      return sendJson(res, 200, await getKoronaReceiptsLive(Number(q.page ?? 1)));
    }

    if (req.method === "GET" && url.pathname === "/api/logs") {
      return sendJson(
        res,
        200,
        await getLogs(Number(q.page ?? 1), Number(q.limit ?? 100), q.level ?? "")
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
          await initDatabase();
          await logSync("dashboard", "info", `Manual sync started: ${job}`);
          if (job === "products" || job === "all") await syncProducts();
          if (job === "inventory" || job === "all") await syncInventory();
          if (job === "orders" || job === "all") await syncOrders();
          await logSync("dashboard", "info", `Manual sync finished: ${job}`);
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

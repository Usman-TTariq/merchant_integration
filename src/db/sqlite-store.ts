import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "../config.js";

let db: Database.Database | null = null;

function sqlite(): Database.Database {
  if (db) return db;
  const dir = path.dirname(config.database.sqlitePath);
  fs.mkdirSync(dir, { recursive: true });
  db = new Database(config.database.sqlitePath);
  db.pragma("journal_mode = WAL");
  db.exec(`
    CREATE TABLE IF NOT EXISTS product_mappings (
      korona_product_id TEXT PRIMARY KEY,
      korona_product_number TEXT,
      shiphero_sku TEXT NOT NULL,
      korona_revision INTEGER,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS order_mappings (
      korona_order_id TEXT PRIMARY KEY,
      korona_order_type TEXT NOT NULL,
      shiphero_order_id TEXT,
      shiphero_order_number TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS processed_receipts (
      receipt_id TEXT PRIMARY KEY,
      processed_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sync_cursors (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS sync_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      job TEXT NOT NULL,
      level TEXT NOT NULL,
      message TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  return db;
}

export async function getCursor(key: string): Promise<string | null> {
  const row = sqlite()
    .prepare("SELECT value FROM sync_cursors WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export async function setCursor(key: string, value: string): Promise<void> {
  sqlite()
    .prepare(
      `INSERT INTO sync_cursors (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value);
}

export async function logSync(job: string, level: "info" | "warn" | "error", message: string): Promise<void> {
  sqlite().prepare("INSERT INTO sync_log (job, level, message) VALUES (?, ?, ?)").run(job, level, message);
  const prefix = `[${job}]`;
  if (level === "error") console.error(prefix, message);
  else if (level === "warn") console.warn(prefix, message);
  else console.log(prefix, message);
}

export async function upsertProductMapping(input: {
  koronaProductId: string;
  koronaProductNumber: string | null;
  shipheroSku: string;
  koronaRevision: number | null;
}): Promise<void> {
  sqlite()
    .prepare(
      `INSERT INTO product_mappings (korona_product_id, korona_product_number, shiphero_sku, korona_revision, updated_at)
       VALUES (?, ?, ?, ?, datetime('now'))
       ON CONFLICT(korona_product_id) DO UPDATE SET
         korona_product_number = excluded.korona_product_number,
         shiphero_sku = excluded.shiphero_sku,
         korona_revision = excluded.korona_revision,
         updated_at = excluded.updated_at`
    )
    .run(input.koronaProductId, input.koronaProductNumber, input.shipheroSku, input.koronaRevision);
}

export async function isOrderMapped(koronaOrderId: string): Promise<boolean> {
  return Boolean(
    sqlite().prepare("SELECT 1 FROM order_mappings WHERE korona_order_id = ?").get(koronaOrderId)
  );
}

export async function insertOrderMapping(input: {
  koronaOrderId: string;
  koronaOrderType: string;
  shipheroOrderId: string | null;
  shipheroOrderNumber: string | null;
}): Promise<void> {
  sqlite()
    .prepare(
      `INSERT INTO order_mappings (korona_order_id, korona_order_type, shiphero_order_id, shiphero_order_number)
       VALUES (?, ?, ?, ?)`
    )
    .run(
      input.koronaOrderId,
      input.koronaOrderType,
      input.shipheroOrderId,
      input.shipheroOrderNumber
    );
}

export async function findShipheroSku(
  koronaProductId?: string,
  koronaProductNumber?: string
): Promise<string | null> {
  const db = sqlite();
  if (koronaProductId) {
    const row = db
      .prepare("SELECT shiphero_sku FROM product_mappings WHERE korona_product_id = ?")
      .get(koronaProductId) as { shiphero_sku: string } | undefined;
    if (row) return row.shiphero_sku;
  }
  if (koronaProductNumber) {
    const row = db
      .prepare("SELECT shiphero_sku FROM product_mappings WHERE korona_product_number = ?")
      .get(koronaProductNumber) as { shiphero_sku: string } | undefined;
    if (row) return row.shiphero_sku;
  }
  return null;
}

export async function isReceiptProcessed(receiptId: string): Promise<boolean> {
  return Boolean(sqlite().prepare("SELECT 1 FROM processed_receipts WHERE receipt_id = ?").get(receiptId));
}

export async function markReceiptProcessed(receiptId: string): Promise<void> {
  sqlite()
    .prepare("INSERT OR IGNORE INTO processed_receipts (receipt_id) VALUES (?)")
    .run(receiptId);
}

export async function countOrderMappings(): Promise<number> {
  return (sqlite().prepare("SELECT COUNT(*) AS c FROM order_mappings").get() as { c: number }).c;
}

export async function findKoronaOrderIdByShiphero(shipheroOrderId: string): Promise<string | null> {
  const row = sqlite()
    .prepare("SELECT korona_order_id FROM order_mappings WHERE shiphero_order_id = ?")
    .get(shipheroOrderId) as { korona_order_id: string } | undefined;
  return row?.korona_order_id ?? null;
}

export async function findKoronaProductIdBySku(sku: string): Promise<string | null> {
  const row = sqlite()
    .prepare("SELECT korona_product_id FROM product_mappings WHERE shiphero_sku = ?")
    .get(sku) as { korona_product_id: string } | undefined;
  return row?.korona_product_id ?? null;
}

export async function countTable(table: string): Promise<number> {
  const allowed = ["product_mappings", "order_mappings", "processed_receipts", "sync_log"] as const;
  if (!allowed.includes(table as (typeof allowed)[number])) throw new Error(`Invalid table: ${table}`);
  return (sqlite().prepare(`SELECT COUNT(*) AS c FROM ${table}`).get() as { c: number }).c;
}

export async function countLogsByLevel(level: string): Promise<number> {
  return (
    sqlite().prepare("SELECT COUNT(*) AS c FROM sync_log WHERE level = ?").get(level) as { c: number }
  ).c;
}

export async function getAllCursors(): Promise<Array<{ key: string; value: string; updated_at: string }>> {
  return sqlite()
    .prepare("SELECT key, value, updated_at FROM sync_cursors ORDER BY key")
    .all() as Array<{ key: string; value: string; updated_at: string }>;
}

export async function queryProductMappings(opts: {
  page: number;
  limit: number;
  search?: string;
}): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const db = sqlite();
  const offset = (opts.page - 1) * opts.limit;
  const search = opts.search?.trim();
  if (search) {
    const term = `%${search}%`;
    const rows = db
      .prepare(
        `SELECT korona_product_id, korona_product_number, shiphero_sku, korona_revision, updated_at
         FROM product_mappings
         WHERE korona_product_id LIKE ? OR korona_product_number LIKE ? OR shiphero_sku LIKE ?
         ORDER BY updated_at DESC LIMIT ? OFFSET ?`
      )
      .all(term, term, term, opts.limit, offset) as Record<string, unknown>[];
    const total = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM product_mappings
           WHERE korona_product_id LIKE ? OR korona_product_number LIKE ? OR shiphero_sku LIKE ?`
        )
        .get(term, term, term) as { c: number }
    ).c;
    return { rows, total };
  }
  const rows = db
    .prepare(
      `SELECT korona_product_id, korona_product_number, shiphero_sku, korona_revision, updated_at
       FROM product_mappings ORDER BY updated_at DESC LIMIT ? OFFSET ?`
    )
    .all(opts.limit, offset) as Record<string, unknown>[];
  const total = (db.prepare("SELECT COUNT(*) AS c FROM product_mappings").get() as { c: number }).c;
  return { rows, total };
}

export async function queryOrderMappings(opts: {
  page: number;
  limit: number;
}): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const db = sqlite();
  const offset = (opts.page - 1) * opts.limit;
  const rows = db
    .prepare(
      `SELECT korona_order_id, korona_order_type, shiphero_order_id, shiphero_order_number, created_at
       FROM order_mappings ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(opts.limit, offset) as Record<string, unknown>[];
  const total = (db.prepare("SELECT COUNT(*) AS c FROM order_mappings").get() as { c: number }).c;
  return { rows, total };
}

export async function queryProcessedReceipts(opts: {
  page: number;
  limit: number;
}): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const db = sqlite();
  const offset = (opts.page - 1) * opts.limit;
  const rows = db
    .prepare(
      "SELECT receipt_id, processed_at FROM processed_receipts ORDER BY processed_at DESC LIMIT ? OFFSET ?"
    )
    .all(opts.limit, offset) as Record<string, unknown>[];
  const total = (db.prepare("SELECT COUNT(*) AS c FROM processed_receipts").get() as { c: number }).c;
  return { rows, total };
}

export async function querySyncLogs(opts: {
  page: number;
  limit: number;
  level?: string;
}): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const db = sqlite();
  const offset = (opts.page - 1) * opts.limit;
  if (opts.level) {
    const rows = db
      .prepare(
        `SELECT id, job, level, message, created_at FROM sync_log
         WHERE level = ? ORDER BY id DESC LIMIT ? OFFSET ?`
      )
      .all(opts.level, opts.limit, offset) as Record<string, unknown>[];
    const total = (
      db.prepare("SELECT COUNT(*) AS c FROM sync_log WHERE level = ?").get(opts.level) as { c: number }
    ).c;
    return { rows, total };
  }
  const rows = db
    .prepare(
      "SELECT id, job, level, message, created_at FROM sync_log ORDER BY id DESC LIMIT ? OFFSET ?"
    )
    .all(opts.limit, offset) as Record<string, unknown>[];
  const total = (db.prepare("SELECT COUNT(*) AS c FROM sync_log").get() as { c: number }).c;
  return { rows, total };
}

export async function maxProductRevision(): Promise<number | null> {
  const row = sqlite().prepare("SELECT MAX(korona_revision) AS r FROM product_mappings").get() as {
    r: number | null;
  };
  return row.r;
}

export async function countProductsUpdatedSinceMinutes(minutes: number): Promise<number> {
  return (
    sqlite()
      .prepare("SELECT COUNT(*) AS c FROM product_mappings WHERE updated_at >= datetime('now', ?)")
      .get(`-${minutes} minutes`) as { c: number }
  ).c;
}

export async function latestProductMapping(): Promise<{
  updated_at: string;
  shiphero_sku: string;
  korona_revision: number | null;
} | null> {
  return (
    (sqlite()
      .prepare(
        "SELECT updated_at, shiphero_sku, korona_revision FROM product_mappings ORDER BY updated_at DESC LIMIT 1"
      )
      .get() as
      | { updated_at: string; shiphero_sku: string; korona_revision: number | null }
      | undefined) ?? null
  );
}

export async function deleteErrorLogs(): Promise<number> {
  return sqlite().prepare("DELETE FROM sync_log WHERE level = 'error'").run().changes;
}

export async function groupLogCounts(): Promise<Array<{ level: string; c: number }>> {
  return sqlite()
    .prepare("SELECT level, COUNT(*) AS c FROM sync_log GROUP BY level")
    .all() as Array<{ level: string; c: number }>;
}

export async function recentSyncLogs(opts: {
  job?: string;
  level?: string;
  limit: number;
}): Promise<Array<{ at: string; job: string; message: string; level: string }>> {
  const db = sqlite();
  if (opts.job && opts.level) {
    return db
      .prepare(
        `SELECT datetime(created_at, 'localtime') AS at, job, level, message FROM sync_log
         WHERE job = ? AND level = ? ORDER BY id DESC LIMIT ?`
      )
      .all(opts.job, opts.level, opts.limit) as Array<{ at: string; job: string; message: string; level: string }>;
  }
  if (opts.job) {
    return db
      .prepare(
        `SELECT datetime(created_at, 'localtime') AS at, job, level, message FROM sync_log
         WHERE job = ? ORDER BY id DESC LIMIT ?`
      )
      .all(opts.job, opts.limit) as Array<{ at: string; job: string; message: string; level: string }>;
  }
  return db
    .prepare(
      `SELECT datetime(created_at, 'localtime') AS at, job, level, message FROM sync_log ORDER BY id DESC LIMIT ?`
    )
    .all(opts.limit) as Array<{ at: string; job: string; message: string; level: string }>;
}

export function getSqliteDb(): Database.Database {
  return sqlite();
}

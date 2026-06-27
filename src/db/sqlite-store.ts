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
    CREATE TABLE IF NOT EXISTS shiphero_barcode_index (
      barcode TEXT PRIMARY KEY,
      shiphero_sku TEXT NOT NULL,
      on_hand INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_shiphero_barcode_index_sku ON shiphero_barcode_index (shiphero_sku);
    CREATE TABLE IF NOT EXISTS korona_product_barcodes (
      korona_product_id TEXT PRIMARY KEY,
      barcodes TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  try {
    db.exec(`ALTER TABLE shiphero_barcode_index ADD COLUMN on_hand INTEGER NOT NULL DEFAULT 0`);
  } catch {
    /* column exists */
  }
  migrateShipheroBarcodeIndexMultiSku(db);
  return db;
}

function migrateShipheroBarcodeIndexMultiSku(database: Database.Database): void {
  const row = database
    .prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='shiphero_barcode_index'")
    .get() as { sql?: string } | undefined;
  if (row?.sql?.includes("PRIMARY KEY (barcode, shiphero_sku)")) return;
  database.exec(`
    CREATE TABLE shiphero_barcode_index_v2 (
      barcode TEXT NOT NULL,
      shiphero_sku TEXT NOT NULL,
      on_hand INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (barcode, shiphero_sku)
    );
    INSERT OR IGNORE INTO shiphero_barcode_index_v2 (barcode, shiphero_sku, on_hand, updated_at)
      SELECT barcode, shiphero_sku, on_hand, updated_at FROM shiphero_barcode_index;
    DROP TABLE shiphero_barcode_index;
    ALTER TABLE shiphero_barcode_index_v2 RENAME TO shiphero_barcode_index;
    CREATE INDEX IF NOT EXISTS idx_shiphero_barcode_index_sku ON shiphero_barcode_index (shiphero_sku);
    CREATE INDEX IF NOT EXISTS idx_shiphero_barcode_index_on_hand ON shiphero_barcode_index (on_hand DESC);
  `);
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

export async function upsertShipheroBarcodeIndex(
  entries: Array<{ barcode: string; shipheroSku: string; onHand?: number }>
): Promise<number> {
  if (!entries.length) return 0;
  const stmt = sqlite().prepare(
    `INSERT INTO shiphero_barcode_index (barcode, shiphero_sku, on_hand, updated_at)
     VALUES (?, ?, ?, datetime('now'))
     ON CONFLICT(barcode, shiphero_sku) DO UPDATE SET
       on_hand = MAX(shiphero_barcode_index.on_hand, excluded.on_hand),
       updated_at = excluded.updated_at`
  );
  const tx = sqlite().transaction((rows: Array<{ barcode: string; shipheroSku: string; onHand?: number }>) => {
    for (const row of rows) stmt.run(row.barcode, row.shipheroSku, Math.max(0, Math.round(row.onHand ?? 0)));
  });
  tx(entries);
  return entries.length;
}

export async function findShipheroSkuByBarcode(barcode: string): Promise<string | null> {
  const row = await lookupShipheroBarcode(barcode);
  return row?.shipheroSku ?? null;
}

export async function lookupShipheroBarcode(
  barcode: string
): Promise<{ shipheroSku: string; onHand: number } | null> {
  const row = sqlite()
    .prepare(
      "SELECT shiphero_sku, on_hand FROM shiphero_barcode_index WHERE barcode = ? ORDER BY on_hand DESC LIMIT 1"
    )
    .get(barcode) as { shiphero_sku: string; on_hand: number } | undefined;
  if (!row) return null;
  return { shipheroSku: row.shiphero_sku, onHand: row.on_hand ?? 0 };
}

export async function lookupShipheroBarcodeCandidates(
  barcodes: string[]
): Promise<Array<{ barcode: string; shipheroSku: string; onHand: number }>> {
  const normalized = [...new Set(barcodes.map((bc) => bc.trim()).filter(Boolean))];
  if (!normalized.length) return [];
  const placeholders = normalized.map(() => "?").join(", ");
  return sqlite()
    .prepare(
      `SELECT barcode, shiphero_sku AS shipheroSku, on_hand AS onHand
       FROM shiphero_barcode_index
       WHERE barcode IN (${placeholders})
       ORDER BY on_hand DESC, shiphero_sku ASC`
    )
    .all(...normalized) as Array<{ barcode: string; shipheroSku: string; onHand: number }>;
}

export async function getShipheroOnHandForSku(sku: string): Promise<number> {
  const row = sqlite()
    .prepare("SELECT MAX(on_hand) AS on_hand FROM shiphero_barcode_index WHERE shiphero_sku = ?")
    .get(sku) as { on_hand: number | null } | undefined;
  return row?.on_hand ?? 0;
}

export async function listProductMappingsForRelink(): Promise<
  Array<{ koronaProductId: string; koronaProductNumber: string | null; shipheroSku: string }>
> {
  return sqlite()
    .prepare(
      `SELECT korona_product_id AS koronaProductId, korona_product_number AS koronaProductNumber, shiphero_sku AS shipheroSku
       FROM product_mappings`
    )
    .all() as Array<{ koronaProductId: string; koronaProductNumber: string | null; shipheroSku: string }>;
}

export async function countShipheroBarcodeIndex(): Promise<number> {
  return (sqlite().prepare("SELECT COUNT(*) AS c FROM shiphero_barcode_index").get() as { c: number }).c;
}

export async function getKoronaBarcodes(koronaProductId: string): Promise<string[]> {
  const row = sqlite()
    .prepare("SELECT barcodes FROM korona_product_barcodes WHERE korona_product_id = ?")
    .get(koronaProductId) as { barcodes: string } | undefined;
  if (!row?.barcodes) return [];
  try {
    const parsed = JSON.parse(row.barcodes) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

export async function upsertKoronaBarcodes(
  entries: Array<{ koronaProductId: string; barcodes: string[] }>
): Promise<number> {
  if (!entries.length) return 0;
  const stmt = sqlite().prepare(
    `INSERT INTO korona_product_barcodes (korona_product_id, barcodes, updated_at)
     VALUES (?, ?, datetime('now'))
     ON CONFLICT(korona_product_id) DO UPDATE SET
       barcodes = excluded.barcodes,
       updated_at = excluded.updated_at`
  );
  const tx = sqlite().transaction((rows: Array<{ koronaProductId: string; barcodes: string[] }>) => {
    for (const row of rows) {
      if (!row.barcodes.length) continue;
      stmt.run(row.koronaProductId, JSON.stringify(row.barcodes));
    }
  });
  tx(entries);
  return entries.length;
}

export async function countKoronaBarcodesCache(): Promise<number> {
  return (sqlite().prepare("SELECT COUNT(*) AS c FROM korona_product_barcodes").get() as { c: number }).c;
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
    .prepare(
      "SELECT korona_order_id FROM order_mappings WHERE shiphero_order_id = ? AND korona_order_type = 'customerOrder'"
    )
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
  linkedOnly?: boolean;
}): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const db = sqlite();
  const offset = (opts.page - 1) * opts.limit;
  const search = opts.search?.trim();
  if (opts.linkedOnly) {
    const rows = db
      .prepare(
        `SELECT pm.korona_product_id, pm.korona_product_number, pm.shiphero_sku, pm.korona_revision, pm.updated_at,
                COALESCE(
                  (SELECT MAX(s.on_hand) FROM shiphero_barcode_index s WHERE s.shiphero_sku = pm.shiphero_sku),
                  0
                ) AS shiphero_on_hand
         FROM product_mappings pm
         WHERE pm.korona_product_number IS NOT NULL AND pm.shiphero_sku != pm.korona_product_number
         ORDER BY shiphero_on_hand DESC, pm.updated_at DESC LIMIT ? OFFSET ?`
      )
      .all(opts.limit, offset) as Record<string, unknown>[];
    const total = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM product_mappings
           WHERE korona_product_number IS NOT NULL AND shiphero_sku != korona_product_number`
        )
        .get() as { c: number }
    ).c;
    return { rows, total };
  }
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
       FROM product_mappings
       ORDER BY
         CASE
           WHEN korona_product_number IS NOT NULL AND shiphero_sku != korona_product_number THEN 0
           ELSE 1
         END,
         updated_at DESC
       LIMIT ? OFFSET ?`
    )
    .all(opts.limit, offset) as Record<string, unknown>[];
  const total = (db.prepare("SELECT COUNT(*) AS c FROM product_mappings").get() as { c: number }).c;
  return { rows, total };
}

export async function queryOrderMappings(opts: {
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
        `SELECT korona_order_id, korona_order_type, shiphero_order_id, shiphero_order_number, created_at
         FROM order_mappings
         WHERE korona_order_id LIKE ? OR korona_order_type LIKE ? OR shiphero_order_id LIKE ? OR shiphero_order_number LIKE ?
         ORDER BY created_at DESC LIMIT ? OFFSET ?`
      )
      .all(term, term, term, term, opts.limit, offset) as Record<string, unknown>[];
    const total = (
      db
        .prepare(
          `SELECT COUNT(*) AS c FROM order_mappings
           WHERE korona_order_id LIKE ? OR korona_order_type LIKE ? OR shiphero_order_id LIKE ? OR shiphero_order_number LIKE ?`
        )
        .get(term, term, term, term) as { c: number }
    ).c;
    return { rows, total };
  }
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
  search?: string;
}): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const db = sqlite();
  const offset = (opts.page - 1) * opts.limit;
  const search = opts.search?.trim();
  if (search) {
    const term = `%${search}%`;
    const rows = db
      .prepare(
        "SELECT receipt_id, processed_at FROM processed_receipts WHERE receipt_id LIKE ? ORDER BY processed_at DESC LIMIT ? OFFSET ?"
      )
      .all(term, opts.limit, offset) as Record<string, unknown>[];
    const total = (
      db.prepare("SELECT COUNT(*) AS c FROM processed_receipts WHERE receipt_id LIKE ?").get(term) as { c: number }
    ).c;
    return { rows, total };
  }
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
  search?: string;
}): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const db = sqlite();
  const offset = (opts.page - 1) * opts.limit;
  const search = opts.search?.trim();
  const level = opts.level?.trim();

  if (level && search) {
    const term = `%${search}%`;
    const rows = db
      .prepare(
        `SELECT id, job, level, message, created_at FROM sync_log
         WHERE level = ? AND (job LIKE ? OR message LIKE ?)
         ORDER BY id DESC LIMIT ? OFFSET ?`
      )
      .all(level, term, term, opts.limit, offset) as Record<string, unknown>[];
    const total = (
      db
        .prepare("SELECT COUNT(*) AS c FROM sync_log WHERE level = ? AND (job LIKE ? OR message LIKE ?)")
        .get(level, term, term) as { c: number }
    ).c;
    return { rows, total };
  }

  if (level) {
    const rows = db
      .prepare(
        `SELECT id, job, level, message, created_at FROM sync_log
         WHERE level = ? ORDER BY id DESC LIMIT ? OFFSET ?`
      )
      .all(level, opts.limit, offset) as Record<string, unknown>[];
    const total = (
      db.prepare("SELECT COUNT(*) AS c FROM sync_log WHERE level = ?").get(level) as { c: number }
    ).c;
    return { rows, total };
  }

  if (search) {
    const term = `%${search}%`;
    const rows = db
      .prepare(
        `SELECT id, job, level, message, created_at FROM sync_log
         WHERE job LIKE ? OR message LIKE ? OR level LIKE ?
         ORDER BY id DESC LIMIT ? OFFSET ?`
      )
      .all(term, term, term, opts.limit, offset) as Record<string, unknown>[];
    const total = (
      db
        .prepare("SELECT COUNT(*) AS c FROM sync_log WHERE job LIKE ? OR message LIKE ? OR level LIKE ?")
        .get(term, term, term) as { c: number }
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

export async function deleteWarningLogs(): Promise<number> {
  return sqlite().prepare("DELETE FROM sync_log WHERE level = 'warn'").run().changes;
}

export interface LogSummary {
  byJobLevel: Array<{ job: string; level: string; c: number }>;
  warnCategories: Array<{ category: string; c: number }>;
  errorSamples: Array<{ message: string; c: number }>;
}

export async function summarizeSyncLogs(): Promise<LogSummary> {
  const db = sqlite();
  const byJobLevel = db
    .prepare(
      `SELECT job, level, COUNT(*) AS c FROM sync_log GROUP BY job, level ORDER BY c DESC`
    )
    .all() as Array<{ job: string; level: string; c: number }>;

  const warnCategories = db
    .prepare(
      `SELECT
        CASE
          WHEN message LIKE '%not tracked%' THEN 'Korona stock not tracked'
          WHEN message LIKE '%no Korona stock rows%' THEN 'No Korona stock rows'
          WHEN message LIKE '%not in ShipHero%' THEN 'SKU not in ShipHero'
          WHEN message LIKE '%Batch issues%' THEN 'Stock batch summary'
          WHEN message LIKE '%missing SKU%' THEN 'Order line missing SKU'
          WHEN message LIKE '%No SKU mapping%' THEN 'Receipt: no SKU mapping'
          WHEN message LIKE '%No Korona product%' THEN 'ShipHero→Korona: no product map'
          WHEN message LIKE '%inventory_remove%' THEN 'Receipt inventory skip'
          ELSE 'Other warning'
        END AS category,
        COUNT(*) AS c
      FROM sync_log WHERE level = 'warn'
      GROUP BY category ORDER BY c DESC`
    )
    .all() as Array<{ category: string; c: number }>;

  const errorSamples = db
    .prepare(
      `SELECT message, COUNT(*) AS c FROM sync_log WHERE level = 'error'
       GROUP BY message ORDER BY c DESC LIMIT 15`
    )
    .all() as Array<{ message: string; c: number }>;

  return { byJobLevel, warnCategories, errorSamples };
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

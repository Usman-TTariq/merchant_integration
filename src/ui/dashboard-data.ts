import { getDb } from "../db.js";

export interface DashboardStats {
  productMappings: number;
  orderMappings: number;
  processedReceipts: number;
  logErrors: number;
  logWarnings: number;
}

export function getStats(): DashboardStats {
  const db = getDb();
  return {
    productMappings: (
      db.prepare("SELECT COUNT(*) AS c FROM product_mappings").get() as { c: number }
    ).c,
    orderMappings: (
      db.prepare("SELECT COUNT(*) AS c FROM order_mappings").get() as { c: number }
    ).c,
    processedReceipts: (
      db.prepare("SELECT COUNT(*) AS c FROM processed_receipts").get() as { c: number }
    ).c,
    logErrors: (
      db.prepare("SELECT COUNT(*) AS c FROM sync_log WHERE level = 'error'").get() as { c: number }
    ).c,
    logWarnings: (
      db.prepare("SELECT COUNT(*) AS c FROM sync_log WHERE level = 'warn'").get() as { c: number }
    ).c,
  };
}

export function getCursors(): Array<{ key: string; value: string; updated_at: string }> {
  return getDb()
    .prepare("SELECT key, value, updated_at FROM sync_cursors ORDER BY key")
    .all() as Array<{ key: string; value: string; updated_at: string }>;
}

export function getProducts(page = 1, limit = 50, search = "") {
  const offset = (page - 1) * limit;
  const db = getDb();
  const term = `%${search.trim()}%`;

  const rows = search
    ? (db
        .prepare(
          `SELECT korona_product_id, korona_product_number, shiphero_sku, korona_revision, updated_at
           FROM product_mappings
           WHERE korona_product_id LIKE ? OR korona_product_number LIKE ? OR shiphero_sku LIKE ?
           ORDER BY updated_at DESC LIMIT ? OFFSET ?`
        )
        .all(term, term, term, limit, offset) as Array<Record<string, unknown>>)
    : (db
        .prepare(
          `SELECT korona_product_id, korona_product_number, shiphero_sku, korona_revision, updated_at
           FROM product_mappings ORDER BY updated_at DESC LIMIT ? OFFSET ?`
        )
        .all(limit, offset) as Array<Record<string, unknown>>);

  const total = search
    ? (
        db
          .prepare(
            `SELECT COUNT(*) AS c FROM product_mappings
             WHERE korona_product_id LIKE ? OR korona_product_number LIKE ? OR shiphero_sku LIKE ?`
          )
          .get(term, term, term) as { c: number }
      ).c
    : (db.prepare("SELECT COUNT(*) AS c FROM product_mappings").get() as { c: number }).c;

  return { rows, total, page, limit };
}

export function getOrders(page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  const db = getDb();
  const rows = db
    .prepare(
      `SELECT korona_order_id, korona_order_type, shiphero_order_id, shiphero_order_number, created_at
       FROM order_mappings ORDER BY created_at DESC LIMIT ? OFFSET ?`
    )
    .all(limit, offset) as Array<Record<string, unknown>>;
  const total = (db.prepare("SELECT COUNT(*) AS c FROM order_mappings").get() as { c: number }).c;
  return { rows, total, page, limit };
}

export function getReceipts(page = 1, limit = 50) {
  const offset = (page - 1) * limit;
  const db = getDb();
  const rows = db
    .prepare(
      "SELECT receipt_id, processed_at FROM processed_receipts ORDER BY processed_at DESC LIMIT ? OFFSET ?"
    )
    .all(limit, offset) as Array<Record<string, unknown>>;
  const total = (db.prepare("SELECT COUNT(*) AS c FROM processed_receipts").get() as { c: number }).c;
  return { rows, total, page, limit };
}

export function getLogs(page = 1, limit = 100, level = "") {
  const offset = (page - 1) * limit;
  const db = getDb();
  const rows = level
    ? (db
        .prepare(
          `SELECT id, job, level, message, created_at FROM sync_log
           WHERE level = ? ORDER BY id DESC LIMIT ? OFFSET ?`
        )
        .all(level, limit, offset) as Array<Record<string, unknown>>)
    : (db
        .prepare(
          "SELECT id, job, level, message, created_at FROM sync_log ORDER BY id DESC LIMIT ? OFFSET ?"
        )
        .all(limit, offset) as Array<Record<string, unknown>>);
  const total = level
    ? (db.prepare("SELECT COUNT(*) AS c FROM sync_log WHERE level = ?").get(level) as { c: number }).c
    : (db.prepare("SELECT COUNT(*) AS c FROM sync_log").get() as { c: number }).c;
  return { rows, total, page, limit };
}

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

let db: Database.Database | null = null;

export function getDb(): Database.Database {
  if (db) return db;

  const dir = path.dirname(config.sync.databasePath);
  fs.mkdirSync(dir, { recursive: true });

  db = new Database(config.sync.databasePath);
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

export function getCursor(key: string): string | null {
  const row = getDb()
    .prepare("SELECT value FROM sync_cursors WHERE key = ?")
    .get(key) as { value: string } | undefined;
  return row?.value ?? null;
}

export function setCursor(key: string, value: string): void {
  getDb()
    .prepare(
      `INSERT INTO sync_cursors (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
    )
    .run(key, value);
}

export function logSync(job: string, level: "info" | "warn" | "error", message: string): void {
  getDb().prepare("INSERT INTO sync_log (job, level, message) VALUES (?, ?, ?)").run(job, level, message);
  const prefix = `[${job}]`;
  if (level === "error") console.error(prefix, message);
  else if (level === "warn") console.warn(prefix, message);
  else console.log(prefix, message);
}

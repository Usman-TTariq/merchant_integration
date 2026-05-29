import Database from "better-sqlite3";
import { config } from "../config.js";

const db = new Database(config.sync.databasePath);
console.log("mappings", db.prepare("SELECT COUNT(*) c FROM product_mappings").get());
console.log("orders", db.prepare("SELECT COUNT(*) c FROM order_mappings").get());
console.log("receipts", db.prepare("SELECT COUNT(*) c FROM processed_receipts").get());
console.log("cursors", db.prepare("SELECT key, value FROM sync_cursors").all());
console.log("logs", db.prepare("SELECT level, COUNT(*) c FROM sync_log GROUP BY level").all());

import Database from "better-sqlite3";
import { config } from "../config.js";

const db = new Database(config.sync.databasePath);
const before = db.prepare("SELECT level, COUNT(*) AS c FROM sync_log GROUP BY level").all();
const deleted = db.prepare("DELETE FROM sync_log WHERE level = 'error'").run();
const after = db.prepare("SELECT level, COUNT(*) AS c FROM sync_log GROUP BY level").all();

console.log("Before:", before);
console.log(`Deleted ${deleted.changes} error log rows`);
console.log("After:", after);
console.log("Product mappings kept:", db.prepare("SELECT COUNT(*) AS c FROM product_mappings").get());

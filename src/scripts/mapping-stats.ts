import "dotenv/config";
import Database from "better-sqlite3";
import { initDatabase } from "../db/index.js";

await initDatabase();
const db = new Database("./data/sync.db");

const total = (db.prepare("SELECT COUNT(*) AS c FROM product_mappings").get() as { c: number }).c;
const linked = (
  db.prepare(
    "SELECT COUNT(*) AS c FROM product_mappings WHERE korona_product_number IS NOT NULL AND shiphero_sku != korona_product_number"
  ).get() as { c: number }
).c;
const oneToOne = (
  db.prepare(
    "SELECT COUNT(*) AS c FROM product_mappings WHERE korona_product_number IS NOT NULL AND shiphero_sku = korona_product_number"
  ).get() as { c: number }
).c;
const aPrefix = (
  db.prepare("SELECT COUNT(*) AS c FROM product_mappings WHERE korona_product_number LIKE 'A%'").get() as { c: number }
).c;
const staleKoronaId = (
  db.prepare(
    `SELECT COUNT(*) AS c FROM product_mappings pm
     WHERE NOT EXISTS (
       SELECT 1 FROM product_mappings pm2
       WHERE pm2.shiphero_sku = pm.shiphero_sku AND pm2.korona_product_number = pm2.shiphero_sku
     ) AND pm.korona_product_number LIKE 'A%'`
  ).get() as { c: number }
).c;

console.log(JSON.stringify({ total, linked, oneToOne, aPrefix }, null, 2));
console.log(
  "recent imports (1:1):",
  db
    .prepare(
      `SELECT korona_product_number, shiphero_sku, updated_at FROM product_mappings
       WHERE korona_product_number = shiphero_sku ORDER BY updated_at DESC LIMIT 8`
    )
    .all()
);
console.log(
  "old linked sample:",
  db
    .prepare(
      `SELECT korona_product_number, shiphero_sku, updated_at FROM product_mappings
       WHERE korona_product_number IS NOT NULL AND shiphero_sku != korona_product_number LIMIT 5`
    )
    .all()
);

import Database from "better-sqlite3";

const db = new Database("./data/sync.db");
const linked = db
  .prepare(
    `SELECT COUNT(*) AS c FROM product_mappings
     WHERE korona_product_number IS NOT NULL AND shiphero_sku != korona_product_number`
  )
  .get();
const nonA = db.prepare(`SELECT COUNT(*) AS c FROM product_mappings WHERE shiphero_sku NOT LIKE 'A%'`).get();
const samples = db
  .prepare(
    `SELECT korona_product_number, shiphero_sku, updated_at FROM product_mappings
     WHERE korona_product_number IS NOT NULL AND shiphero_sku != korona_product_number
     ORDER BY updated_at DESC LIMIT 20`
  )
  .all();
console.log(JSON.stringify({ linked, nonA, samples }, null, 2));

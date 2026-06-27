import "dotenv/config";
import Database from "better-sqlite3";

const db = new Database(process.env.DATABASE_PATH || "./data/sync.db");
const total = db.prepare("SELECT COUNT(*) AS c FROM product_mappings").get();
const nonA = db.prepare("SELECT COUNT(*) AS c FROM product_mappings WHERE shiphero_sku NOT LIKE 'A%'").get();
const digitStart = db
  .prepare("SELECT COUNT(*) AS c FROM product_mappings WHERE shiphero_sku GLOB '[0-9]*'")
  .get();
const bsi = db
  .prepare("SELECT COUNT(*) AS c FROM product_mappings WHERE shiphero_sku LIKE 'BSI-%'")
  .get();
const samples = db
  .prepare(
    "SELECT shiphero_sku, korona_product_number FROM product_mappings WHERE shiphero_sku NOT LIKE 'A%' LIMIT 15"
  )
  .all();
console.log(JSON.stringify({ total, nonA, digitStart, bsi, samples }, null, 2));

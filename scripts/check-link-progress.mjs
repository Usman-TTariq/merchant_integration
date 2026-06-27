import Database from "better-sqlite3";

const db = new Database("./data/sync.db");
const linked = db
  .prepare(
    `SELECT COUNT(*) AS c FROM product_mappings
     WHERE korona_product_number IS NOT NULL AND shiphero_sku != korona_product_number`
  )
  .get();
const barcodeIndex = db.prepare("SELECT COUNT(*) AS c FROM shiphero_barcode_index").get();
const koronaCache = db.prepare("SELECT COUNT(*) AS c FROM korona_product_barcodes").get();
const cursors = db.prepare("SELECT key, value FROM sync_cursors WHERE key LIKE '%barcode%' OR key LIKE '%index%'").all();
console.log(JSON.stringify({ linked, barcodeIndex, koronaCache, cursors }, null, 2));

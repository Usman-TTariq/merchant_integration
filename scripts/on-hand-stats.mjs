import Database from "better-sqlite3";

const db = new Database("./data/sync.db", { readonly: true });
const nz = db.prepare("SELECT COUNT(*) AS c FROM shiphero_barcode_index WHERE on_hand > 0").get();
const total = db.prepare("SELECT COUNT(*) AS c FROM shiphero_barcode_index").get();
const linkedStocked = db
  .prepare(
    `SELECT COUNT(*) AS c FROM product_mappings pm
     INNER JOIN shiphero_barcode_index s ON s.shiphero_sku = pm.shiphero_sku
     WHERE pm.korona_product_number IS NOT NULL
       AND pm.shiphero_sku != pm.korona_product_number
       AND s.on_hand > 0`
  )
  .get();
const linkedZero = db
  .prepare(
    `SELECT COUNT(*) AS c FROM product_mappings pm
     LEFT JOIN shiphero_barcode_index s ON s.shiphero_sku = pm.shiphero_sku
     WHERE pm.korona_product_number IS NOT NULL
       AND pm.shiphero_sku != pm.korona_product_number
       AND COALESCE(s.on_hand, 0) = 0`
  )
  .get();
console.log(JSON.stringify({ indexNonZero: nz, indexTotal: total, linkedStocked, linkedZero }, null, 2));

import Database from "better-sqlite3";

const db = new Database("./data/sync.db");
const page1 = db
  .prepare(
    `SELECT korona_product_number, shiphero_sku, updated_at FROM product_mappings
     ORDER BY
       CASE
         WHEN korona_product_number IS NOT NULL AND shiphero_sku != korona_product_number THEN 0
         WHEN shiphero_sku NOT LIKE 'A%' THEN 0
         ELSE 1
       END,
       updated_at DESC
     LIMIT 15`
  )
  .all();
console.log(JSON.stringify(page1, null, 2));

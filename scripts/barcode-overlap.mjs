import Database from "better-sqlite3";

function sanitizeSku(sku) {
  return sku.trim().slice(0, 128);
}

const db = new Database("./data/sync.db", { readonly: true });
const korRows = db.prepare("SELECT barcodes FROM korona_product_barcodes").all();
const shMap = new Map(
  db.prepare("SELECT barcode, shiphero_sku, on_hand FROM shiphero_barcode_index").all().map((r) => [r.barcode, r])
);

let withBc = 0;
let overlapProducts = 0;
const samples = [];

for (const row of korRows) {
  let arr = [];
  try {
    arr = JSON.parse(row.barcodes || "[]");
  } catch {
    /* ignore */
  }
  if (!arr.length) continue;
  withBc++;
  for (const bc of arr) {
    const n = sanitizeSku(String(bc));
    const hit = shMap.get(n);
    if (hit) {
      overlapProducts++;
      if (samples.length < 10) samples.push({ bc: n, shiphero_sku: hit.shiphero_sku, on_hand: hit.on_hand });
      break;
    }
  }
}

const linked = db
  .prepare(
    `SELECT COUNT(*) AS c FROM product_mappings
     WHERE korona_product_number IS NOT NULL AND shiphero_sku != korona_product_number`
  )
  .get().c;

console.log(
  JSON.stringify(
    {
      koronaProducts: korRows.length,
      withBarcodes: withBc,
      productsWithMatchingBarcode: overlapProducts,
      shipheroBarcodes: shMap.size,
      linked,
      samples,
    },
    null,
    2
  )
);

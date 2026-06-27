import "dotenv/config";
import { KoronaClient } from "../src/clients/korona.js";
import { ShipHeroClient } from "../src/clients/shiphero.js";

const shiphero = new ShipHeroClient();
const korona = new KoronaClient();

const testSkus = ["0014646", "0047540", "0047640", "A38573"];

for (const sku of testSkus) {
  const sh = await shiphero.getProductBySku(sku);
  console.log("ShipHero", sku, sh ? { sku: sh.sku, barcode: sh.barcode, name: sh.name?.slice(0, 40) } : null);
}

let ocho = 0;
for await (const batch of korona.paginate((page) => korona.getProducts({ page, limit: 100 }))) {
  for (const p of batch) {
    if (!p.name?.toLowerCase().includes("ocho")) continue;
    ocho++;
    if (ocho <= 8) {
      const codes = (p.codes ?? []).map((c) => c.code).filter(Boolean);
      console.log("Korona Ocho", {
        number: p.number,
        codes,
        name: p.name?.slice(0, 50),
      });
    }
  }
}

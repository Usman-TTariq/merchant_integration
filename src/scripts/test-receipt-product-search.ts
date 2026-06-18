import "dotenv/config";
import { KoronaClient } from "../clients/korona.js";
import { getKoronaReceiptsLive, searchKoronaProducts } from "../ui/status.js";
import { receiptHasSaleLines, receiptSaleLines } from "../utils/korona-receipt.js";

const term = process.argv[2] ?? "1432021";
const korona = new KoronaClient();

const products = await searchKoronaProducts(korona, term, 1, 3);
console.log("product hits:", products.results?.map((p) => `${p.number} ${p.id}`));

const pid = products.results?.[0]?.id;
if (!pid) {
  console.log("no product for term");
  process.exit(0);
}

const list = await korona.getReceipts({ page: 1, size: 100 });
console.log("total receipts:", list.resultsTotal);

let matchedList = 0;
let matchedFull = 0;
for (const r of list.results ?? []) {
  const lines = receiptSaleLines(r);
  const hitList = lines.some(
    (l) =>
      l.product?.id === pid ||
      l.product?.number === term ||
      l.recognitionCode === term
  );
  if (hitList) matchedList++;

  let full = r;
  if (!receiptHasSaleLines(r)) {
    try {
      full = await korona.getReceipt(r.id);
    } catch {
      continue;
    }
  }
  const fullLines = receiptSaleLines(full);
  const hitFull = fullLines.some(
    (l) =>
      l.product?.id === pid ||
      l.product?.number === term ||
      l.recognitionCode === term
  );
  if (hitFull) {
    matchedFull++;
    console.log("MATCH receipt", full.number, full.id);
  }
}

console.log("matched on list payload:", matchedList);
console.log("matched after full fetch:", matchedFull);

const live = await getKoronaReceiptsLive(1, term, 100);
console.log("getKoronaReceiptsLive total:", live.total);
console.log("productMatch:", live.productMatch ?? "none");

try {
  const byProduct = await korona.getReceipts({ page: 1, size: 20, product: pid });
  console.log("API product= filter total:", byProduct?.resultsTotal ?? 0);
} catch (e) {
  console.log("API product= error:", e instanceof Error ? e.message : e);
}

console.log("\n--- all receipt lines ---");
for (const r of list.results ?? []) {
  let full = r;
  if (!receiptHasSaleLines(r)) {
    try {
      full = await korona.getReceipt(r.id);
    } catch {
      continue;
    }
  }
  const lines = receiptSaleLines(full);
  if (lines.length) {
    console.log(
      "receipt",
      full.number,
      lines.map((l) => ({
        pid: l.product?.id?.slice(0, 8),
        pnum: l.product?.number,
        rc: l.recognitionCode,
      }))
    );
  }
}

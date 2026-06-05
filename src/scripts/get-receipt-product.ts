import "dotenv/config";
import { KoronaClient } from "../clients/korona.js";

const receiptNumber = process.argv[2] ?? "10037";
const productNumber = process.argv[3] ?? "A24264";

const korona = new KoronaClient();
for await (const batch of korona.paginate((page) => korona.getReceipts({ page }))) {
  const receipt = batch.find((r) => r.number === receiptNumber);
  if (!receipt) continue;

  let full = receipt;
  if (!receipt.items?.length) {
    full = await korona.getReceipt(receipt.id);
  }

  const line = full.items?.find((item) => item.product?.number === productNumber);
  console.log(JSON.stringify(line?.product ?? null, null, 2));
  process.exit(line?.product?.id ? 0 : 1);
}

console.error("Receipt not found:", receiptNumber);
process.exit(1);

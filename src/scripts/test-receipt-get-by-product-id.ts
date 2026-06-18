import "dotenv/config";
import { KoronaClient } from "../clients/korona.js";

const korona = new KoronaClient();
const productId = "ee92a628-770d-46bd-8b8a-c9f2952a8206";

try {
  const receipt = await korona.getReceipt(productId);
  console.log("getReceipt(productId) returned:", receipt);
} catch (e) {
  console.log("getReceipt(productId) error:", e instanceof Error ? e.message : e);
}

try {
  const list = await korona.getReceipts({ page: 1, size: 100, number: productId });
  console.log("getReceipts number=uuid:", list);
} catch (e) {
  console.log("getReceipts number=uuid error:", e instanceof Error ? e.message : e);
}

try {
  const list = await korona.getReceipts({ page: 1, size: 100, number: "-770d-46bd-8b8a-c9f2952a8206" });
  console.log("getReceipts partial:", list);
} catch (e) {
  console.log("getReceipts partial error:", e instanceof Error ? e.message : e);
}

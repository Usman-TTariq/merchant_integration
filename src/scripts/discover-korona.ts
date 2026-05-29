import "dotenv/config";
import { KoronaClient } from "../clients/korona.js";

const korona = new KoronaClient();
const base = process.env.KORONA_BASE_URL!.replace(/\/$/, "");
const accountId = process.env.KORONA_ACCOUNT_ID!;
const auth =
  "Basic " +
  Buffer.from(`${process.env.KORONA_USERNAME}:${process.env.KORONA_PASSWORD}`).toString("base64");

async function get<T>(path: string): Promise<T> {
  const res = await fetch(`${base}/accounts/${accountId}${path}`, {
    headers: { Accept: "application/json", Authorization: auth },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 300)}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

const inventories = await get<{ results: Array<{ id: string; number: string; description?: string }> }>(
  "/inventories?page=1&size=10"
);
console.log("Inventories:", inventories.results);

for (const inv of inventories.results ?? []) {
  try {
    const lists = await get<{ results: Array<{ id: string; number: string; name?: string }> }>(
      `/inventories/${inv.id}/inventoryLists?page=1&size=10`
    );
    console.log(`Lists for ${inv.number} (${inv.id}):`, lists.results);
  } catch (e) {
    console.log(`Lists for ${inv.id} failed:`, e instanceof Error ? e.message : e);
  }
}

let ordersTotal = 0;
try {
  const orders = await get<{ resultsTotal?: number; results?: unknown[] }>(
    "/customerOrders?page=1&size=3"
  );
  ordersTotal = orders.resultsTotal ?? orders.results?.length ?? 0;
  console.log("Customer orders total:", ordersTotal, "sample:", orders.results?.slice(0, 2));
} catch (e) {
  console.log("Customer orders:", e instanceof Error ? e.message : e);
}

const receipts = await get<{ resultsTotal: number }>("/receipts?page=1&size=1");
console.log("Receipts total:", receipts.resultsTotal);

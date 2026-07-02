import "dotenv/config";

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

const groups = await get<{ results: Array<{ id: string; number: string; name?: string }> }>(
  "/commodityGroups?page=1&size=20"
);
const sectors = await get<{ results: Array<{ id: string; number: string; name?: string }> }>(
  "/sectors?page=1&size=10"
);
const assortments = await get<{ results: Array<{ id: string; number: string; name?: string }> }>(
  "/assortments?page=1&size=10"
);

console.log("\nCommodity groups:", groups.results?.map((g) => ({ id: g.id, number: g.number, name: g.name })));
console.log("Sectors:", sectors.results?.map((s) => ({ id: s.id, number: s.number, name: s.name })));
console.log("Assortments:", assortments.results?.map((a) => ({ id: a.id, number: a.number, name: a.name })));

const spirits = groups.results?.find((g) => g.name === "Spirits");
const generalSector = sectors.results?.find((s) => s.name === "General");
const generalAssortment = assortments.results?.find((a) => a.name?.includes("General"));
console.log("\nSuggested .env for import (defaults):");
if (spirits) console.log(`KORONA_COMMODITY_GROUP_ID=${spirits.id}  # ${spirits.name}`);
if (generalSector) console.log(`KORONA_SECTOR_ID=${generalSector.id}  # ${generalSector.name}`);
if (generalAssortment) console.log(`KORONA_ASSORTMENT_ID=${generalAssortment.id}  # ${generalAssortment.name}`);

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

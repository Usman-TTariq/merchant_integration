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
  if (!res.ok) throw new Error(`${res.status} ${text.slice(0, 500)}`);
  return text ? (JSON.parse(text) as T) : ({} as T);
}

const list = await get<{ results: Array<{ id: string; number?: string }> }>("/receipts?page=1&size=20");
const latest = list.results?.at(-1);
if (!latest) {
  console.log("No receipts");
  process.exit(0);
}

console.log("=== LIST entry (receipt", latest.number, ") ===");
const listEntry = list.results!.find((r) => r.id === latest.id);
console.log(JSON.stringify(listEntry, null, 2));

console.log("\n=== FULL receipt GET ===");
const full = await get<Record<string, unknown>>(`/receipts/${latest.id}`);
console.log(JSON.stringify(full, null, 2));
console.log("\nTop-level keys:", Object.keys(full));

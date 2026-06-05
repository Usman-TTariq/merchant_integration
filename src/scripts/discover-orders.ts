import "dotenv/config";

const base = process.env.KORONA_BASE_URL!.replace(/\/$/, "");
const accountId = process.env.KORONA_ACCOUNT_ID!;
const auth =
  "Basic " +
  Buffer.from(`${process.env.KORONA_USERNAME}:${process.env.KORONA_PASSWORD}`).toString("base64");

async function get(path: string): Promise<{ ok: boolean; status: number; text: string; data: unknown }> {
  const res = await fetch(`${base}/accounts/${accountId}${path}`, {
    headers: { Accept: "application/json", Authorization: auth },
  });
  const text = await res.text();
  let data: unknown = text;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    /* keep text */
  }
  return { ok: res.ok, status: res.status, text, data };
}

const paths = [
  "/customerOrders?page=1&size=10",
  "/customerOrders?page=1&size=10&sort=revision",
  "/customerOrders?page=1&size=10&active=true",
  "/stockOrders?page=1&size=10",
  "/orders?page=1&size=10",
  "/receipts?page=1&size=3",
];

console.log("Account:", accountId);
console.log("Base:", base);
console.log("");

for (const path of paths) {
  const r = await get(path);
  const d = r.data as { resultsTotal?: number; results?: unknown[]; message?: string };
  const total = d?.resultsTotal ?? d?.results?.length ?? (r.ok ? "?" : r.status);
  console.log(`${r.ok ? "OK" : "ERR"} ${path} (HTTP ${r.status}, ${r.text.length} bytes)`);
  console.log("  raw:", JSON.stringify(r.data).slice(0, 500));
  console.log("  total:", total);
  if (d?.results?.[0]) {
    console.log("  sample keys:", Object.keys(d.results[0] as object).join(", "));
    console.log("  sample:", JSON.stringify(d.results[0], null, 2).slice(0, 400));
  } else if (!r.ok) {
    console.log("  body:", JSON.stringify(d).slice(0, 200));
  }
  console.log("");
}

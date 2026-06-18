import "dotenv/config";
import { KoronaClient } from "../clients/korona.js";
import { getKoronaProductsLive } from "../ui/status.ts";

const k = new KoronaClient();
const term = process.argv[2] ?? "10001";

async function tryList(label: string, fn: () => Promise<unknown>) {
  try {
    const list = (await fn()) as { results?: Array<{ number?: string }>; resultsTotal?: number } | undefined;
    console.log(
      label + ":",
      list?.results?.map((p) => p.number) ?? "(none)",
      "total",
      list?.resultsTotal ?? 0
    );
  } catch (err) {
    console.log(label + ": ERROR", err instanceof Error ? err.message : err);
  }
}

await tryList("plain", () => k.getProducts({ page: 1, size: 5 }));
await tryList("byNum", () => k.getProducts({ page: 1, size: 5, number: term }));
await tryList("byName", () => k.getProducts({ page: 1, size: 5, name: term }));

const live = await getKoronaProductsLive(1, term, 5);
console.log("live:", live.products.map((p) => p.number), "total", live.total);

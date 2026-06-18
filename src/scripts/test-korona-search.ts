import "dotenv/config";
import { KoronaClient } from "../clients/korona.js";
import { searchKoronaProducts } from "../ui/status.js";

const k = new KoronaClient();
const term = process.argv[2] ?? "10001";

async function tryList(label: string, fn: () => Promise<unknown>) {
  try {
    const list = (await fn()) as { results?: Array<{ number?: string; id?: string }>; resultsTotal?: number } | undefined;
    console.log(
      label + ":",
      list?.results?.map((p) => `${p.number} (${p.id?.slice(0, 8)}…)`).join(", ") || "(none)",
      "total",
      list?.resultsTotal ?? 0
    );
  } catch (err) {
    console.log(label + ": ERROR", err instanceof Error ? err.message : err);
  }
}

await tryList("plain", () => k.getProducts({ page: 1, size: 5 }));
await tryList("byNum", () => k.getProducts({ page: 1, size: 5, number: term }));

const live = await searchKoronaProducts(k, term, 1, 5);
console.log(
  "searchKoronaProducts:",
  live.results?.map((p) => `${p.number} ${p.id}`).join(" | ") || "(none)",
  "total",
  live.total ?? live.resultsTotal
);

if (process.argv[3]) {
  const partial = process.argv[3];
  const partialLive = await searchKoronaProducts(k, partial, 1, 5);
  console.log(
    "partial UUID search:",
    partialLive.results?.map((p) => p.id).join(" | ") || "(none)"
  );
}

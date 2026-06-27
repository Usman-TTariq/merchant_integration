import "dotenv/config";
import { KoronaClient } from "../src/clients/korona.js";

const targets = new Set(["0014646", "0047540", "43168493437033", "BSI-GARx"]);
const prefixes = new Map();
let total = 0;

const k = new KoronaClient();
for await (const batch of k.paginate((page) => k.getProducts({ page, limit: 100 }))) {
  for (const pr of batch) {
    if (pr.deleted) continue;
    total++;
    const num = String(pr.number ?? "");
    const p = num.charAt(0) || "?";
    prefixes.set(p, (prefixes.get(p) ?? 0) + 1);
    if (targets.has(num)) {
      console.log("MATCH", { number: num, name: pr.name, id: pr.id });
    }
  }
}

console.log("\nKorona products (non-deleted):", total);
console.log("First char distribution:", Object.fromEntries([...prefixes.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)));

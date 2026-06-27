import "dotenv/config";
import { KoronaClient } from "../src/clients/korona.js";

const k = new KoronaClient();
for await (const batch of k.paginate((page) => k.getProducts({ page, limit: 100 }))) {
  const p = batch.find((x) => x.number === "A6245" || x.number === "A6246");
  if (!p) continue;
  const full = await k.getProduct(p.id);
  console.log({
    number: full.number,
    codes: full.codes,
    name: full.name?.slice(0, 60),
  });
  break;
}

import "dotenv/config";
import { ShipHeroClient } from "../src/clients/shiphero.js";

const sh = new ShipHeroClient();
const term = "898627001308";

const attempts: Array<{ name: string; query: string; variables?: Record<string, unknown> }> = [
  {
    name: "analyze search",
    query: `query($search: String!) {
      products {
        data(analyze: { search: $search }, first: 3) {
          edges { node { sku barcode name } }
        }
      }
    }`,
    variables: { search: term },
  },
  {
    name: "sku filter",
    query: `query($sku: String!) {
      products {
        data(sku: $sku, first: 3) {
          edges { node { sku barcode name } }
        }
      }
    }`,
    variables: { sku: "0047640" },
  },
];

for (const a of attempts) {
  try {
    const data = await sh.graphql(a.query, a.variables);
    console.log(a.name, JSON.stringify(data, null, 2));
  } catch (err) {
    console.log(a.name, "ERR", err instanceof Error ? err.message.slice(0, 200) : err);
  }
}

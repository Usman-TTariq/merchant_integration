import "dotenv/config";
import { queryProductMappings } from "../db.js";

const terms = ["770d-46bd", "-770d-46bd-8b8a-c9f2952a8206", "ee92a628-770d-46bd-8b8a-c9f2952a8206"];
for (const term of terms) {
  const r = await queryProductMappings({ page: 1, limit: 3, search: term });
  console.log(term, "=>", r.total, r.rows.map((x) => x.korona_product_id));
}


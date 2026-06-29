/**
 * Production barcode linking pipeline (local CLI against Supabase).
 * Usage: npm run prod:link [-- --cache-pages=5 --index-pages=50]
 */
import "dotenv/config";
import { assertDatabaseConfigForRuntime, config } from "../config.js";
import { initDatabase, logSync } from "../db.js";
import { runBarcodeLinkPipeline } from "../sync/barcode-link.js";

assertDatabaseConfigForRuntime();
if (config.database.provider !== "supabase") {
  console.error("Set DATABASE_PROVIDER=supabase and SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const cachePages = Number(process.argv.find((a) => a.startsWith("--cache-pages="))?.split("=")[1] ?? "5");
const indexPages = Number(process.argv.find((a) => a.startsWith("--index-pages="))?.split("=")[1] ?? "50");

await initDatabase();
console.log("=== Production barcode link pipeline ===\n");
await logSync("bootstrap", "info", "prod:link pipeline started");

const result = await runBarcodeLinkPipeline({
  koronaPages: cachePages,
  shipheroPages: indexPages,
});

console.log(JSON.stringify(result, null, 2));
await logSync("bootstrap", "info", `prod:link pipeline done: ${JSON.stringify(result)}`);

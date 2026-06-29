/**
 * Apply Supabase schema + barcode migration via DATABASE_URL (Postgres).
 * Usage: npm run db:migrate
 *
 * Set DATABASE_URL to Supabase → Settings → Database → Connection string (URI).
 * Or run supabase/migrate-barcode-index.sql manually in SQL Editor.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { getDatabaseProvider, verifySupabaseTables } from "../db/index.js";
import { isSupabaseConfigured } from "../db/supabase-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, "../../supabase/schema.sql");
const migratePath = path.resolve(__dirname, "../../supabase/migrate-barcode-index.sql");
const fixProdPath = path.resolve(__dirname, "../../supabase/fix-production-barcode.sql");

console.log("=== Supabase migration ===\n");
console.log("Provider:", getDatabaseProvider());

if (!config.database.postgresUrl) {
  console.log("DATABASE_URL not set (Postgres connection string).");
  console.log("\nManual steps:");
  console.log("  1. Supabase Dashboard → SQL Editor");
  console.log("  2. Run:", schemaPath);
  console.log("  3. Then run:", fixProdPath);
  if (isSupabaseConfigured()) {
    try {
      await verifySupabaseTables();
      console.log("\nSupabase REST connection OK (tables accessible via API).");
    } catch (err) {
      console.error("\nTables check failed:", err instanceof Error ? err.message : err);
      process.exit(1);
    }
  }
  process.exit(0);
}

const pg = await import("pg");
const client = new pg.default.Client({ connectionString: config.database.postgresUrl });
await client.connect();

const schemaSql = fs.readFileSync(schemaPath, "utf8");
const migrateSql = fs.readFileSync(migratePath, "utf8");
const fixProdSql = fs.readFileSync(fixProdPath, "utf8");

console.log("Applying schema.sql…");
await client.query(schemaSql);
console.log("Applying fix-production-barcode.sql…");
await client.query(fixProdSql);
console.log("Applying migrate-barcode-index.sql…");
await client.query(migrateSql);
await client.end();

console.log("\nMigration complete.");
await verifySupabaseTables();
console.log("Supabase tables verified.");

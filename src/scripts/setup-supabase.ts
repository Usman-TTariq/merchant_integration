import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { config } from "../config.js";
import { getDatabaseProvider, initDatabase, verifySupabaseTables } from "../db/index.js";
import { isSupabaseConfigured } from "../db/supabase-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.resolve(__dirname, "../../supabase/schema.sql");

console.log("=== Database Setup ===\n");
console.log("Provider:", getDatabaseProvider());

if (!isSupabaseConfigured()) {
  console.log("Supabase env not set. Using SQLite at", config.database.sqlitePath);
  await initDatabase();
  console.log("SQLite ready.");
  process.exit(0);
}

console.log("Supabase URL:", config.database.supabaseUrl);

if (config.database.postgresUrl) {
  const pg = await import("pg");
  const sql = fs.readFileSync(schemaPath, "utf8");
  const client = new pg.default.Client({ connectionString: config.database.postgresUrl });
  await client.connect();
  await client.query(sql);
  await client.end();
  console.log("Schema applied via DATABASE_URL");
} else {
  console.log("\nIf tables are missing, run this SQL in Supabase Dashboard → SQL Editor:");
  console.log(`  File: supabase/schema.sql`);
  console.log("\nOr set DATABASE_URL to your Postgres connection string and re-run npm run db:setup");
}

try {
  await verifySupabaseTables();
  console.log("\nSupabase connection OK — all tables accessible.");
} catch (err) {
  console.error("\nSetup incomplete:", err instanceof Error ? err.message : err);
  process.exit(1);
}

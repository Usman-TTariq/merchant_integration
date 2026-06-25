/**
 * Check env vars before Vercel deploy or local production-like runs.
 * Usage: npm run env:verify [-- --production]
 */
import "dotenv/config";
import { config, assertDatabaseConfigForRuntime } from "../config.js";

const production = process.argv.includes("--production");

const required: Array<{ key: string; ok: boolean; hint?: string }> = [
  { key: "KORONA_ACCOUNT_ID", ok: Boolean(process.env.KORONA_ACCOUNT_ID?.trim()) },
  { key: "KORONA_USERNAME", ok: Boolean(process.env.KORONA_USERNAME?.trim()) },
  { key: "KORONA_PASSWORD", ok: Boolean(process.env.KORONA_PASSWORD?.trim()) },
  {
    key: "KORONA_WAREHOUSE_ID",
    ok: Boolean(process.env.KORONA_WAREHOUSE_ID?.trim()),
    hint: "Required for Korona stock reads (inventory_replace source)",
  },
  {
    key: "SHIPHERO_WAREHOUSE_ID",
    ok: Boolean(process.env.SHIPHERO_WAREHOUSE_ID?.trim()),
    hint: "Run: npm run setup",
  },
  {
    key: "ShipHero auth",
    ok: Boolean(
      process.env.SHIPHERO_REFRESH_TOKEN?.trim() ||
        process.env.SHIPHERO_ACCESS_TOKEN?.trim() ||
        (process.env.SHIPHERO_USERNAME?.trim() && process.env.SHIPHERO_PASSWORD?.trim())
    ),
    hint: "Set SHIPHERO_REFRESH_TOKEN or SHIPHERO_ACCESS_TOKEN",
  },
  {
    key: "SYNC_KORONA_STOCK",
    ok: process.env.SYNC_KORONA_STOCK !== "false",
    hint: "Should be true for level-based stock sync",
  },
];

const productionOnly: Array<{ key: string; ok: boolean; hint?: string }> = [
  { key: "SUPABASE_URL", ok: Boolean(process.env.SUPABASE_URL?.trim()) },
  { key: "SUPABASE_SERVICE_ROLE_KEY", ok: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) },
  { key: "DASHBOARD_PASSWORD", ok: Boolean(process.env.DASHBOARD_PASSWORD?.trim()) },
  {
    key: "CRON_SECRET",
    ok: Boolean(process.env.CRON_SECRET?.trim()),
    hint: "Long random string for /api/cron/* auth",
  },
];

console.log(`=== Environment verify (${production ? "production" : "local"}) ===\n`);

let failed = 0;
for (const row of required) {
  if (!row.ok) {
    console.log(`MISSING  ${row.key}${row.hint ? ` — ${row.hint}` : ""}`);
    failed++;
  } else {
    console.log(`OK       ${row.key}`);
  }
}

if (production) {
  console.log("\n--- Vercel / Supabase ---");
  for (const row of productionOnly) {
    if (!row.ok) {
      console.log(`MISSING  ${row.key}${row.hint ? ` — ${row.hint}` : ""}`);
      failed++;
    } else {
      console.log(`OK       ${row.key}`);
    }
  }

  if (process.env.VERCEL) {
    try {
      assertDatabaseConfigForRuntime();
      console.log("\nOK       Database provider:", config.database.provider);
    } catch (err) {
      console.log("\nFAIL     Database:", err instanceof Error ? err.message : err);
      failed++;
    }
  } else {
    console.log("\nNote: Set DATABASE_PROVIDER=supabase when deploying to Vercel.");
  }
}

console.log(`\nShipHero auth mode: ${config.shiphero.authMode}`);
console.log(`Database provider: ${config.database.provider}`);

if (failed) {
  console.log(`\n${failed} issue(s). Fix Vercel → Settings → Environment Variables before deploy.`);
  process.exit(1);
}

console.log("\nAll checks passed.");

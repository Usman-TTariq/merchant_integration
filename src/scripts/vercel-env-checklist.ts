/**
 * Print Vercel Environment Variables checklist (names only — no secret values).
 * Copy values from your local .env into Vercel → Settings → Environment Variables.
 * Usage: npm run vercel:env-checklist [-- --production]
 */
import "dotenv/config";

const production = process.argv.includes("--production");

const groups: Array<{ title: string; keys: string[]; productionOnly?: boolean }> = [
  {
    title: "Required — Korona",
    keys: ["KORONA_ACCOUNT_ID", "KORONA_USERNAME", "KORONA_PASSWORD", "KORONA_WAREHOUSE_ID"],
  },
  {
    title: "Required — ShipHero",
    keys: [
      "SHIPHERO_REFRESH_TOKEN",
      "SHIPHERO_ACCESS_TOKEN",
      "SHIPHERO_WAREHOUSE_ID",
    ],
  },
  {
    title: "Required — Supabase (Vercel persistence)",
    keys: ["SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "DATABASE_PROVIDER"],
    productionOnly: true,
  },
  {
    title: "Required — App / cron",
    keys: ["SYNC_KORONA_STOCK", "DASHBOARD_PASSWORD", "CRON_SECRET"],
  },
  {
    title: "Recommended",
    keys: ["SKU_FIELD", "STOCK_SYNC_BATCH_SIZE", "DISPLAY_TIMEZONE", "KORONA_BASE_URL"],
  },
];

console.log("=== Vercel Environment Variables checklist ===\n");
console.log("Set each in Vercel → Project → Settings → Environment Variables (Production).\n");

let missing = 0;
for (const group of groups) {
  if (group.productionOnly && !production) continue;
  console.log(`--- ${group.title} ---`);
  for (const key of group.keys) {
    const val = process.env[key]?.trim();
    let ok = Boolean(val);
    if (key === "SHIPHERO_ACCESS_TOKEN") {
      ok = Boolean(val || process.env.SHIPHERO_REFRESH_TOKEN?.trim());
    }
    if (key === "DATABASE_PROVIDER" && production) {
      ok = val === "supabase" || Boolean(process.env.SUPABASE_URL?.trim());
    }
    if (!ok) missing++;
    const status = ok ? "OK (set locally)" : "MISSING locally — add before deploy";
    console.log(`  ${key}: ${status}`);
  }
  console.log("");
}

console.log("Notes:");
console.log("  - Use SHIPHERO_REFRESH_TOKEN OR SHIPHERO_ACCESS_TOKEN (not both required).");
console.log("  - Set DATABASE_PROVIDER=supabase on Vercel.");
console.log("  - CRON_SECRET: long random string; Vercel cron sends Authorization: Bearer <CRON_SECRET>");
console.log("  - SYNC_KORONA_STOCK=true for level-based inventory_add/remove delta sync.");
console.log("\nVerify: npm run env:verify -- --production");

if (missing > 0) {
  console.log(`\n${missing} variable(s) missing in local .env — fill before copying to Vercel.`);
  process.exit(1);
}

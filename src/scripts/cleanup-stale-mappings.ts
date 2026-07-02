/**
 * Remove stale product_mappings from pre-import / legacy sync.
 * Keeps direct import rows (Korona # = ShipHero SKU, not A-prefix duplicate era).
 *
 * Usage:
 *   npm run cleanup:stale-mappings -- --stats
 *   npm run cleanup:stale-mappings -- --dry-run
 *   npm run cleanup:stale-mappings -- --execute
 */
import "dotenv/config";
import Database from "better-sqlite3";
import { config } from "../config.js";
import { initDatabase, logSync } from "../db/index.js";
import { isSyncPaused } from "../sync/pause.js";

const statsOnly = process.argv.includes("--stats");
const dryRun = !process.argv.includes("--execute");

function sqliteDb(): Database.Database {
  return new Database(config.database.sqlitePath);
}

function count(db: Database.Database, sql: string): number {
  return (db.prepare(sql).get() as { c: number }).c;
}

await initDatabase();
const db = sqliteDb();

const totalBefore = count(db, "SELECT COUNT(*) AS c FROM product_mappings");
const legacyLinked = count(
  db,
  `SELECT COUNT(*) AS c FROM product_mappings
   WHERE korona_product_number IS NOT NULL AND shiphero_sku != korona_product_number`
);
const aPrefixOneToOne = count(
  db,
  `SELECT COUNT(*) AS c FROM product_mappings
   WHERE korona_product_number = shiphero_sku AND korona_product_number LIKE 'A%'`
);
const duplicateSkus = count(
  db,
  `SELECT COUNT(*) AS c FROM (
     SELECT shiphero_sku FROM product_mappings GROUP BY shiphero_sku HAVING COUNT(*) > 1
   )`
);
const duplicateRows = count(
  db,
  `SELECT COUNT(*) AS c FROM product_mappings pm
   WHERE EXISTS (
     SELECT 1 FROM product_mappings pm2
     WHERE pm2.shiphero_sku = pm.shiphero_sku AND pm2.rowid != pm.rowid
   )`
);

console.log("=== Stale product_mappings cleanup ===");
console.log(`  mode: ${statsOnly ? "stats" : dryRun ? "dry-run" : "EXECUTE"}`);
console.log(`  total now:              ${totalBefore}`);
console.log(`  legacy linked:          ${legacyLinked}  (korona# != shiphero SKU)`);
console.log(`  A-prefix 1:1 dupes:    ${aPrefixOneToOne}  (old Korona=ShipHero A####)`);
console.log(`  shiphero SKUs duplicated: ${duplicateSkus} SKUs / ${duplicateRows} rows`);

const keepAfterEstimate = totalBefore - legacyLinked - aPrefixOneToOne;
console.log(`  est. after rules 1+2:   ~${keepAfterEstimate} (+ dedupe pass)`);

if (statsOnly) {
  console.log("\nSample legacy:", db.prepare(
    `SELECT korona_product_number, shiphero_sku FROM product_mappings
     WHERE korona_product_number IS NOT NULL AND shiphero_sku != korona_product_number LIMIT 5`
  ).all());
  console.log("Sample keep (direct):", db.prepare(
    `SELECT korona_product_number, shiphero_sku, updated_at FROM product_mappings
     WHERE korona_product_number = shiphero_sku AND korona_product_number NOT LIKE 'A%'
     ORDER BY updated_at DESC LIMIT 5`
  ).all());
  process.exit(0);
}

if (!(await isSyncPaused())) {
  console.error("\nERROR: Sync is not paused. Run: npm run sync:pause");
  process.exit(1);
}

const run = db.transaction(() => {
  let deleted = 0;

  if (!dryRun) {
    deleted += db
      .prepare(
        `DELETE FROM product_mappings
         WHERE korona_product_number IS NOT NULL AND shiphero_sku != korona_product_number`
      )
      .run().changes;

    deleted += db
      .prepare(
        `DELETE FROM product_mappings
         WHERE korona_product_number = shiphero_sku AND korona_product_number LIKE 'A%'`
      )
      .run().changes;

    // Per shiphero_sku keep newest updated_at (import wins over stale korona_product_id rows).
    deleted += db
      .prepare(
        `DELETE FROM product_mappings
         WHERE rowid IN (
           SELECT pm.rowid FROM product_mappings pm
           INNER JOIN (
             SELECT shiphero_sku, MAX(updated_at) AS max_updated
             FROM product_mappings
             GROUP BY shiphero_sku
             HAVING COUNT(*) > 1
           ) d ON d.shiphero_sku = pm.shiphero_sku AND pm.updated_at < d.max_updated
         )`
      )
      .run().changes;
  } else {
    deleted =
      legacyLinked +
      aPrefixOneToOne +
      count(
        db,
        `SELECT COUNT(*) AS c FROM product_mappings pm
         INNER JOIN (
           SELECT shiphero_sku, MAX(updated_at) AS max_updated
           FROM product_mappings GROUP BY shiphero_sku HAVING COUNT(*) > 1
         ) d ON d.shiphero_sku = pm.shiphero_sku AND pm.updated_at < d.max_updated`
      );
  }

  return deleted;
});

const deleted = run();
const totalAfter = dryRun ? totalBefore - deleted : count(db, "SELECT COUNT(*) AS c FROM product_mappings");
const directKeep = count(
  db,
  `SELECT COUNT(*) AS c FROM product_mappings
   WHERE korona_product_number = shiphero_sku AND korona_product_number NOT LIKE 'A%'`
);

console.log(`\n${dryRun ? "Would delete" : "Deleted"}: ${deleted} row(s)`);
console.log(`  total after:  ${totalAfter}`);
console.log(`  direct 1:1:  ${directKeep}`);

if (!dryRun) {
  await logSync("cleanup", "info", `Removed ${deleted} stale product_mappings (${directKeep} direct remain)`);
}

if (dryRun) {
  console.log("\nRun with --execute to apply.");
}

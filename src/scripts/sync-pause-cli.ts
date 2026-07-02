/**
 * Pause or resume all syncing (same flag as dashboard).
 * Usage: npm run sync:pause | npm run sync:resume | npm run sync:paused
 */
import "dotenv/config";
import { initDatabase } from "../db.js";
import { isSyncPaused, setSyncPaused } from "../sync/pause.js";

const cmd = process.argv[2] ?? "status";

await initDatabase();

if (cmd === "pause") {
  await setSyncPaused(true, "cli");
  console.log("Sync paused — Korona→ShipHero updates stopped.");
} else if (cmd === "resume") {
  await setSyncPaused(false, "cli");
  console.log("Sync resumed.");
} else if (cmd === "status" || cmd === "paused") {
  console.log(`Sync paused: ${await isSyncPaused()}`);
} else {
  console.error("Usage: npm run sync:pause | npm run sync:resume | npm run sync:paused");
  process.exit(1);
}

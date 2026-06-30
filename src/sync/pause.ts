import { getCursor, logSync, setCursor } from "../db.js";

export const SYNC_PAUSED_KEY = "sync_paused";

export async function isSyncPaused(): Promise<boolean> {
  const value = await getCursor(SYNC_PAUSED_KEY);
  return value === "true";
}

export async function setSyncPaused(paused: boolean, source = "dashboard"): Promise<void> {
  await setCursor(SYNC_PAUSED_KEY, paused ? "true" : "false");
  await logSync(
    source,
    "info",
    paused
      ? "All syncing paused — Korona→ShipHero updates and product mapping stopped"
      : "All syncing resumed"
  );
}

/** Returns true when the job was skipped because syncing is paused. */
export async function skipIfSyncPaused(job: string): Promise<boolean> {
  if (!(await isSyncPaused())) return false;
  await logSync(job, "info", "Sync paused — skipped (no Korona→ShipHero updates)");
  return true;
}

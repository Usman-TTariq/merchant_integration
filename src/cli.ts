import "dotenv/config";
import { runSyncJob, type SyncJob } from "./sync/run-job.js";

const job = (process.argv[2] ?? "all") as SyncJob;

async function main(): Promise<void> {
  if (!["products", "inventory", "orders", "stock", "all"].includes(job)) {
    console.error(`Unknown job: ${job}`);
    console.error("Usage: npm run sync:<products|inventory|orders|stock|all>");
    process.exit(1);
  }
  const results = await runSyncJob(job);
  console.log(results);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

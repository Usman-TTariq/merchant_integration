import "dotenv/config";
import { initDatabase, querySyncLogs } from "../db.js";

await initDatabase();
const { rows, total } = await querySyncLogs({ page: 1, limit: 50, level: "error" });
console.log(`Total errors: ${total}\n`);
for (const r of rows) {
  console.log(`${r.created_at} [${r.job}] ${r.message}`);
}

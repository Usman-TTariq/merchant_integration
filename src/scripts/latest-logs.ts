import { querySyncLogs } from "../db.js";
import { initDatabase } from "../db.js";

await initDatabase();

const { rows: latest } = await querySyncLogs({ page: 1, limit: 5 });
console.log(JSON.stringify(latest, null, 2));

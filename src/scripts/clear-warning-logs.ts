import { countTable, deleteWarningLogs, groupLogCounts, initDatabase } from "../db.js";

await initDatabase();

const before = await groupLogCounts();
const deleted = await deleteWarningLogs();
const after = await groupLogCounts();

console.log("Before:", before);
console.log(`Deleted ${deleted} warning log rows`);
console.log("After:", after);
console.log("Product mappings kept:", await countTable("product_mappings"));

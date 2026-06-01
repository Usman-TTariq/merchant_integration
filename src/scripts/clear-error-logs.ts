import { countOrderMappings, countTable, deleteErrorLogs, groupLogCounts } from "../db.js";
import { initDatabase } from "../db.js";

await initDatabase();

const before = await groupLogCounts();
const deleted = await deleteErrorLogs();
const after = await groupLogCounts();

console.log("Before:", before);
console.log(`Deleted ${deleted} error log rows`);
console.log("After:", after);
console.log("Product mappings kept:", { c: await countTable("product_mappings") });

import { countTable, getAllCursors, groupLogCounts, initDatabase } from "../db.js";
import { config } from "../config.js";

await initDatabase();

console.log("Database provider:", config.database.provider);
console.log("mappings", { c: await countTable("product_mappings") });
console.log("orders", { c: await countTable("order_mappings") });
console.log("receipts", { c: await countTable("processed_receipts") });
console.log("cursors", await getAllCursors());
console.log("logs", await groupLogCounts().then((rows) => rows.map((r) => ({ level: r.level, c: r.c }))));

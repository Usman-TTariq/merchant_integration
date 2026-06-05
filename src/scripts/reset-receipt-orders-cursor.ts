import "dotenv/config";
import { initDatabase, setCursor } from "../db.js";

await initDatabase();
await setCursor("receipt_orders_revision", "0");
console.log("Reset receipt_orders_revision cursor to 0");

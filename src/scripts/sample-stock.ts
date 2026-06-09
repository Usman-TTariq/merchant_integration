import "dotenv/config";
import { KoronaClient } from "../clients/korona.js";

const productId = process.argv[2] ?? "c6d6b8d3-6f81-4c7f-8b30-cfa4cff35116";
const korona = new KoronaClient();
const stocks = await korona.getProductStocks(productId);
console.log(JSON.stringify(stocks, null, 2));

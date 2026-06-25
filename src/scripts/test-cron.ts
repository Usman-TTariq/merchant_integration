/**
 * Hit cron endpoints (local or production) to verify auth + job execution.
 * Usage:
 *   npm run cron:test
 *   npm run cron:test -- --url https://your-app.vercel.app --job stock
 */
import "dotenv/config";

const args = process.argv.slice(2);
const urlIdx = args.indexOf("--url");
const jobIdx = args.indexOf("--job");
const baseUrl = (urlIdx >= 0 ? args[urlIdx + 1] : `http://localhost:${process.env.DASHBOARD_PORT ?? "3847"}`)?.replace(
  /\/$/,
  ""
);
const job = jobIdx >= 0 ? args[jobIdx + 1] : "stock";
const secret = process.env.CRON_SECRET?.trim();

if (!secret) {
  console.error("Set CRON_SECRET in .env to test cron auth.");
  process.exit(1);
}

const valid = ["products", "inventory", "orders", "stock", "all"];
if (!valid.includes(job)) {
  console.error(`Invalid job. Use one of: ${valid.join(", ")}`);
  process.exit(1);
}

const endpoint = `${baseUrl}/api/cron/${job}`;
const timeoutMs = job === "orders" ? 120_000 : 600_000;
console.log(`POST ${endpoint} (timeout ${timeoutMs / 1000}s)`);

const res = await fetch(endpoint, {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
  signal: AbortSignal.timeout(timeoutMs),
});

const body = await res.text();
console.log("Status:", res.status);
try {
  console.log(JSON.parse(body));
} catch {
  console.log(body);
}

if (!res.ok) process.exit(1);
console.log("\nCron accepted. Check dashboard Logs tab for job=cron entries (may take 1–3 min).");

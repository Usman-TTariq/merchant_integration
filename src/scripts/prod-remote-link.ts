/**
 * Trigger production barcode-link cron jobs on Vercel (uses CRON_SECRET from .env).
 * Usage:
 *   npm run prod:remote-link
 *   npm run prod:remote-link -- --url https://merchantshiphero.com --job barcode-link
 */
import "dotenv/config";

const args = process.argv.slice(2);
const urlIdx = args.indexOf("--url");
const jobIdx = args.indexOf("--job");
const baseUrl = (urlIdx >= 0 ? args[urlIdx + 1] : "https://merchantshiphero.com")?.replace(/\/$/, "");
const job = jobIdx >= 0 ? args[jobIdx + 1] : "barcode-link";
const secret = process.env.CRON_SECRET?.trim();

if (!secret) {
  console.error("Set CRON_SECRET in .env");
  process.exit(1);
}

const valid = ["barcode-cache", "barcode-index", "link", "barcode-link"];
if (!valid.includes(job)) {
  console.error(`Invalid job. Use one of: ${valid.join(", ")}`);
  process.exit(1);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function hitCron(name: string): Promise<void> {
  const endpoint = `${baseUrl}/api/cron/${name}`;
  const maxAttempts = 8;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`POST ${endpoint}${attempt > 1 ? ` (retry ${attempt}/${maxAttempts})` : ""}`);
    const res = await fetch(endpoint, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}` },
      signal: AbortSignal.timeout(300_000),
    });
    const body = await res.text();
    console.log("Status:", res.status);
    try {
      console.log(JSON.parse(body));
    } catch {
      console.log(body);
    }

    if (res.ok) return;

    if (res.status === 409 && attempt < maxAttempts) {
      console.log("Job busy — waiting 45s before retry…");
      await sleep(45_000);
      continue;
    }

    if (res.status === 401) {
      throw new Error(`${name} failed (401): CRON_SECRET in .env must match Vercel → Settings → Environment Variables`);
    }
    throw new Error(`${name} failed (${res.status})`);
  }
}

console.log(`=== Remote production link: ${baseUrl} ===\n`);

if (job === "barcode-link") {
  for (const step of ["barcode-cache", "barcode-index", "link"] as const) {
    await hitCron(step);
    console.log("");
  }
} else {
  await hitCron(job);
}

console.log("\nDone. Refresh Product Mappings on the live dashboard.");

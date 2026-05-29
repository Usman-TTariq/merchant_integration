import fs from "node:fs";
import path from "node:path";
import "dotenv/config";

const ENV_PATH = path.resolve(process.cwd(), ".env");

function loadEnvFile(): string {
  if (!fs.existsSync(ENV_PATH)) {
    throw new Error(".env not found. Run: copy .env.example .env");
  }
  return fs.readFileSync(ENV_PATH, "utf8");
}

function setEnvValue(content: string, key: string, value: string): string {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  if (pattern.test(content)) {
    return content.replace(pattern, line);
  }
  return `${content.trimEnd()}\n${line}\n`;
}

function env(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v && v !== "CHANGE_ME" ? v : undefined;
}

function shipheroAccessToken(): string | undefined {
  return env("SHIPHERO_ACCESS_TOKEN") ?? env("SHIP_HERO_API") ?? env("ship_hero_api");
}

async function testKorona(): Promise<number> {
  const base = env("KORONA_BASE_URL")!.replace(/\/$/, "");
  const accountId = env("KORONA_ACCOUNT_ID")!;
  const token = Buffer.from(`${env("KORONA_USERNAME")}:${env("KORONA_PASSWORD")}`).toString("base64");
  const url = `${base}/accounts/${accountId}/products?page=1&size=1`;

  const res = await fetch(url, {
    headers: { Accept: "application/json", Authorization: `Basic ${token}` },
  });

  if (!res.ok) {
    throw new Error(`Korona API ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as { resultsTotal?: number };
  return data.resultsTotal ?? 0;
}

async function shipheroToken(): Promise<string> {
  const refreshToken = env("SHIPHERO_REFRESH_TOKEN");
  if (refreshToken) {
    const res = await fetch(
      process.env.SHIPHERO_REFRESH_URL ?? "https://public-api.shiphero.com/auth/refresh",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: refreshToken }),
      }
    );
    if (!res.ok) {
      throw new Error(`ShipHero refresh ${res.status}: ${(await res.text()).slice(0, 300)}`);
    }
    const data = (await res.json()) as { access_token: string };
    return data.access_token;
  }

  const accessToken = shipheroAccessToken()?.replace(/\s+/g, "");
  if (accessToken) return accessToken;

  const username = env("SHIPHERO_USERNAME");
  const password = env("SHIPHERO_PASSWORD");
  if (!username || !password) {
    throw new Error(
      "ShipHero auth missing. Set SHIPHERO_ACCESS_TOKEN, SHIPHERO_REFRESH_TOKEN, or SHIPHERO_USERNAME + SHIPHERO_PASSWORD"
    );
  }

  const res = await fetch(
    process.env.SHIPHERO_AUTH_URL ?? "https://public-api.shiphero.com/auth/token",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }
  );

  if (!res.ok) {
    throw new Error(`ShipHero auth ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }

  const data = (await res.json()) as { access_token: string };
  return data.access_token;
}

async function fetchWarehouses(token: string): Promise<Array<{ id: string; identifier?: string; legacy_id?: number }>> {
  const res = await fetch(
    process.env.SHIPHERO_GRAPHQL_URL ?? "https://public-api.shiphero.com/graphql",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        query: `query {
          account {
            data {
              warehouses {
                id
                legacy_id
                identifier
              }
            }
          }
        }`,
      }),
    }
  );

  const json = (await res.json()) as {
    message?: string;
    errors?: Array<{ message: string }>;
    data?: {
      account?: {
        data?: {
          warehouses?: Array<{ id: string; identifier?: string; legacy_id?: number }>;
        };
      };
    };
  };

  if (json.message) {
    throw new Error(`ShipHero: ${json.message}`);
  }
  if (json.errors?.length) {
    throw new Error(json.errors.map((e) => e.message).join("; "));
  }

  return json.data?.account?.data?.warehouses ?? [];
}

function pickWarehouse(
  warehouses: Array<{ id: string; identifier?: string; legacy_id?: number }>
): { id: string; identifier?: string; legacy_id?: number } | null {
  if (!warehouses.length) return null;
  if (warehouses.length === 1) return warehouses[0]!;

  const primary = warehouses
    .filter((w) => w.identifier === "Primary")
    .sort((a, b) => (a.legacy_id ?? 0) - (b.legacy_id ?? 0));
  if (primary.length) return primary[0]!;

  const named = warehouses.filter((w) => w.identifier && w.identifier !== "Primary");
  if (named.length === 1) return named[0]!;

  return null;
}

async function main(): Promise<void> {
  const koronaRequired = ["KORONA_ACCOUNT_ID", "KORONA_USERNAME", "KORONA_PASSWORD"];
  const missingKorona = koronaRequired.filter((k) => !env(k));
  if (missingKorona.length) {
    throw new Error(`Missing Korona env: ${missingKorona.join(", ")}`);
  }

  console.log("Testing Korona API...");
  const productCount = await testKorona();
  console.log(`  OK — Account ID verified, ${productCount} product(s) in Korona`);

  const hasShiphero =
    env("SHIPHERO_REFRESH_TOKEN") ||
    shipheroAccessToken() ||
    (env("SHIPHERO_USERNAME") && env("SHIPHERO_PASSWORD"));

  if (!hasShiphero) {
    console.log("\nShipHero auth not configured — Korona OK, ShipHero skipped.");
    console.log("Add SHIPHERO_ACCESS_TOKEN or email/password, then re-run: npm run setup");
    return;
  }

  try {
    console.log("Testing ShipHero auth...");
    const token = await shipheroToken();

    console.log("Fetching ShipHero warehouses...");
    const warehouses = await fetchWarehouses(token);
    if (!warehouses.length) {
      throw new Error("No warehouses returned from ShipHero");
    }

  for (const w of warehouses) {
    console.log(`  - ${w.identifier ?? "(no name)"} (legacy ${w.legacy_id ?? "?"}): ${w.id}`);
  }

  let envContent = loadEnvFile();
  const currentWarehouse = env("SHIPHERO_WAREHOUSE_ID");
  const needsWarehouse = !currentWarehouse;

  if (needsWarehouse) {
    const chosen = pickWarehouse(warehouses);
    if (chosen) {
      envContent = setEnvValue(envContent, "SHIPHERO_WAREHOUSE_ID", chosen.id);
      fs.writeFileSync(ENV_PATH, envContent, "utf8");
      console.log(
        `\nSaved SHIPHERO_WAREHOUSE_ID=${chosen.id} (${chosen.identifier ?? "warehouse"})`
      );
    } else {
      console.log("\nMultiple warehouses — set SHIPHERO_WAREHOUSE_ID in .env to one of the IDs above.");
      process.exit(1);
    }
  } else {
      console.log(`\nSHIPHERO_WAREHOUSE_ID already set: ${currentWarehouse}`);
    }

    console.log("\nSetup complete. Run:");
    console.log("  npm run sync:products");
    console.log("  npm run sync:all");
  } catch (err) {
    console.error("\nShipHero setup failed:", err instanceof Error ? err.message : err);
    console.error("\nKorona is working. For ShipHero, use one of:");
    console.error("  1. SHIPHERO_REFRESH_TOKEN (from My Account → Developer Users)");
    console.error("  2. SHIPHERO_USERNAME + SHIPHERO_PASSWORD (ShipHero login email)");
    console.error("  3. New SHIPHERO_ACCESS_TOKEN (expires every ~28 days)");
    console.error("\nYour ShipHero credentials failed. Check SHIPHERO_REFRESH_TOKEN or login in .env.");
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});

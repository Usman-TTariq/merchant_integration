import "dotenv/config";

const REQUIRED_ENV = [
  "KORONA_ACCOUNT_ID",
  "KORONA_USERNAME",
  "KORONA_PASSWORD",
] as const;

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    const missing = REQUIRED_ENV.filter((key) => !process.env[key]?.trim());
    const hint =
      missing.length > 1
        ? `Missing in .env: ${missing.join(", ")}. Copy .env.example → .env or run: npx vercel env pull .env`
        : `Missing in .env: ${name}. Copy .env.example → .env or pull from Vercel: npx vercel env pull .env`;
    throw new Error(hint);
  }
  return value.trim();
}

function optional(name: string): string | undefined {
  const value = process.env[name];
  return value?.trim() || undefined;
}

function shipheroAccessToken(): string | undefined {
  const raw =
    optional("SHIPHERO_ACCESS_TOKEN") ??
    optional("SHIP_HERO_API") ??
    optional("ship_hero_api");
  if (!raw) return undefined;
  const cleaned = raw.replace(/\s+/g, "");
  return cleaned.length > 0 ? cleaned : undefined;
}

function shipheroAuthMode(): "access_token" | "refresh_token" | "password" | "none" {
  if (optional("SHIPHERO_REFRESH_TOKEN")) return "refresh_token";
  if (shipheroAccessToken()) return "access_token";
  if (optional("SHIPHERO_USERNAME") && optional("SHIPHERO_PASSWORD")) return "password";
  return "none";
}

function supabaseUrl(): string | undefined {
  const direct = optional("SUPABASE_URL");
  if (direct) return direct.replace(/\/$/, "");
  const databaseUrl = optional("DATABASE_URL");
  if (databaseUrl?.startsWith("http")) return databaseUrl.replace(/\/$/, "");
  return undefined;
}

function databaseProvider(): "supabase" | "sqlite" {
  const forced = optional("DATABASE_PROVIDER");
  if (forced === "sqlite" || forced === "supabase") return forced;
  if (supabaseUrl() && optional("SUPABASE_SERVICE_ROLE_KEY")) return "supabase";
  return "sqlite";
}

export function assertDatabaseConfigForRuntime(): void {
  if (process.env.VERCEL && config.database.provider !== "supabase") {
    throw new Error(
      "Vercel deployment requires SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY. SQLite does not persist on serverless."
    );
  }
}

export const config = {
  korona: {
    baseUrl: (optional("KORONA_BASE_URL") ?? "https://185.koronacloud.com/web/api/v3").replace(/\/$/, ""),
    accountId: required("KORONA_ACCOUNT_ID"),
    username: required("KORONA_USERNAME"),
    password: required("KORONA_PASSWORD"),
    inventoryId: optional("KORONA_INVENTORY_ID"),
    inventoryListId: optional("KORONA_INVENTORY_LIST_ID"),
    /** Optional Korona warehouse UUID for stock reads (defaults: sum all warehouses). */
    warehouseId: optional("KORONA_WAREHOUSE_ID"),
    /** PATCH trackInventory=true when /products/{id}/stocks returns not tracked (default on). */
    autoEnableStockTracking: optional("KORONA_AUTO_ENABLE_STOCK_TRACKING") !== "false",
  },
  shiphero: {
    authUrl: optional("SHIPHERO_AUTH_URL") ?? "https://public-api.shiphero.com/auth/token",
    refreshUrl: optional("SHIPHERO_REFRESH_URL") ?? "https://public-api.shiphero.com/auth/refresh",
    graphqlUrl: optional("SHIPHERO_GRAPHQL_URL") ?? "https://public-api.shiphero.com/graphql",
    authMode: shipheroAuthMode(),
    accessToken: shipheroAccessToken(),
    username: optional("SHIPHERO_USERNAME"),
    password: optional("SHIPHERO_PASSWORD"),
    refreshToken: optional("SHIPHERO_REFRESH_TOKEN"),
    warehouseId: optional("SHIPHERO_WAREHOUSE_ID"),
    locationId: optional("SHIPHERO_LOCATION_ID"),
  },
  database: {
    provider: databaseProvider(),
    sqlitePath: optional("DATABASE_PATH") ?? "./data/sync.db",
    postgresUrl: optional("DATABASE_URL")?.startsWith("postgres") ? optional("DATABASE_URL") : undefined,
    supabaseUrl: supabaseUrl(),
    supabaseServiceKey: optional("SUPABASE_SERVICE_ROLE_KEY"),
  },
  sync: {
    pageSize: Number(optional("SYNC_PAGE_SIZE") ?? "100"),
    skuField: (optional("SKU_FIELD") ?? "number") as "number" | "code" | "id",
    shipheroOrdersUpdatedFrom: optional("SHIPHERO_ORDERS_UPDATED_FROM"),
    /** Push Korona stock levels to ShipHero on_hand (default on). */
    koronaStock: optional("SYNC_KORONA_STOCK") !== "false",
    stockBatchSize: Number(optional("STOCK_SYNC_BATCH_SIZE") ?? "150"),
  },
  cron: {
    products: optional("CRON_PRODUCTS") ?? "0 */4 * * *",
    inventory: optional("CRON_INVENTORY") ?? "*/15 * * * *",
    orders: optional("CRON_ORDERS") ?? "*/10 * * * *",
  },
  dashboard: {
    /** IANA timezone for UI timestamps (default: US Pacific). */
    displayTimezone: optional("DISPLAY_TIMEZONE") ?? "America/Los_Angeles",
  },
} as const;

export function requireShipheroWarehouseId(): string {
  const id = config.shiphero.warehouseId;
  if (!id || id === "CHANGE_ME") {
    throw new Error("Missing SHIPHERO_WAREHOUSE_ID. Run: npm run setup");
  }
  return id;
}

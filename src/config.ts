import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) {
    throw new Error(`Missing required environment variable: ${name}`);
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

export const config = {
  korona: {
    baseUrl: (optional("KORONA_BASE_URL") ?? "https://185.koronacloud.com/web/api/v3").replace(/\/$/, ""),
    accountId: required("KORONA_ACCOUNT_ID"),
    username: required("KORONA_USERNAME"),
    password: required("KORONA_PASSWORD"),
    inventoryId: optional("KORONA_INVENTORY_ID"),
    inventoryListId: optional("KORONA_INVENTORY_LIST_ID"),
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
  sync: {
    pageSize: Number(optional("SYNC_PAGE_SIZE") ?? "100"),
    skuField: (optional("SKU_FIELD") ?? "number") as "number" | "code" | "id",
    databasePath: optional("DATABASE_PATH") ?? "./data/sync.db",
    shipheroOrdersUpdatedFrom: optional("SHIPHERO_ORDERS_UPDATED_FROM"),
  },
  cron: {
    products: optional("CRON_PRODUCTS") ?? "0 */4 * * *",
    inventory: optional("CRON_INVENTORY") ?? "*/15 * * * *",
    orders: optional("CRON_ORDERS") ?? "*/10 * * * *",
  },
} as const;

export function requireShipheroWarehouseId(): string {
  const id = config.shiphero.warehouseId;
  if (!id || id === "CHANGE_ME") {
    throw new Error("Missing SHIPHERO_WAREHOUSE_ID. Run: npm run setup");
  }
  return id;
}

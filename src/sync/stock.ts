import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";
import { config } from "../config.js";
import { findShipheroSku, getCursor, logSync, queryProductMappings, setCursor } from "../db.js";
import { resolveKoronaStockQuantity } from "../utils/korona-product-stock.js";
import { sanitizeSku } from "../utils/sku.js";
import type { KoronaReceipt, KoronaSaleLine } from "../types/korona.js";
import { receiptSaleLines } from "../utils/korona-receipt.js";

const STOCK_PAGE_CURSOR = "stock_sync_page";

export type StockSyncResult = "updated" | "skipped" | "untracked" | "missing" | "in_sync" | "slotting";

export type SyncProductStockOptions = {
  /** When false, routine batch sync won't log per-SKU warnings (avoids log spam). */
  logWarnings?: boolean;
};

export async function syncProductStock(
  korona: KoronaClient,
  shiphero: ShipHeroClient,
  koronaProductId: string,
  sku: string,
  reason: string,
  job: "stock" | "products" | "orders" = "stock",
  options?: SyncProductStockOptions
): Promise<StockSyncResult> {
  if (!config.sync.koronaStock) return "skipped";

  const logWarnings = options?.logWarnings ?? true;
  const resolved = await resolveKoronaStockQuantity(korona, koronaProductId);
  if (resolved.status === "untracked") {
    if (logWarnings) {
      await logSync(
        job,
        "warn",
        `SKU ${sku}: Korona stock not tracked (enable trackInventory in Korona or set KORONA_INVENTORY_ID + KORONA_INVENTORY_LIST_ID), skipping`
      );
    }
    return "untracked";
  }
  if (resolved.status === "no_rows") {
    if (logWarnings) {
      await logSync(job, "warn", `SKU ${sku}: no Korona stock rows, skipping`);
    }
    return "skipped";
  }

  const target = resolved.qty;
  if (resolved.enabledTracking) {
    await logSync(job, "info", `SKU ${sku}: enabled Korona trackInventory, on_hand=${target}`);
  } else if (resolved.source === "inventory_list") {
    await logSync(job, "info", `SKU ${sku}: using Korona inventory list quantity ${target}`);
  }
  const existing = await shiphero.getProductBySku(sku);
  if (!existing) {
    if (logWarnings) {
      await logSync(job, "warn", `SKU ${sku}: not in ShipHero, skipping stock sync`);
    }
    return "missing";
  }

  const current = shiphero.getWarehouseOnHand(existing);
  if (current === target) return "in_sync";

  try {
    await shiphero.inventoryReplace(sku, target, reason);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (msg.toLowerCase().includes("dynamic slotting")) {
      if (logWarnings) {
        await logSync(
          job,
          "warn",
          `SKU ${sku}: inventory_replace blocked (ShipHero dynamic slotting account required) — contact ShipHero support`
        );
      }
      return "slotting";
    }
    throw err;
  }
  await logSync(job, "info", `Stock sync ${sku}: ${current} → ${target} (${reason})`);
  return "updated";
}

async function resolveSku(line: KoronaSaleLine): Promise<string | null> {
  const productId = line.product?.id;
  const productNumber = line.product?.number ?? line.recognitionCode;
  const mapped = await findShipheroSku(productId, productNumber);
  return mapped ?? (productNumber ? sanitizeSku(productNumber) : null);
}

export async function syncStockForReceipt(
  korona: KoronaClient,
  shiphero: ShipHeroClient,
  receipt: KoronaReceipt
): Promise<number> {
  if (!config.sync.koronaStock) return 0;

  const receiptNumber = receipt.number ?? receipt.id;
  const seen = new Set<string>();
  let updated = 0;

  for (const line of receiptSaleLines(receipt)) {
    const productId = line.product?.id;
    if (!productId || seen.has(productId)) continue;
    seen.add(productId);

    const sku = await resolveSku(line);
    if (!sku) continue;

    const result = await syncProductStock(
      korona,
      shiphero,
      productId,
      sku,
      `Korona receipt ${receiptNumber}`,
      "orders"
    );
    if (result === "updated") updated++;
  }

  return updated;
}

export async function syncStock(): Promise<{ updated: number; skipped: number; page: number; pages: number }> {
  const korona = new KoronaClient();
  const shiphero = new ShipHeroClient();

  const batchSize = config.sync.stockBatchSize;
  const pageCursor = await getCursor(STOCK_PAGE_CURSOR);
  let page = pageCursor ? Number(pageCursor) : 1;
  if (!Number.isFinite(page) || page < 1) page = 1;

  const { rows, total } = await queryProductMappings({ page, limit: batchSize });
  const pages = Math.max(1, Math.ceil(total / batchSize));

  let updated = 0;
  let skipped = 0;
  let inSync = 0;
  let untracked = 0;
  let noRows = 0;
  let missing = 0;
  let slotting = 0;

  for (const row of rows) {
    const koronaProductId = String(row.korona_product_id ?? "");
    const sku = String(row.shiphero_sku ?? "");
    if (!koronaProductId || !sku) {
      skipped++;
      continue;
    }

    try {
      const result = await syncProductStock(
        korona,
        shiphero,
        koronaProductId,
        sku,
        "Korona stock sync",
        "stock",
        { logWarnings: false }
      );
      if (result === "updated") updated++;
      else if (result === "in_sync") inSync++;
      else if (result === "untracked") untracked++;
      else if (result === "missing") missing++;
      else if (result === "slotting") slotting++;
      else if (result === "skipped") noRows++;
      else skipped++;
    } catch (err) {
      skipped++;
      await logSync(
        "stock",
        "error",
        `Stock sync ${sku}: ${err instanceof Error ? err.message : String(err)}`
      );
    }
  }

  const nextPage = rows.length === 0 || page >= pages ? 1 : page + 1;
  await setCursor(STOCK_PAGE_CURSOR, String(nextPage));

  if (untracked || noRows || missing || slotting) {
    await logSync(
      "stock",
      "warn",
      `Batch issues: untracked=${untracked} no_rows=${noRows} missing_shiphero=${missing} slotting=${slotting} page=${page}/${pages}`
    );
  }

  await logSync(
    "stock",
    "info",
    `Done: updated=${updated} in_sync=${inSync} no_rows=${noRows} untracked=${untracked} missing_shiphero=${missing} slotting=${slotting} errors=${skipped} page=${page}/${pages} next=${nextPage}`
  );
  return { updated, skipped, page, pages };
}

import { getSupabase } from "./supabase-client.js";

export async function getCursor(key: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from("sync_cursors")
    .select("value")
    .eq("key", key)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.value ?? null;
}

export async function setCursor(key: string, value: string): Promise<void> {
  const { error } = await getSupabase()
    .from("sync_cursors")
    .upsert({ key, value, updated_at: new Date().toISOString() }, { onConflict: "key" });
  if (error) throw new Error(error.message);
}

export async function logSync(job: string, level: "info" | "warn" | "error", message: string): Promise<void> {
  const { error } = await getSupabase().from("sync_log").insert({ job, level, message });
  if (error) throw new Error(error.message);
  const prefix = `[${job}]`;
  if (level === "error") console.error(prefix, message);
  else if (level === "warn") console.warn(prefix, message);
  else console.log(prefix, message);
}

export async function upsertProductMapping(input: {
  koronaProductId: string;
  koronaProductNumber: string | null;
  shipheroSku: string;
  koronaRevision: number | null;
}): Promise<void> {
  const { error } = await getSupabase()
    .from("product_mappings")
    .upsert(
      {
        korona_product_id: input.koronaProductId,
        korona_product_number: input.koronaProductNumber,
        shiphero_sku: input.shipheroSku,
        korona_revision: input.koronaRevision,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "korona_product_id" }
    );
  if (error) throw new Error(error.message);
}

export async function isOrderMapped(koronaOrderId: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from("order_mappings")
    .select("korona_order_id")
    .eq("korona_order_id", koronaOrderId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function insertOrderMapping(input: {
  koronaOrderId: string;
  koronaOrderType: string;
  shipheroOrderId: string | null;
  shipheroOrderNumber: string | null;
}): Promise<void> {
  const { error } = await getSupabase().from("order_mappings").insert({
    korona_order_id: input.koronaOrderId,
    korona_order_type: input.koronaOrderType,
    shiphero_order_id: input.shipheroOrderId,
    shiphero_order_number: input.shipheroOrderNumber,
  });
  if (error) throw new Error(error.message);
}

export async function findShipheroSku(
  koronaProductId?: string,
  koronaProductNumber?: string
): Promise<string | null> {
  const sb = getSupabase();
  if (koronaProductId) {
    const { data, error } = await sb
      .from("product_mappings")
      .select("shiphero_sku")
      .eq("korona_product_id", koronaProductId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data.shiphero_sku;
  }
  if (koronaProductNumber) {
    const { data, error } = await sb
      .from("product_mappings")
      .select("shiphero_sku")
      .eq("korona_product_number", koronaProductNumber)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data.shiphero_sku;
  }
  return null;
}

export async function upsertShipheroBarcodeIndex(
  entries: Array<{ barcode: string; shipheroSku: string; onHand?: number }>
): Promise<number> {
  if (!entries.length) return 0;
  const sb = getSupabase();
  for (const entry of entries) {
    const onHand = Math.max(0, Math.round(entry.onHand ?? 0));
    const { data: existing, error: readErr } = await sb
      .from("shiphero_barcode_index")
      .select("on_hand")
      .eq("barcode", entry.barcode)
      .eq("shiphero_sku", entry.shipheroSku)
      .maybeSingle();
    if (readErr) throw new Error(readErr.message);

    const { error } = await sb.from("shiphero_barcode_index").upsert(
      {
        barcode: entry.barcode,
        shiphero_sku: entry.shipheroSku,
        on_hand: Math.max(onHand, Number(existing?.on_hand ?? 0)),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "barcode,shiphero_sku" }
    );
    if (error) throw new Error(error.message);
  }
  return entries.length;
}

export async function findShipheroSkuByBarcode(barcode: string): Promise<string | null> {
  const row = await lookupShipheroBarcode(barcode);
  return row?.shipheroSku ?? null;
}

export async function lookupShipheroBarcode(
  barcode: string
): Promise<{ shipheroSku: string; onHand: number } | null> {
  const { data, error } = await getSupabase()
    .from("shiphero_barcode_index")
    .select("shiphero_sku, on_hand")
    .eq("barcode", barcode)
    .order("on_hand", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.shiphero_sku) return null;
  return { shipheroSku: data.shiphero_sku, onHand: Number(data.on_hand ?? 0) };
}

export async function lookupShipheroBarcodeCandidates(
  barcodes: string[]
): Promise<Array<{ barcode: string; shipheroSku: string; onHand: number }>> {
  const normalized = [...new Set(barcodes.map((bc) => bc.trim()).filter(Boolean))];
  if (!normalized.length) return [];
  const { data, error } = await getSupabase()
    .from("shiphero_barcode_index")
    .select("barcode, shiphero_sku, on_hand")
    .in("barcode", normalized)
    .order("on_hand", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    barcode: String(row.barcode),
    shipheroSku: String(row.shiphero_sku),
    onHand: Number(row.on_hand ?? 0),
  }));
}

export async function getShipheroOnHandForSku(sku: string): Promise<number> {
  const { data, error } = await getSupabase()
    .from("shiphero_barcode_index")
    .select("on_hand")
    .eq("shiphero_sku", sku)
    .order("on_hand", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Number(data?.on_hand ?? 0);
}

export async function listProductMappingsForRelink(): Promise<
  Array<{ koronaProductId: string; koronaProductNumber: string | null; shipheroSku: string }>
> {
  const pageSize = 1000;
  let from = 0;
  const all: Array<{ koronaProductId: string; koronaProductNumber: string | null; shipheroSku: string }> = [];

  while (true) {
    const { data, error } = await getSupabase()
      .from("product_mappings")
      .select("korona_product_id, korona_product_number, shiphero_sku")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const chunk = (data ?? []).map((row) => ({
      koronaProductId: String(row.korona_product_id),
      koronaProductNumber: row.korona_product_number ? String(row.korona_product_number) : null,
      shipheroSku: String(row.shiphero_sku),
    }));
    all.push(...chunk);
    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return all;
}

export async function countKoronaDuplicateMappings(): Promise<number> {
  const pageSize = 1000;
  let from = 0;
  let total = 0;

  while (true) {
    const { data, error } = await getSupabase()
      .from("product_mappings")
      .select("korona_product_number, shiphero_sku")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const chunk = data ?? [];
    for (const row of chunk) {
      const num = row.korona_product_number ? String(row.korona_product_number) : "";
      if (num && String(row.shiphero_sku) === num) total++;
    }
    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return total;
}

export async function deleteProductMapping(koronaProductId: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from("product_mappings")
    .delete()
    .eq("korona_product_id", koronaProductId)
    .select("korona_product_id");
  if (error) throw new Error(error.message);
  return (data?.length ?? 0) > 0;
}

export async function loadKoronaBarcodesMap(): Promise<Map<string, string[]>> {
  const pageSize = 1000;
  let from = 0;
  const map = new Map<string, string[]>();

  while (true) {
    const { data, error } = await getSupabase()
      .from("korona_product_barcodes")
      .select("korona_product_id, barcodes")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const chunk = data ?? [];
    for (const row of chunk) {
      try {
        const parsed = JSON.parse(String(row.barcodes)) as unknown;
        const barcodes = Array.isArray(parsed)
          ? parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
          : [];
        if (barcodes.length) map.set(String(row.korona_product_id), barcodes);
      } catch {
        /* ignore */
      }
    }
    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return map;
}

export async function loadShipheroBarcodeIndexByBarcode(): Promise<
  Map<string, Array<{ barcode: string; shipheroSku: string; onHand: number }>>
> {
  const pageSize = 1000;
  let from = 0;
  const map = new Map<string, Array<{ barcode: string; shipheroSku: string; onHand: number }>>();

  while (true) {
    const { data, error } = await getSupabase()
      .from("shiphero_barcode_index")
      .select("barcode, shiphero_sku, on_hand")
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const chunk = data ?? [];
    for (const row of chunk) {
      const barcode = String(row.barcode);
      const hit = {
        barcode,
        shipheroSku: String(row.shiphero_sku),
        onHand: Number(row.on_hand ?? 0),
      };
      const list = map.get(barcode) ?? [];
      list.push(hit);
      map.set(barcode, list);
    }
    if (chunk.length < pageSize) break;
    from += pageSize;
  }

  return map;
}

export async function countShipheroBarcodeIndex(): Promise<number> {
  return countTable("shiphero_barcode_index");
}

export async function getKoronaBarcodes(koronaProductId: string): Promise<string[]> {
  const { data, error } = await getSupabase()
    .from("korona_product_barcodes")
    .select("barcodes")
    .eq("korona_product_id", koronaProductId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data?.barcodes) return [];
  try {
    const parsed = JSON.parse(String(data.barcodes)) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((v): v is string => typeof v === "string" && v.trim().length > 0)
      : [];
  } catch {
    return [];
  }
}

export async function upsertKoronaBarcodes(
  entries: Array<{ koronaProductId: string; barcodes: string[] }>
): Promise<number> {
  if (!entries.length) return 0;
  const { error } = await getSupabase()
    .from("korona_product_barcodes")
    .upsert(
      entries
        .filter((e) => e.barcodes.length)
        .map((e) => ({
          korona_product_id: e.koronaProductId,
          barcodes: JSON.stringify(e.barcodes),
          updated_at: new Date().toISOString(),
        })),
      { onConflict: "korona_product_id" }
    );
  if (error) throw new Error(error.message);
  return entries.length;
}

export async function countKoronaBarcodesCache(): Promise<number> {
  return countTable("korona_product_barcodes");
}

export async function isReceiptProcessed(receiptId: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from("processed_receipts")
    .select("receipt_id")
    .eq("receipt_id", receiptId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return Boolean(data);
}

export async function markReceiptProcessed(receiptId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("processed_receipts")
    .upsert({ receipt_id: receiptId }, { onConflict: "receipt_id", ignoreDuplicates: true });
  if (error) throw new Error(error.message);
}

export async function countOrderMappings(): Promise<number> {
  const { count, error } = await getSupabase()
    .from("order_mappings")
    .select("*", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function findKoronaOrderIdByShiphero(shipheroOrderId: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from("order_mappings")
    .select("korona_order_id")
    .eq("shiphero_order_id", shipheroOrderId)
    .eq("korona_order_type", "customerOrder")
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.korona_order_id ?? null;
}

export async function findKoronaProductIdBySku(sku: string): Promise<string | null> {
  const { data, error } = await getSupabase()
    .from("product_mappings")
    .select("korona_product_id")
    .eq("shiphero_sku", sku)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.korona_product_id ?? null;
}

export async function countTable(table: string): Promise<number> {
  const { count, error } = await getSupabase().from(table).select("*", { count: "exact", head: true });
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function countLogsByLevel(level: string): Promise<number> {
  const { count, error } = await getSupabase()
    .from("sync_log")
    .select("*", { count: "exact", head: true })
    .eq("level", level);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function getAllCursors(): Promise<Array<{ key: string; value: string; updated_at: string }>> {
  const { data, error } = await getSupabase()
    .from("sync_cursors")
    .select("key, value, updated_at")
    .order("key");
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function queryProductMappings(opts: {
  page: number;
  limit: number;
  search?: string;
  linkedOnly?: boolean;
  directOnly?: boolean;
}): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const sb = getSupabase();
  const from = (opts.page - 1) * opts.limit;
  const to = from + opts.limit - 1;
  const search = opts.search?.trim();

  if (opts.directOnly) {
    const { data, error } = await sb
      .from("product_mappings")
      .select("*")
      .not("korona_product_number", "is", null)
      .order("updated_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);
    const filtered = (data ?? []).filter(
      (row) => row.shiphero_sku && row.korona_product_number && row.shiphero_sku === row.korona_product_number
    );
    const withOnHand = await Promise.all(
      filtered.map(async (row) => ({
        ...row,
        shiphero_on_hand: await getShipheroOnHandForSku(String(row.shiphero_sku)),
      }))
    );
    const total = withOnHand.length;
    const rows = withOnHand.slice(from, to + 1);
    return { rows: rows as Record<string, unknown>[], total };
  }

  if (opts.linkedOnly) {
    const { data, error } = await sb
      .from("product_mappings")
      .select("*")
      .not("korona_product_number", "is", null)
      .order("updated_at", { ascending: false })
      .limit(5000);
    if (error) throw new Error(error.message);
    const filtered = (data ?? []).filter(
      (row) => row.shiphero_sku && row.korona_product_number && row.shiphero_sku !== row.korona_product_number
    );
    const withOnHand = await Promise.all(
      filtered.map(async (row) => ({
        ...row,
        shiphero_on_hand: await getShipheroOnHandForSku(String(row.shiphero_sku)),
      }))
    );
    withOnHand.sort(
      (a, b) =>
        Number(b.shiphero_on_hand ?? 0) - Number(a.shiphero_on_hand ?? 0) ||
        String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""))
    );
    const total = withOnHand.length;
    const rows = withOnHand.slice(from, to + 1);
    return { rows: rows as Record<string, unknown>[], total };
  }

  let query = sb
    .from("product_mappings")
    .select("*", { count: "exact" })
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (search) {
    query = query.or(
      `korona_product_id.ilike.%${search}%,korona_product_number.ilike.%${search}%,shiphero_sku.ilike.%${search}%`
    );
  }

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as Record<string, unknown>[], total: count ?? 0 };
}

export async function queryOrderMappings(opts: {
  page: number;
  limit: number;
  search?: string;
}): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const from = (opts.page - 1) * opts.limit;
  const to = from + opts.limit - 1;
  const search = opts.search?.trim();

  let query = getSupabase()
    .from("order_mappings")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);

  if (search) {
    query = query.or(
      `korona_order_id.ilike.%${search}%,korona_order_type.ilike.%${search}%,shiphero_order_id.ilike.%${search}%,shiphero_order_number.ilike.%${search}%`
    );
  }

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as Record<string, unknown>[], total: count ?? 0 };
}

export async function queryProcessedReceipts(opts: {
  page: number;
  limit: number;
  search?: string;
}): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const from = (opts.page - 1) * opts.limit;
  const to = from + opts.limit - 1;
  const search = opts.search?.trim();

  let query = getSupabase()
    .from("processed_receipts")
    .select("*", { count: "exact" })
    .order("processed_at", { ascending: false })
    .range(from, to);

  if (search) {
    query = query.ilike("receipt_id", `%${search}%`);
  }

  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as Record<string, unknown>[], total: count ?? 0 };
}

export async function querySyncLogs(opts: {
  page: number;
  limit: number;
  level?: string;
  search?: string;
}): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const from = (opts.page - 1) * opts.limit;
  const to = from + opts.limit - 1;
  const search = opts.search?.trim();
  let query = getSupabase()
    .from("sync_log")
    .select("*", { count: "exact" })
    .order("id", { ascending: false })
    .range(from, to);
  if (opts.level) query = query.eq("level", opts.level);
  if (search) {
    query = query.or(`job.ilike.%${search}%,message.ilike.%${search}%,level.ilike.%${search}%`);
  }
  const { data, count, error } = await query;
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as Record<string, unknown>[], total: count ?? 0 };
}

export async function maxProductRevision(): Promise<number | null> {
  const { data, error } = await getSupabase()
    .from("product_mappings")
    .select("korona_revision")
    .order("korona_revision", { ascending: false, nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.korona_revision ?? null;
}

export async function countProductsUpdatedSinceMinutes(minutes: number): Promise<number> {
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const { count, error } = await getSupabase()
    .from("product_mappings")
    .select("*", { count: "exact", head: true })
    .gte("updated_at", since);
  if (error) throw new Error(error.message);
  return count ?? 0;
}

export async function latestProductMapping(): Promise<{
  updated_at: string;
  shiphero_sku: string;
  korona_revision: number | null;
} | null> {
  const { data, error } = await getSupabase()
    .from("product_mappings")
    .select("updated_at, shiphero_sku, korona_revision")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data ?? null;
}

export async function deleteErrorLogs(): Promise<number> {
  const { data, error } = await getSupabase().from("sync_log").delete().eq("level", "error").select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

export async function deleteWarningLogs(): Promise<number> {
  const { data, error } = await getSupabase().from("sync_log").delete().eq("level", "warn").select("id");
  if (error) throw new Error(error.message);
  return data?.length ?? 0;
}

export interface LogSummary {
  byJobLevel: Array<{ job: string; level: string; c: number }>;
  warnCategories: Array<{ category: string; c: number }>;
  errorSamples: Array<{ message: string; c: number }>;
}

function categorizeWarnMessage(message: string): string {
  if (message.includes("not tracked")) return "Korona stock not tracked";
  if (message.includes("no Korona stock rows")) return "No Korona stock rows";
  if (message.includes("not in ShipHero")) return "SKU not in ShipHero";
  if (message.includes("Batch issues")) return "Stock batch summary";
  if (message.includes("missing SKU")) return "Order line missing SKU";
  if (message.includes("No SKU mapping")) return "Receipt: no SKU mapping";
  if (message.includes("No Korona product")) return "ShipHero→Korona: no product map";
  if (message.includes("inventory_remove")) return "Receipt inventory skip";
  return "Other warning";
}

export async function summarizeSyncLogs(): Promise<LogSummary> {
  const sb = getSupabase();
  const byJobLevelMap = new Map<string, { job: string; level: string; c: number }>();
  const warnCatMap = new Map<string, number>();
  const errorMap = new Map<string, number>();

  let from = 0;
  const pageSize = 1000;
  while (true) {
    const { data, error } = await sb
      .from("sync_log")
      .select("job, level, message")
      .in("level", ["warn", "error"])
      .range(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    if (!data?.length) break;

    for (const row of data) {
      const job = String(row.job ?? "");
      const level = String(row.level ?? "");
      const key = `${job}\0${level}`;
      const existing = byJobLevelMap.get(key);
      if (existing) existing.c++;
      else byJobLevelMap.set(key, { job, level, c: 1 });

      const message = String(row.message ?? "");
      if (level === "warn") {
        const cat = categorizeWarnMessage(message);
        warnCatMap.set(cat, (warnCatMap.get(cat) ?? 0) + 1);
      } else if (level === "error") {
        errorMap.set(message, (errorMap.get(message) ?? 0) + 1);
      }
    }

    if (data.length < pageSize) break;
    from += pageSize;
  }

  const byJobLevel = [...byJobLevelMap.values()].sort((a, b) => b.c - a.c);
  const warnCategories = [...warnCatMap.entries()]
    .map(([category, c]) => ({ category, c }))
    .sort((a, b) => b.c - a.c);
  const errorSamples = [...errorMap.entries()]
    .map(([message, c]) => ({ message, c }))
    .sort((a, b) => b.c - a.c)
    .slice(0, 15);

  return { byJobLevel, warnCategories, errorSamples };
}

export async function groupLogCounts(): Promise<Array<{ level: string; c: number }>> {
  const { data, error } = await getSupabase().from("sync_log").select("level");
  if (error) throw new Error(error.message);
  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    counts.set(row.level, (counts.get(row.level) ?? 0) + 1);
  }
  return [...counts.entries()].map(([level, c]) => ({ level, c }));
}

export async function recentSyncLogs(opts: {
  job?: string;
  level?: string;
  limit: number;
}): Promise<Array<{ at: string; job: string; message: string; level: string }>> {
  let query = getSupabase()
    .from("sync_log")
    .select("created_at, job, level, message")
    .order("id", { ascending: false })
    .limit(opts.limit);
  if (opts.job) query = query.eq("job", opts.job);
  if (opts.level) query = query.eq("level", opts.level);
  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data ?? []).map((row) => ({
    at: row.created_at,
    job: row.job,
    level: row.level,
    message: row.message,
  }));
}

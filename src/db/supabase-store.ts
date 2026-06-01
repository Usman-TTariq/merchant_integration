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
}): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const sb = getSupabase();
  const from = (opts.page - 1) * opts.limit;
  const to = from + opts.limit - 1;
  const search = opts.search?.trim();

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
}): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const from = (opts.page - 1) * opts.limit;
  const to = from + opts.limit - 1;
  const { data, count, error } = await getSupabase()
    .from("order_mappings")
    .select("*", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, to);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as Record<string, unknown>[], total: count ?? 0 };
}

export async function queryProcessedReceipts(opts: {
  page: number;
  limit: number;
}): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const from = (opts.page - 1) * opts.limit;
  const to = from + opts.limit - 1;
  const { data, count, error } = await getSupabase()
    .from("processed_receipts")
    .select("*", { count: "exact" })
    .order("processed_at", { ascending: false })
    .range(from, to);
  if (error) throw new Error(error.message);
  return { rows: (data ?? []) as Record<string, unknown>[], total: count ?? 0 };
}

export async function querySyncLogs(opts: {
  page: number;
  limit: number;
  level?: string;
}): Promise<{ rows: Record<string, unknown>[]; total: number }> {
  const from = (opts.page - 1) * opts.limit;
  const to = from + opts.limit - 1;
  let query = getSupabase()
    .from("sync_log")
    .select("*", { count: "exact" })
    .order("id", { ascending: false })
    .range(from, to);
  if (opts.level) query = query.eq("level", opts.level);
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

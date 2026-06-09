import { config, assertDatabaseConfigForRuntime } from "../config.js";
import { isSupabaseConfigured, verifySupabaseTables } from "./supabase-client.js";
import * as sqlite from "./sqlite-store.js";
import * as supabase from "./supabase-store.js";

export type DatabaseProvider = "sqlite" | "supabase";

const store = isSupabaseConfigured() ? supabase : sqlite;

export function getDatabaseProvider(): DatabaseProvider {
  return config.database.provider;
}

export async function initDatabase(): Promise<void> {
  assertDatabaseConfigForRuntime();
  if (config.database.provider === "supabase") {
    await verifySupabaseTables();
  }
}

export const getCursor = store.getCursor;
export const setCursor = store.setCursor;
export const logSync = store.logSync;
export const upsertProductMapping = store.upsertProductMapping;
export const isOrderMapped = store.isOrderMapped;
export const insertOrderMapping = store.insertOrderMapping;
export const findShipheroSku = store.findShipheroSku;
export const isReceiptProcessed = store.isReceiptProcessed;
export const markReceiptProcessed = store.markReceiptProcessed;
export const countOrderMappings = store.countOrderMappings;
export const findKoronaOrderIdByShiphero = store.findKoronaOrderIdByShiphero;
export const findKoronaProductIdBySku = store.findKoronaProductIdBySku;
export const countTable = store.countTable;
export const countLogsByLevel = store.countLogsByLevel;
export const getAllCursors = store.getAllCursors;
export const queryProductMappings = store.queryProductMappings;
export const queryOrderMappings = store.queryOrderMappings;
export const queryProcessedReceipts = store.queryProcessedReceipts;
export const querySyncLogs = store.querySyncLogs;
export const maxProductRevision = store.maxProductRevision;
export const countProductsUpdatedSinceMinutes = store.countProductsUpdatedSinceMinutes;
export const latestProductMapping = store.latestProductMapping;
export const deleteErrorLogs = store.deleteErrorLogs;
export const deleteWarningLogs = store.deleteWarningLogs;
export const summarizeSyncLogs = store.summarizeSyncLogs;
export type { LogSummary } from "./sqlite-store.js";
export const groupLogCounts = store.groupLogCounts;
export const recentSyncLogs = store.recentSyncLogs;

/** @deprecated Use async db helpers. Kept for scripts that still import getDb. */
export function getDb(): never {
  throw new Error(
    `Direct getDb() is not supported with provider "${config.database.provider}". Use db helpers from db/index.js`
  );
}

export { isSupabaseConfigured, verifySupabaseTables } from "./supabase-client.js";
export { getSqliteDb } from "./sqlite-store.js";

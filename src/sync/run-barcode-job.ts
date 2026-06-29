import { initDatabase } from "../db.js";
import {
  cacheKoronaBarcodesChunk,
  indexShipheroBarcodesChunk,
  relinkProductMappingsChunk,
  runBarcodeLinkPipeline,
  type BarcodeLinkOptions,
} from "./barcode-link.js";

export type BarcodeJob = "barcode-cache" | "barcode-index" | "link" | "barcode-link";

const CRON_OPTS: BarcodeLinkOptions = {
  koronaPages: 5,
  shipheroPages: 50,
  koronaConcurrency: 6,
};

export async function runBarcodeJob(job: BarcodeJob, opts: BarcodeLinkOptions = {}): Promise<Record<string, unknown>> {
  await initDatabase();
  const merged = { ...CRON_OPTS, ...opts };

  switch (job) {
    case "barcode-cache":
      return { barcodeCache: await cacheKoronaBarcodesChunk(merged) };
    case "barcode-index":
      return { barcodeIndex: await indexShipheroBarcodesChunk(merged) };
    case "link":
      return { link: await relinkProductMappingsChunk() };
    case "barcode-link":
      return await runBarcodeLinkPipeline(merged);
    default:
      throw new Error(`Unknown barcode job: ${job}`);
  }
}

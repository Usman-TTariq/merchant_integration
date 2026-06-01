-- Run in Supabase Dashboard → SQL Editor (or: npm run db:setup)

CREATE TABLE IF NOT EXISTS product_mappings (
  korona_product_id TEXT PRIMARY KEY,
  korona_product_number TEXT,
  shiphero_sku TEXT NOT NULL,
  korona_revision INTEGER,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS order_mappings (
  korona_order_id TEXT PRIMARY KEY,
  korona_order_type TEXT NOT NULL,
  shiphero_order_id TEXT,
  shiphero_order_number TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS processed_receipts (
  receipt_id TEXT PRIMARY KEY,
  processed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_cursors (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS sync_log (
  id BIGSERIAL PRIMARY KEY,
  job TEXT NOT NULL,
  level TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_product_mappings_updated_at ON product_mappings (updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_mappings_sku ON product_mappings (shiphero_sku);
CREATE INDEX IF NOT EXISTS idx_sync_log_created_at ON sync_log (created_at DESC);

ALTER TABLE product_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE order_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE processed_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_cursors ENABLE ROW LEVEL SECURITY;
ALTER TABLE sync_log ENABLE ROW LEVEL SECURITY;

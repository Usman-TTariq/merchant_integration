-- Run once in Supabase SQL Editor if shiphero_barcode_index already exists with barcode PRIMARY KEY.
-- Safe to skip on fresh installs (schema.sql already uses composite PK).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.table_constraints
    WHERE table_name = 'shiphero_barcode_index'
      AND constraint_type = 'PRIMARY KEY'
      AND constraint_name = 'shiphero_barcode_index_pkey'
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.key_column_usage
    WHERE table_name = 'shiphero_barcode_index'
      AND constraint_name = 'shiphero_barcode_index_pkey'
      AND column_name = 'shiphero_sku'
  ) THEN
    CREATE TABLE shiphero_barcode_index_v2 (
      barcode TEXT NOT NULL,
      shiphero_sku TEXT NOT NULL,
      on_hand INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (barcode, shiphero_sku)
    );
    INSERT INTO shiphero_barcode_index_v2 (barcode, shiphero_sku, on_hand, updated_at)
    SELECT barcode, shiphero_sku, COALESCE(on_hand, 0), updated_at
    FROM shiphero_barcode_index
    ON CONFLICT (barcode, shiphero_sku) DO NOTHING;
    DROP TABLE shiphero_barcode_index;
    ALTER TABLE shiphero_barcode_index_v2 RENAME TO shiphero_barcode_index;
    CREATE INDEX IF NOT EXISTS idx_shiphero_barcode_index_sku ON shiphero_barcode_index (shiphero_sku);
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS shiphero_barcode_index (
  barcode TEXT NOT NULL,
  shiphero_sku TEXT NOT NULL,
  on_hand INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (barcode, shiphero_sku)
);

CREATE INDEX IF NOT EXISTS idx_shiphero_barcode_index_sku ON shiphero_barcode_index (shiphero_sku);

CREATE TABLE IF NOT EXISTS korona_product_barcodes (
  korona_product_id TEXT PRIMARY KEY,
  barcodes TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE shiphero_barcode_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE korona_product_barcodes ENABLE ROW LEVEL SECURITY;

-- Run this ONCE in Supabase Dashboard → SQL Editor (production fix).
-- Fixes: "column shiphero_barcode_index.on_hand does not exist"

-- 1) Ensure barcode tables exist
CREATE TABLE IF NOT EXISTS korona_product_barcodes (
  korona_product_id TEXT PRIMARY KEY,
  barcodes TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS shiphero_barcode_index (
  barcode TEXT NOT NULL,
  shiphero_sku TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) Add on_hand column on old installs
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'shiphero_barcode_index'
      AND column_name = 'on_hand'
  ) THEN
    ALTER TABLE shiphero_barcode_index ADD COLUMN on_hand INTEGER NOT NULL DEFAULT 0;
  END IF;
END $$;

-- 3) Upgrade single-PK (barcode) → composite PK (barcode, shiphero_sku)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_schema = 'public'
      AND table_name = 'shiphero_barcode_index'
      AND constraint_type = 'PRIMARY KEY'
      AND constraint_name = 'shiphero_barcode_index_pkey'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.key_column_usage
    WHERE table_schema = 'public'
      AND table_name = 'shiphero_barcode_index'
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
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_shiphero_barcode_index_sku ON shiphero_barcode_index (shiphero_sku);

ALTER TABLE shiphero_barcode_index ENABLE ROW LEVEL SECURITY;
ALTER TABLE korona_product_barcodes ENABLE ROW LEVEL SECURITY;

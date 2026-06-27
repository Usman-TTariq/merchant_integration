# Korona ↔ ShipHero Sync

Node/TypeScript service that syncs **products**, **inventory**, **orders**, and **stock levels** between [Korona Cloud API v3](https://manual.koronapos.com/korona-cloud-api-v3/) and [ShipHero GraphQL](https://developer.shiphero.com/).

**Important:** Korona POS changes appear in **ShipHero's app** when background sync jobs run GraphQL mutations (`inventory_add` / `inventory_remove`, `order_create`, etc.). The WinChateau dashboard compares and monitors — it is not ShipHero's source of truth.

## Features

| Job | Direction | Behavior |
|-----|-----------|----------|
| `products` | Korona → ShipHero | `product_create` / `product_update` by SKU |
| `stock` | Korona → ShipHero | Korona on-hand → `inventory_add` / `inventory_remove` delta (when `SYNC_KORONA_STOCK=true`) |
| `inventory` | Korona → ShipHero | POS receipts → `inventory_remove` (only when `SYNC_KORONA_STOCK=false`) |
| `orders` | Korona → ShipHero | POS receipts → `order_create` (`R-{receipt#}`) |
| `inventory` | ShipHero → Korona | Fulfilled orders → Korona inventory list (optional; needs `KORONA_INVENTORY_ID`) |

State is stored in SQLite locally (`data/sync.db`) or **Supabase** on Vercel: product mappings, order mappings, revision cursors, sync logs.

## Setup (local)

1. **Node 20+**

   ```bash
   cd d:\merchat_integration
   npm install
   ```

2. **Copy env file** (never commit `.env`):

   ```bash
   copy .env.example .env
   ```

3. **Fill `.env`** and verify:

   ```bash
   npm run setup          # test APIs, auto-fill SHIPHERO_WAREHOUSE_ID
   npm run env:verify     # local checks
   ```

4. **Manual sync** (local has no auto cron unless `npm start`):

   ```bash
   npm run sync:products
   npm run sync:orders
   npm run sync:stock
   npm run sync:all
   ```

5. **Dashboard UI**:

   ```bash
   npm run ui
   ```

   Open http://localhost:3847 — Korona live data, mappings, logs, manual sync buttons.

6. **Local scheduler** (always-on server):

   ```bash
   npm start
   ```

   Runs products, inventory, orders, and **stock** on cron (UTC). Stock cron matches Vercel: 150 SKUs per 15 min.

## Vercel production deploy

SQLite does not persist on Vercel — **Supabase is required**.

### 1. Environment variables

```bash
npm run vercel:env-checklist    # names to copy into Vercel dashboard
npm run env:verify -- --production
```

**Required in Vercel → Settings → Environment Variables:**

| Variable | Purpose |
|----------|---------|
| `KORONA_*` | Korona API + `KORONA_WAREHOUSE_ID` for stock reads |
| `SHIPHERO_REFRESH_TOKEN` or `SHIPHERO_ACCESS_TOKEN` | ShipHero auth |
| `SHIPHERO_WAREHOUSE_ID` | Target warehouse |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | Persistent DB |
| `DATABASE_PROVIDER=supabase` | Force Supabase on serverless |
| `SYNC_KORONA_STOCK=true` | Level-based stock sync |
| `DASHBOARD_PASSWORD` | Protect dashboard |
| `CRON_SECRET` | Long random string for `/api/cron/*` auth |

**Recommended:** `SKU_FIELD=number`, `STOCK_SYNC_BATCH_SIZE=150`, `DISPLAY_TIMEZONE=America/Los_Angeles`

### 2. Deploy

```bash
npm run build
npx vercel --prod          # or connect GitHub repo in Vercel dashboard
npm run db:setup           # apply supabase/schema.sql (once)
```

`vercel.json` schedules:

| Cron | Schedule | Effect |
|------|----------|--------|
| `/api/cron/orders` | every 3 min | POS receipts → ShipHero orders |
| `/api/cron/stock` | every 15 min | 150 SKUs → delta stock sync |
| `/api/cron/products` | every 6 hours | Product create/update |

Vercel sends `Authorization: Bearer <CRON_SECRET>` (or `x-vercel-cron: 1` on platform cron).

### 3. One-time production bootstrap

After first deploy:

```bash
npm run prod:bootstrap     # sync products + link R-* orders (on prod DB)
# OR trigger via dashboard Sync Products + Sync Orders
```

Full stock backfill (~11k SKUs): stock cron rotates 150 SKUs every 15 min (~19.5 h for one full pass), or run **Sync Stock** repeatedly until cursor wraps.

### 4. Verify

```bash
npm run cron:test -- --url https://your-app.vercel.app --job stock
npm run verify:sync        # sample Korona vs ShipHero on_hand
```

Check **ShipHero app** directly (not dashboard): `on_hand`, `R-*` orders, Reports **Qty mismatch** filter shrinking over time.

### 5. Operating model (steady state)

1. POS sells in Korona → Korona stock updates
2. Within ~3 min — orders cron creates/links ShipHero order
3. Within ~15 min — stock cron pushes changed on_hand
4. Staff uses **ShipHero app** for inventory/orders
5. WinChateau Reports — weekly mismatch audit

## Stock sync (delta add/remove)

Level sync compares Korona on-hand to ShipHero `on_hand` and applies the difference:

- Korona higher → `inventory_add`
- Korona lower → `inventory_remove`
- Equal → skip

Accounts without dynamic slotting cannot use `inventory_replace`; delta sync is the supported path. If remove fails with "not enough inventory", the SKU is skipped and retried on the next cron pass.

## SKU mapping

`SKU_FIELD` controls the ShipHero SKU source:

- `number` (default) — Korona product number
- `code` — primary barcode
- `id` — Korona UUID

Run **products** sync before inventory/orders/stock so mappings exist.

### Barcode linking (Korona → existing ShipHero / Shopify SKUs)

Korona POS uses `A*****` product numbers; ShipHero often has web SKUs like `0047640` or `10655-1`. Sync now links by **Korona barcode (`productCode`)** when a matching ShipHero product exists:

1. Build barcode index (run until `hasNext: false`; resume-safe):

   ```bash
   npm run index:shiphero-barcodes -- --pages=500
   ```

2. Re-link all Korona products to matched ShipHero SKUs:

   ```bash
   npm run link:products
   ```

3. Normal product sync continues to use linked SKUs (`SHIPHERO_LINK_BY_BARCODE=true` by default).

Mappings tab will show `0047640`, `10655-1`, etc. where barcodes match — not only `A*****`.

When the same barcode exists on multiple ShipHero SKUs, linking prefers the row with **higher on_hand** (stocked web SKU over empty `A*` duplicate). Re-run `index:shiphero-barcodes` after upgrading so the index stores on_hand.

## Security

- Rotate any credentials shared in chat or tickets.
- Keep secrets only in `.env` / Vercel env vars.
- Set `DASHBOARD_PASSWORD` locally and on Vercel.

## Build

```bash
npm run build
node dist/cli.js products
```

## NPM scripts reference

| Script | Purpose |
|--------|---------|
| `env:verify` | Check required env vars (`--production` for Vercel) |
| `vercel:env-checklist` | List vars to set in Vercel |
| `prod:bootstrap` | One-time products + orders on production DB |
| `cron:test` | POST to `/api/cron/*` with `CRON_SECRET` |
| `verify:sync` | Sample Korona vs ShipHero qty compare |
| `orders:backfill` | Link existing ShipHero `R-*` orders locally |
| `db:setup` | Apply Supabase schema |

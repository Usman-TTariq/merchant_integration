# Korona ↔ ShipHero Sync

Node/TypeScript service that syncs **products**, **inventory**, and **orders** between [Korona Cloud API v3](https://manual.koronapos.com/korona-cloud-api-v3/) and [ShipHero GraphQL](https://developer.shiphero.com/).

## Features

| Job | Direction | Behavior |
|-----|-----------|----------|
| `products` | Korona → ShipHero | `product_create` / `product_update` by SKU |
| `inventory` | Korona → ShipHero | POS receipts → `inventory_remove` |
| `inventory` | ShipHero → Korona | Fulfilled orders → Korona inventory list items (optional) |
| `orders` | Korona → ShipHero | `customerOrders` → `order_create` |

State is stored in SQLite (`data/sync.db`): product mappings, order mappings, revision cursors, processed receipts.

## Setup

1. **Node 20+**

   ```bash
   cd d:\merchat_integration
   npm install
   ```

2. **Copy env file** (never commit `.env`):

   ```bash
   copy .env.example .env
   ```

3. **Fill `.env`** (replace `CHANGE_ME` placeholders):

   - Korona: `KORONA_ACCOUNT_ID`, `KORONA_USERNAME`, `KORONA_PASSWORD`
   - ShipHero: `SHIPHERO_USERNAME`, `SHIPHERO_PASSWORD`
   - Run setup to test APIs and auto-fill warehouse ID:

   ```bash
   npm run setup
   ```

   Setup validates Korona + ShipHero, lists warehouses, and writes `SHIPHERO_WAREHOUSE_ID` when only one warehouse exists.

4. **Optional env**:

   ```bash
   npm run sync:products
   npm run sync:inventory
   npm run sync:orders
   npm run sync:all
   ```

5. **Dashboard UI** (view data & run sync):

   ```bash
   npm run ui
   ```

   Open http://localhost:3847 — shows Korona live products, sync mappings, logs, and manual sync buttons.

6. **Scheduler** (cron, UTC):

   ```bash
   npm start
   ```

## SKU mapping

`SKU_FIELD` controls the ShipHero SKU source:

- `number` (default) — Korona product number
- `code` — primary barcode
- `id` — Korona UUID

Run **products** sync before inventory/orders so mappings exist in SQLite.

## ShipHero warehouse ID

In ShipHero GraphQL Playground or a `warehouses` query, copy the base64 `warehouse_id` for your warehouse into `SHIPHERO_WAREHOUSE_ID`.

## Security

- Rotate any credentials that were shared in chat or tickets.
- Keep secrets only in `.env`.
- **Dashboard login:** set `DASHBOARD_PASSWORD` in `.env` (local) and in Vercel → Environment Variables (production). Without it, the UI is not password-protected.
- For Korona POS **External System Call**, you can use the same password in the call’s Login/Password fields (HTTP basic) or sign in on the login page after opening the Display URL.

## Build

```bash
npm run build
node dist/cli.js products
```

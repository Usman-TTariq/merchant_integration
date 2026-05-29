import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";
import { getDb, getCursor, logSync, setCursor } from "../db.js";
import { sanitizeSku } from "../utils/sku.js";
import type { KoronaAddress, KoronaCustomerOrder, KoronaCustomerOrderLine } from "../types/korona.js";

const CURSOR_KEY = "customer_orders_revision";

function orderLines(order: KoronaCustomerOrder): KoronaCustomerOrderLine[] {
  return order.items ?? order.orderLines ?? [];
}

function formatPrice(value?: number): string {
  return value != null ? value.toFixed(2) : "0.00";
}

function shippingFromOrder(order: KoronaCustomerOrder): Record<string, string> {
  const addr: KoronaAddress =
    order.deliveryAddress ??
    order.customer?.addresses?.[0] ??
    {};

  const street = [addr.street, addr.houseNumber].filter(Boolean).join(" ").trim();

  return {
    first_name: addr.firstName ?? "Customer",
    last_name: addr.lastName ?? "",
    company: addr.company ?? "",
    address1: street || "Address required",
    address2: "",
    city: addr.city ?? "",
    state: "",
    state_code: "",
    zip: addr.zipCode ?? "",
    country: addr.country?.name ?? "US",
    country_code: "US",
    email: addr.email ?? "",
    phone: addr.phone ?? "",
  };
}

export async function syncOrders(): Promise<{ created: number; skipped: number }> {
  const korona = new KoronaClient();
  const shiphero = new ShipHeroClient();
  const db = getDb();

  const revision = getCursor(CURSOR_KEY);
  const revisionNum = revision ? Number(revision) : undefined;

  const isMapped = db.prepare("SELECT 1 FROM order_mappings WHERE korona_order_id = ?");
  const insertMapping = db.prepare(`
    INSERT INTO order_mappings (korona_order_id, korona_order_type, shiphero_order_id, shiphero_order_number)
    VALUES (?, 'customerOrder', ?, ?)
  `);
  const skuLookup = db.prepare(
    "SELECT shiphero_sku FROM product_mappings WHERE korona_product_id = ? OR korona_product_number = ?"
  );

  let created = 0;
  let skipped = 0;
  let maxRevision = revisionNum ?? 0;

  for await (const batch of korona.paginate((page) =>
    korona.getCustomerOrders({ revision: revisionNum, page })
  )) {
    for (const order of batch) {
      if (order.deleted) {
        skipped++;
        continue;
      }
      if (order.revision != null && order.revision > maxRevision) {
        maxRevision = order.revision;
      }
      if (isMapped.get(order.id)) {
        skipped++;
        continue;
      }

      let full = order;
      if (!orderLines(order).length) {
        try {
          full = await korona.getCustomerOrder(order.id);
        } catch (err) {
          logSync("orders", "error", `Fetch order ${order.id}: ${err instanceof Error ? err.message : String(err)}`);
          skipped++;
          continue;
        }
      }

      const lines = orderLines(full);
      if (!lines.length) {
        skipped++;
        continue;
      }

      const lineItems: Array<{ sku: string; quantity: number; price: string; name: string }> = [];

      for (const line of lines) {
        const qty = line.quantity ?? 0;
        if (qty <= 0) continue;

        const productId = line.product?.id;
        const productNumber = line.product?.number;
        const mapped = productId
          ? (skuLookup.get(productId, productNumber ?? "") as { shiphero_sku: string } | undefined)
          : undefined;

        const sku = mapped?.shiphero_sku ?? (productNumber ? sanitizeSku(productNumber) : null);
        if (!sku) {
          logSync("orders", "warn", `Order ${full.number ?? full.id}: missing SKU for line`);
          continue;
        }

        lineItems.push({
          sku,
          quantity: Math.round(qty),
          price: formatPrice(line.price),
          name: line.description ?? line.product?.name ?? sku,
        });
      }

      if (!lineItems.length) {
        skipped++;
        continue;
      }

      const orderNumber = full.number ?? full.id;
      const partnerOrderId = `korona-${full.id}`;

      try {
        const createdOrder = await shiphero.createOrder({
          orderNumber,
          partnerOrderId,
          shopName: "Korona",
          lineItems,
          shippingAddress: shippingFromOrder(full),
        });

        insertMapping.run(full.id, createdOrder.id, createdOrder.order_number);
        created++;
        logSync("orders", "info", `Created ShipHero order ${createdOrder.order_number} from Korona ${orderNumber}`);
      } catch (err) {
        skipped++;
        logSync("orders", "error", `Order ${orderNumber}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (maxRevision > (revisionNum ?? 0)) {
    setCursor(CURSOR_KEY, String(maxRevision));
  }

  logSync("orders", "info", `Done: created=${created} skipped=${skipped}`);
  return { created, skipped };
}

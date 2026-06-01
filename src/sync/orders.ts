import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";
import {
  findShipheroSku,
  getCursor,
  insertOrderMapping,
  isOrderMapped,
  logSync,
  setCursor,
} from "../db.js";
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

  const revision = await getCursor(CURSOR_KEY);
  const revisionNum = revision ? Number(revision) : undefined;

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
      if (await isOrderMapped(order.id)) {
        skipped++;
        continue;
      }

      let full = order;
      if (!orderLines(order).length) {
        try {
          full = await korona.getCustomerOrder(order.id);
        } catch (err) {
          await logSync("orders", "error", `Fetch order ${order.id}: ${err instanceof Error ? err.message : String(err)}`);
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
        const mappedSku = await findShipheroSku(productId, productNumber);

        const sku = mappedSku ?? (productNumber ? sanitizeSku(productNumber) : null);
        if (!sku) {
          await logSync("orders", "warn", `Order ${full.number ?? full.id}: missing SKU for line`);
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

        await insertOrderMapping({
          koronaOrderId: full.id,
          koronaOrderType: "customerOrder",
          shipheroOrderId: createdOrder.id,
          shipheroOrderNumber: createdOrder.order_number,
        });
        created++;
        await logSync("orders", "info", `Created ShipHero order ${createdOrder.order_number} from Korona ${orderNumber}`);
      } catch (err) {
        skipped++;
        await logSync("orders", "error", `Order ${orderNumber}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (maxRevision > (revisionNum ?? 0)) {
    await setCursor(CURSOR_KEY, String(maxRevision));
  }

  await logSync("orders", "info", `Done: created=${created} skipped=${skipped}`);
  return { created, skipped };
}

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
import { receiptHasSaleLines, receiptSaleLines } from "../utils/korona-receipt.js";
import { sanitizeSku } from "../utils/sku.js";
import type {
  KoronaAddress,
  KoronaCustomerOrder,
  KoronaCustomerOrderLine,
  KoronaReceipt,
  KoronaSaleLine,
} from "../types/korona.js";

const CUSTOMER_ORDERS_CURSOR = "customer_orders_revision";
const RECEIPT_ORDERS_CURSOR = "receipt_orders_revision";

type ShipHeroLineItem = { sku: string; quantity: number; price: string; name: string };

function orderLines(order: KoronaCustomerOrder): KoronaCustomerOrderLine[] {
  return order.items ?? order.orderLines ?? [];
}

function formatPrice(value?: number): string {
  return value != null ? value.toFixed(2) : "0.00";
}

function saleQuantity(line: KoronaSaleLine): number {
  return Math.abs(line.quantity ?? 0);
}

function aggregateLineItems(items: ShipHeroLineItem[]): ShipHeroLineItem[] {
  const bySku = new Map<string, ShipHeroLineItem>();
  for (const item of items) {
    const existing = bySku.get(item.sku);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      bySku.set(item.sku, { ...item });
    }
  }
  return [...bySku.values()];
}

async function lineItemsFromSaleLines(
  lines: KoronaSaleLine[],
  context: string
): Promise<ShipHeroLineItem[]> {
  const lineItems: ShipHeroLineItem[] = [];

  for (const line of lines) {
    const qty = saleQuantity(line);
    if (qty <= 0) continue;

    const productId = line.product?.id;
    const productNumber = line.product?.number ?? line.recognitionCode;
    const mappedSku = await findShipheroSku(productId, productNumber);
    const sku = mappedSku ?? (productNumber ? sanitizeSku(productNumber) : null);

    if (!sku) {
      await logSync("orders", "warn", `${context}: missing SKU for line`);
      continue;
    }

    lineItems.push({
      sku,
      quantity: Math.round(qty),
      price: formatPrice(line.price),
      name: line.description ?? line.product?.name ?? sku,
    });
  }

  return aggregateLineItems(lineItems);
}

async function filterShipHeroSkus(
  shiphero: ShipHeroClient,
  items: ShipHeroLineItem[],
  context: string
): Promise<ShipHeroLineItem[]> {
  const valid: ShipHeroLineItem[] = [];
  for (const item of items) {
    const product = await shiphero.getProductBySku(item.sku);
    if (product) {
      valid.push(item);
    } else {
      await logSync("orders", "warn", `${context}: SKU ${item.sku} not in ShipHero, skipping line`);
    }
  }
  return valid;
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

function shippingFromReceipt(receipt: KoronaReceipt): Record<string, string> {
  const store = receipt.organizationalUnit?.name ?? "Korona Store";
  const pos = receipt.pointOfSale?.name ?? "Point of Sale";

  return {
    first_name: "In-Store",
    last_name: "Sale",
    company: store,
    address1: pos,
    address2: "",
    city: "",
    state: "",
    state_code: "",
    zip: "",
    country: "US",
    country_code: "US",
    email: "",
    phone: "",
  };
}

function isReceiptEligible(receipt: KoronaReceipt): boolean {
  if (receipt.cancelled || receipt.voided) return false;
  return receiptHasSaleLines(receipt);
}

async function syncCustomerOrders(): Promise<{ created: number; skipped: number }> {
  const korona = new KoronaClient();
  const shiphero = new ShipHeroClient();

  const revision = await getCursor(CUSTOMER_ORDERS_CURSOR);
  const revisionNum = revision ? Number(revision) : undefined;

  let created = 0;
  let skipped = 0;
  let maxRevision = revisionNum ?? 0;

  for await (const batch of korona.paginate((page) =>
    korona.getCustomerOrders({ revision: revisionNum, page })
  )) {
    for (const order of batch) {
      const bumpRevision = () => {
        if (order.revision != null && order.revision > maxRevision) {
          maxRevision = order.revision;
        }
      };

      if (order.deleted) {
        bumpRevision();
        skipped++;
        continue;
      }
      if (await isOrderMapped(order.id)) {
        bumpRevision();
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

      const lineItems = await lineItemsFromSaleLines(
        orderLines(full),
        `Order ${full.number ?? full.id}`
      );
      if (!lineItems.length) {
        bumpRevision();
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
        bumpRevision();
        created++;
        await logSync("orders", "info", `Created ShipHero order ${createdOrder.order_number} from Korona ${orderNumber}`);
      } catch (err) {
        skipped++;
        await logSync("orders", "error", `Order ${orderNumber}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  if (maxRevision > (revisionNum ?? 0)) {
    await setCursor(CUSTOMER_ORDERS_CURSOR, String(maxRevision));
  }

  return { created, skipped };
}

async function syncReceiptOrders(): Promise<{ created: number; skipped: number }> {
  const korona = new KoronaClient();
  const shiphero = new ShipHeroClient();

  const revision = await getCursor(RECEIPT_ORDERS_CURSOR);
  const revisionNum = revision ? Number(revision) : undefined;

  let created = 0;
  let skipped = 0;
  let maxRevision = revisionNum ?? 0;

  for await (const batch of korona.paginate((page) =>
    korona.getReceipts({ revision: revisionNum, page })
  )) {
    for (const receipt of batch) {
      const bumpRevision = () => {
        if (receipt.revision != null && receipt.revision > maxRevision) {
          maxRevision = receipt.revision;
        }
      };

      if (await isOrderMapped(receipt.id)) {
        bumpRevision();
        skipped++;
        continue;
      }

      let full: KoronaReceipt = receipt;
      if (!isReceiptEligible(receipt)) {
        if (!receiptHasSaleLines(receipt) && !receipt.cancelled && !receipt.voided) {
          try {
            full = await korona.getReceipt(receipt.id);
          } catch (err) {
            await logSync("orders", "error", `Fetch receipt ${receipt.id}: ${err instanceof Error ? err.message : String(err)}`);
            skipped++;
            continue;
          }
        }
      }

      if (!isReceiptEligible(full)) {
        bumpRevision();
        skipped++;
        continue;
      }

      const receiptLabel = `Receipt ${full.number ?? full.id}`;
      const lineItems = await filterShipHeroSkus(
        shiphero,
        await lineItemsFromSaleLines(receiptSaleLines(full), receiptLabel),
        receiptLabel
      );
      if (!lineItems.length) {
        bumpRevision();
        skipped++;
        continue;
      }

      const receiptNumber = full.number ?? full.id;
      const orderNumber = `R-${receiptNumber}`;
      const partnerOrderId = `korona-r-${receiptNumber}`.slice(0, 45);

      try {
        const createdOrder = await shiphero.createOrder({
          orderNumber,
          partnerOrderId,
          shopName: "Korona POS",
          lineItems,
          shippingAddress: shippingFromReceipt(full),
          fulfillmentStatus: "fulfilled",
        });

        await insertOrderMapping({
          koronaOrderId: full.id,
          koronaOrderType: "receipt",
          shipheroOrderId: createdOrder.id,
          shipheroOrderNumber: createdOrder.order_number,
        });
        bumpRevision();
        created++;
        await logSync(
          "orders",
          "info",
          `Created ShipHero order ${createdOrder.order_number} from Korona receipt ${receiptNumber}`
        );
      } catch (err) {
        skipped++;
        await logSync(
          "orders",
          "error",
          `Receipt ${receiptNumber}: ${err instanceof Error ? err.message : String(err)}`
        );
      }
    }
  }

  if (maxRevision > (revisionNum ?? 0)) {
    await setCursor(RECEIPT_ORDERS_CURSOR, String(maxRevision));
  }

  return { created, skipped };
}

export async function syncOrders(): Promise<{ created: number; skipped: number }> {
  const customer = await syncCustomerOrders();
  const receipts = await syncReceiptOrders();
  const created = customer.created + receipts.created;
  const skipped = customer.skipped + receipts.skipped;

  await logSync(
    "orders",
    "info",
    `Done: created=${created} skipped=${skipped} (customer=${customer.created}/${customer.skipped}, receipts=${receipts.created}/${receipts.skipped})`
  );
  return { created, skipped };
}

import { config } from "../config.js";
import type { PrintLabelInput, ShipHeroOrder } from "../types/shiphero.js";

function fulfillableQuantity(line: {
  quantity: number;
  quantity_pending_fulfillment?: number;
  quantity_shipped?: number;
}): number {
  if (line.quantity_pending_fulfillment != null) {
    return Math.max(0, Math.round(line.quantity_pending_fulfillment));
  }
  const shipped = line.quantity_shipped ?? 0;
  return Math.max(0, Math.round(line.quantity - shipped));
}

/** Build PrintLabelInput for genericlabel from a ShipHero order. */
export function buildGenericLabelInput(order: ShipHeroOrder): PrintLabelInput {
  const lineItems: Array<{ line_item_id: string; quantity: number }> = [];

  for (const edge of order.line_items?.edges ?? []) {
    const node = edge.node;
    if (!node?.id) continue;
    const qty = fulfillableQuantity(node);
    if (qty <= 0) continue;
    lineItems.push({ line_item_id: node.id, quantity: qty });
  }

  if (lineItems.length === 0) {
    throw new Error(
      `Order ${order.order_number ?? order.id} has no fulfillable line items for label print`
    );
  }

  const lp = config.labelPrint;
  return {
    order_id: order.id,
    shipping_carrier: lp.carrier,
    shipping_method: lp.method,
    print_invoice: lp.printInvoice,
    packages: [
      {
        dimensions: {
          weight: lp.weight,
          height: lp.height,
          width: lp.width,
          length: lp.length,
        },
        line_items: lineItems,
      },
    ],
  };
}

export function isLabelPrintEligible(fulfillmentStatus?: string | null): boolean {
  const status = (fulfillmentStatus ?? "").toLowerCase();
  if (!status) return true;
  return !["fulfilled", "closed", "cancelled", "canceled"].includes(status);
}

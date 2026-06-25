import type { ShipHeroClient } from "../clients/shiphero.js";
import { insertOrderMapping, logSync } from "../db.js";

type CreateOrderInput = Parameters<ShipHeroClient["createOrder"]>[0];

export function isDuplicateShipheroOrderError(err: unknown): boolean {
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  return msg.includes("already exists");
}

export async function createOrLinkShipheroOrder(
  shiphero: ShipHeroClient,
  input: CreateOrderInput,
  link: {
    koronaOrderId: string;
    koronaOrderType: "receipt" | "customerOrder";
    logLabel: string;
  }
): Promise<"created" | "linked"> {
  try {
    const createdOrder = await shiphero.createOrder(input);
    await insertOrderMapping({
      koronaOrderId: link.koronaOrderId,
      koronaOrderType: link.koronaOrderType,
      shipheroOrderId: createdOrder.id,
      shipheroOrderNumber: createdOrder.order_number,
    });
    await logSync(
      "orders",
      "info",
      `Created ShipHero order ${createdOrder.order_number} from ${link.logLabel}`
    );
    return "created";
  } catch (err) {
    if (!isDuplicateShipheroOrderError(err)) throw err;

    const existing = await shiphero.findOrder({
      shopName: input.shopName,
      orderNumber: input.orderNumber,
      partnerOrderId: input.partnerOrderId,
    });
    if (!existing) {
      throw new Error(
        `ShipHero order ${input.orderNumber} already exists but could not be found for linking`
      );
    }

    await insertOrderMapping({
      koronaOrderId: link.koronaOrderId,
      koronaOrderType: link.koronaOrderType,
      shipheroOrderId: existing.id,
      shipheroOrderNumber: existing.order_number,
    });
    await logSync(
      "orders",
      "info",
      `Linked existing ShipHero order ${existing.order_number} to ${link.logLabel}`
    );
    return "linked";
  }
}

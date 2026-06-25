import { config, requireShipheroWarehouseId } from "../config.js";
import type {
  GraphQLResponse,
  LabelPrintResponse,
  PrintLabelInput,
  ShipHeroOrder,
  ShipHeroProduct,
} from "../types/shiphero.js";

interface TokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
}

export class ShipHeroClient {
  private accessToken: string | null = null;
  private tokenExpiresAt = 0;

  private async authenticate(): Promise<string> {
    if (config.shiphero.authMode === "none") {
      throw new Error(
        "ShipHero not configured. Set SHIPHERO_ACCESS_TOKEN, SHIPHERO_REFRESH_TOKEN, or SHIPHERO_USERNAME + SHIPHERO_PASSWORD"
      );
    }

    if (config.shiphero.authMode === "access_token" && config.shiphero.accessToken) {
      return config.shiphero.accessToken;
    }

    if (this.accessToken && Date.now() < this.tokenExpiresAt - 60_000) {
      return this.accessToken;
    }

    if (config.shiphero.refreshToken) {
      const res = await fetch(config.shiphero.refreshUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ refresh_token: config.shiphero.refreshToken }),
      });
      if (!res.ok) {
        throw new Error(`ShipHero token refresh failed: ${res.status} ${await res.text()}`);
      }
      const data = (await res.json()) as TokenResponse;
      this.accessToken = data.access_token;
      this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
      return this.accessToken;
    }

    if (!config.shiphero.username || !config.shiphero.password) {
      throw new Error(
        "ShipHero username/password not configured. Set SHIPHERO_ACCESS_TOKEN, SHIPHERO_REFRESH_TOKEN, or SHIPHERO_USERNAME + SHIPHERO_PASSWORD"
      );
    }

    const res = await fetch(config.shiphero.authUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        username: config.shiphero.username,
        password: config.shiphero.password,
      }),
    });

    if (!res.ok) {
      throw new Error(`ShipHero auth failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as TokenResponse;
    this.accessToken = data.access_token;
    this.tokenExpiresAt = Date.now() + data.expires_in * 1000;
    return this.accessToken;
  }

  async graphql<T>(query: string, variables?: Record<string, unknown>, attempt = 0): Promise<T> {
    const token = await this.authenticate();
    const res = await fetch(config.shiphero.graphqlUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query, variables }),
    });

    const json = (await res.json()) as GraphQLResponse<T>;
    if (!res.ok || json.errors?.length) {
      const msg = json.errors?.map((e) => e.message).join("; ") ?? res.statusText;
      const creditWait = msg.match(/In (\d+) seconds? you will have enough credits/i);
      if (creditWait && attempt < 5) {
        await new Promise((r) => setTimeout(r, Number(creditWait[1]) * 1000 + 500));
        return this.graphql(query, variables, attempt + 1);
      }
      throw new Error(`ShipHero GraphQL error: ${msg}`);
    }
    if (!json.data) throw new Error("ShipHero GraphQL returned no data");
    return json.data;
  }

  async getProductBySku(sku: string): Promise<ShipHeroProduct | null> {
    try {
      const data = await this.graphql<{
        product: { data: ShipHeroProduct | null };
      }>(
        `query ProductBySku($sku: String!) {
          product(sku: $sku) {
            request_id
            data {
              id
              sku
              name
              barcode
              warehouse_products {
                warehouse_id
                on_hand
              }
            }
          }
        }`,
        { sku }
      );
      return data.product.data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("Product not found") || msg.includes("Not Found")) {
        return null;
      }
      throw err;
    }
  }

  async createProduct(input: {
    name: string;
    sku: string;
    price: string;
    barcode?: string;
    onHand?: number;
  }): Promise<ShipHeroProduct> {
    const data = await this.graphql<{
      product_create: { product: ShipHeroProduct };
    }>(
      `mutation CreateProduct($data: CreateProductInput!) {
        product_create(data: $data) {
          product { id sku name }
        }
      }`,
      {
        data: {
          name: input.name,
          sku: input.sku,
          price: input.price,
          barcode: input.barcode,
          warehouse_products: [
            {
              warehouse_id: requireShipheroWarehouseId(),
              on_hand: input.onHand ?? 0,
            },
          ],
        },
      }
    );
    return data.product_create.product;
  }

  async updateProduct(input: { sku: string; name?: string; barcode?: string }): Promise<void> {
    await this.graphql(
      `mutation UpdateProduct($data: UpdateProductInput!) {
        product_update(data: $data) { request_id }
      }`,
      {
        data: {
          sku: input.sku,
          name: input.name,
          barcode: input.barcode,
        },
      }
    );
  }

  async inventoryRemove(sku: string, quantity: number, reason: string): Promise<void> {
    const data: Record<string, unknown> = {
      sku,
      warehouse_id: requireShipheroWarehouseId(),
      quantity: Math.round(quantity),
      reason,
    };
    if (config.shiphero.locationId) {
      data.location_id = config.shiphero.locationId;
    }

    await this.graphql(
      `mutation InventoryRemove($data: UpdateInventoryInput!) {
        inventory_remove(data: $data) { request_id }
      }`,
      { data }
    );
  }

  getWarehouseOnHand(product: ShipHeroProduct, warehouseId?: string): number {
    const wid = warehouseId ?? requireShipheroWarehouseId();
    const row = product.warehouse_products?.find((w) => w.warehouse_id === wid);
    return row?.on_hand ?? 0;
  }

  async inventoryReplace(sku: string, quantity: number, reason: string): Promise<void> {
    const data: Record<string, unknown> = {
      sku,
      warehouse_id: requireShipheroWarehouseId(),
      quantity: Math.round(quantity),
      reason,
    };
    if (config.shiphero.locationId) {
      data.location_id = config.shiphero.locationId;
    }

    await this.graphql(
      `mutation InventoryReplace($data: ReplaceInventoryInput!) {
        inventory_replace(data: $data) { request_id }
      }`,
      { data }
    );
  }

  async inventoryAdd(sku: string, quantity: number, reason: string): Promise<void> {
    const data: Record<string, unknown> = {
      sku,
      warehouse_id: requireShipheroWarehouseId(),
      quantity: Math.round(quantity),
      reason,
    };
    if (config.shiphero.locationId) {
      data.location_id = config.shiphero.locationId;
    }

    await this.graphql(
      `mutation InventoryAdd($data: UpdateInventoryInput!) {
        inventory_add(data: $data) { request_id }
      }`,
      { data }
    );
  }

  async createOrder(input: {
    orderNumber: string;
    partnerOrderId: string;
    shopName: string;
    lineItems: Array<{ sku: string; quantity: number; price: string; name: string }>;
    shippingAddress: Record<string, string | undefined>;
    fulfillmentStatus?: "pending" | "fulfilled";
  }): Promise<{ id: string; order_number: string }> {
    const fulfillmentStatus = input.fulfillmentStatus ?? "pending";
    const fulfilled = fulfillmentStatus === "fulfilled";

    const data = await this.graphql<{
      order_create: { order: { id: string; order_number: string } };
    }>(
      `mutation CreateOrder($data: CreateOrderInput!) {
        order_create(data: $data) {
          order { id order_number }
        }
      }`,
      {
        data: {
          order_number: input.orderNumber,
          partner_order_id: input.partnerOrderId,
          shop_name: input.shopName,
          fulfillment_status: fulfillmentStatus,
          shipping_lines: { title: "Standard", price: "0.00", carrier: "Korona" },
          shipping_address: input.shippingAddress,
          line_items: input.lineItems.map((li, index) => ({
            sku: li.sku,
            partner_line_item_id: `${input.orderNumber}-${index + 1}`.slice(0, 45),
            quantity: li.quantity,
            price: li.price,
            product_name: li.name,
            fulfillment_status: fulfillmentStatus,
            quantity_pending_fulfillment: fulfilled ? 0 : li.quantity,
            warehouse_id: requireShipheroWarehouseId(),
          })),
        },
      }
    );
    return data.order_create.order;
  }

  async findOrder(input: {
    shopName: string;
    orderNumber: string;
    partnerOrderId?: string;
  }): Promise<{ id: string; order_number: string } | null> {
    type FindOrderResponse = {
      orders: {
        data: {
          edges: Array<{ node: { id: string; order_number: string; partner_order_id?: string } }>;
        };
      };
    };

    const data = await this.graphql<FindOrderResponse>(
      `query FindOrder($shop_name: String, $order_number: String, $partner_order_id: String) {
        orders(shop_name: $shop_name, order_number: $order_number, partner_order_id: $partner_order_id) {
          data(first: 1) {
            edges {
              node {
                id
                order_number
                partner_order_id
              }
            }
          }
        }
      }`,
      {
        shop_name: input.shopName,
        order_number: input.orderNumber,
        partner_order_id: input.partnerOrderId ?? null,
      }
    );

    const node = data.orders.data.edges[0]?.node;
    if (node) return { id: node.id, order_number: node.order_number };

    if (input.partnerOrderId) {
      const fallback = await this.graphql<FindOrderResponse>(
        `query FindOrderByNumber($shop_name: String, $order_number: String) {
          orders(shop_name: $shop_name, order_number: $order_number) {
            data(first: 1) {
              edges {
                node { id order_number }
              }
            }
          }
        }`,
        { shop_name: input.shopName, order_number: input.orderNumber }
      );
      const fallbackNode = fallback.orders.data.edges[0]?.node;
      return fallbackNode ? { id: fallbackNode.id, order_number: fallbackNode.order_number } : null;
    }

    return null;
  }

  async getOrderById(orderId: string): Promise<ShipHeroOrder | null> {
    try {
      const data = await this.graphql<{
        order: { data: ShipHeroOrder | null };
      }>(
        `query OrderById($id: String!) {
          order(id: $id) {
            request_id
            data {
              id
              order_number
              partner_order_id
              fulfillment_status
              updated_at
              shipping_address {
                first_name
                last_name
                city
                state
                country
              }
              line_items(first: 50) {
                edges {
                  node {
                    id
                    sku
                    quantity
                    quantity_shipped
                    quantity_pending_fulfillment
                    fulfillment_status
                  }
                }
              }
            }
          }
        }`,
        { id: orderId }
      );
      return data.order.data;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (
        msg.includes("not found") ||
        msg.includes("Not Found") ||
        msg.includes("Invalid id")
      ) {
        return null;
      }
      throw err;
    }
  }

  async labelPrint(input: PrintLabelInput): Promise<LabelPrintResponse> {
    const data = await this.graphql<{
      label_print: LabelPrintResponse;
    }>(
      `mutation LabelPrint($data: PrintLabelInput!) {
        label_print(data: $data) {
          request_id
          complexity
          labels {
            id
            tracking_number
            tracking_url
            order_number
            carrier
            shipping_method
            status
            label {
              pdf_location
              paper_pdf_location
              thermal_pdf_location
              image_location
            }
          }
        }
      }`,
      { data: input }
    );
    return data.label_print;
  }

  async getFulfilledOrders(updatedFrom?: string): Promise<ShipHeroOrder[]> {
    const orders: ShipHeroOrder[] = [];
    let after: string | null = null;

    type FulfilledOrdersResponse = {
      orders: {
        data: {
          pageInfo: { hasNextPage: boolean; endCursor: string | null };
          edges: Array<{ node: ShipHeroOrder }>;
        };
      };
    };

    for (let page = 0; page < 50; page++) {
      const data: FulfilledOrdersResponse = await this.graphql<FulfilledOrdersResponse>(
        `query FulfilledOrders($first: Int, $after: String) {
          orders {
            data(first: $first, after: $after) {
              pageInfo { hasNextPage endCursor }
              edges {
                node {
                  id
                  order_number
                  partner_order_id
                  fulfillment_status
                  updated_at
                  line_items(first: 50) {
                    edges {
                      node {
                        sku
                        quantity
                        quantity_shipped
                        fulfillment_status
                      }
                    }
                  }
                }
              }
            }
          }
        }`,
        { first: 25, after }
      );

      const connection = data.orders.data;
      for (const edge of connection.edges) {
        const order = edge.node;
        if (!order.fulfillment_status) continue;
        const status = order.fulfillment_status.toLowerCase();
        if (!["fulfilled", "shipped", "closed"].includes(status)) continue;
        if (updatedFrom && order.updated_at && order.updated_at < updatedFrom) continue;
        orders.push(order);
      }

      if (!connection.pageInfo.hasNextPage) break;
      after = connection.pageInfo.endCursor;
    }

    return orders;
  }
}

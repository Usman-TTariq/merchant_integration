import { config } from "../config.js";
import type {
  KoronaCustomerOrder,
  KoronaInventoryListItem,
  KoronaProduct,
  KoronaProductStock,
  KoronaReceipt,
  KoronaResultList,
} from "../types/korona.js";

export class KoronaClient {
  private readonly authHeader: string;

  constructor() {
    const token = Buffer.from(`${config.korona.username}:${config.korona.password}`).toString("base64");
    this.authHeader = `Basic ${token}`;
  }

  private accountPath(suffix: string): string {
    return `${config.korona.baseUrl}/accounts/${config.korona.accountId}${suffix}`;
  }

  private async request<T>(url: string, init?: RequestInit): Promise<T> {
    const res = await fetch(url, {
      ...init,
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        Authorization: this.authHeader,
        ...init?.headers,
      },
    });

    if (!res.ok) {
      const body = await res.text();
      throw new Error(`Korona API ${res.status} ${res.statusText}: ${body.slice(0, 500)}`);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  private buildQuery(params: Record<string, string | number | undefined>): string {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") q.set(k, String(v));
    }
    const s = q.toString();
    return s ? `?${s}` : "";
  }

  async *paginate<T>(
    fetchPage: (page: number) => Promise<KoronaResultList<T> | undefined>
  ): AsyncGenerator<T[], void, unknown> {
    let page = 1;
    while (true) {
      const list = await fetchPage(page);
      if (!list) break;
      if (list.results?.length) yield list.results;
      const pagesTotal = list.pagesTotal ?? page;
      if (page >= pagesTotal) break;
      page += 1;
    }
  }

  getProducts(opts?: { revision?: number; page?: number }): Promise<KoronaResultList<KoronaProduct>> {
    const query = this.buildQuery({
      page: opts?.page ?? 1,
      size: config.sync.pageSize,
      revision: opts?.revision,
      sort: "revision",
    });
    return this.request(this.accountPath(`/products${query}`));
  }

  getProduct(productId: string): Promise<KoronaProduct> {
    return this.request(this.accountPath(`/products/${productId}`));
  }

  getReceipts(opts?: { revision?: number; page?: number }): Promise<KoronaResultList<KoronaReceipt>> {
    const query = this.buildQuery({
      page: opts?.page ?? 1,
      size: config.sync.pageSize,
      revision: opts?.revision,
      sort: "revision",
    });
    return this.request(this.accountPath(`/receipts${query}`));
  }

  getReceipt(receiptId: string): Promise<KoronaReceipt> {
    return this.request(this.accountPath(`/receipts/${receiptId}`));
  }

  getCustomerOrders(opts?: { revision?: number; page?: number }): Promise<KoronaResultList<KoronaCustomerOrder>> {
    const query = this.buildQuery({
      page: opts?.page ?? 1,
      size: config.sync.pageSize,
      revision: opts?.revision,
      sort: "revision",
    });
    return this.request(this.accountPath(`/customerOrders${query}`));
  }

  getCustomerOrder(orderId: string): Promise<KoronaCustomerOrder> {
    return this.request(this.accountPath(`/customerOrders/${orderId}`));
  }

  getProductStocks(productId: string): Promise<KoronaResultList<KoronaProductStock>> {
    const query = this.buildQuery({ size: config.sync.pageSize });
    return this.request(this.accountPath(`/products/${productId}/stocks${query}`));
  }

  /** Returns null when Korona does not track stock for this product. */
  async getProductStocksSafe(productId: string): Promise<KoronaProductStock[] | null> {
    try {
      const list = await this.getProductStocks(productId);
      return list.results ?? [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes("not tracked") || msg.includes("CONDITION_MISMATCH")) {
        return null;
      }
      throw err;
    }
  }

  updateInventoryListItems(
    inventoryId: string,
    inventoryListId: string,
    items: KoronaInventoryListItem[]
  ): Promise<unknown> {
    return this.request(
      this.accountPath(`/inventories/${inventoryId}/inventoryLists/${inventoryListId}/items`),
      { method: "PATCH", body: JSON.stringify(items) }
    );
  }
}

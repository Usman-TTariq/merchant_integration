import { config } from "../config.js";
import { KoronaClient } from "../clients/korona.js";
import { ShipHeroClient } from "../clients/shiphero.js";

export interface ServiceStatus {
  ok: boolean;
  message: string;
  detail?: string;
}

export interface DashboardStatus {
  korona: ServiceStatus;
  shiphero: ServiceStatus;
  config: {
    accountId: string;
    skuField: string;
    warehouseId: string | null;
    shipheroAuthMode: string;
    databasePath: string;
  };
}

export async function checkKorona(): Promise<ServiceStatus & { productTotal?: number }> {
  try {
    const korona = new KoronaClient();
    const list = await korona.getProducts({ page: 1 });
    return {
      ok: true,
      message: "Connected",
      detail: `${list.resultsTotal ?? 0} products in Korona`,
      productTotal: list.resultsTotal ?? 0,
    };
  } catch (err) {
    return {
      ok: false,
      message: "Connection failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function checkShipHero(): Promise<ServiceStatus> {
  if (config.shiphero.authMode === "none") {
    return { ok: false, message: "Not configured", detail: "Add ShipHero credentials in .env" };
  }

  try {
    const shiphero = new ShipHeroClient();
    await shiphero.graphql<{ account: { data: { id: string } | null } }>(
      `query { account { data { id email } } }`
    );
    return { ok: true, message: "Connected", detail: "GraphQL API responding" };
  } catch (err) {
    return {
      ok: false,
      message: "Connection failed",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function getDashboardStatus(): Promise<DashboardStatus> {
  const [korona, shiphero] = await Promise.all([checkKorona(), checkShipHero()]);
  return {
    korona,
    shiphero,
    config: {
      accountId: config.korona.accountId,
      skuField: config.sync.skuField,
      warehouseId: config.shiphero.warehouseId ?? null,
      shipheroAuthMode: config.shiphero.authMode,
      databasePath: config.sync.databasePath,
    },
  };
}

export async function getKoronaProductsLive(page = 1) {
  const korona = new KoronaClient();
  const list = await korona.getProducts({ page });
  return {
    total: list.resultsTotal ?? 0,
    pages: list.pagesTotal ?? 1,
    page: list.currentPage ?? page,
    products: (list.results ?? []).map((p) => ({
      id: p.id,
      number: p.number ?? "",
      name: p.name ?? "",
      deleted: Boolean(p.deleted),
      revision: p.revision ?? null,
      barcode: p.codes?.find((c) => c.primary)?.code ?? p.codes?.[0]?.code ?? "",
      price: p.prices?.[0]?.value ?? null,
    })),
  };
}

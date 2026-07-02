export interface KoronaReference {
  id?: string;
  number?: string;
  name?: string;
}

export interface KoronaAmount {
  value?: number;
  actual?: number;
  currency?: KoronaReference;
}

export interface KoronaProduct {
  id: string;
  revision?: number;
  number?: string;
  name?: string;
  deleted?: boolean;
  trackInventory?: boolean;
  commodityGroup?: KoronaReference;
  sector?: KoronaReference;
  assortment?: KoronaReference;
  codes?: Array<{ code?: string; productCode?: string; primary?: boolean }>;
  prices?: Array<{ value?: number; priceGroup?: KoronaReference }>;
}

export interface KoronaProductCreateResult {
  status: "OK" | "ERROR";
  id?: string;
  number?: string;
  revision?: number;
  message?: string;
  action?: string;
  href?: string;
}

export type KoronaProductCreateInput = Partial<KoronaProduct> & {
  commodityGroup?: KoronaReference;
  sector?: KoronaReference;
  assortment?: KoronaReference;
};

export interface KoronaSaleLine {
  quantity?: number;
  product?: KoronaReference;
  recognitionCode?: string;
  description?: string;
  price?: number;
}

export interface KoronaReceiptItem {
  quantity?: number;
  product?: KoronaReference;
  description?: string;
  recognitionNumber?: string;
  recognitionCode?: string;
  type?: string;
  total?: { net?: number; gross?: number };
}

export interface KoronaReceipt {
  id: string;
  revision?: number;
  number?: string;
  creationTime?: string;
  modificationTime?: string;
  cancelled?: boolean;
  voided?: boolean;
  organizationalUnit?: KoronaReference;
  pointOfSale?: KoronaReference;
  /** Legacy / alternate field name in some API examples */
  sales?: KoronaSaleLine[];
  /** Korona Cloud API v3 receipt line items */
  items?: KoronaReceiptItem[];
}

export interface KoronaCustomerOrderLine {
  quantity?: number;
  product?: KoronaReference;
  price?: number;
  description?: string;
}

export interface KoronaAddress {
  firstName?: string;
  lastName?: string;
  company?: string;
  street?: string;
  houseNumber?: string;
  zipCode?: string;
  city?: string;
  country?: KoronaReference;
  email?: string;
  phone?: string;
}

export interface KoronaCustomerOrder {
  id: string;
  revision?: number;
  number?: string;
  creationTime?: string;
  modificationTime?: string;
  deleted?: boolean;
  customer?: KoronaReference & { addresses?: KoronaAddress[] };
  deliveryAddress?: KoronaAddress;
  items?: KoronaCustomerOrderLine[];
  orderLines?: KoronaCustomerOrderLine[];
}

export interface KoronaProductStock {
  revision?: number;
  amount?: KoronaAmount | number;
  product?: KoronaReference;
  warehouse?: KoronaReference;
  listed?: boolean;
}

export interface KoronaInventoryListItem {
  product: KoronaReference;
  quantity?: KoronaAmount | number;
  stock?: { actual?: number; nominal?: number };
}

export interface KoronaResultList<T> {
  currentPage: number;
  pagesTotal: number;
  resultsTotal: number;
  resultsOfPage: number;
  results: T[];
  links?: Record<string, string>;
}

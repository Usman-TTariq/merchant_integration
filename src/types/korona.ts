export interface KoronaReference {
  id?: string;
  number?: string;
  name?: string;
}

export interface KoronaAmount {
  value?: number;
  currency?: KoronaReference;
}

export interface KoronaProduct {
  id: string;
  revision?: number;
  number?: string;
  name?: string;
  deleted?: boolean;
  codes?: Array<{ code?: string; primary?: boolean }>;
  prices?: Array<{ value?: number; priceGroup?: KoronaReference }>;
}

export interface KoronaSaleLine {
  quantity?: number;
  product?: KoronaReference;
  recognitionCode?: string;
  description?: string;
  price?: number;
}

export interface KoronaReceipt {
  id: string;
  revision?: number;
  number?: string;
  creationTime?: string;
  modificationTime?: string;
  sales?: KoronaSaleLine[];
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
  amount?: KoronaAmount;
  product?: KoronaReference;
  warehouse?: KoronaReference;
}

export interface KoronaInventoryListItem {
  product: KoronaReference;
  quantity?: KoronaAmount | number;
}

export interface KoronaResultList<T> {
  currentPage: number;
  pagesTotal: number;
  resultsTotal: number;
  resultsOfPage: number;
  results: T[];
  links?: Record<string, string>;
}

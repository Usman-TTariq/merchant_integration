export interface ShipHeroProduct {
  id: string;
  sku: string;
  name: string;
  barcode?: string;
  warehouse_products?: Array<{
    warehouse_id: string;
    on_hand?: number;
    locations?: {
      edges?: Array<{ node?: { location_id: string; quantity: number } }>;
    };
  }>;
}

export interface ShipHeroOrderLine {
  sku: string;
  quantity: number;
  quantity_shipped?: number;
  fulfillment_status?: string;
}

export interface ShipHeroOrder {
  id: string;
  order_number: string;
  partner_order_id?: string;
  fulfillment_status?: string;
  order_date?: string;
  updated_at?: string;
  shipping_address?: {
    first_name?: string;
    last_name?: string;
    company?: string;
    address1?: string;
    address2?: string;
    city?: string;
    state?: string;
    state_code?: string;
    zip?: string;
    country?: string;
    country_code?: string;
    email?: string;
    phone?: string;
  };
  line_items?: {
    edges?: Array<{ node?: ShipHeroOrderLine & { product_name?: string; price?: string } }>;
  };
}

export interface GraphQLResponse<T> {
  data?: T;
  errors?: Array<{ message: string; code?: number }>;
}

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
  id?: string;
  sku: string;
  quantity: number;
  quantity_shipped?: number;
  quantity_pending_fulfillment?: number;
  fulfillment_status?: string;
}

export interface PrintLabelPackageLineInput {
  line_item_id: string;
  quantity: number;
}

export interface PrintLabelPackageDimensions {
  weight: number;
  height: number;
  width: number;
  length: number;
}

export interface PrintLabelPackageInput {
  dimensions: PrintLabelPackageDimensions;
  line_items: PrintLabelPackageLineInput[];
}

export interface PrintLabelInput {
  order_id: string;
  shipping_carrier: string;
  shipping_method: string;
  print_invoice?: boolean;
  packages: PrintLabelPackageInput[];
}

export interface ShippingLabelFileLocations {
  pdf_location?: string | null;
  paper_pdf_location?: string | null;
  thermal_pdf_location?: string | null;
  image_location?: string | null;
}

export interface ShippingLabelResult {
  id?: string;
  tracking_number?: string | null;
  tracking_url?: string | null;
  order_number?: string | null;
  carrier?: string | null;
  shipping_method?: string | null;
  status?: string | null;
  label?: ShippingLabelFileLocations | null;
}

export interface LabelPrintResponse {
  request_id?: string;
  complexity?: number;
  labels?: ShippingLabelResult[] | null;
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

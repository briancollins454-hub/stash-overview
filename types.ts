
export interface PhysicalStockItem {
  id: string;
  ean: string;
  vendor: string;
  productCode: string;
  description: string; // Product Name
  colour: string;
  size: string;
  quantity: number;
  isEmbellished: boolean;
  clubName?: string;
  addedAt: number;
}

export interface ReturnStockItem {
  id: string;
  orderNumber: string;
  itemName: string;
  sku: string;
  quantity: number;
  addedAt: number;
  size?: string; // Matches user's SQL column
  ean?: string;  // Matches user's SQL column
}

export interface ReferenceProduct {
  ean: string;
  vendor: string;
  productCode: string;
  description: string;
  colour: string;
  size: string;
}

export interface ShopifyOrder {
  id: string;
  orderNumber: string;
  customerName: string;
  email: string;
  date: string; // ISO Date string
  updatedAt: string; // Last modification date
  closedAt?: string; // Date the order was archived/closed
  totalPrice: string;
  paymentStatus: 'paid' | 'pending' | 'refunded';
  // Fix: Added 'restocked' to the fulfillmentStatus union to match line-item possibilities and fix App.tsx logic
  fulfillmentStatus: 'fulfilled' | 'unfulfilled' | 'partial' | 'restocked';
  shippingAddress?: {
    name: string;
    address1: string;
    address2?: string;
    city: string;
    province?: string;
    zip: string;
    country: string;
    phone?: string;
  };
  shippingMethod?: string;
  shippingCost?: string;
  subtotalPrice?: string;
  taxPrice?: string;
  timelineComments: string[]; // Looking for 6-digit codes
  items: {
    id: string; // UNIQUE ID (GID) - CRITICAL for mapping
    name: string;
    quantity: number;
    fulfilledQuantity?: number; // Added to track line-item level partial shipments
    sku: string;
    ean?: string; // Barcode
    variantId?: string; // Shopify ProductVariant GID (for barcode updates)
    productType?: string; // e.g. Apparel, Service, Accessory
    vendor?: string; // Item Vendor (e.g. Nike, Stash Shop)
    itemStatus?: 'fulfilled' | 'unfulfilled' | 'restocked'; // Shopify Status
    decoStatus?: string; // Text Summary (optional now)
    linkedDecoItemId?: string; // ID of the specific matched Deco Item
    itemDecoJobId?: string; // NEW: Individual job ID for this specific line (common for MTO)
    itemDecoData?: DecoJob; // NEW: Cached deco job data for this specific line
    decoReceived?: boolean;
    decoProduced?: boolean;
    decoShipped?: boolean;
    procurementStatus?: number; 
    productionStatus?: number;
    shippingStatus?: number;
    matchConfidence?: number;
    potentialMatchName?: string;
    candidateDecoItems?: DecoItem[]; // Added to fix type error in OrderTable
    imageUrl?: string;
    price?: string;
    properties?: {
      name: string;
      value: string | number;
    }[];
    tracking?: {
      number: string;
      url: string;
      date: string;
    };
  }[];
  tags: string[]; // Used for Club Shop identification
}

export interface DecoItem {
  productCode: string;
  vendorSku?: string;
  name: string;
  quantity: number;
  ean?: string; // Added for GTIN/Barcode visibility
  status?: string;
  isReceived: boolean;
  isProduced: boolean;
  isShipped: boolean;
  procurementStatus: number;
  productionStatus: number;
  shippingStatus: number;
}

export interface DecoJob {
  id: string;
  jobNumber: string;
  poNumber: string; 
  jobName: string;
  customerName: string;
  status: string; // Changed to string for full API fidelity
  dateOrdered?: string;
  productionDueDate: string;
  dateDue?: string;
  dateShipped?: string;
  itemsProduced: number;
  totalItems: number;
  notes: string;
  productCode: string;
  items: DecoItem[];
}

export type ProductionStatus = string;

export interface UnifiedOrder {
  shopify: ShopifyOrder;
  deco?: DecoJob;
  matchStatus: 'linked' | 'unlinked';
  productionStatus: ProductionStatus;
  completionPercentage: number;
  stockCompletionPercentage: number;
  mtoCompletionPercentage: number;
  mappedPercentage?: number; // Pre-calculated Mapped percentage for eligibility
  // Count metadata for UI indicators
  mappedCount?: number;
  eligibleCount?: number;
  readyStockCount?: number;
  totalStockCount?: number;
  readyMtoCount?: number;
  totalMtoCount?: number;
  daysInProduction: number;
  daysRemaining: number; 
  slaTargetDate: string;
  mtoDaysRemaining?: number;
  mtoTargetDate?: string;
  clubName: string;
  decoJobId?: string;
  productionDueDate?: string;
  fulfillmentDate?: string;
  fulfillmentDuration?: number;
  isMto: boolean;
  hasStockItems: boolean;
  isStockDispatchReady: boolean; // Flag for unfulfilled stock items produced in Deco
  hasEmailEnquiry?: boolean;
  shipStationTracking?: {
    trackingNumber: string;
    carrier: string;
    carrierCode: string;
    shipDate: string;
    shippingCost: number;
  };
  _rawOrderDate?: Date;
  _rawDispatchDate?: Date;
  _rawProductionDate?: Date;
}

export interface ChatMessage {
  role: 'user' | 'model';
  text: string;
  timestamp: number;
}

export interface AiMappingSuggestion {
  shopifyItemId: string;
  decoItemName: string;
  confidence: number;
  reason: string;
}

export interface ProductMapping {
  shopifyPattern: string;
  decoPattern: string;
  updatedAt: string;
}

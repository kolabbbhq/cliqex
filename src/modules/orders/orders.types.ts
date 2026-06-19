import { Order, OrderItem, Customer } from '@prisma/client';

// ----------------------------------------------------------------
// CreateOrderInput
// ----------------------------------------------------------------
export interface CreateOrderInput {
  customerId: string;
  serviceType: 'GROCERY' | 'ERRAND' | 'CLEANING';
  sourceType?: 'TEXT' | 'IMAGE' | 'VOICE';
  rawText?: string;
  rawMediaUrl?: string;
  deliveryAddress?: string;
  scheduledAt?: Date; // for cleaning bookings
  items?: {
    name: string;
    nameLower: string;
    quantity: string;
    sort?: number;
  }[];

  // ✅ populated when order comes from WhatsApp Flow
  flowData?: {
     serviceLabel?: string;   // ← add this line
    itemList: string;
    budget: number;
    preferredStore?: string;
    area: string;
    areaLabel: string;
    additionalInfo?: string;
    phoneNumber: string;
  };
}

// ----------------------------------------------------------------
// OrderWithItems
// All Decimal fields are already converted to number by mapOrder()
// in orders.repository.ts — so we type them as number here
// ----------------------------------------------------------------
export interface OrderWithItems extends Omit<Order, 'deliveryFee' | 'subtotal' | 'total'> {
  deliveryFee: number;
  subtotal: number;
  total: number;
  items: OrderItemNormalised[];
  customer: { id: string; phone: string; name: string | null };
  buddy?: { id: string; name: string; phone: string } | null;
}

export interface OrderItemNormalised extends Omit<OrderItem, 'unitPrice' | 'aiSuggestedPrice'> {
  unitPrice: number | null;
  aiSuggestedPrice: number | null;
}

// ----------------------------------------------------------------
// PaginatedOrders
// ----------------------------------------------------------------
export interface PaginatedOrders {
  data: OrderWithItems[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

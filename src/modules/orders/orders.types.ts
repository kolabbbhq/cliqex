import { Order, OrderItem } from '@prisma/client';

export interface CreateOrderInput {
  customerId: string;
  serviceType: string;
  sourceType?: 'TEXT' | 'IMAGE' | 'VOICE';
  rawText?: string;
  rawMediaUrl?: string;
  deliveryAddress?: string;
  deliveryFee?: number;      // ✅ pre-filled from area config
  scheduledAt?: Date;
    notes?: string;        // ← add

  items?: {
    name: string;
    nameLower: string;
    quantity: string;
    sort?: number;
  }[];
  flowData?: {
  serviceLabel?: string;
  itemList?: string;
  budget?: number;
  preferredStore?: string;
  area?: string;
  areaLabel?: string;
  additionalInfo?: string;
  phoneNumber?: string;
  tableNumber?: string;   // ← add
  source?: string;        // ← add
};
}

export interface OrderWithItems extends Omit<Order, 'deliveryFee' | 'subtotal' | 'total' | 'serviceCharge' | 'vatAmount'> {
  deliveryFee: number;
  subtotal: number;
  serviceCharge: number;    // ✅
  vatAmount: number;        // ✅
  total: number;
  items: OrderItemNormalised[];
  customer: { id: string; phone: string; name: string | null };
  buddy?: { id: string; name: string; phone: string } | null;
}

export interface OrderItemNormalised extends Omit<OrderItem, 'unitPrice' | 'aiSuggestedPrice'> {
  unitPrice: number | null;
  aiSuggestedPrice: number | null;
}

export interface PaginatedOrders {
  data: OrderWithItems[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}
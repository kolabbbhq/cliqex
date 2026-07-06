import { OrderStatus, SourceType } from '@prisma/client';

export type ServiceType = string;

export interface ParsedOrderItem {
  name: string;
  nameLower: string;
  quantity: string;
  sort: number;
  isAiExtracted?: boolean;
  aiSuggestedPrice?: number;
  aiConfidence?: number;
}


export interface CreateOrderInput {
  customerId: string;
  serviceType: ServiceType;
  sourceType: SourceType;
  rawText?: string;
  rawMediaUrl?: string;
  items?: ParsedOrderItem[];
  deliveryAddress?: string;
  scheduledAt?: Date;
}


export interface OrderWithItems {
  id: string;
  orderNumber: string;
  customerId: string;
  buddyId: string | null;
  serviceType: ServiceType;
  status: OrderStatus;
  sourceType: SourceType;
  rawText: string | null;
  rawMediaUrl: string | null;
  aiExtracted: boolean;
  deliveryFee: number;
  subtotal: number;
  total: number;
  deliveryAddress: string | null;
  scheduledAt: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  items: OrderItemView[];
  customer: {
    id: string;
    phone: string;
    name: string | null;
  };
}

export interface OrderItemView {
  id: string;
  name: string;
  quantity: string;
  unitPrice: number | null;
  aiSuggestedPrice: number | null;
  aiConfidence: number | null;
  isAiExtracted: boolean;
  sort: number;
}


export interface PaginatedOrders {
  data: OrderWithItems[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}


export interface UpdateItemPriceInput {
  itemId: string;
  unitPrice: number;
}

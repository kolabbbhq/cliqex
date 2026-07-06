import { OrderStatus } from '@prisma/client';

export interface QuotePreview {
  orderId: string;
  orderNumber: string;
  customer: {
    id: string;
    phone: string;
    name: string | null;
  };
  serviceType: string;
  items: QuoteItemPreview[];
  subtotal: number;
  deliveryFee: number;
  serviceCharge: number;   // ✅
  vatAmount: number;       // ✅
  total: number;
  whatsappPreview: string;
}

export interface QuoteItemPreview {
  id: string;
  name: string;
  quantity: string;
  unitPrice: number | null;
  aiSuggestedPrice: number | null;
  aiConfidence: number | null;
  isAiExtracted: boolean;
}

export interface SendQuoteResult {
  success: boolean;
  orderNumber: string;
  total: number;
  sentAt: Date;
}

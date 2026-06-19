import { OrderStatus, ServiceType } from '@prisma/client';

// ----------------------------------------------------------------
// Quote preview — what the CRM shows before admin sends
// ----------------------------------------------------------------
export interface QuotePreview {
  orderId: string;
  orderNumber: string;
  customer: {
    id: string;
    phone: string;
    name: string | null;
  };
  serviceType: ServiceType;
  items: QuoteItemPreview[];
  subtotal: number;
  deliveryFee: number;
  total: number;
  whatsappPreview: string; // the exact message that will be sent
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

// ----------------------------------------------------------------
// Send quote result
// ----------------------------------------------------------------
export interface SendQuoteResult {
  success: boolean;
  orderNumber: string;
  total: number;
  sentAt: Date;
}
